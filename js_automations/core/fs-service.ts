'use strict';

import * as path from 'path';
import * as nodeFs from 'fs';
import * as fsp from 'fs/promises';

// Virtual root → real path mapping.
// internal:// is resolved at runtime from workerData.fsDataDir.
const FIXED_ROOTS: Record<string, string> = {
  shared: '/share',
  media: '/media',
};

interface ResolvedPath {
  absPath: string;
  rootDir: string;
}

/**
 * Resolves a virtual path (e.g. 'internal://logs/app.log') to an absolute
 * filesystem path, enforcing sandbox boundaries.
 *
 * @param virtualPath - e.g. 'internal://foo/bar.json'
 * @param dataDir     - Absolute path for internal:// root
 * @throws on unknown root or path traversal
 */
function resolvePath(virtualPath: string, dataDir: string): ResolvedPath {
  const match = virtualPath.match(/^(internal|shared|media):\/\/(.*)/s);
  if (!match) {
    throw new Error(`ha.fs: Invalid path "${virtualPath}" — must start with internal://, shared://, or media://`);
  }
  const [, root, rest] = match;
  const rootDir = root === 'internal' ? dataDir : FIXED_ROOTS[root];

  if (!rootDir) throw new Error(`ha.fs: Unknown virtual root "${root}://"`);

  // Normalize to remove any embedded ".." segments
  const absPath = path.resolve(rootDir, rest);

  // Traversal guard: resolved path must stay inside rootDir
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (absPath !== rootDir && !absPath.startsWith(rootWithSep)) {
    throw new Error(`ha.fs: Path traversal detected — "${virtualPath}" resolves outside sandbox`);
  }

  return { absPath, rootDir };
}

/**
 * Parses a human-readable size string ('5MB', '512KB', '2GB') into bytes.
 */
function parseMaxSize(str: string | number): number {
  if (typeof str === 'number') return str;
  const m = String(str).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!m) return 5 * 1024 * 1024; // default 5 MB
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toUpperCase();
  const factors: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.floor(n * (factors[unit] ?? 1));
}

/**
 * Recursively computes the total size of a directory in bytes.
 * @param dir - Absolute path
 */
async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        total += await getDirSize(full);
      } else {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* dir may not exist */
  }
  return total;
}

interface FsStat {
  size: number;
  modified: Date;
  isDirectory: boolean;
}

interface RotateOptions {
  maxSize?: string | number;
  keep?: number;
}

interface HaFsQuotas {
  internal?: number;
  shared?: number;
  media?: number;
}

interface BuildHaFsOptions {
  dataDir: string;
  capabilityEnforcement: boolean;
  permissions: string[];
  quotas?: HaFsQuotas;
}

interface HaFs {
  read(virtualPath: string, encoding?: 'utf8'): Promise<string>;
  read(virtualPath: string, encoding: 'binary'): Promise<Buffer>;
  write(virtualPath: string, data: string | Buffer): Promise<void>;
  append(virtualPath: string, data: string | Buffer): Promise<void>;
  exists(virtualPath: string): Promise<boolean>;
  list(virtualPath: string): Promise<string[]>;
  stat(virtualPath: string): Promise<FsStat>;
  move(srcVirtual: string, destVirtual: string): Promise<void>;
  delete(virtualPath: string): Promise<void>;
  watch(virtualPath: string, callback: (event: string, filename: string | null) => void): () => void;
  rotate(virtualPath: string, options?: RotateOptions): Promise<void>;
}

/**
 * Builds the ha.fs API object for use inside a Worker.
 */
