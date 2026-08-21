// core/backup-manager.ts
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ZipArchive } from 'archiver';
import { createClient } from 'webdav';
import * as cron from 'node-cron';

interface BackupSettings {
  schedule_enabled?: boolean;
  schedule_frequency?: 'daily' | 'weekly';
  schedule_weekday?: string;
  schedule_time?: string;
  retention_count?: number;
  webdav_enabled?: boolean;
  webdav_url?: string;
  webdav_username?: string;
  webdav_password?: string;
}

interface SettingsManagerLike {
  on(event: 'settings_updated', listener: (settings: { backup?: BackupSettings }) => void): void;
  getSettings(): { backup?: BackupSettings };
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

interface BackupManagerConfig {
  SCRIPTS_DIR: string;
  BACKUP_DIR: string;
  PRE_RESTORE_BACKUP_DIR: string;
}

interface BackupEntry {
  filename: string;
  size: number;
  created: string;
  location: 'local' | 'webdav';
}

interface WebDavTestConfig {
  url: string;
  username?: string;
  password?: string;
}

interface WebDavResult {
  success: boolean;
  error?: string;
}

const PRE_RESTORE_RETENTION_COUNT = 5;
const WEBDAV_TEST_TIMEOUT_MS = 8000;

const WEEKDAY_TO_CRON: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * BackupManager owns creating, scheduling, retaining, and (optionally)
 * off-boxing ZIP backups of SCRIPTS_DIR. Modeled on MqttManager/WebhookManager:
 * reads settings.backup lazily, reacts to settings_updated, "start doing work"
 * (the cron schedule) is a separate explicit step from construction.
 */
class BackupManager extends EventEmitter {
  private settingsManager: SettingsManagerLike;
  private logManager: LogManagerLike;
  private scriptsDir: string;
  private backupDir: string;
  private preRestoreDir: string;
  private task: cron.ScheduledTask | null = null;

  constructor(settingsManager: SettingsManagerLike, logManager: LogManagerLike, config: BackupManagerConfig) {
    super();
    this.settingsManager = settingsManager;
    this.logManager = logManager;
    this.scriptsDir = config.SCRIPTS_DIR;
    this.backupDir = config.BACKUP_DIR;
    this.preRestoreDir = config.PRE_RESTORE_BACKUP_DIR;

    this.settingsManager.on('settings_updated', (settings) => {
      if (settings.backup) this._reschedule(settings.backup);
    });
  }

  /** Starts the cron schedule from current settings. Call once from kernel.start(). */
  start(): void {
    this._reschedule(this.settingsManager.getSettings().backup || {});
  }

  /** Stops the cron schedule, if any. Call from kernel.shutdown(). */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  private _reschedule(settings: BackupSettings): void {
    this.stop();
    if (!settings.schedule_enabled) return;

    const [hourStr, minuteStr] = (settings.schedule_time || '03:00').split(':');
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      this.logManager.add(
        'warn',
        'Backup',
        `[Backup] Invalid schedule_time "${settings.schedule_time}" — schedule not set.`
      );
      return;
    }

    const dayField =
      settings.schedule_frequency === 'weekly' ? String(WEEKDAY_TO_CRON[settings.schedule_weekday || 'sun'] ?? 0) : '*';
    const cronExpr = `${minute} ${hour} * * ${dayField}`;

    if (!cron.validate(cronExpr)) {
      this.logManager.add('warn', 'Backup', `[Backup] Generated invalid cron expression "${cronExpr}" — schedule not set.`);
      return;
    }

    this.task = cron.schedule(cronExpr, () => {
      this.createBackup('scheduled').catch((e) => {
        this.logManager.add('error', 'Backup', `[Backup] Scheduled backup failed: ${(e as Error).message}`);
      });
    });
    this.logManager.add('debug', 'Backup', `[Backup] Scheduled: "${cronExpr}".`);
  }

  /** Streams SCRIPTS_DIR into a ZIP at destPath, same glob/ignore pattern as the manual download route. */
  private writeZipTo(destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const archive = new ZipArchive({ zlib: { level: 9 } });
      const output = fs.createWriteStream(destPath);

      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.glob('**/*', {
        cwd: this.scriptsDir,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      archive.finalize();
    });
  }

