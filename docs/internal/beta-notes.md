# Release notes for the 3.2.0 beta pre-release

Paste into the GitHub pre-release body after `npm run ship:beta:minor` (the script only generates a commit list for betas). Written for beta testers; the stable entry lives in `CHANGELOG.md` under `<!-- NEXT -->`. Remove the matching hint box from `README.md` when the stable release ships.

---

## 3.2.0-beta.0 — MCP server for AI assistants

This beta lets an AI assistant work with your JS Automations scripts. Please try it and tell us what breaks.

> **Before you start:** the beta shares scripts, libraries and the `ha.store` data with the stable add-on. Stop _JS Automations_ first, then start _JS Automations (Beta)_. Never run both. Secret encryption keys are per add-on — if you switched on **Encrypt ha.store Secrets**, switch it off again before going back to stable.

### What's new

- **MCP server** (port 3002, off by default): **Settings → MCP Server**. Access token with show / copy / create new, optional IP allowlist, reverse-proxy settings.
- **One-click install for Claude Desktop** (Windows and macOS): download the `.mcpb` extension from the same page, open it, enable it in _Settings → Extensions_, start a **new chat** and allow the tools. The file contains your access token — don't share it.
- **16 tools in three groups**, each with its own switch. Reading logs, errors, events, entities and scripts is on; writing scripts and cards, `delete_script`, `call_service` and `get_store` are **off by default**.
- **Writes are safe to try:** syntax-checked, type-checked (warnings), committed to Git with a snapshot of your previous state, and nothing is restarted automatically. Credentials are masked in everything the assistant reads; `ha.store` secrets are never returned.
- **Assistants keep to JSA conventions:** typed `CONFIG` block, one `<script>_state` object for restart-proof values, credentials only as empty store fields with a warning.
- **Editor follows the assistant:** open tabs and the card preview reload when a file changes; unsaved edits are kept and a banner explains the conflict; a deleted script closes its tab.
- **MCP tab (Expert Mode)** with a live call log. **Maintainer mode** lets the assistant note API and documentation ideas as ready-to-copy issue text.
- New guides: [MCP](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md), [Authoring Scripts](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/authoring.md), [ioBroker migration](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/iobroker-migration.md).

### Fixes

- `@card dev` is honoured by `ha.frontend.installCard()` again (the card was installed although the script was in preview mode).
- Card preview reloads after an external change.
- **New script → From repo** restores a script whose deletion was already committed; errors show as plain text.
- `ha.persistent('key', false)` is typed as `boolean`.
- Docs: how a native entity receives commands (`'ON'`/`'OFF'` through `ha.on()`), all `ha.on` filter operators.
- Dependencies: Express 5.3 (security fixes), plus minor/patch updates.

### Please test

1. Install the `.mcpb`, ask Claude to _"list my scripts and tell me which ones have errors"_.
2. Switch on **write_script** and ask for a small script — then look at the Git history and the editor.
3. Use the **Convert an ioBroker script** prompt text from the MCP guide on one of your own scripts.
4. Anything that surprises you: open an issue with the assistant's wording and what you expected.

### Known limits

- Claude Desktop only lists tools here. The three prompts are not shown in its menus yet — copy the text versions from the guide.
- Claude Desktop's own "custom connectors" need public HTTPS with OAuth and cannot reach a LAN add-on; use the `.mcpb` extension.
- Prompt injection can only be reduced, not removed: script and log text is marked as untrusted data, but what an assistant may do is limited by the tool switches. Keep writing and `call_service` off unless you need them.

Full details: [MCP guide](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md).