function buildHaFs({ dataDir, capabilityEnforcement, permissions, quotas = {} }: BuildHaFsOptions): HaFs {
  const perms = new Set(permissions || []);

  function checkRead(): void {
    if (capabilityEnforcement && !perms.has('fs:read') && !perms.has('fs:write')) {
      throw new Error(
        'PermissionDeniedError: ha.fs read operations require @permission fs:read in your script header.'
      );
    }
  }

  function checkWrite(): void {
    if (capabilityEnforcement && !perms.has('fs:write')) {
      throw new Error(
        'PermissionDeniedError: ha.fs write operations require @permission fs:write in your script header.'
      );
    }
  }

  const resolve = (p: string): string => resolvePath(p, dataDir).absPath;

  /** Maps a resolved rootDir to the configured quota in bytes (0 = unlimited). */
  function getQuotaBytes(rootDir: string): number {
    if (rootDir === dataDir) return quotas.internal || 0;
    if (rootDir === FIXED_ROOTS.shared) return quotas.shared || 0;
    if (rootDir === FIXED_ROOTS.media) return quotas.media || 0;
    return 0;
  }

  /**
   * Throws if writing `newData` to `virtualPath` would exceed the root quota.
   * For overwrites, the existing file size is subtracted from the current total.
   */
  async function assertWriteQuota(virtualPath: string, newData: string | Buffer): Promise<void> {
    const { absPath, rootDir } = resolvePath(virtualPath, dataDir);
    const limit = getQuotaBytes(rootDir);
    if (!limit) return;
    const newBytes = Buffer.byteLength(newData);
    const current = await getDirSize(rootDir);
    let existing = 0;
    try {
      existing = (await fsp.stat(absPath)).size;
    } catch {
      /* new file */
    }
    if (current - existing + newBytes > limit) {
      throw new Error(`ha.fs: Storage quota exceeded — root is limited to ${Math.round(limit / (1024 * 1024))} MB`);
    }
  }

  /** Throws if appending `newData` to `virtualPath` would exceed the root quota. */
  async function assertAppendQuota(virtualPath: string, newData: string | Buffer): Promise<void> {
    const { rootDir } = resolvePath(virtualPath, dataDir);
    const limit = getQuotaBytes(rootDir);
    if (!limit) return;
    const newBytes = Buffer.byteLength(newData);
    const current = await getDirSize(rootDir);
    if (current + newBytes > limit) {
      throw new Error(`ha.fs: Storage quota exceeded — root is limited to ${Math.round(limit / (1024 * 1024))} MB`);
    }
  }

  return {
    /**
     * Reads a file. Returns a string by default; pass 'binary' for a Buffer.
     */
    async read(virtualPath: string, encoding: 'utf8' | 'binary' = 'utf8'): Promise<any> {
      checkRead();
      const abs = resolve(virtualPath);
      return encoding === 'binary' ? fsp.readFile(abs) : fsp.readFile(abs, 'utf8');
    },

    /**
     * Writes (or overwrites) a file. Creates parent directories if needed.
     */
    async write(virtualPath: string, data: string | Buffer): Promise<void> {
      checkWrite();
      await assertWriteQuota(virtualPath, data);
      const abs = resolve(virtualPath);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, data);
    },

    /**
     * Appends data to a file. Creates the file and parent directories if needed.
     */
    async append(virtualPath: string, data: string | Buffer): Promise<void> {
      checkWrite();
      await assertAppendQuota(virtualPath, data);
      const abs = resolve(virtualPath);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.appendFile(abs, data);
    },

    /**
     * Returns true if the path exists (file or directory).
     */
    async exists(virtualPath: string): Promise<boolean> {
      checkRead();
      const abs = resolve(virtualPath);
      return nodeFs.existsSync(abs);
    },

    /**
     * Lists entries in a directory. Directories are suffixed with '/'.
     */
    async list(virtualPath: string): Promise<string[]> {
      checkRead();
      const abs = resolve(virtualPath);
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name));
    },

    /**
     * Returns file/directory metadata.
     */
    async stat(virtualPath: string): Promise<FsStat> {
      checkRead();
      const abs = resolve(virtualPath);
      const s = await fsp.stat(abs);
      return { size: s.size, modified: s.mtime, isDirectory: s.isDirectory() };
    },

    /**
     * Moves or renames a file. Both paths must be within the same or different virtual roots.
     */
    async move(srcVirtual: string, destVirtual: string): Promise<void> {
      checkWrite();
      const { absPath: src, rootDir: srcRoot } = resolvePath(srcVirtual, dataDir);
      const { absPath: dest, rootDir: destRoot } = resolvePath(destVirtual, dataDir);
      if (srcRoot !== destRoot) {
        throw new Error('ha.fs: move() requires both paths to be within the same virtual root.');
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(src, dest);
    },

    /**
     * Deletes a file or directory (recursively).
     */
    async delete(virtualPath: string): Promise<void> {
      checkWrite();
      const abs = resolve(virtualPath);
      const s = await fsp.stat(abs);
      if (s.isDirectory()) {
        await fsp.rm(abs, { recursive: true, force: true });
      } else {
        await fsp.unlink(abs);
      }
    },

    /**
     * Watches a file or directory for changes.
     * @returns Unsubscribe function — call it to stop watching.
     */
    watch(virtualPath: string, callback: (event: string, filename: string | null) => void): () => void {
      checkRead();
      const abs = resolve(virtualPath);
      const watcher = nodeFs.watch(abs, { recursive: false }, (event, filename) => {
        try {
          callback(event, filename);
        } catch (_) {
          /* user error in callback */
        }
      });
      return () => watcher.close();
    },

    /**
     * Log rotation helper. Trims the file when it exceeds maxSize,
     * keeping up to `keep` numbered backup files.
     * @example
     * await ha.fs.rotate('internal://app.log', { maxSize: '5MB', keep: 3 });
     * // Produces: app.log, app.1.log, app.2.log, app.3.log (oldest deleted)
     */
    async rotate(virtualPath: string, options: RotateOptions = {}): Promise<void> {
      checkWrite();
      const { maxSize = '5MB', keep = 3 } = options;
      const maxBytes = parseMaxSize(maxSize);
      const abs = resolve(virtualPath);

      let s;
      try {
        s = await fsp.stat(abs);
      } catch {
        return;
      } // file doesn't exist yet
      if (s.size <= maxBytes) return;

      const ext = path.extname(abs);
      const base = abs.slice(0, abs.length - ext.length);

      // Delete the oldest backup slot
      try {
        await fsp.unlink(`${base}.${keep}${ext}`);
      } catch {
        /* may not exist */
      }

      // Shift existing backups up one slot
      for (let i = keep - 1; i >= 1; i--) {
        try {
          await fsp.rename(`${base}.${i}${ext}`, `${base}.${i + 1}${ext}`);
        } catch {
          /* slot may not exist */
        }
      }

      // Rotate current file to .1
      await fsp.rename(abs, `${base}.1${ext}`);
    },
  };
}

export = { resolvePath, buildHaFs };
