## [3.0.0-beta.0] - 2026-08-09

- chore: force LF line endings via .gitattributes
- Merge pull request #23 from rocklobster42195/feature/backend-ts-migration
- docs: add 3.x beta callout to README, document LIT/backend-TS/Blockly in TECH-README
- feat: swap sidebar header logo to robot_angry on beta builds
- feat: give the beta channel a distinct robot_angry identity
- docs: mark dev-port flag resolved in grill notes
- fix: npm run dev port-already-in-use after a previous session
- docs: draft 3.0.0 changelog entry (Harder, Better, Faster, Stronger)
- style: apply prettier formatting to backend TS files and notes
- docs: capture 3.0.0 beta ship-plan grill session
- chore: silence Edge Tools' typescript-config/strict advisory hint
- refactor: convert server.js to TypeScript (final file, RFC §8 complete)
- refactor: convert routes/scripts-routes.js to TypeScript
- refactor: convert routes/system-route.js to TypeScript
- refactor: convert routes/store-route.js and ha-routes.js to TypeScript
- refactor: convert routes/webhook-route.js to TypeScript
- refactor: convert routes/settings-route.js to TypeScript
- refactor: convert services/system-service.js to TypeScript
- fix: Expert Mode toggle needed a hard reload to apply the sidebar logo color
- fix: nodemon restart-storm from watching its own tsc build output
- feat: full header-tag IntelliSense in the editor
- fix: IntelliSense/snippet consistency gaps in the Monaco editor
- fix: use state_class instead of device_class for system CPU/RAM sensors
- refactor: convert kernel.js to TypeScript
- refactor: convert core/entity-manager.js to TypeScript
- refactor: convert core/worker-wrapper.js to TypeScript
- refactor: convert core/worker-manager.js to TypeScript
- refactor: convert core/card-manager.js to TypeScript
- refactor: convert core/script-watcher.js to TypeScript
- refactor: convert core/dependency-manager.js to TypeScript
- refactor: convert core/settings-manager.js to TypeScript
- refactor: convert core/ha-connection.js to TypeScript
- refactor: convert core/mqtt-manager.js to TypeScript
- refactor: convert core/webhook-manager.js to TypeScript
- refactor: convert core/settings-schema.js to TypeScript
- refactor: convert core/fs-service.js to TypeScript
- refactor: convert core/compiler-manager.js to TypeScript
- refactor: convert core/blockly-compiler.js to TypeScript
- refactor: convert core/script-header-parser.js to TypeScript
- refactor: convert core/store-manager.js to TypeScript
- refactor: convert core/ha-history-helpers.js to TypeScript
- refactor: convert core/bridge.js to TypeScript
- refactor: convert core/log-manager.js to TypeScript
- refactor: convert core/capability-analyzer.js to TypeScript
- refactor: convert core/type-definition-generator.js to TypeScript
- refactor: convert core/sibling-guard.js to TypeScript
- refactor: convert core/script-command-router.js to TypeScript
- refactor: convert core/state-manager.js to TypeScript
- refactor: convert core/dev-setup.js to TypeScript
- chore: remove dead store-type-generator.js
- refactor: convert core/config.js to TypeScript
- build: add tsc compile step for backend TypeScript modules
- docs: capture backend TS migration methodology
- fix: sidebar BLK badge had no color styling
- feat: state-preview toggle in the entity picker (Ctrl+E)
- fix: entity-picker-modal now closes on Escape
- style: run prettier on pre-existing Blockly files (whitespace only)
- style: run prettier on today's new/edited files
- ci: allow manually triggering the CI workflow (workflow_dispatch)
- feat: add automated frontend component tests (RFC §9.3)
- refactor: remove dead CSS left behind by the LIT component migration
- fix: card-preview toggle button active-state never synced reactively
- fix: card-preview drag handle listener never actually attached
- fix: keep card-preview panel on-screen when widening or resizing
- fix: hide card-preview toggle unless a JS/TS script has @card active
- feat: migrate script editor to <editor-view>/<monaco-editor> LIT components (RFC Phase B item 8)
- feat: migrate creation wizard to <script-modal> LIT component (RFC Phase B item 7)
- fix: resolve pre-existing lint errors in Blockly's .blocks BOM handling
- Merge main (Blockly visual editor) into feature/lint-prettier-ci-foundation
- Merge pull request #21 from rocklobster42195/feature/blockly-integration
- Merge remote-tracking branch 'origin/main' into feature/blockly-integration
- feat: add block-level error visualization for Blockly scripts
- feat: add Calendar/Todo blocks and history timeSince/trend blocks
- feat: add Area/Label blocks, Webhook block, and permission-map derivation
- feat: add ha_ask Blockly block, localize toolbox shadow text, fix inline layout
- docs: sync M5 checklist with the shipped Show Code / duplicate-as-JS design
- feat: add Blockly Show Code panel and non-destructive Convert-to-JS
- feat: add ha_wait_for_state Blockly block with timeout success/timeout branches
- docs: record final Blockly scope decision (beginner-focused, cut list)
- feat: mobile header as fixed 4-button nav, settings mobile polish
- feat: add Mobile View (RFC §7)
- feat: add confirm-dialog, alert-toast, entity-picker-modal, store-item-modal (RFC Phase A item 6)
- docs: remove duplicate/auto-generated 2.57.9 CHANGELOG entry
- feat: migrate card preview panel to LIT (TS)
- style: run prettier on card-manager.js
- fix: card preview default config now respects @expose entity domain
- feat: add ha.frontend.cacheAsset() for locally caching external assets
- fix: repair the Command Reference docs tab and extend the mqtt warning dot
- feat: migrate sidebar and script list to LIT (TS)
- fix: MQTT test connection could hang forever on a dead port
- feat: migrate settings view to LIT (TS)
- feat: migrate event inspector to LIT (TS)
- feat: migrate store explorer to LIT (TS)
- feat: migrate webhook-panel, mqtt-monitor, and watch-panel to LIT (TS)
- feat: migrate status bar to LIT (TS), fix shadow-DOM icon loading
- feat: migrate log-viewer to LIT (TS)
- feat: migrate integration-banner and safe-mode-banner to LIT (TS)
- feat: extract CSS design tokens into a defined 3-level surface model
- feat: wire lint/format/test as a pre-release gate
- feat: add node:test infra with a Home-Assistant-unreachable boot smoke test
- chore: enable checkJs/allowJs for backend TypeScript groundwork
- chore: add ESLint + Prettier + CI, fix all lint errors
- docs: replace LIT migration RFC with frontend modernization plan
- feat: add Store/MQTT blocks, localize Blockly UI, expand standard block library
- feat: add ha_register options mutator and extend ha_update
- feat: dynamic entity/service dropdowns for Blockly blocks
- Merge branch 'main' into feature/blockly-integration
- Merge branch 'main' into feature/blockly-integration
- feat: add ha_entity value block and unify entity sockets
- feat: add schedule triggers and a data mutator for call service
- feat: add script-utility and register/update blocks to Blockly library
- feat: add Blockly editor shell with first working block chain
- feat: add Blockly M1 foundation (.blocks compile pipeline)

---

<!-- NEXT -->

---

## [2.57.9] - 2026-08-07

- feat: add ha.frontend.cacheAsset() for locally caching external assets (team logos, album art, ...)
- feat: auto-restart crashed scripts and expose HA connection status to scripts
- fix: MQTT test connection could hang forever on a dead port
- fix: capability-analyzer now detects direct ha.mqtt.publish()/subscribe() usage
- fix: status bar and header version badge stuck stale after a socket reconnect
- fix: Webhook Panel could stay stuck on pre-restart state after an addon restart

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