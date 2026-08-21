// core/git-manager.ts
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { simpleGit, CheckRepoActions } from 'simple-git';
import type { SimpleGit } from 'simple-git';

interface VersioningSettings {
  author_name?: string;
  author_email?: string;
  github_enabled?: boolean;
  github_repo_url?: string;
  github_token?: string;
}

interface SettingsManagerLike {
  getSettings(): { versioning?: VersioningSettings };
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

interface CommitEntry {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
}

interface GitStatus {
  hasRepo: boolean;
  hasRemote: boolean;
  ahead: number;
  dirty: boolean;
  lastPushError: string | null;
}

interface DeletedScriptEntry {
  path: string;
  lastCommitHash: string;
  lastCommitDate: string;
}

interface GitResult {
  success: boolean;
  error?: string;
}

// Only these live-in-repo directories/files are ever versioned. settings.json (.storage/) and the
// runtime store (data/) are deliberately excluded — they change on every automation tick and would
// flood history with noise instead of real code changes (that's the zip backup's job instead).
const GITIGNORE_CONTENT = ['.storage/', 'data/', 'node_modules/', ''].join('\n');
const TRACKED_EXTENSIONS = ['.ts', '.js', '.blocks'];

class GitManager extends EventEmitter {
  private settingsManager: SettingsManagerLike;
  private logManager: LogManagerLike;
  private scriptsDir: string;
  private git: SimpleGit;
  private lastPushError: string | null = null;

  constructor(settingsManager: SettingsManagerLike, logManager: LogManagerLike, scriptsDir: string) {
    super();
    this.settingsManager = settingsManager;
    this.logManager = logManager;
    this.scriptsDir = scriptsDir;
    this.git = simpleGit(scriptsDir);
  }

  private getVersioningSettings(): VersioningSettings {
    return this.settingsManager.getSettings().versioning || {};
  }

