'use strict';

const path = require('path');
const nodeFs = require('fs');
const fsp = require('fs/promises');

// Virtual root → real path mapping.
// internal:// is resolved at runtime from workerData.fsDataDir.
const FIXED_ROOTS = {
    shared: '/share',
    media:  '/media',
};

/**
 * Resolves a virtual path (e.g. 'internal://logs/app.log') to an absolute
 * filesystem path, enforcing sandbox boundaries.
 *
 * @param {string} virtualPath - e.g. 'internal://foo/bar.json'
 * @param {string} dataDir     - Absolute path for internal:// root
 * @returns {{ absPath: string, rootDir: string }}
 * @throws {Error} on unknown root or path traversal
 */
function resolvePath(virtualPath, dataDir) {
    const match = virtualPath.match(/^(internal|shared|media):\/\/(.*)/s);
    if (!match) {
        throw new Error(
            `ha.fs: Invalid path "${virtualPath}" — must start with internal://, shared://, or media://`
        );
    }
    const [, root, rest] = match;
    const rootDir = root === 'internal' ? dataDir : FIXED_ROOTS[root];

    if (!rootDir) throw new Error(`ha.fs: Unknown virtual root "${root}://"`);

    // Normalize to remove any embedded ".." segments
    const absPath = path.resolve(rootDir, rest);

    // Traversal guard: resolved path must stay inside rootDir
    const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
    if (absPath !== rootDir && !absPath.startsWith(rootWithSep)) {
        throw new Error(
            `ha.fs: Path traversal detected — "${virtualPath}" resolves outside sandbox`
        );
    }

    return { absPath, rootDir };
}

/**
 * Parses a human-readable size string ('5MB', '512KB', '2GB') into bytes.
 * @param {string|number} str
 * @returns {number}
 */
function parseMaxSize(str) {
    if (typeof str === 'number') return str;
    const m = String(str).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
    if (!m) return 5 * 1024 * 1024; // default 5 MB
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'B').toUpperCase();
    const factors = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
    return Math.floor(n * (factors[unit] ?? 1));
}

/**
 * Recursively computes the total size of a directory in bytes.
 * @param {string} dir - Absolute path
 * @returns {Promise<number>}
 */
async function getDirSize(dir) {
    let total = 0;
    try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                total += await getDirSize(full);
            } else {
                try { total += (await fsp.stat(full)).size; } catch { /* skip */ }
            }
        }
    } catch { /* dir may not exist */ }
    return total;
}

/**
 * Builds the ha.fs API object for use inside a Worker.
 *
 * @param {object} opts
 * @param {string}   opts.dataDir             - Absolute path for internal://
 * @param {boolean}  opts.capabilityEnforcement
 * @param {string[]} opts.permissions          - Declared @permission tokens
 * @param {object}   opts.quotas              - Max bytes per root: { internal, shared, media } (0 = unlimited)
 * @returns {object} ha.fs
 */
