// core/restore-manager.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yauzl from 'yauzl';
import ScriptHeaderParser from './script-header-parser';
import BackupManager from './backup-manager';
import { isDerivedArtifact } from './backup-scope';

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

interface SettingsManagerLike {
  init(): void;
}

interface StateManagerLike {
  getEnabledScripts(): string[];
}

interface DependencyManagerLike {
  install(dependencies: string[], force?: boolean): Promise<void>;
}

interface CardManagerLike {
  performStartupCleanup(knownCardNames: string[]): Promise<void>;
}

interface ScriptWatcherLike {
  setPaused(paused: boolean): void;
}

interface WorkerManagerLike {
  workers: Map<string, unknown>;
  getScripts(): string[];
  stopScript(filename: string, reason?: string): void;
  startScript(filename: string): void;
  on(event: 'script_exit', listener: (data: { filename: string }) => void): void;
  off(event: 'script_exit', listener: (data: { filename: string }) => void): void;
}

interface RestoreManagerConfig {
  SCRIPTS_DIR: string;
}

interface RestoreDiff {
  added: string[];
  changed: string[];
  deleted: string[];
}

interface PendingRestore {
  tempDir: string;
  diff: RestoreDiff;
  createdAt: number;
}

interface RestoreResult {
  preRestoreSnapshot: string;
  filesApplied: number;
}

const RESTORE_TMP_DIRNAME = '.restore-tmp';
const PENDING_RESTORE_TTL_MS = 30 * 60 * 1000;
const WORKER_STOP_TIMEOUT_MS = 5000;
const AUTOSTART_STAGGER_MS = 300;
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git']);

/**
 * Orchestrates the rare, disaster-recovery zip restore: upload -> diff -> selective apply ->
 * worker pause/resume. Deliberately scoped as a heavy, occasional tool (day-to-day single-file
 * recovery is git-manager.ts's job) — see docs/internal/backup-concept.md.
 */
class RestoreManager {
  private logManager: LogManagerLike;
  private settingsManager: SettingsManagerLike;
  private stateManager: StateManagerLike;
  private depManager: DependencyManagerLike;
  private workerManager: WorkerManagerLike;
  private cardManager: CardManagerLike;
  private backupManager: BackupManager;
  private scriptWatcher: ScriptWatcherLike | null;
  private scriptsDir: string;
  private tmpRoot: string;
  private pending = new Map<string, PendingRestore>();

  constructor(
    logManager: LogManagerLike,
    settingsManager: SettingsManagerLike,
    stateManager: StateManagerLike,
    depManager: DependencyManagerLike,
    workerManager: WorkerManagerLike,
    cardManager: CardManagerLike,
    backupManager: BackupManager,
    scriptWatcher: ScriptWatcherLike | null,
    config: RestoreManagerConfig
  ) {
    this.logManager = logManager;
    this.settingsManager = settingsManager;
    this.stateManager = stateManager;
    this.depManager = depManager;
    this.workerManager = workerManager;
    this.cardManager = cardManager;
    this.backupManager = backupManager;
    this.scriptWatcher = scriptWatcher;
    this.scriptsDir = config.SCRIPTS_DIR;
    // Deliberately os.tmpdir(), not anywhere under SCRIPTS_DIR (STORAGE_DIR is a SUBDIRECTORY
    // of SCRIPTS_DIR, not a sibling — nesting the scratch dir there would make it show up as
    // "deleted" in the diff against SCRIPTS_DIR's own current-state walk, self-referentially).
    this.tmpRoot = path.join(os.tmpdir(), RESTORE_TMP_DIRNAME);
  }

  /** Extracts an uploaded backup zip to an isolated scratch dir (never SCRIPTS_DIR/BACKUP_DIR
   * directly, so a bad zip can't collide with anything live) and diffs it against the current
   * working tree. Returns a restoreId the UI carries through diff-review -> apply. */
  async unpackToTemp(zipBuffer: Buffer): Promise<{ restoreId: string; diff: RestoreDiff }> {
    this._pruneStalePending();

    const restoreId = crypto.randomUUID();
    const tempDir = path.join(this.tmpRoot, restoreId);
    fs.mkdirSync(tempDir, { recursive: true });

    let zipfile: yauzl.ZipFile;
    try {
      zipfile = await yauzl.fromBufferPromise(zipBuffer, { lazyEntries: true, strictFileNames: true });
    } catch (e) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw new Error(`Invalid zip file: ${(e as Error).message}`, { cause: e });
    }

