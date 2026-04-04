# 📂 Concept: Filesystem API (Experimental)

## 1. Objective
Provide scripts with the ability to read and write files within the Home Assistant environment while maintaining system stability and security. This feature is intended for advanced users and will be located in the "Danger Zone" of the settings.

## 2. Security Concept ("Danger Zone")
Direct filesystem access carries the risk of damaging Home Assistant configuration files. The following safeguards will be implemented:

*   **Global Toggle:** An option `Enable Experimental Filesystem Access` in the settings (default: `false`).
*   **Sandboxing:** Access is restricted to specific directories:
    *   `Internal`: `/config/js_automations/data/` (for script-internal data).
    *   `Shared`: `/share/` (for cross-addon communication, if permitted by Home Assistant configuration).
    *   `External`: Custom mount points defined in the addon settings (e.g., `/mnt/nas_recordings/`).
*   **Path Sanitization:** All paths provided to the API are checked for "Path Traversal" patterns (e.g., `../`).
*   **Resource Limits:** Optional file size quotas to prevent scripts from filling the host's storage.

## 3. Use-Cases
*   **Custom Logging:** Writing detailed CSV or log files for long-term analysis without bloating the Home Assistant database.
*   **Media Management:** Storing camera snapshots, downloading audio files for TTS, or processing images.
*   **Persistent Large Data:** Storing large JSON datasets that would be inefficient to keep in the memory-resident `ha.store`.
*   **Configuration Generation:** Dynamically creating configuration files for other integrations or addons.
*   **External Backups:** Exporting specific script data to the `/share` folder for external backup solutions.
*   **Network Storage:** Storing long-term data (e.g., video clips, historical logs) directly on a NAS.

## 4. Proposed API (`ha.fs`)
The API will provide simplified, asynchronous versions of standard Node.js `fs` operations, scoped to the sandbox.

| Method | Description |
| :--- | :--- |
| `ha.fs.read(path, encoding)` | Reads file content (UTF-8 by default). |
| `ha.fs.write(path, data)` | Writes/overwrites a file. Creates subdirectories if needed. |
| `ha.fs.append(path, data)` | Appends data to an existing file (ideal for logging). |
| `ha.fs.exists(path)` | Checks if a file or directory exists. |
| `ha.fs.list(path)` | Returns an array of file/directory names in a path. |
| `ha.fs.delete(path)` | Deletes a file or directory. |

### Path Mapping
To keep scripts portable, the API uses virtual roots:
*   `internal://` maps to `/config/js_automations/data/`
*   `shared://` maps to `/share/`
*   `nas://` (or any custom name) maps to a configured network mount.

Example: `await ha.fs.write('nas://logs/today.log', 'Data...');`

## 5. UI Integration
*   **Settings:** A new toggle in the "Danger Zone" category.
*   **Mount Manager:** A table in the settings to define:
    *   **Label:** (e.g., "nas")
    *   **Type:** (SMB, NFS, Bind)
    *   **Source:** (e.g., `//192.168.1.10/backups`)
    *   **Options:** (User, Password, Read-Only flag)
*   **Warnings:** Clear visual warnings in the UI about the risks of filesystem access.
*   **i18n:** Translations for English and German.

> **Note on HAOS:** If the user runs Home Assistant OS, they should primarily use the native "Network Storage" feature (Settings -> System -> Storage). These mounts automatically appear in `/share` or `/media`, which are then accessible via the `shared://` root without further configuration in this addon.

## 6. Implementation Steps
1.  Add `filesystem_enabled` to `settings-manager.js`.
2.  Implement a safe `FsService` in `core/` that handles path sanitization and directory creation.
3.  Inject the `ha.fs` object into the `WorkerWrapper` when the setting is enabled.
4.  Update the `ha-api.d.ts` for IntelliSense support.
5.  Add UI components and translations.