function buildHaFs({ dataDir, capabilityEnforcement, permissions, quotas = {} }) {
    const perms = new Set(permissions || []);

    function checkRead() {
        if (capabilityEnforcement && !perms.has('fs:read') && !perms.has('fs:write')) {
            throw new Error(
                'PermissionDeniedError: ha.fs read operations require @permission fs:read in your script header.'
            );
        }
    }

    function checkWrite() {
        if (capabilityEnforcement && !perms.has('fs:write')) {
            throw new Error(
                'PermissionDeniedError: ha.fs write operations require @permission fs:write in your script header.'
            );
        }
    }

    const resolve = (p) => resolvePath(p, dataDir).absPath;

    /** Maps a resolved rootDir to the configured quota in bytes (0 = unlimited). */
    function getQuotaBytes(rootDir) {
        if (rootDir === dataDir) return quotas.internal || 0;
        if (rootDir === FIXED_ROOTS.shared) return quotas.shared || 0;
        if (rootDir === FIXED_ROOTS.media) return quotas.media || 0;
        return 0;
    }

    /**
     * Throws if writing `newData` to `virtualPath` would exceed the root quota.
     * For overwrites, the existing file size is subtracted from the current total.
     */
    async function assertWriteQuota(virtualPath, newData) {
        const { absPath, rootDir } = resolvePath(virtualPath, dataDir);
        const limit = getQuotaBytes(rootDir);
        if (!limit) return;
        const newBytes = Buffer.byteLength(newData);
        const current = await getDirSize(rootDir);
        let existing = 0;
        try { existing = (await fsp.stat(absPath)).size; } catch { /* new file */ }
        if (current - existing + newBytes > limit) {
            throw new Error(
                `ha.fs: Storage quota exceeded — root is limited to ${Math.round(limit / (1024 * 1024))} MB`
            );
        }
    }

    /** Throws if appending `newData` to `virtualPath` would exceed the root quota. */
    async function assertAppendQuota(virtualPath, newData) {
        const { rootDir } = resolvePath(virtualPath, dataDir);
        const limit = getQuotaBytes(rootDir);
        if (!limit) return;
        const newBytes = Buffer.byteLength(newData);
        const current = await getDirSize(rootDir);
        if (current + newBytes > limit) {
            throw new Error(
                `ha.fs: Storage quota exceeded — root is limited to ${Math.round(limit / (1024 * 1024))} MB`
            );
        }
    }

    return {
        /**
         * Reads a file. Returns a string by default; pass 'binary' for a Buffer.
         * @param {string} virtualPath
         * @param {string} [encoding='utf8'] — 'utf8' | 'binary'
         */
        async read(virtualPath, encoding = 'utf8') {
            checkRead();
            const abs = resolve(virtualPath);
            return encoding === 'binary'
                ? fsp.readFile(abs)
                : fsp.readFile(abs, 'utf8');
        },

        /**
         * Writes (or overwrites) a file. Creates parent directories if needed.
         * @param {string} virtualPath
         * @param {string|Buffer} data
         */
        async write(virtualPath, data) {
            checkWrite();
            await assertWriteQuota(virtualPath, data);
            const abs = resolve(virtualPath);
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            await fsp.writeFile(abs, data);
        },

        /**
         * Appends data to a file. Creates the file and parent directories if needed.
         * @param {string} virtualPath
         * @param {string|Buffer} data
         */
        async append(virtualPath, data) {
            checkWrite();
            await assertAppendQuota(virtualPath, data);
            const abs = resolve(virtualPath);
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            await fsp.appendFile(abs, data);
        },

        /**
         * Returns true if the path exists (file or directory).
         * @param {string} virtualPath
         */
        async exists(virtualPath) {
            checkRead();
            const abs = resolve(virtualPath);
            return nodeFs.existsSync(abs);
        },

        /**
         * Lists entries in a directory. Directories are suffixed with '/'.
         * @param {string} virtualPath
         * @returns {Promise<string[]>}
         */
        async list(virtualPath) {
            checkRead();
            const abs = resolve(virtualPath);
            const entries = await fsp.readdir(abs, { withFileTypes: true });
            return entries.map(e => e.isDirectory() ? e.name + '/' : e.name);
        },

        /**
         * Returns file/directory metadata.
         * @param {string} virtualPath
         * @returns {Promise<{ size: number, modified: Date, isDirectory: boolean }>}
         */
        async stat(virtualPath) {
            checkRead();
            const abs = resolve(virtualPath);
            const s = await fsp.stat(abs);
            return { size: s.size, modified: s.mtime, isDirectory: s.isDirectory() };
        },

        /**
         * Moves or renames a file. Both paths must be within the same or different virtual roots.
         * @param {string} srcVirtual
         * @param {string} destVirtual
         */
        async move(srcVirtual, destVirtual) {
            checkWrite();
            const { absPath: src, rootDir: srcRoot }   = resolvePath(srcVirtual, dataDir);
            const { absPath: dest, rootDir: destRoot } = resolvePath(destVirtual, dataDir);
            if (srcRoot !== destRoot) {
                throw new Error(
                    'ha.fs: move() requires both paths to be within the same virtual root.'
                );
            }
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.rename(src, dest);
        },

        /**
         * Deletes a file or directory (recursively).
         * @param {string} virtualPath
         */
        async delete(virtualPath) {
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
         * @param {string} virtualPath
         * @param {(event: string, filename: string|null) => void} callback
         * @returns {() => void} Unsubscribe function — call it to stop watching.
         */
        watch(virtualPath, callback) {
            checkRead();
            const abs = resolve(virtualPath);
            const watcher = nodeFs.watch(abs, { recursive: false }, (event, filename) => {
                try { callback(event, filename); } catch (_) { /* user error in callback */ }
            });
            return () => watcher.close();
        },

        /**
         * Log rotation helper. Trims the file when it exceeds maxSize,
         * keeping up to `keep` numbered backup files.
         * @param {string} virtualPath
         * @param {{ maxSize?: string|number, keep?: number }} [options]
         * @example
         * await ha.fs.rotate('internal://app.log', { maxSize: '5MB', keep: 3 });
         * // Produces: app.log, app.1.log, app.2.log, app.3.log (oldest deleted)
         */
        async rotate(virtualPath, options = {}) {
            checkWrite();
            const { maxSize = '5MB', keep = 3 } = options;
            const maxBytes = parseMaxSize(maxSize);
            const abs = resolve(virtualPath);

            let s;
            try { s = await fsp.stat(abs); } catch { return; } // file doesn't exist yet
            if (s.size <= maxBytes) return;

            const ext  = path.extname(abs);
            const base = abs.slice(0, abs.length - ext.length);

            // Delete the oldest backup slot
            try { await fsp.unlink(`${base}.${keep}${ext}`); } catch { /* may not exist */ }

            // Shift existing backups up one slot
            for (let i = keep - 1; i >= 1; i--) {
                try {
                    await fsp.rename(`${base}.${i}${ext}`, `${base}.${i + 1}${ext}`);
                } catch { /* slot may not exist */ }
            }

            // Rotate current file to .1
            await fsp.rename(abs, `${base}.1${ext}`);
        },
    };
}

module.exports = { resolvePath, buildHaFs };