  /** Creates a timestamped backup zip, applies retention, and best-effort uploads to WebDAV if configured. */
  async createBackup(reason: 'manual' | 'scheduled'): Promise<{ path: string; filename: string }> {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const suffix = reason === 'scheduled' ? '-auto' : '';
    const filename = `js-automations-backup-${yyyy}${mm}${dd}-${hh}${min}${suffix}.zip`;
    const filePath = path.join(this.backupDir, filename);

    await this.writeZipTo(filePath);
    this.logManager.add('debug', 'Backup', `[Backup] Created ${filename} (${reason}).`);
    this.emit('backup_created', { filename, reason });

    await this.applyRetention();

    const settings = this.settingsManager.getSettings().backup;
    if (settings?.webdav_enabled) {
      const result = await this.uploadToWebDav(filePath);
      if (!result.success) {
        this.logManager.add('warn', 'Backup', `[Backup] WebDAV upload failed, local copy stays authoritative: ${result.error}`);
      }
    }

    return { path: filePath, filename };
  }

  /** Deletes the oldest backups in a directory beyond a retention count. Local .zip files only. */
  private applyRetentionIn(dir: string, retentionCount: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const zips = entries
      .filter((e) => e.isFile() && e.name.endsWith('.zip'))
      .map((e) => {
        const filePath = path.join(dir, e.name);
        return { filePath, mtime: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of zips.slice(retentionCount)) {
      try {
        fs.unlinkSync(old.filePath);
      } catch (e) {
        this.logManager.add('warn', 'Backup', `[Backup] Failed to delete old backup ${old.filePath}: ${(e as Error).message}`);
      }
    }
  }

  /** Applies the configured retention to the local backup dir. Pre-restore snapshots (Phase 3) live in
   * their own subfolder with a fixed, separate retention so a restore mistake can't be rotated away by
   * an unrelated scheduled backup. */
  async applyRetention(): Promise<void> {
    const settings = this.settingsManager.getSettings().backup;
    const retentionCount = settings?.retention_count && settings.retention_count > 0 ? settings.retention_count : 14;
    this.applyRetentionIn(this.backupDir, retentionCount);
    this.applyRetentionIn(this.preRestoreDir, PRE_RESTORE_RETENTION_COUNT);
  }

  listBackups(): BackupEntry[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.zip'))
      .map((e) => {
        const filePath = path.join(this.backupDir, e.name);
        const stat = fs.statSync(filePath);
        return { filename: e.name, size: stat.size, created: stat.mtime.toISOString(), location: 'local' as const };
      })
      .sort((a, b) => (a.created < b.created ? 1 : -1));
  }

  deleteBackup(filename: string): boolean {
    // Reject path separators outright rather than relying on path.basename to silently
    // strip them — an accepted "../../etc/passwd"-shaped filename must never resolve.
    if (!filename || filename.includes('/') || filename.includes('\\') || !filename.endsWith('.zip')) return false;
    const filePath = path.join(this.backupDir, filename);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private buildWebDavClient(config: { url: string; username?: string; password?: string }) {
    return createClient(config.url, {
      username: config.username || undefined,
      password: config.password || undefined,
    });
  }

  async uploadToWebDav(filePath: string): Promise<WebDavResult> {
    const settings = this.settingsManager.getSettings().backup;
    if (!settings?.webdav_url) return { success: false, error: 'No WebDAV URL configured' };

    try {
      const client = this.buildWebDavClient({
        url: settings.webdav_url,
        username: settings.webdav_username,
        password: settings.webdav_password,
      });
      const data = fs.readFileSync(filePath);
      await client.putFileContents(path.basename(filePath), data, { overwrite: true });
      this.logManager.add('debug', 'Backup', `[Backup] Uploaded ${path.basename(filePath)} to WebDAV.`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  static async testWebDavConnection(config: WebDavTestConfig): Promise<WebDavResult> {
    try {
      const client = createClient(config.url, {
        username: config.username || undefined,
        password: config.password || undefined,
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), WEBDAV_TEST_TIMEOUT_MS)
      );
      await Promise.race([client.exists('/'), timeout]);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }
}

export = BackupManager;
