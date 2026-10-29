<!-- NEXT -->

feat: MCP server for AI assistants, one-click Claude Desktop install, authoring guide

### With A Little Help From My Friends

Let an AI assistant work with your scripts. JS Automations is now an MCP server: Claude Desktop (or any MCP client) can read your scripts and logs, find out why something does not run, and — if you allow it — write and restart scripts. You stay in control: it is off by default, every tool has its own switch, and every change is saved as a Git commit. See the new [MCP guide](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md).

**MCP server**

- New server on port **3002** (separate from the webhook port), switched on under **Settings → MCP Server**; access token with show / copy / create-new, optional IP allowlist and reverse-proxy settings
- **One-click install for Claude Desktop**: download a `.mcpb` extension with endpoint and token filled in, or copy a ready config
- 16 tools in three groups (read, control, write), each with its own switch. Writing, `call_service`, `delete_script` and `get_store` are **off by default**
- Writes are syntax-checked first and type-checked (warnings), saved atomically and committed to Git together with a snapshot of your previous state; a script's Lovelace card is preserved; nothing is restarted automatically
- Open editor tabs reload when an assistant changes the file (a card preview too); unsaved edits are kept, a lasting banner points out the conflict and saving asks before overwriting; a script an assistant deletes closes its tab
- Credentials are masked in everything an assistant reads; `ha.store` secrets are never returned. Script source and log text are marked as untrusted data for the assistant
- `get_api_reference` can search the documentation and return just the matching passages; the new topic `services` serves the typed Home Assistant services of your instance (for example the `media` payload of `media_player.play_media`)
- Prompts **New JSA script**, **Plan a JSA script (interview)** and **Convert an ioBroker script**, plus the documentation as resources
- New [migration guide](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/iobroker-migration.md) for moving ioBroker scripts to JS Automations (ID mapping, API translation table, worked example)
- Assistants keep credentials out of script source: they are empty fields of the persisted config, with a warning and a persistent notification until the user fills them in
- New **Authoring Scripts** guide (script structure, header tags, conventions, cards) and a header tag reference in the API Reference
- Works with other MCP clients too (Streamable HTTP + bearer token)

**Developer tools (Expert Mode)**

- New **MCP** tab: live log of tool calls with expandable, copyable errors
- Dev-tools tabs can be **switched off** individually under Settings → General
- **Maintainer mode** (for JSA developers): the assistant quietly notes API, feature and documentation ideas, raises each once after it came up three times, and reports hard errors immediately; notes appear in the MCP tab and can be copied as GitHub-issue text

**Under the hood**

- Rate limiting, lockout and allowlist moved into a shared module used by both the webhook and the MCP server
- Script overview shared between the UI and MCP

**Fixes**

- `@card dev` is honoured again by `ha.frontend.installCard()`: the card is no longer written to `www` and registered as a Lovelace resource while the script is still in preview mode
- The card preview reloads after the card was changed from outside the editor
- **New script → From repo** can restore a script whose deletion was already committed; a failed restore shows the plain error message instead of escaped JSON
- Editor: error and type tooltips show on hover again (they never appeared), and the editor icons (search, quick fixes) no longer show as hex codes
- Typings: `ha.call()` no longer reports "Expression produces a union type that is too complex" on instances with a few hundred entities or more
- Typings: `ha.states[id]` accepts an entity ID held in a variable or `CONFIG` (it was a type error), and service fields declared as text by Home Assistant accept numbers (for example `number.set_value`)
- `ha.persistent('key', false)` is typed as `boolean` instead of the literal `false`, so assigning `true` no longer fails the type check
- Documentation: how a native entity receives commands from Home Assistant (`'ON'` / `'OFF'` through `ha.on()`), all `ha.on` filter operators with and without a threshold


---

## [3.1.0] - 2026-10-26

> **⚠️ Before you update or downgrade:** Secret encryption for `ha.store` is **opt-in** (Settings → Danger Zone → *Encrypt ha.store Secrets*). If you switch it on, switch it **off again before going back to an older add-on version** — older versions cannot read encrypted secrets, and they stay unreadable until you update again. Nothing changes for you unless you enable it.