  /** Checks whether SCRIPTS_DIR itself is a repo ROOT (has its own .git directly inside it) —
   * deliberately NOT the default checkIsRepo(), which checks "is this path inside ANY repo's
   * work tree" and returns true whenever SCRIPTS_DIR happens to be a subdirectory of an
   * unrelated outer repo (e.g. this addon's own project checkout in local dev mode, where
   * SCRIPTS_DIR defaults to `<repo>/scripts`). That false positive meant ensureRepo() never
   * actually ran `git init` there, and every commit() silently operated on the addon's own
   * project history instead of a dedicated scripts repo — caught live when a user's first
   * commit reported "nothing to commit" despite never having versioned anything. */
  async hasRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    } catch {
      return false;
    }
  }

  private async applyAuthorConfig(): Promise<void> {
    const settings = this.getVersioningSettings();
    await this.git.raw(['config', 'user.name', settings.author_name || 'JS Automations']);
    await this.git.raw(['config', 'user.email', settings.author_email || 'jsa@localhost']);
  }

  /** Lazily initializes the local repo (first commit attempt only, not at boot — a fresh install
   * shouldn't get a surprise .git) plus a .gitignore that keeps settings/store out of history. */
  async ensureRepo(): Promise<void> {
    const gitignorePath = path.join(this.scriptsDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
    }
    if (await this.hasRepo()) return;

    await this.git.init();
    await this.applyAuthorConfig();
    this.logManager.add('debug', 'Git', '[Git] Initialized local repository in SCRIPTS_DIR.');
  }

  /** Commits currently staged-worthy changes (new + modified, deletions only if opted in via the
   * delete-dialog checkbox). Returns hash: null when there was nothing to commit.
   *
   * `paths`, when given, scopes staging to exactly those paths — this is what the editor's
   * per-script Commit button passes (just the open file), so clicking Commit on one script
   * never sweeps up unrelated pending changes elsewhere in the repo. Omitting `paths` stages
   * everything pending (used by nothing in the UI today, kept as the flexible default). */
  async commit(
    message: string,
    options: { includeDeletions?: boolean; paths?: string[] } = {}
  ): Promise<{ hash: string | null; filesChanged: number }> {
    await this.ensureRepo();
    await this.applyAuthorConfig();

    const status = await this.git.status();
    let toStage = [...status.not_added, ...status.modified, ...status.renamed.map((r) => r.to)];
    if (options.includeDeletions) toStage.push(...status.deleted);
    if (options.paths) {
      const scope = new Set(options.paths);
      // .gitignore is infrastructure ensureRepo() creates, not a user file the wizard could ever
      // let someone select — fold it into every scoped commit so it doesn't sit untracked forever.
      toStage = toStage.filter((p) => scope.has(p) || p === '.gitignore');
    }
    if (toStage.length === 0) {
      return { hash: null, filesChanged: 0 };
    }
    await this.git.add(toStage);

    // Pathspec-scoped commit (not a bare `git commit`) — even if something unrelated was
    // already sitting staged in the index for any reason, only toStage's paths end up in this
    // commit. Belt-and-suspenders on top of the add() above already only staging that scope.
    const result = await this.git.commit(message, toStage);
    this.logManager.add('debug', 'Git', `[Git] Committed ${toStage.length} file(s): ${result.commit}.`);
    this.emit('git_status_changed');
    return { hash: result.commit || null, filesChanged: toStage.length };
  }

  async log(filePath?: string): Promise<CommitEntry[]> {
    if (!(await this.hasRepo())) return [];
    const result = await this.git.log(filePath ? { file: filePath, maxCount: 200 } : { maxCount: 200 });
    return result.all.map((c) => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 7),
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  }

  async showFileAtCommit(hash: string, filePath: string): Promise<string> {
    return this.git.show([`${hash}:${filePath}`]);
  }

  /** Diffs a file's content between two commits — for browsing history, not the common
   * commit-vs-current-editor-buffer case (the frontend does that one client-side against the
   * already-open Monaco buffer, using just showFileAtCommit for the historical side). */
  async diff(hashBefore: string, hashAfter: string, filePath: string): Promise<{ before: string; after: string }> {
    const [before, after] = await Promise.all([
      this.showFileAtCommit(hashBefore, filePath).catch(() => ''),
      this.showFileAtCommit(hashAfter, filePath).catch(() => ''),
    ]);
    return { before, after };
  }

  /** Restores one file's working-tree content to a past commit. Working tree only — never
   * auto-commits; the user reviews and commits explicitly afterward, same as any other change. */
  async restoreFileToCommit(hash: string, filePath: string): Promise<void> {
    await this.git.raw(['checkout', hash, '--', filePath]);
  }

  /** Non-destructive undo: creates a new commit reverting the given one. `git reset --hard` is
   * deliberately never exposed — it would destroy history. */
  async revertCommit(hash: string): Promise<void> {
    await this.git.raw(['revert', hash, '--no-edit']);
    this.emit('git_status_changed');
  }

  /** Scripts that exist somewhere in git history but are missing from disk right now — feeds the
   * Creation Wizard's "Aus Repo" tab. */
  async listDeletedScripts(): Promise<DeletedScriptEntry[]> {
    if (!(await this.hasRepo())) return [];

    const raw = await this.git.raw(['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A']);
    const everCommittedPaths = new Set(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && TRACKED_EXTENSIONS.some((ext) => l.endsWith(ext)))
    );

    const results: DeletedScriptEntry[] = [];
    for (const relPath of everCommittedPaths) {
      if (fs.existsSync(path.join(this.scriptsDir, relPath))) continue;
      try {
        const lastLog = await this.git.log({ file: relPath, maxCount: 1 });
        if (lastLog.latest) {
          results.push({ path: relPath, lastCommitHash: lastLog.latest.hash, lastCommitDate: lastLog.latest.date });
        }
      } catch {
        // Path had no resolvable history (e.g. renamed away) — skip rather than fail the whole list.
      }
    }
    return results.sort((a, b) => (a.lastCommitDate < b.lastCommitDate ? 1 : -1));
  }

  /** Writes a deleted script's last committed content back to disk. Does not commit — the file
   * just reappears as an uncommitted-clean script, same as anything restored from history. */
  async restoreDeletedScript(filePath: string): Promise<void> {
    const content = await this.showFileAtCommit('HEAD', filePath);
    const absPath = path.join(this.scriptsDir, filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }

  async getStatus(): Promise<GitStatus> {
    const hasRepo = await this.hasRepo();
    if (!hasRepo) {
      return { hasRepo: false, hasRemote: false, ahead: 0, dirty: false, lastPushError: this.lastPushError };
    }
    const settings = this.getVersioningSettings();
    const status = await this.git.status();
    return {
      hasRepo: true,
      hasRemote: !!settings.github_enabled && !!settings.github_repo_url,
      ahead: status.ahead,
      dirty: !status.isClean(),
      lastPushError: this.lastPushError,
    };
  }

  /** https://github.com/user/repo.git -> https://TOKEN@github.com/user/repo.git. Built fresh per
   * call and never persisted — the caller must never `git remote set-url` with this. */
  static buildAuthenticatedUrl(repoUrl: string, token: string): string {
    return repoUrl.replace(/^https:\/\//, `https://${token}@`);
  }

  /** Separate from commit() by design — a flaky GitHub connection should never block committing. */
  async push(): Promise<GitResult> {
    const settings = this.getVersioningSettings();
    if (!settings.github_enabled || !settings.github_repo_url) {
      return { success: false, error: 'No GitHub remote configured' };
    }
    if (!(await this.hasRepo())) {
      return { success: false, error: 'No local repository yet — commit something first' };
    }
    try {
      const status = await this.git.status();
      const branch = status.current || 'main';
      const url = settings.github_token
        ? GitManager.buildAuthenticatedUrl(settings.github_repo_url, settings.github_token)
        : settings.github_repo_url;
      await this.git.push([url, `HEAD:refs/heads/${branch}`]);
      this.lastPushError = null;
      this.logManager.add('debug', 'Git', `[Git] Pushed to ${settings.github_repo_url}.`);
      this.emit('git_status_changed');
      return { success: true };
    } catch (e) {
      this.lastPushError = (e as Error).message;
      this.logManager.add('warn', 'Git', `[Git] Push failed: ${this.lastPushError}`);
      this.emit('git_status_changed');
      return { success: false, error: this.lastPushError };
    }
  }

  static async testGitHubConnection(repoUrl: string, token: string): Promise<GitResult> {
    if (!repoUrl) return { success: false, error: 'No repository URL configured' };
    try {
      const url = token ? GitManager.buildAuthenticatedUrl(repoUrl, token) : repoUrl;
      await simpleGit().listRemote([url]);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }
}

export = GitManager;