    for await (const entry of zipfile.eachEntry()) {
      const destPath = path.join(tempDir, entry.fileName);
      // Zip-slip guard: refuse any entry that would resolve outside tempDir.
      if (!destPath.startsWith(tempDir + path.sep) && destPath !== tempDir) continue;

      if (/[/\\]$/.test(entry.fileName)) {
        fs.mkdirSync(destPath, { recursive: true });
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const readStream = await zipfile.openReadStreamPromise(entry);
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(destPath);
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
      });
    }

    const diff = this.diffAgainstCurrent(tempDir);
    this.pending.set(restoreId, { tempDir, diff, createdAt: Date.now() });
    return { restoreId, diff };
  }

  getPendingDiff(restoreId: string): RestoreDiff | undefined {
    return this.pending.get(restoreId)?.diff;
  }

  discardPending(restoreId: string): void {
    const pending = this.pending.get(restoreId);
    if (!pending) return;
    fs.rmSync(pending.tempDir, { recursive: true, force: true });
    this.pending.delete(restoreId);
  }

  private _pruneStalePending(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) {
      if (now - p.createdAt > PENDING_RESTORE_TTL_MS) this.discardPending(id);
    }
  }

  private _walk(dir: string, base: string = dir): string[] {
    if (!fs.existsSync(dir)) return [];
    let results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        results = results.concat(this._walk(full, base));
      } else if (!isDerivedArtifact(rel)) {
        // Same exclusion list backup-manager.ts uses when writing the zip (backup-scope.ts) —
        // these can never be IN the zip by design, so without this they'd show up as "deleted"
        // on every single restore diff even though nothing was actually lost.
        results.push(rel);
      }
    }
    return results;
  }

  diffAgainstCurrent(tempDir: string): RestoreDiff {
    const zipFiles = this._walk(tempDir);
    const currentFiles = new Set(this._walk(this.scriptsDir));

    const added: string[] = [];
    const changed: string[] = [];
    for (const rel of zipFiles) {
      const curPath = path.join(this.scriptsDir, rel);
      if (!fs.existsSync(curPath)) {
        added.push(rel);
        continue;
      }
      const a = fs.readFileSync(path.join(tempDir, rel));
      const b = fs.readFileSync(curPath);
      if (!a.equals(b)) changed.push(rel);
    }

    const zipSet = new Set(zipFiles);
    const deleted = [...currentFiles].filter((rel) => !zipSet.has(rel));

    return { added: added.sort(), changed: changed.sort(), deleted: deleted.sort() };
  }

  /** File-copy step only — never called directly, only from runFullRestore() after workers
   * are stopped. */
  private applyRestore(restoreId: string, selectedPaths: string[]): number {
    const pending = this.pending.get(restoreId);
    if (!pending) throw new Error('Unknown or expired restore session');
    const selected = new Set(selectedPaths);
    let applied = 0;

    for (const rel of [...pending.diff.added, ...pending.diff.changed]) {
      if (!selected.has(rel)) continue;
      const dest = path.join(this.scriptsDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(pending.tempDir, rel), dest);
      applied++;
    }
    for (const rel of pending.diff.deleted) {
      if (!selected.has(rel)) continue;
      const dest = path.join(this.scriptsDir, rel);
      if (fs.existsSync(dest)) fs.rmSync(dest);
      applied++;
    }
    return applied;
  }

  /** Stops every currently running worker and waits for confirmed exit (via `script_exit`),
   * racing a hard timeout — logs and proceeds rather than blocking indefinitely on a stuck
   * worker (full teardown of one worker can legitimately take ~2.2s). */
  private async stopAllWorkers(): Promise<void> {
    const running = [...this.workerManager.workers.keys()];
    if (running.length === 0) return;

    const allStopped = Promise.all(
      running.map(
        (filename) =>
          new Promise<void>((resolve) => {
            if (!this.workerManager.workers.has(filename)) return resolve();
            const onExit = (d: { filename: string }): void => {
              if (d.filename !== filename) return;
              this.workerManager.off('script_exit', onExit);
              resolve();
            };
            this.workerManager.on('script_exit', onExit);
            this.workerManager.stopScript(filename, 'restore in progress');
          })
      )
    );
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, WORKER_STOP_TIMEOUT_MS));

    const winner = await Promise.race([allStopped.then(() => 'stopped'), timeout.then(() => 'timeout')]);
    if (winner === 'timeout') {
      this.logManager.add(
        'warn',
        'Restore',
        `[Restore] Timed out waiting for all workers to stop after ${WORKER_STOP_TIMEOUT_MS}ms — proceeding anyway.`
      );
    }
  }

  /** Staggered restart (300ms apart), matching kernel.ts's own autostart loop — firing every
   * worker's MQTT discovery / HA service calls in the same tick can overwhelm HA. */
  private async restartAllWorkers(): Promise<void> {
    const enabled = this.stateManager.getEnabledScripts();
    for (const file of enabled) {
      const fullPath = path.join(this.scriptsDir, file);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const meta: any = ScriptHeaderParser.parse(fullPath);
        const dependencies = 'dependencies' in meta ? meta.dependencies : [];
        if (dependencies.length > 0) await this.depManager.install(dependencies, false);
      } catch (e) {
        this.logManager.add(
          'warn',
          'Restore',
          `[Restore] Dependency install failed for ${file}: ${(e as Error).message}`
        );
      }
      this.workerManager.startScript(file);
      await new Promise((r) => setTimeout(r, AUTOSTART_STAGGER_MS));
    }
  }

  /** Same card-cleanup logic as kernel.ts's post-boot pass: scripts self-install their cards
   * when their worker starts (already covered by restartAllWorkers), this just removes orphaned
   * Lovelace resources/card files for scripts that no longer exist or no longer carry @card. */
  private async rebuildCards(): Promise<void> {
    const knownCardNames = this.workerManager
      .getScripts()
      .map((p) => {
        const meta: any = ScriptHeaderParser.parse(p);
        if (!meta.card) return null;
        return path.basename(p, path.extname(p)) + '-card';
      })
      .filter((name): name is string => Boolean(name));

    await this.cardManager.performStartupCleanup(knownCardNames);
  }

  /** Reuses BackupManager's zip-write logic, writing into its dedicated pre-restore bucket
   * (separate 5-slot retention — a restore mistake can't get rotated away by an unrelated
   * scheduled backup). */
  async createPreRestoreSnapshot(): Promise<{ path: string; filename: string }> {
    return this.backupManager.createPreRestoreSnapshot();
  }

  /** The full sequence: pre-restore snapshot -> pause watcher -> stop workers -> apply selected
   * changes -> reload settings -> restart workers -> rebuild cards -> resume watcher. A full
   * addon restart is still recommended afterward (surfaced in the UI, not here) for guaranteed
   * MQTT/webhook config reload — settingsManager.init() only refreshes the in-memory settings
   * object and the Settings UI, not every manager's live connection. */
  async runFullRestore(restoreId: string, selectedPaths: string[]): Promise<RestoreResult> {
    if (!this.pending.has(restoreId)) throw new Error('Unknown or expired restore session');

    const snapshot = await this.createPreRestoreSnapshot();
    this.logManager.add('info', 'Restore', `[Restore] Pre-restore snapshot created: ${snapshot.filename}.`);

    this.scriptWatcher?.setPaused(true);
    try {
      await this.stopAllWorkers();
      const filesApplied = this.applyRestore(restoreId, selectedPaths);
      this.settingsManager.init();
      await this.restartAllWorkers();
      await this.rebuildCards();

      this.logManager.add('info', 'Restore', `[Restore] Complete — ${filesApplied} file(s) applied.`);
      return { preRestoreSnapshot: snapshot.filename, filesApplied };
    } finally {
      this.scriptWatcher?.setPaused(false);
      this.discardPending(restoreId);
    }
  }
}

export = RestoreManager;
