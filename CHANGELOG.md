<!-- NEXT -->

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