### Save and Sound

Your scripts and your data are now safe: every change can be versioned, the whole add-on can be backed up on a schedule, and secrets can be encrypted at rest.

**Script versioning with Git**

- Local Git history for your scripts — explicit **Commit** button, History panel and full-width diff tabs; the Commit button is disabled when the active tab has nothing to commit
- Optional push to a remote repository — works with any HTTPS Git host (GitHub, GitLab, Gitea, …) via an access token; the status bar shows unpushed commits
- Restore a file to any commit, revert a commit, or bring back a deleted script
- Optional commit-on-delete

**Backup & restore**

- Scheduled backups (cron) as zip snapshots with retention, optionally uploaded to a WebDAV target
- Disaster-recovery restore from a zip: selective diff before applying, plus an automatic pre-restore snapshot to roll back

**Secrets**

- `ha.store` secrets can be encrypted at rest (opt-in, switchable at runtime without a restart, with a safety copy and rollback)
- Per-script sharing lists decide which scripts may read a secret; sharing survives renames and marks deleted scripts
- Secret values carry a SECRET badge and are only shown on explicit reveal
- Password and token fields in Settings (`git_token`, MQTT and WebDAV passwords) are masked server-side — the raw value never leaves the server unless you reveal it; leaving a field blank on save keeps the stored value

**Security**

- Updated npm dependencies and upgraded simple-git to 4.x — resolves all known `npm audit` findings
- The add-on image now ships a Node.js version that includes the Brotli fix for CVE-2026-111497 ("HTTP2Shell")
- Added Dependabot for weekly dependency updates

**Fixes**

- Home Assistant WebSocket watchdog — drops a stale socket on reconnect instead of hanging
- Generated type definitions emit a valid index signature for large objects
- `ha.store.get()` returns live values even without listeners
- Git no longer mistakes the add-on's own repository for the scripts repository
- Commits no longer sweep up files you did not select; the diff editor no longer garbles on first paint
- Several diff-view and i18n polish fixes

---

## [3.0.2] - 2026-08-25

- style: prettier formatting pass on new docs
- fix: clear cached revealed webhook token on registry resync
- fix: don't silently drop ha.update() when ha.register() hasn't landed yet
- fix: merge webhook registry writes onto disk instead of overwriting
- fix: translate hardcoded LABEL/AREA placeholders in New Script wizard
- docs: remove old root API_REFERENCE.md/TECH-README.md (moved to docs/ in previous commit)
- docs: restructure into docs/guide + docs/internal, slim README
- fix: honor ha.frontend.installCard's config option via getStubConfig
- fix: resolve HA theme-color slugs for label group headers
- fix: collapse editor-view host when a virtual system tab is active
- docs: update README hero screenshot for 3.0.0

---

## [3.0.0] - 2026-08-13

### Harder, Better, Faster, Stronger

The entire app has been rebuilt from the ground up — a new visual scripting editor, a modernized interface, and a fully typed codebase underneath.

**Blockly visual editor**

Scripts can now be built visually, no code required — drag-and-drop blocks for triggers, conditions, entity/service calls, MQTT, webhooks, Calendar/Todo, and more. "Show Code" reveals the generated JavaScript live, and any block script can be duplicated as an editable `.js` file the moment you outgrow the blocks.

**What's new**

- Full Blockly block library: entity/service calls, state/schedule/webhook triggers, Store, MQTT, Area/Label lookups, Calendar/Todo, `ha.history` trend/timeSince, an interactive Ask block
- "Show Code" panel — see the generated JavaScript instantly, no server round-trip
- "Duplicate as JavaScript" — a safe, non-destructive way out of the visual editor once a script gets complex
- Block-level error highlighting when a `.blocks` script throws at runtime
- Automatic `@permission` derivation from the blocks actually used

**A completely modernized interface**

