# 📂 Concept: Filesystem API (Experimental)

## Introduction

Scripts in JS Automations run entirely in memory. They can read HA states, call services, and store small amounts of data in `ha.store` — but everything disappears on restart, and there is no way to write a file, read a config, or process an image. The Filesystem API closes that gap.

With `ha.fs`, scripts gain access to a sandboxed slice of the Home Assistant filesystem. Three virtual roots are available: `internal://` for data that belongs exclusively to the script, `shared://` for exchanging data with other addons or NAS mounts, and `media://` for camera images, audio files, and other media.

### What can you build with it?

**Custom CSV logging**
A script that tracks energy prices writes a new row every hour. After a week, 168 rows exist — ready to be opened in Excel or processed by another script.

```js
const row = `${new Date().toISOString()},${price},${unit}\n`;
await ha.fs.append('internal://prices.csv', row);
await ha.fs.rotate('internal://prices.csv', { maxSize: '2MB', keep: 2 });
```

**Config file hot-reload**
A script reads its configuration from a JSON file in `/share`. When the file changes, it reloads automatically — no script restart needed.

```js
let config = JSON.parse(await ha.fs.read('shared://my-script/config.json'));

ha.fs.watch('shared://my-script/config.json', async () => {
  config = JSON.parse(await ha.fs.read('shared://my-script/config.json'));
  ha.log('Config reloaded');
});
```

**Camera snapshot archive**
A script triggered by a motion sensor saves the latest camera snapshot to `/media` and cleans up images older than 7 days.

```js
const snapshot = await fetch(CAMERA_URL).then(r => r.buffer());
const filename = `media://doorbell/${Date.now()}.jpg`;
await ha.fs.write(filename, snapshot);

// Prune: keep only last 7 days
const files = await ha.fs.list('media://doorbell/');
for (const f of files) {
  const { modified } = await ha.fs.stat(`media://doorbell/${f}`);
  if (Date.now() - modified.getTime() > 7 * 86_400_000) {
    await ha.fs.delete(`media://doorbell/${f}`);
  }
}
```

**Feeding data to another addon**
A script exports a JSON summary to `/share` every night so a reporting addon can pick it up.

```js
const report = { generated: new Date(), entries: await buildReport() };
await ha.fs.write('shared://reports/nightly.json', JSON.stringify(report, null, 2));
```

**Automated script & store backup to NAS**
A dedicated backup script runs nightly at 03:00, copies all scripts and a full `ha.store` snapshot to a timestamped folder on the NAS, and keeps the last 14 backups.

```js
/**
 * @name JSA Backup
 * @icon mdi:backup-restore
 * @description Nightly backup of all scripts and ha.store to NAS.
 * @permission fs:read, fs:write
 */

const NAS_ROOT = 'shared://jsa-backups';
const KEEP = 14;

async function runBackup() {
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const dest = `${NAS_ROOT}/${ts}`;

  // 1. Copy all script files
  const scripts = await ha.fs.list('internal://../../scripts/'); // /config/js_automations/scripts/
  for (const file of scripts) {
    const content = await ha.fs.read(`internal://../../scripts/${file}`);
    await ha.fs.write(`${dest}/scripts/${file}`, content);
  }

  // 2. Copy ha.store (already a JSON file on disk)
  const store = await ha.fs.read('internal://../../store.json');
  await ha.fs.write(`${dest}/store.json`, store);

  ha.log(`Backup completed → ${dest}`);

  // 3. Prune old backups (keep newest N)
  const all = (await ha.fs.list(NAS_ROOT))
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}/))
    .sort()
    .reverse();
  for (const old of all.slice(KEEP)) {
    await ha.fs.delete(`${NAS_ROOT}/${old}`);
    ha.log(`Pruned old backup: ${old}`);
  }
}

runBackup();
schedule('0 3 * * *', runBackup);
```

> **Note:** `ha.store.export()` is a planned companion method that serialises the full store to a plain object. Script files are accessed via their real path within the sandbox — a dedicated `scripts://` virtual root (see Roadmap) would make this cleaner.

---

## 1. Objective
Provide scripts with the ability to read and write files within the Home Assistant environment while maintaining system stability and security. This feature is intended for advanced users and will be located in the "Danger Zone" of the settings.

## 2. Security Concept ("Danger Zone")
Direct filesystem access carries the risk of damaging Home Assistant configuration files. The following safeguards will be implemented:

