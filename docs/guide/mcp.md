# MCP Server (AI assistants)

JS Automations can act as an [MCP](https://modelcontextprotocol.io) server. An AI assistant that supports MCP — for example **Claude Desktop** — can then list and read your scripts, check logs and errors, start and restart them and, if you allow it, write new ones. The thinking happens in the assistant you already use; JS Automations needs **no API key** and has no chat window of its own.

You stay in control: the server is **off by default**, every tool has its own switch, writing is **off by default**, and every change an assistant makes is saved as a Git commit.

## Quick start (Claude Desktop)

1. Open **Settings → MCP Server** and switch **MCP server** on.
2. Click **Install for Claude Desktop**. This downloads a `.mcpb` file; double-click it and confirm in Claude Desktop. The endpoint and access token are already filled in.
3. In Claude Desktop, ask something like _"List my JS Automations scripts"_.

Claude Desktop must run on a computer that can reach the add-on (same network or VPN). Claude's web-based "Connectors" cannot reach a Home Assistant in your home network and are **not supported** — see [Limitations](#limitations).

The `.mcpb` file contains your access token. Do not share it; if it leaks, create a new token in the panel.

### Without the one-click install

The panel also has **Copy Claude Desktop config**. Paste the result into `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit Config). This route needs [Node.js](https://nodejs.org) on the computer running Claude Desktop, because it starts the small `mcp-remote` bridge through `npx`.

## Other AI clients

The server speaks the standard **Streamable HTTP** transport with a static bearer token, so any MCP client that can connect to a remote HTTP server and send a custom header should work:

- URL: the endpoint shown in the panel, e.g. `http://homeassistant.local:3002/mcp`
- Header: `Authorization: Bearer <your token>`

Many clients take a configuration along these lines (exact keys differ per client — check its documentation):

```json
{
  "mcpServers": {
    "js-automations": {
      "url": "http://homeassistant.local:3002/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

Clients without header support can use the `mcp-remote` snippet from the panel. JS Automations has been tested with the official MCP SDK client and the bundled Claude Desktop bridge; other clients are expected to work but are not verified.

## What an assistant can do

Every tool can be switched on or off individually under **Settings → MCP Server**. Defaults:

| Group   | Tool                                            | What it does                                                                                              | Default |
| ------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| Read    | `list_scripts`                                  | Name, status, header tags and error state of all scripts and libraries                                    | on      |
| Read    | `read_script`                                   | Source code (card shown as plain JavaScript, known credentials masked)                                    | on      |
| Read    | `get_logs`                                      | Recent log lines, filterable by script, level, age and text                                               | on      |
| Read    | `get_script_errors`                             | Why a script is not working: status, recent errors, compiler messages                                     | on      |
| Read    | `get_events`                                    | The last 300 Home Assistant events seen while MCP is on                                                   | on      |
| Read    | `list_entities`, `get_entity`                   | Entities with state and attributes                                                                        | on      |
| Read    | `get_api_reference`                             | The documentation an assistant needs to write scripts (this site's authoring guide, API reference, types) | on      |
| Read    | `get_store`                                     | `ha.store` values. Secrets are never returned; keys like `token` or `password` are masked                 | **off** |
| Control | `start_script`, `stop_script`, `restart_script` | Control scripts; start/restart report whether the script is still running a moment later                  | on      |
| Control | `call_service`                                  | Call a Home Assistant service (acts on real devices; host-level services are refused)                     | **off** |
| Write   | `write_script`, `write_card`                    | Create or change scripts, libraries and Lovelace cards                                                    | **off** |
| Write   | `delete_script`                                 | Delete a script or library                                                                                | **off** |

Blockly scripts are not visible to assistants.

### What happens when an assistant writes

- The source is **syntax-checked first**; a script with syntax errors is rejected and the file stays untouched.
- TypeScript is also **type-checked** against your real entities and services. Type problems are returned as warnings (the file is still written), because a type check can occasionally be wrong.
- Before overwriting, JS Automations commits your current state of the file ("snapshot"), then the change itself, so **nothing is ever lost**. If the scripts folder has no Git repository yet, one is created on the first change. Commit messages start with `mcp:`; see [Script Versioning](./script-versioning.md) to browse, compare or restore.
- The **Lovelace card** of an existing script is preserved when its code is rewritten; `write_card` changes it.
- A script is **never started or restarted** by writing. The assistant calls `restart_script` separately; if the script is running, the result says so.
- If you have the file open in the editor, a clean tab reloads automatically. With unsaved edits, your text is kept, you get a warning, and saving asks before overwriting the assistant's version.

### Prompts and documentation

Assistants that support prompt templates offer three:

- **New JSA script** — writes a script following the project conventions (see [Authoring Scripts](./authoring.md)).
- **Convert an ioBroker script** — paste a script from the ioBroker JavaScript adapter; the assistant maps the ioBroker IDs to your Home Assistant entities (asking about every guess, never inventing IDs), converts it following the [migration guide](./iobroker-migration.md) and lists what could not be converted.
- **Plan a JSA script (interview)** — the assistant asks you questions one at a time (trigger, entities, edge cases, settings, notifications) and writes the script only after you confirm the specification.

The documentation is also exposed as resources. On connecting, every client is told to read the authoring guide before writing a script and never to put credentials into source code.

## Network and security

- The server listens on **port 3002** (fixed, listed under the add-on's **Network** settings; the host port can be changed there). Stable and Beta add-ons share it and the token, so only one of them runs at a time.
- It is deliberately separate from the webhook port (3001): webhooks are meant to be reachable from outside, MCP gives access to your scripts.
- **Authentication:** one access token (Settings → MCP Server → _Access token_: show, copy, create new). Creating a new token immediately locks out every client using the old one. The token is **not part of backups**: after restoring a backup, a new token is created and you need to reinstall the `.mcpb` (or copy the config again).
- **Protection:** per client address at most 300 requests per minute; 5 wrong tokens lock that address out for 10 minutes. Optional **IP allowlist** (addresses or IPv4 ranges such as `192.168.1.0/24`).
- **Reverse proxy / tunnel:** set the **External URL**, and enable **Trust reverse proxy** only if a proxy you control sits in front (otherwise callers could fake their IP). The server does not terminate TLS itself; do not expose it to the internet without a TLS-terminating proxy.
- **Privacy:** everything an assistant reads through these tools — scripts, logs, entity states — is sent to the provider of that assistant. Credentials are filtered on a best-effort basis (named values such as `password`, well-known token formats), but this is a safety net, not a guarantee. Keep credentials in `ha.store` secrets, never in script source.

## Developer tools: MCP tab

With **Expert Mode** on, the dev-tools area has an **MCP** tab:

- **Tool calls** — a live log of what assistants did (time, tool, script, client address, duration). Failed calls can be expanded to read the full error and copied. The log is kept in memory (last 200) and is cleared on restart.
- **JSA feedback from the assistant** — notes from [maintainer mode](#maintainer-mode), if enabled.

Under **Settings → General → Expert Mode** you can also switch off dev-tools tabs you do not use (WATCH, REPL, MQTT, EVENTS, WEBHOOKS, MCP) to save space.

## Maintainer mode

For people who develop JS Automations itself. Under **Settings → General** (Expert Mode on) enable **Maintainer mode**. The connected assistant is then told that it works with the JSA developers. It quietly notes things about JSA — an awkward API, a missing feature, unclear documentation, a bug — with the `jsa_feedback` tool, and does not interrupt your work for them.

- Similar notes are merged and counted. An observation is raised with you **once**, after it has come up three times.
- **Hard errors** (JSA itself crashes, loses data or returns wrong results) are reported **immediately**.
- Notes stay on your Home Assistant, appear in the MCP tab (expandable, with a copy button that formats them for a GitHub issue) and can be deleted.

How well an assistant sticks to "do not nag" depends on the model; the counting and the thresholds are enforced by JS Automations.

## Troubleshooting

| Symptom                                                       | What to check                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status says "not running yet"                                 | The port may still be held by the other (Stable/Beta) add-on. Stop that one, or wait — JS Automations retries every 15 seconds.                  |
| Client reports "unauthorized" / HTTP 401                      | Wrong or rotated token. Reinstall the `.mcpb` or copy the token again.                                                                           |
| Client reports HTTP 429                                       | Too many requests, or the address is locked out after repeated wrong tokens (10 minutes).                                                        |
| "Cannot reach the JS Automations MCP server"                  | The computer cannot reach `<home-assistant>:3002`. Check network/VPN, the add-on's Network settings and the **External URL** if you use a proxy. |
| The assistant sees no tools                                   | All tools may be switched off, or the client needs a restart after you changed settings.                                                         |
| The download button gives a file Claude Desktop does not open | Use **Copy Claude Desktop config** instead.                                                                                                      |
| Copy buttons do nothing                                       | Browsers only allow clipboard access on HTTPS or localhost.                                                                                      |

## Limitations

- Only the Streamable HTTP transport with a **static bearer token**. There is no OAuth, so services that require it or a public HTTPS address — Claude's web "Connectors", ChatGPT's custom connectors — cannot use it.
- One access token for all clients.
- Stateless: every request stands alone; there is no session and no server-initiated messages.
- `.mcpb` installation was built against the published MCPB specification; it has not been validated with Anthropic's validator.