The whole frontend has been rewritten on LIT web components with TypeScript, and the backend is now fully TypeScript too — same features, a more consistent UI, and several long-standing edge-case bugs found and fixed along the way.

- New **Mobile View** — a phone-friendly dashboard and log screen, auto-detected or toggled manually
- State-preview toggle in the entity picker (Ctrl+E) — see an entity's live state while picking it
- Full header-tag (`@include`, `@card`, ...) IntelliSense in the script editor
- Refreshed, more consistent visual design (unified spacing/surface colors across every panel)

**Also fixed along the way**

- Expert Mode toggle needed a hard reload to apply the sidebar logo color
- IntelliSense/snippet consistency gaps in the Monaco editor
- System CPU/RAM sensors now correctly use `state_class` (were silently rejected by HA before)
- Card preview panel: drag handle now works, panel stays on-screen when resized, toggle button reflects state correctly, only shows for JS/TS scripts with `@card`
- Entity picker modal now closes on Escape
- Store Explorer and server log deletion were incorrectly locked to admin-only, now work for all users
- Sidebar search no longer steals keyboard focus away from the editor
- Status bar stayed hidden on the mobile main-log screen; MQTT status indicator could drop when switching mobile views
- Script Packs: the card type advertised to Home Assistant's "Add Card" picker now always matches the card's real custom element tag (previously a script with an underscore in its filename could get stuck in an infinite loading spinner)
- Monaco editor: fixed duplicate model creation when reopening a tab, and stale typings lingering after re-registration
- `ha.entity()` service calls now release their keep-alive reference exactly once (potential resource leak fixed)
- `ha.persistent()` now backfills missing top-level keys after a schema upgrade instead of leaving them undefined
- Resolved all high-severity npm audit findings

---

## [2.57.9] - 2026-08-07

- feat: add ha.frontend.cacheAsset() for locally caching external assets (team logos, album art, ...)
- feat: auto-restart crashed scripts and expose HA connection status to scripts
- fix: MQTT test connection could hang forever on a dead port
- fix: capability-analyzer now detects direct ha.mqtt.publish()/subscribe() usage
- fix: status bar and header version badge stuck stale after a socket reconnect
- fix: Webhook Panel could stay stuck on pre-restart state after an addon restart

---

## [2.57.8] - 2026-07-23

- fix: false-positive Safe Mode on ordinary addon restarts silently blocked script autostart
- feat: add stale_ok availability option and ha.unregister() runtime API
- docs: replace Angular migration RFC with LIT migration plan
- fix: MQTT monitor rows expand full detail on click, drop remove button
- fix: WATCH tab tiles missing until script restart (replay race vs. late DOM init)
- fix: resolve WATCH tab icons from HA's own device_class icon translations
- fix: retroactively correct v2.57.7 CHANGELOG entry (CRLF boundary-matching bug)
- fix: normalize CRLF before matching CHANGELOG <!-- NEXT --> boundary (Windows core.autocrlf breaks pure-LF sepIdx search)

---

## [2.57.7] - 2026-07-10

- fix: coalesce concurrent getEntityRegistry() calls to stop self-inflicted registry-poll flood
- fix: guard performStartupCleanup against overlapping concurrent runs
- fix: re-sync beta CHANGELOG mirror after correcting v2.57.6 stable entry
- fix: retroactively correct v2.57.6 release notes (CRLF regex + fragile git describe --exclude); drop deprecated armv7 build target

---

## [2.57.6] - 2026-07-10

- fix: don't block script autostart behind Lovelace card cleanup during boot
- fix: prevent stacked concurrent loadHAMetadata retry chains (thundering herd on MQTT flapping)
- fix: close HA websocket on shutdown (disconnect() never existed); reload HA metadata once connection is up
- fix: complete deferred startup (autostart, events, MQTT) after failed initial HA connection
- ci: update actions to Node 24 majors (checkout v7, docker actions v4/v6/v7)
- feat: maintain beta addon CHANGELOG.md; skip beta bump commits in release notes
- feat: compact beta version badge, JSA BETA header title, shorter beta addon name
- fix: exit on SIGTERM instead of waiting for SIGKILL; open web server before kernel start
- docs: document expected Supervisor port conflict when starting beta while stable runs
- feat: add ship:beta:minor and ship:beta:major variants
- feat: add ship:beta npm script (lost in previous commit)
- feat: add beta release channel (beta addon, sibling guard, ship:beta pipeline)
- fix: align dev panel tab spacing across all five tabs
- fix: replace fixed RAM warning threshold with pressure/trend based signal