*   **Global Toggle:** An option `Enable Experimental Filesystem Access` in the settings (default: `false`).
*   **Sandboxing:** Access is restricted to specific directories:
    *   `Internal`: `/config/js_automations/data/` (for script-internal data).
    *   `Shared`: `/share/` (for cross-addon communication and NAS mounts via HAOS Network Storage).
    *   `Media`: `/media/` (for camera snapshots, audio files, images).
*   **Path Sanitization:** All paths provided to the API are checked for "Path Traversal" patterns (e.g., `../`).
*   **Resource Limits:** Configurable file size quotas per virtual root to prevent scripts from filling the host's storage.
*   **Permission Transparency:** Scripts using `ha.fs` should declare `@permission fs:read` and/or `@permission fs:write` in their header. The capability system (see `capability_concept.md`) auto-detects filesystem access and shows a badge in the script list — and warns visually when the declaration is missing. With enforcement enabled, undeclared `ha.fs` calls throw a `PermissionDeniedError` at runtime.

## 3. Use-Cases
*   **Custom Logging:** Writing detailed CSV or log files for long-term analysis without bloating the Home Assistant database.
*   **Media Management:** Storing camera snapshots, downloading audio files for TTS, or processing images.
*   **Persistent Large Data:** Storing large JSON datasets that would be inefficient to keep in the memory-resident `ha.store`.
*   **Configuration Generation:** Dynamically creating configuration files for other integrations or addons.
*   **External Backups:** Exporting specific script data to the `/share` folder for external backup solutions.

## 4. Proposed API (`ha.fs`)
The API will provide simplified, asynchronous versions of standard Node.js `fs` operations, scoped to the sandbox.

| Method | Description |
| :--- | :--- |
| `ha.fs.read(path, encoding?)` | Reads file content (UTF-8 by default). Pass `'binary'` for Buffer. |
| `ha.fs.write(path, data)` | Writes/overwrites a file. Creates subdirectories if needed. |
| `ha.fs.append(path, data)` | Appends data to an existing file (ideal for logging). |
| `ha.fs.exists(path)` | Checks if a file or directory exists. |
| `ha.fs.list(path)` | Returns an array of file/directory names in a path. |
| `ha.fs.stat(path)` | Returns `{ size, modified: Date, isDirectory }`. Useful for log rotation checks. |
| `ha.fs.move(src, dest)` | Moves or renames a file. Both paths must be within the same virtual root. |
| `ha.fs.delete(path)` | Deletes a file or directory. |
| `ha.fs.watch(path, callback)` | Calls `callback(event, filename)` when the file or directory changes. Returns an unsubscribe function. |
| `ha.fs.rotate(path, options)` | Log rotation helper: trims the file when it exceeds `maxSize`, keeps up to `keep` backup files. |

`ha.fs.rotate` options:
```js
await ha.fs.rotate('internal://app.log', { maxSize: '5MB', keep: 3 });
// Renames: app.log → app.1.log → app.2.log → app.3.log (oldest deleted)
```

### Path Mapping
To keep scripts portable, the API uses virtual roots:
*   `internal://` maps to `/config/js_automations/data/`
*   `shared://` maps to `/share/`
*   `media://` maps to `/media/`

Example: `await ha.fs.write('shared://logs/today.log', 'Data...');`

## 5. UI Integration
*   **Settings:** A new toggle in the "Danger Zone" category.
*   **Warnings:** Clear visual warnings in the UI about the risks of filesystem access.
*   **i18n:** Translations for English and German.

**Network storage on HAOS:** External NAS mounts are out of scope for this addon. Home Assistant OS provides native network storage management via Settings → System → Storage. Mounts configured there appear automatically at `/share` or `/media` and are accessible via the `shared://` or `media://` roots without any additional configuration here.

## 6. Implementation Steps
1.  Add `filesystem_enabled` to `settings-manager.js`.
2.  Implement a safe `FsService` in `core/` that handles path sanitization and directory creation.
3.  Inject the `ha.fs` object into the `WorkerWrapper` when the setting is enabled. When `capability_enforcement` is also enabled, wrap each method to check `metadata.permissions` and throw `PermissionDeniedError` if `fs:read` or `fs:write` is absent.
4.  Update the `ha-api.d.ts` for IntelliSense support.
5.  Add UI components and translations.
6.  Implement the capability badge system (see `capability_concept.md`) — auto-detection of `ha.fs` usage and `@permission` tag parsing ship together with the filesystem API.