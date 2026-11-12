# Security model

What a JS Automations script can do, what protects you, and what does not. Short version: **scripts are trusted code.** JS Automations contains accidents and makes risky things visible, but it is not a sandbox against code you should not run in the first place.

## What a script can do

Every script runs in its **own Worker Thread** inside the add-on's container.

- **A crash or an endless loop is contained.** It does not take down Home Assistant or other scripts. There is a restart protection, a bootloop detection ([Safe Mode](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/troubleshooting.md#safe-mode)) and a memory limit per script (**Settings → Danger Zone**).
- **A script has the same access to Home Assistant as the add-on.** It can read every state, call every service and fire events, as the add-on's own token may. A script that switches a lock can switch your lock.
- **A script can use the network** (`fetch`, `http`, `axios`, ...) unless it is stopped from doing so, see below.
- **A script can install npm packages.** Packages named in `@npm` are installed automatically when the script starts, and their code runs with the script's rights. Treat an `@npm` line like any dependency you add to a program.

Worker threads isolate failures, not intent. **Only run scripts you have read or trust**, in particular ones you import from somewhere else (for example from the [Script Library](https://rocklobster42195.github.io/ha-jsa-library/) or a chat). Imported scripts show their capability badges in the list before you start them.

## `@permission`: declaring what a script uses

Sensitive capabilities are declared in the script header:

| Token      | Covers                                                  |
| ---------- | ------------------------------------------------------- |
| `network`  | `fetch()`, `http`, `https`, `axios`, `got`, ...         |
| `fs:read`  | `ha.fs.read`, `.exists`, `.list`, `.stat`, `.watch`     |
| `fs:write` | `ha.fs.write`, `.append`, `.delete`, `.move`, `.rotate` |
| `fs`       | `fs:read` and `fs:write`                                |
| `exec`     | `child_process` (`exec`, `spawn`, ...)                  |
| `webhook`  | `ha.onWebhook()` (declared for transparency)            |
| `mqtt`     | `ha.mqtt.publish()` / `.subscribe()` (for transparency) |

Two things happen with the declaration:

1. **Transparency.** The script list reads the source and shows a badge per capability. A capability that is **used but not declared** is marked amber, one that is **declared but not used** is dimmed. This is the quickest way to see what an imported script wants before it runs.
2. **Enforcement** (**Settings → Danger Zone → Enforce @permission Declarations**, on by default). With it on, a script that uses `network`, `fs` or `exec` without declaring it gets a `PermissionDeniedError` at runtime.

Enforcement is a guard rail against mistakes and surprises, for example a library that suddenly starts calling out. **It is not a security boundary against deliberately malicious code.** Do not rely on it to make an untrusted script safe.

Details of the tokens and the checks: [Capability & Permission System](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/API_REFERENCE.md#capability--permission-system).

## Files

`ha.fs` is **off by default** and has to be switched on under **Settings → Danger Zone**. It works only inside three roots: `internal://` (the add-on's data folder), `shared://` (`/share`, NAS mounts) and `media://` (`/media`). Paths that try to leave a root are refused, and every root has a storage quota for writes.

## Credentials and the store

- **Keep credentials out of script source.** Scripts get them from `ha.store` (a secret) or from an empty field of a persisted config that you fill in the Store Explorer. Source code ends up in Git history, backups and exports.
- A **secret** is visible only to the script that created it and to the scripts it was shared with; other scripts get `undefined`. Secrets are masked in the Store Explorer until you click the eye icon.
- **Encryption at rest is opt-in:** **Settings → Danger Zone → Encrypt ha.store Secrets**. The key lives in the add-on's private data, not in `/config` and not in backups. Without it, secrets are stored as readable text in the add-on's store file. Read [Secrets are unreadable after switching add-ons](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/troubleshooting.md#secrets-are-unreadable-after-switching-add-ons) before you switch it on.
- The MCP access token is kept in `.storage/mcp.json` and is **never part of a backup**; a restore creates a fresh one.

## Webhooks

The webhook port (3001) is the one door of the add-on that is **meant to be reachable from outside**.

- Every webhook has its own **token**, generated and managed by JS Automations.
- Requests are **rate-limited** (60 per minute per webhook and address), and repeated wrong tokens lock an address out for a while.
- A webhook can have an **IP allowlist** that is checked before the token. Use it whenever the sender publishes its addresses (GitHub, Stripe, ...).
- The handler runs in your script: validate what arrives, and never pass request data into `exec` or into file paths.

See [Webhooks](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/API_REFERENCE.md#webhook-api-haonwebhook) in the API Reference.

## AI assistants (MCP)

The MCP server gives an assistant access to your scripts, so it is **off by default** and built for caution:

- A **bearer token**, an optional **IP allowlist**, rate limiting and a lockout after wrong tokens. It runs on its own port (3002), separate from the webhook port, and is not meant for the internet.
- **Access levels** from _read only_ up to _write_, plus a level where the assistant can only **propose** changes that you review and apply yourself. `get_store`, `call_service`, `run_snippet` and `delete_script` have their own switches and are off by default.
- **Writes are checked and recorded:** syntax and type checks first, an automatic Git commit with a snapshot of the previous state, and a live log of every tool call in the **MCP** tab.
- **Credentials are masked** in everything an assistant reads, and `ha.store` secrets are never returned. Assistants cannot create or change store entries.
- Script source, log lines and entity texts are marked as **untrusted data**, so that instructions hidden in them are not followed. This reduces prompt injection but cannot remove it: what an assistant may do is limited by the switches, so keep writing and `call_service` off unless you need them.

The details are in the [MCP guide](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md#network-and-security).

## Web interface

The interface is reached through Home Assistant's **Ingress**, so it is protected by your Home Assistant login. The add-on does not open a host port for it. Anyone who can open the add-on in Home Assistant can read and change all scripts and run code, so give access to it as carefully as you give admin access to Home Assistant.

## Reporting a problem

Found something that looks like a vulnerability? Please do not put the details into a public issue. [Open an issue](https://github.com/rocklobster42195/ha-js_automations_addon/issues) that only says you have a security report (no details, no tokens), and the details can be shared privately from there.