---

## [2.57.5] - 2026-07-07

- fix: ease startup congestion when many scripts autostart at once — staggered script starts (300ms apart), extended the entity registration ACK poll window (20→40 attempts), and fixed the HA metadata retry guard to check areas/labels readiness independently instead of requiring both to be empty

---

## [2.57.4] - 2026-07-07

- fix: Webhook Panel showed no entries (and a stale external URL) on every page load when running behind Ingress — it used raw `fetch('/api/webhooks...')` instead of the Ingress-aware `apiFetch()` helper, so the request never reached the add-on

---

## [2.57.3] - 2026-07-07

- fix: webhook server was never reachable from outside the container — `config.yaml` was missing the Docker `ports:` publish entry for the webhook port, so Supervisor never exposed it to the host
- fix: webhook port is now fixed at `3001` instead of a `Settings → Webhooks → Port` option — it must match the port published in `config.yaml`, so making it user-configurable was misleading (changing it had no real effect)

---

## [2.57.2] - 2026-07-07

- fix: keep worker alive when ha.action() handlers are registered
- docs: note that the add-on is production-ready but still actively evolving

---

## [2.57.1] - 2026-07-04

- fix: harden Webhook API — IP allowlist (`WebhookOptions.allowlist`), HMAC signature verification (`ha.verifyWebhookSignature()`) for GitHub/Stripe-style signed payloads, and a lockout after repeated failed token attempts
- fix: Webhook Panel now reflects port/external URL changes without a full reload
- feat: `ha.call(serviceId, data, { returnResponse: true })` awaits a service's response payload (e.g. `weather.get_forecasts`) instead of firing-and-forgetting
- fix: response-required service calls (`{ returnResponse: true }`) now populate HA's target selector, not just `service_data` — otherwise HA replied "did not match any entities" regardless of a valid entity_id
- fix: Live REPL crashing on top-level `await` (`ERR_REQUIRE_ASYNC_MODULE`) — snippets are now wrapped in an async IIFE before executing
- fix: `ha`/`schedule` intermittently showing as unknown in Monaco after a reconnect — `entities.d.ts`/`services.d.ts` are now guaranteed to exist from startup and are written atomically, so a missing or half-written file can no longer break the whole type-checking program

---

## [2.57.0] - 2026-07-03

### Return to Sender

`ha.onWebhook()` turns any script into a webhook receiver — external services (GitHub, Stripe, Ko-fi, IFTTT, ...) can push data into a running script and get a real HTTP response back. Unlike HA's built-in webhook automations, which always return an empty `200 OK` immediately and run asynchronously afterward, JSA webhooks are fully bidirectional: your handler receives the complete request and returns any status code and body.

**What's new**
- `ha.onWebhook(id, handler)` / `ha.onWebhook(id, options, handler)` — registers an endpoint at `:<port>/webhook/<id>`
- `GET` / `POST` / `PUT` / `DELETE` / `PATCH` support via `options.method` (default `POST`)
- `{ noAuth: true }` for services that verify themselves (e.g. Ko-fi)
- Tokens are auto-generated and managed by JSA — never in script code, stable across reloads/restarts, rotatable from the UI
- New **Webhook Panel** in Developer Tools — active endpoints, copy-ready URLs, token reveal/rotate/delete, last-call status
- Rate limiting, constant-time token verification, and generic error responses (no internals leaked) built in
- New `@permission webhook` capability
- New Settings → Webhooks section: port, external URL, trust reverse proxy

---

## [2.56.4] - 2026-07-02

