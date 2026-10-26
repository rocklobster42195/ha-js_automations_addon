# Backup & Restore

JS Automations can back up your scripts and data as zip snapshots, on a schedule or on demand, and restore them after a disaster. For getting a single file back, the [History panel](./script-versioning.md) is the quicker tool.

## Backing up

Configure it under **Settings → Backup**:

- **Automatic Backup** — runs server-side, daily or weekly at a time you choose. No download needed.
- **Retention** — how many backups to keep. Older ones are deleted automatically (default 14).
- **Back up now** — creates a backup immediately.
- **WebDAV target (optional)** — uploads every backup to a WebDAV server (for example a NAS) as well. This is best-effort: the local copy stays authoritative if the upload fails. Use **Test Connection** to check the credentials; the password is masked in Settings.

A backup contains your scripts and the add-on's data folder. Files that are regenerated on every start (generated type definitions, caches) are left out on purpose.

> **Encryption key.** If you use [encrypted store secrets](../API_REFERENCE.md), the key is not part of a backup and never leaves the machine. Encrypted secrets from a backup can only be read on the installation that created them.
>
> The key is also per add-on: the stable and the beta add-on each have their own (`/data/store.key`), so encrypted secrets do not carry over when you switch between them. Switch the encryption off before switching, or copy `store.key` into the other add-on's data folder. Uninstalling an add-on deletes its key for good.

## Restoring

Open **Settings → Backup → Restore backup...** and select a backup zip.

1. The add-on compares the zip with the current state and lists what would be **changed**, **new** or **deleted**.
2. Select what should be applied — everything, or only the parts you want.
3. Confirm. A **safety snapshot of the current state is created automatically** before anything is overwritten, so a restore can itself be undone.
4. The server restarts briefly. Restart the add-on afterwards so MQTT and webhooks fully pick up the restored configuration.

Safety snapshots are kept separately from normal backups, so a mistaken restore cannot be rotated away by retention.
