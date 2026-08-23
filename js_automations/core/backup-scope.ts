// core/backup-scope.ts
//
// Relative paths (POSIX-style, forward slashes, relative to SCRIPTS_DIR) that are derived or
// regenerated on boot and deliberately excluded from backup scope — not real user state. Shared
// between backup-manager.ts (excludes them from the zip) and restore-manager.ts (excludes them
// from the live-disk walk it diffs the zip against). Without the second half, these would always
// show up as "deleted" in a restore's diff: they can never be in the zip by design, so a naive
// current-disk-vs-zip comparison flags every one of them, every time.
const DERIVED_DIR_PREFIXES = ['.storage/dist/'];
const DERIVED_FILES = new Set([
  '.storage/entities.d.ts', // TypeDefinitionGenerator regenerates this from the live HA connection
  '.storage/ha-api.d.ts', // synced fresh from the addon's own bundled types on every boot
  '.storage/card-registry.json', // CardManager's card-reconcile cache, falls back to {} if missing
  '.storage/asset-cache-registry.json', // CardManager's downloaded-asset cache index
  '.storage/.boot_crash_counter', // bootloop-detection counter; restoring a stale one could misfire safe mode
]);

export function isDerivedArtifact(relPath: string): boolean {
  return DERIVED_FILES.has(relPath) || DERIVED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

// archiver's glob() ignore list wants glob patterns, not a predicate — kept in sync with the
// checks above by construction (one prefix -> one `<prefix>**` pattern, one file -> itself).
export const DERIVED_ARTIFACT_GLOBS: string[] = [
  ...DERIVED_DIR_PREFIXES.map((prefix) => `${prefix}**`),
  ...DERIVED_FILES,
];