- fix: correct package.json version to match released v2.56.3
- fix: reduce HA reconnect log spam and make MQTT recovery robust
- Merge branch 'main' of https://github.com/rocklobster42195/ha-js_automations_addon
- fix: correctly persist script state on self-stop via ha.stop()
- Update README to remove status badge and note
- docs: outline concept for a future Webhook API (`ha.onWebhook`) — not implemented yet

---

## [2.56.3] - 2026-07-01

### Fix You

**Editor**
- Fixed: `ha` and `schedule` globals intermittently disappearing in Monaco editor — `entities.d.ts` was generated with `export interface`, making it a TypeScript module instead of an ambient file; globals are now reliably available after reconnect
- Fixed: `@permission network` incorrectly shown as "not needed" for scripts referencing `ha.http` via destructuring or stored variables

**Runtime**
- Fixed: Memory leak — `ha.onEvent()` subscriptions for stopped scripts were never removed from the internal subscription map
- Fixed: Memory leak — active entity tracking (`activeRunEntities`) was not cleared on worker exit

---

## [2.56.2] - 2026-06-24

---

## [2.56.1] - 2026-06-24

---

## [2.56.0] - 2026-06-24

feat: add ha.history computed helpers; breaking: remove ha.getHistory/ha.getStatistics

### History Repeating

`ha.history` is now the single namespace for everything time-series related — raw state history, pre-aggregated statistics, and six built-in computation functions that run directly in the script worker. No HA helper entities, no UI configuration needed.

All six helpers accept either an entity ID (fetches from HA automatically) or a plain array of `{ state, last_changed }` objects — so external API data feeds straight into the same functions without any wrapper.

**Breaking change:** `ha.getHistory()` and `ha.getStatistics()` are removed. Use `ha.history.get()` and `ha.history.statistics()`.

**What's new**
- `ha.history.get()` — replaces `ha.getHistory()`
- `ha.history.statistics()` — replaces `ha.getStatistics()`
- `ha.history.trend(source, options)` — `'rising'` / `'falling'` / `'stable'` via OLS regression
- `ha.history.derivative(source, options)` — rate of change; `method: 'linear'` (OLS) or `'polynomial'` (parabolic/cubic fit, instantaneous slope at last point)
- `ha.history.integral(source, options)` — area under the curve (e.g. W → Wh), trapezoidal by default
- `ha.history.stats(source, options)` — mean, min, max, median, stddev, count
- `ha.history.timeSince(source, state?)` — ms since last state change or last entry into a specific state
- `ha.history.timeInState(source, state, options)` — total ms spent in a state within a time window
- All helpers accept an entity ID **or** an external data array (`HAHistoryEntry[]`)

---

## [2.55.2] - 2026-06-20

---

## [2.55.1] - 2026-06-20

feat: implement MQTT Monitor with publish functionality and event firing capabilities

### On the Wire

Scripts now speak MQTT natively.

`ha.mqtt.subscribe()` gives scripts a direct line to the broker — wildcards included. React to raw Tasmota payloads, Zigbee2MQTT messages without the HA integration, DIY hardware, or anything else on the bus.
`ha.mqtt.publish()` sends messages to any topic, with full JSON serialization and retain/QoS support. Subscriptions are scoped to the script and cleaned up automatically on stop.

`ha.register()` now passes unknown config fields directly into the MQTT Discovery payload. This unlocks complex HA domains — register a native `light` with `brightness_command_topic`, a `climate` with `temperature_command_topic`, or a `cover` with `position_topic` — all handled via `ha.mqtt.subscribe()` in the same script.

**What's new**
- `ha.mqtt.subscribe(topic, callback)` — raw broker subscription, returns an unsubscribe function
- `ha.mqtt.publish(topic, payload, options?)` — publish to any topic, auto-JSON serialization
- Wildcard support: `+` (single level) and `#` (multi-level)
- `ha.register()` Discovery passthrough for domain-specific fields
- Graceful no-op when no MQTT broker is configured — scripts warn instead of hanging