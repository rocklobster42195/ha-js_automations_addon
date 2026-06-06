# Under the Hood: JS Automations

This document describes the technical architecture of the addon — how the subsystems interact, why certain design decisions were made, and what happens internally when a script starts, an entity is created, or a Home Assistant event is received.

It is intended as a contributor-level deep-dive, not a quick-start guide. For API usage examples see [API_REFERENCE.md](./API_REFERENCE.md).

---

## Table of Contents

1. [Overview: The Two-Transport Model](#1-overview-the-two-transport-model)
2. [Kernel: Orchestration and Boot Sequence](#2-kernel-orchestration-and-boot-sequence)
3. [Bridge: Event Mediation](#3-bridge-event-mediation)
4. [Worker Threads: Isolation and Lifecycle](#4-worker-threads-isolation-and-lifecycle)
5. [Worker Wrapper: The Sandbox](#5-worker-wrapper-the-sandbox)
6. [Entity Selector: `ha.select()`](#6-entity-selector-haselect)
7. [Persistent Store & `ha.persistent()`](#7-persistent-store--hapersistent)
8. [`ha.action()` System](#8-haaction-system)
9. [Entity Manager: Entity Lifecycle](#9-entity-manager-entity-lifecycle)
10. [MQTT Discovery: How Entities Are Created](#10-mqtt-discovery-how-entities-are-created)
11. [Entity Registry: Persistence and Mark-and-Sweep](#11-entity-registry-persistence-and-mark-and-sweep)
12. [HA Connection: WebSocket & State Cache](#12-ha-connection-websocket--state-cache)
13. [MQTT Manager: Broker Connection and Command Routing](#13-mqtt-manager-broker-connection-and-command-routing)
14. [TypeScript Pipeline and IntelliSense](#14-typescript-pipeline-and-intellisense)
15. [Settings: Schema-Driven UI](#15-settings-schema-driven-ui)
16. [Capability & Permission System](#16-capability--permission-system)
17. [Card Manager: Script Pack System](#17-card-manager-script-pack-system)
18. [Resource Consumption and Known Limits](#18-resource-consumption-and-known-limits)

---

## 1. Overview: The Two-Transport Model

The addon communicates with Home Assistant over **two independent transport channels**:

| Channel | Purpose | Direction |
|---|---|---|
| **HA WebSocket** | Receive events, call services, query/write entity registry | Bidirectional |
| **MQTT** | Register entities (Discovery), publish states, receive commands | Bidirectional |

**Why two transports?**

The HA WebSocket is the native channel for data and events — it delivers all state changes in real time and allows service calls. However, it does not provide a persistent mechanism for registering custom entities. Historically the addon required a Custom Integration (`js_automations` custom component) that could create entities via REST.

Since switching to **MQTT Discovery**, the custom integration is no longer needed. MQTT Discovery is the official HA protocol for dynamically registered entities. A single retained payload on `homeassistant/<domain>/<object_id>/config` is enough — HA automatically creates the entity including device, device class, attributes, and everything else. The payload stays retained in the broker, so HA re-registers it on every restart.

---

## 2. Kernel: Orchestration and Boot Sequence

`core/kernel.js` is the central orchestrator. It is exported as a singleton (`module.exports = new Kernel()`), meaning there is exactly one Kernel instance per process.

### Instantiation vs. Start

The Kernel deliberately separates **`boot()`** from **`start()`**:

- **`boot(io)`** — Called as soon as the Express/Socket.io server is ready. Instantiates all managers, registers persistent event listeners, creates the Bridge. No I/O, no network.
- **`start()`** — Starts the actual application logic: establish the HA connection, connect to MQTT, compile TypeScript, register entities, start scripts.

This separation allows `bridge.connect()` (Socket.io event wiring) to be called as the very first step in `start()` — so the UI can receive updates immediately while the system is still booting.

### Boot Sequence (simplified)

```
boot(io)
├── LogManager, SettingsManager, HAConnector instantiate
├── DependencyManager, StateManager, StoreManager instantiate
├── CompilerManager, MqttManager instantiate
├── WorkerManager configure (storageDir, scriptsDir, store, mqtt)
├── SystemService create
├── EntityManager create (receives all above as injection)
├── Bridge create
└── Register static event listeners (Settings, Logs, MQTT Status)

start()
├── bridge.connect()          ← Wire Socket.io events
├── systemService.start()     ← Start CPU/RAM polling
├── TypeScript initial pass   ← Compile all .ts scripts
├── haConnector.connect()     ← Establish HA WebSocket
├── mqttManager.connect()     ← Connect to MQTT broker
├── Read HA language
├── entityManager.createExposedEntities()  ← Register @expose entities
├── _setupSystemEventListeners()           ← HA events → Worker dispatch
├── Start autostart scripts
└── performGlobalCleanup()    ← Remove orphaned entities immediately
```

### Dependency Injection via Kernel

The Kernel constructs all managers itself and passes dependencies explicitly as constructor arguments. Example: `EntityManager` receives `haConnection`, `workerManager`, `stateManager`, `depManager`, `systemService`, `mqttManager`, and `compilerManager` as injected dependencies. There is no global service-locator pattern — every class declares its dependencies in its constructor signature.

### Reconnect Logic

`handleReconnection()` is called from a route when the frontend detects a connection drop. It reconnects the HA WebSocket, refreshes the system language, republishes `@expose` entities, and calls `republishNativeEntities()` — so all entities created via `ha.register()` (including device-grouped ones) are present again after an HA restart.

### Global Cleanup Cycle

Every 60 minutes (and once immediately after boot), `performGlobalCleanup()` runs:
1. Compares the scripts currently on disk (slugified) with the registered entities in HA
2. Removes orphaned entities (script deleted, entity still in HA)
3. Republishes all `ha.register()` entities (integrity check)

---

## 3. Bridge: Event Mediation

`core/bridge.js` is the only component that knows Socket.io exists. All other managers emit standard Node.js `EventEmitter` events — the Bridge translates these into the Socket.io protocol toward the browser.

```
LogManager    ──log_added──────────────►  Bridge  ──socket.emit('log')──────────────►  Frontend
Kernel        ──ha_state_changed──────►  Bridge  ──socket.emit('ha_state_changed')──►  Frontend
Kernel        ──integration_status──►   Bridge  ──socket.emit('integration_status')──►  Frontend
SystemService ──system_stats_updated──►  Bridge  ──socket.emit('system_stats')──────►  Frontend
```

When a new browser tab connects (Socket.io `connection` event), the Bridge immediately sends the current system status — so every new tab sees the correct state without waiting for the next event.

The Bridge itself contains **no logic**, only routing. This makes it testable and replaceable: swapping Socket.io for plain WebSockets would only require changing the Bridge.

---

## 4. Worker Threads: Isolation and Lifecycle

Every script runs in its own **Node.js Worker Thread** (not a separate process). Consequences:

- **No shared heap**: Scripts cannot interfere with each other via memory access
- **Separate V8 isolate**: A crash in one script does not crash the main process
- **Communication only via `postMessage`**: All interactions between script and system use structured messages

### Starting a Worker: `startScript(filename)`

`WorkerManager.startScript()` executes the following steps:

1. **TypeScript resolution**: If `filename.ts`, the actual execution file is `dist/filename.js`. If the compiled version does not exist, abort with an error message.
2. **Restart-protection check**: Have more than `restart_protection_count` starts been attempted within the last `restart_protection_time` milliseconds? → Abort, error message.
3. **Initialize Mark-and-Sweep**: `activeRunEntities.set(filename, new Set())` — starts an empty tracking set for "active in this run". After 10 seconds, a sweep is initiated (see §11).
4. **Create Worker**: `new Worker('worker-wrapper.js', { workerData, resourceLimits })` with:
   - The complete script metadata object as `workerData`
   - The initial HA state cache (`haConnector.states` + alias entries)
   - The initial store content
   - The memory limit (`maxOldGenerationSizeMb`)

### Message Protocol (Worker → Manager)

| `msg.type` | Meaning |
|---|---|
| `log` | Log line from `ha.log()` or `console.log()` |
| `call_service` | `ha.call()` / `ha.callService()` — Manager calls HA WebSocket, sends response back |
| `update_state` | `ha.update()` — Manager forwards to EntityManager (MQTT) |
| `create_entity` | `ha.register()` — Manager forwards to EntityManager for Discovery |
| `subscribe` | `ha.on()` — Manager registers pattern in `subscriptions` map |
| `store_set` | `ha.store.set()` — Manager persists via StoreManager, broadcasts to all other workers |
| `ask` | `ha.ask()` — Manager sends HA mobile app notification, waits for action response |
| `get_stats` | Heartbeat request; worker responds with RAM usage |
| `install_card` | `ha.frontend.installCard()` — Manager forwards to CardManager |
| `register_action` | `ha.action()` — Manager registers action handler name for routing |

Failed service calls (`call_service`) are caught in the WorkerManager and logged to the master process log rather than crashing silently — this ensures errors are always visible in the UI even if the script itself does not have error handling.

### Dispatching State Changes to Workers

When HA sends a `state_changed` event over the WebSocket, the Kernel calls `workerManager.dispatchStateChange(entity_id, new_state, old_state)`. The WorkerManager checks for each running worker whether its `subscriptions` array contains a pattern that matches the `entity_id`. Only if there is a match does it send `worker.postMessage({ type: 'state_changed', ... })`.

Pattern matching supports wildcards (`sensor.*`) and exact entity IDs. Since every dispatch iterates all running workers, the complexity is O(Workers × Subscriptions) — negligible at realistic script counts.

### Thread Lifecycle: Reference Counting

`parentPort.unref()` is called at thread start: the worker thread exits automatically when its event loop is empty and no further callbacks are pending. A script that only calls `ha.call(...)` and does nothing else afterward will exit cleanly on its own.

`ha.on()` uses a **reference counter** rather than a simple toggle (fixed in v2.51.2/v2.51.5):

- Each `ha.on()` call increments `refCount` and calls `parentPort.ref()` when `refCount` goes from 0 to 1 (first listener)
- Each listener removal decrements `refCount` and calls `parentPort.unref()` when `refCount` reaches 0 (last listener removed)
- This ensures the worker stays alive for exactly as long as at least one active `ha.on()` listener exists

The reference counting approach also handles scripts that call `ha.on()` inside conditional branches or loops correctly — without it, the worker could exit prematurely or stay alive indefinitely depending on call order.

### Graceful Shutdown

When the WorkerManager wants to stop a worker, it sends `{ type: 'stop_request' }`. The wrapper then calls all `onStop` callbacks of the script (e.g., to close connections) and then exits cleanly.

---

## 5. Worker Wrapper: The Sandbox

`core/worker-wrapper.js` is the file that is actually executed as a Worker. It builds the sandbox environment before the user script is loaded.

### Module Path Injection

So that scripts can write `require('axios')` without installing `axios` themselves, the `.storage/node_modules` directory is added to both `Module.globalPaths` and `module.paths`. This is a Node.js-internal mechanism — without this injection, `require()` in the worker context would only search standard paths.

### Axios Monkey-Patch

Worker Threads have a known issue with HTTP keep-alive connections: open sockets prevent the thread from terminating. The wrapper patches `Module.prototype.require` so that every `require('axios')` automatically receives `keepAlive: false`.

### Capability Enforcement

After module-path injection and before the Axios patch, a `Module._load` hook is installed (when `capabilityEnforcement: true` in `workerData`):

- **`NETWORK_MODULES`** (`http`, `https`, `net`, `tls`, `dns`): Throws `PermissionDeniedError` if `@permission network` is missing.
- **`EXEC_MODULES`** (`child_process`): Throws `PermissionDeniedError` if `@permission exec` is missing.
- **`globalThis.fetch`**: Replaced with a throwing function if `@permission network` is missing.

The hook is minimally invasive — it delegates all permitted calls to the original `Module._load`.

### Filesystem Injection

After `global.ha = ha` is set, (when `filesystemEnabled: true` and `fsDataDir` is not empty) `ha.fs` is injected:

```js
const { buildHaFs } = require('./fs-service');
ha.fs = buildHaFs({ dataDir, capabilityEnforcement, permissions, quotas });
```

`fs-service.js` is a pure utility module. `buildHaFs()` returns an object with 10 methods (read, write, append, exists, list, stat, move, delete, watch, rotate). Each method:
1. Checks the `@permission` declaration (when enforcement is active)
2. Resolves the virtual path (`internal://` → `fsDataDir`, `shared://` → `/share`, `media://` → `/media`) with a traversal guard
3. Checks the storage quota (only on write/append)
4. Executes the actual `fs/promises` operation

### The `ha` Object

The wrapper constructs a global `ha` object. The following table covers the complete set of methods injected, all of which internally call `parentPort.postMessage()`:

| Method | Message type | Notes |
|---|---|---|
| `ha.on(pattern, [filter], [threshold], cb)` | `subscribe` | Increments refCount, calls `parentPort.ref()` when first listener added |
| `ha.call(serviceId, data)` | `call_service` | Dot-notation `'domain.service'`; preferred over deprecated `ha.callService()` |
| `ha.callService(domain, service, data)` | `call_service` | **Deprecated** — use `ha.call()` |
| `ha.update(entityId, state, attrs?)` | `update_state` | Replaces deprecated `ha.updateState()` |
| `ha.update(entityId, attributesOnly)` | `update_state` | Attributes-only overload |
| `ha.updateState(entityId, state, attrs?)` | `update_state` | **Deprecated** — use `ha.update()` |
| `ha.register(entityId, config)` | `create_entity` | Triggers MQTT Discovery |
| `ha.getState(entityId)` | — | Synchronous read from local state cache |
| `ha.getStateValue(entityId)` | — | Converts `'on'`/`'off'` to boolean, numeric strings to number |
| `ha.getAttr(entityId, attr)` | — | Synchronous attribute read from local cache |
| `ha.getGroupMembers(entityId)` | — | Reads `attributes.entity_id` from the group entity's cached state |
| `ha.select(pattern)` | — | Builds an `EntitySelector` from the local state cache |
| `ha.waitFor(pattern, [filter], [threshold], opts)` | `subscribe` | Returns a Promise that resolves on the next matching state change |
| `ha.waitUntil(condition, opts)` | — | Polls `condition()` every `pollInterval` ms (default 500 ms), resolves when true |
| `ha.log(msg)` / `.debug` / `.warn` / `.error` | `log` | Sends log line to master process |
| `ha.store.set(key, value)` | `store_set` | Persists and broadcasts to all other workers |
| `ha.store.get(key)` | — | Synchronous read from local store snapshot |
| `ha.store.delete(key)` | `store_set` | Sets value to `undefined`, triggers broadcast |
| `ha.store.on(key, cb)` | — | Local reactive listener for store key changes |
| `ha.persistent(key, default)` | — | Returns a deep proxy or `{ value }` ref; see §7 |
| `ha.action(name, handler)` | `register_action` | Registers named action handler; see §8 |
| `ha.notify(msg, opts)` | `call_service` | Calls `notify.*` HA service |
| `ha.ask(msg, opts)` | `ask` | Actionable notification, returns Promise |
| `ha.stop(reason)` / `.restart(reason)` | `log` + `process.exit` | Graceful stop/restart |
| `ha.onStop(cb)` | — | Registers shutdown callback |
| `ha.onError(cb)` | — | Registers background error handler |
| `ha.localize(mapping, fallback)` | — | Returns string for `ha.language` |
| `ha.frontend.installCard(opts)` | `install_card` | Triggers CardManager; see §17 |
| `ha.entity(entityId)` | (fluent proxy) | Returns `EntityServices` proxy for chained service calls |

---

## 6. Entity Selector: `ha.select()`

`ha.select(pattern)` returns an `EntitySelector` — a chainable wrapper for bulk operations across multiple entities.

### Pattern Matching

The pattern is evaluated against the local state cache (`initialStates`) at the moment `ha.select()` is called:

| Pattern type | Example | Match behavior |
|---|---|---|
| Exact entity ID | `'light.living_room'` | Single entity |
| Wildcard string | `'light.*'` | All entities where `entity_id` starts with `light.` |
| Entity ID array | `['light.a', 'light.b']` | Exact set of entities |
| RegExp | `/^sensor\.(temp|hum)/` | Regex match against entity ID |

### EntitySelector API

```
EntitySelector
├── .list         → HAState[]  (read-only snapshot)
├── .count        → number
├── .where(fn)    → EntitySelector (filtered subset)
├── .each(fn)     → EntitySelector (side effects, returns same set)
├── .expand()     → EntitySelector (resolve group members recursively)
├── .toArray()    → HAState[]
├── .throttle(ms) → EntitySelector (adds delay between batch service calls)
├── .wait(ms)     → Promise<EntitySelector>
└── .<service>(data) → Promise<EntitySelector>  (domain-specific via SelectorServices<P>)
```

### Service Chaining

Because the selector is typed with `SelectorServices<P>` (derived from the entity ID prefix), domain-specific methods are available directly on the selector:

```js
await ha.select('light.*')
  .where(e => e.attributes.brightness > 50)
  .throttle(200)
  .turn_off();
```

Under the hood, `.turn_off()` (and all other domain service methods) call `ha.callService(domain, method, { entity_id: [...] })` for all entities in the current selection, honoring the `throttle` delay between each call.

### Group Expansion

`.expand()` resolves group entities to their members. It reads `attributes.entity_id` from each group entity in the current selection and returns a new `EntitySelector` with those members instead. Useful when a script receives a group entity and needs to operate on individual members.

---

## 7. Persistent Store & `ha.persistent()`

### `ha.store` — Cross-Script Shared Store

`ha.store` provides a key-value store that is shared across all running scripts and persisted to `.storage/store.json`.

| API | Behavior |
|---|---|
| `ha.store.set(key, value, isSecret?)` | Sends `store_set` to WorkerManager → StoreManager persists, broadcasts new value to all other workers |
| `ha.store.get(key)` | Synchronous read from the local store snapshot delivered at worker start |
| `ha.store.delete(key)` | Equivalent to `ha.store.set(key, undefined)` |
| `ha.store.on(key, cb)` | Registers a local change listener; called when the master broadcasts a store update |
| `ha.store.val` | Direct reference to the local snapshot object — reads are synchronous but do **not** trigger listeners or persistence |

The broadcast mechanism: when any worker calls `ha.store.set()`, WorkerManager notifies StoreManager which persists the value and then sends `{ type: 'store_update', key, value }` to every other running worker. Each worker's local `store` snapshot is updated in place, triggering any registered `.on()` listeners.

### `ha.persistent()` — Auto-Saving Proxy

`ha.persistent(key, defaultValue)` creates a value wrapper that automatically saves back to `ha.store` on every mutation. There are two distinct behaviors depending on the type of `defaultValue`:

**Primitive values** (`string`, `number`, `boolean`):

```js
const counter = ha.persistent('counter', 0);
counter.value++;          // reads, increments, and saves in one expression
ha.log(counter.value);    // always reads the current persisted value
```

The wrapper is a plain object `{ value: T }` where the `value` property is backed by a getter/setter. The setter calls `ha.store.set(key, newValue)` on every write.

**Object values** (anything that is not a primitive):

```js
const config = ha.persistent('config', { teamId: 42, interval: 30 });
config.teamId = 99;       // automatically persisted
config.nested = { x: 1 };
config.nested.x = 2;     // deep write also persisted
```

The wrapper uses a recursive `Proxy`. The `set` trap is applied at every level of the object tree. Whenever any nested property is written, the trap walks up to the root and calls `ha.store.set(key, root)` with the complete current state of the object. The initial value is loaded from `ha.store.get(key)` at proxy creation time; if not found, `defaultValue` is used.

**Important**: The `ha.persistent()` proxy is local to the script instance. Other scripts that want to react to changes must use `ha.store.on(key, cb)`.

---

## 8. `ha.action()` System

`ha.action(name, handler)` registers a named handler in the worker. Actions are the universal bridge between external trigger sources and the running script.

### Registration

```js
ha.action('refresh', async () => {
  await fetchData();
});

ha.action('set-team', async ({ teamId }) => {
  config.teamId = teamId;
  return { ok: true };
});
```

When the worker calls `ha.action()`, a `register_action` message is sent to WorkerManager so it knows that this script handles the given action name. The handler itself stays in the worker's local `actions` Map.

### Trigger Path 1 — Lovelace Card via HA Event Bus

```
Card calls __jsa__.callAction('refresh', payload)
  │
  ▼
HA WebSocket: fire_event { event_type: 'jsa_action', data: { script, action, payload, correlation_id } }
  │
  ▼
WorkerManager receives 'jsa_action' event, finds worker for 'script'
  │
  ▼
worker.postMessage({ type: 'action', action, payload, correlationId })
  │
  ▼
Worker executes handler, returns result
  │
  ▼
worker.postMessage({ type: 'action_result', correlationId, result })
  │
  ▼
WorkerManager fires HA event: jsa_action_result { correlationId, result }
  │
  ▼
Card's __jsa__.connect(hass) listener resolves the Promise
```

The `correlationId` is a UUID generated client-side. Pending `callAction()` calls are tracked in a Map on the card's `__jsa__` object; they resolve (or reject after 10 seconds) when `jsa_action_result` with the matching `correlationId` arrives.

### Trigger Path 2 — Button Entity

```js
ha.register('button.my_refresh', { name: 'Refresh Data', action: 'refresh' });
```

When the MQTT `set` command arrives on `jsa/button/my_refresh/set` (HA button press), `ScriptCommandRouter` looks up the `action` field registered for this entity and routes it as a local action call on the same worker — no HA Event Bus round-trip.

### Trigger Path 3 — Direct Worker Message (internal)

WorkerManager can dispatch actions directly to a worker via `postMessage({ type: 'action', action, payload })` without going through the HA Event Bus. Currently used for internal routing (e.g., MQTT command → action).

---

## 9. Entity Manager: Entity Lifecycle

`core/entity-manager.js` is the central component for everything related to HA entities. It reacts to events from WorkerManager and orchestrates MQTT Discovery, type-definition generation, script watching, and command routing.

### Injected Subsystems (instantiated via constructor)

- **`TypeDefinitionGenerator`**: Generates `entities.d.ts` and `store.d.ts` for IntelliSense
- **`ScriptCommandRouter`**: Routes MQTT commands to the correct script action (start/stop/set state)
- **`ScriptWatcher`**: Monitors the scripts directory for file changes (chokidar)

### Event Routing from WorkerManager

| Event | Handler |
|---|---|
| `create_entity` | `handleDynamicEntity()` — MQTT Discovery for `ha.register()` |
| `update_entity_state` | `handleEntityStateUpdate()` — Publish state via MQTT |
| `script_start` / `script_exit` | `handleScriptLifecycle()` — Update control entity state (on/off) |
| `request_device_cleanup` | `checkDeviceCleanup()` — Remove MQTT device when no entities remain |
| `sweep_entity_removed` | Clean up HA entity registry via WebSocket |

### `@expose` Entities vs. `ha.register()` Entities

There are two ways to create entities:

**`@expose` header** (static, at addon start):
The script header `// @expose switch` automatically creates a switch entity at startup. This is processed by `createExposedEntities()` and is treated as "protected" — the Mark-and-Sweep mechanism ignores it.

**`ha.register()`** (dynamic, at runtime):
Script code calls `ha.register('sensor.my_sensor', { name: '...', ... })`. This goes as a `create_entity` message to WorkerManager, which forwards it to `EntityManager.handleDynamicEntity()`.

### Device Grouping

`ha.register()` accepts a `device` configuration option that groups multiple entities from a single script under one HA device card:

```js
// Shorthand — uses the script's name and slug as device identity
ha.register('sensor.outside_temp', {
  name: 'Outside Temperature',
  device: true,
});

// Full control — custom device metadata
ha.register('sensor.outside_temp', {
  name: 'Outside Temperature',
  device: {
    name: 'Weather Station',
    identifiers: ['my_weather_station_01'],
    manufacturer: 'Acme Corp',
    model: 'WS-2000',
  },
});
```

When `device: true` is used, EntityManager builds the device block using:
- `identifiers: ['jsa_script_<scriptSlug>']`
- `name: <script display name>`
- `manufacturer: 'JS Automations'`
- `model: 'Script'`

The device block is added to the MQTT Discovery payload under the `device:` key (see §10 for the full payload shape).

**Important caveat**: When a device block is present in the Discovery payload, HA generates the `entity_id` as `<device_name_slug>_<entity_name_slug>` instead of using the `default_entity_id` field. This is why the stale entity detection includes the "device-prefix" case (Case 4, §10). To avoid the mismatch, either omit `device:` or accept that HA controls the entity ID format when a device is specified.

---

## 10. MQTT Discovery: How Entities Are Created

### The Discovery Protocol

HA listens on topics of the form `homeassistant/<domain>/<object_id>/config`. When a JSON payload is published there (retained), HA automatically creates the entity. When an empty string is published, HA removes the entity.

### Payload Construction

For a `ha.register('sensor.freifunk_clients', { name: 'Freifunk Clients' })` call, `handleDynamicEntity()` builds the following payload:

```json
{
  "name": "Freifunk Clients",
  "default_entity_id": "sensor.freifunk_clients",
  "object_id": "freifunk_clients",
  "unique_id": "jsa_freifunk_clients",
  "state_topic": "jsa/sensor/freifunk_clients/data",
  "json_attributes_topic": "jsa/sensor/freifunk_clients/data",
  "value_template": "{{ value_json.state }}",
  "availability_topic": "jsa/status",
  "payload_available": "online",
  "payload_not_available": "offline"
}
```

**`default_entity_id`** (HA 2025.10+, mandatory from HA 2026.4):
This field provides the desired entity ID including domain (e.g., `"sensor.freifunk_clients"`). It is the direct successor to the deprecated `object_id` field. Without this field, HA from version 2026.4 onward would slugify the `name` field to derive the entity ID — so `name: 'Anzahl Freifunk Clients'` would become `sensor.anzahl_freifunk_clients` instead of `sensor.freifunk_clients`.

**`object_id`** (legacy, deprecated since HA 2025.10):
Still sent for backward compatibility with HA < 2025.10 (object part only, without domain prefix).

**State topic**:
The state is published as JSON on `jsa/<domain>/<object_id>/data`: `{ "state": "42", "attributes": {...}, "icon": "mdi:..." }`. HA extracts the state via `value_template: "{{ value_json.state }}"` and attributes via `json_attributes_topic`.

### Device-Grouped Entity Payload

When `device:` is present, the Discovery payload includes a `device` block:

```json
{
  "name": "Outside Temperature",
  "default_entity_id": "sensor.outside_temp",
  "unique_id": "jsa_script_weather_outside_temp",
  "state_topic": "jsa/sensor/outside_temp/data",
  "device": {
    "identifiers": ["jsa_script_weather"],
    "name": "Weather",
    "manufacturer": "JS Automations",
    "model": "Script"
  },
  "...": "..."
}
```

Note that when a `device` block is present, HA ignores `default_entity_id` and `object_id` for entity ID generation — it uses `<device_name_slug>_<entity_name_slug>` instead. The stale entity detection handles the resulting Case 4 mismatch (see below).

### Discovery Topic vs. State Topic

| Topic | Content | Retain |
|---|---|---|
| `homeassistant/<domain>/<object_id>/config` | Entity configuration (JSON) | ✓ |
| `jsa/<domain>/<object_id>/data` | Entity state + attributes (JSON) | ✓ |
| `jsa/status` | `online` / `offline` (Birth/Will) | ✓ |
| `jsa/<domain>/<object_id>/set` | Command from HA (e.g. toggle switch) | ✗ |

### Stale Entity Detection

Before publishing the Discovery payload, `handleDynamicEntity()` checks the HA Entity Registry via WebSocket to detect stale data and conflicts:

**Case 1 — Wrong entity ID, same `unique_id`**:
An entity with the same `unique_id` (`jsa_<scriptSlug>_<objectId>`) but a different `entity_id` exists? This happens after a rename or moving to a different script file. → Remove entity from registry, clear Discovery topic.

**Case 2 — Name-slug entity ID from old payload**:
An entity with the slugified version of the friendly name exists (e.g., `sensor.anzahl_freifunk_clients` instead of `sensor.freifunk_clients`)? This is a relic from before `default_entity_id`. → Also remove.

**Case 3 — Foreign entity blocking the desired entity ID**:
An entity from another system (e.g., a native integration) occupies exactly the desired `entity_id` and has a different `unique_id`? HA would silently append `_2`. → Remove blocker from registry, re-publish Discovery topic.

**Case 4 — Orphaned state**:
A state exists in HA's state machine under the desired entity ID, but no registry entry exists for it? This happens when an entity was removed from the registry in a previous run but its state remained in HA's memory.

This phantom blocks in two ways:
- **Entity creation**: HA's `async_generate_entity_id()` checks the state machine — if it finds the state, it appends `_2`.
- **Registry rename**: `config/entity_registry/update` with `new_entity_id` also checks the state machine and rejects with `"Entity with this ID is already registered"` even though `config/entity_registry/list` shows no entry.

→ Delete state via REST `DELETE /api/states/<entity_id>` before publishing the payload.

**`alreadyCorrect` optimization**:
If the entity is already correctly in the registry (same `unique_id`, expected `entity_id`), the Discovery topic is **not** cleared — an unnecessary clear causes HA to recreate the entity, which in a race with the still-present registry entry produces `_2` again. The payload is simply published as an update to the existing entity.

After all checks, the Discovery topic is cleared if needed (empty string, retained) and the correct payload is published.

### ACK Poll: Entity ID Confirmation

After publishing the Discovery payload, an **ACK Poll** starts — a polling loop that queries the Entity Registry every 500 ms until the entity is correctly registered (max. 20 attempts ≈ 10 seconds).

The poll runs in parallel and does not block. It checks four states:

**1. Correct entity ID** (`haEntry.entity_id === entityId`):
Success. Any duplicates with the same `unique_id` but wrong entity ID are cleaned up. `area_id` and `labels` are set via `config/entity_registry/update`.

**2. Blocker in registry** (another entity occupies `entity_id` with a foreign `unique_id`):
The entity + its retained MQTT topic are removed, our topic is re-published. Next poll attempt.

**3. Numeric collision** (entity landed as `<desired>_2`, `<desired>_3`, etc.):
First checks for an orphaned state at the target ID (state machine occupied, registry empty) → if found, REST DELETE. Then: registry rename via `config/entity_registry/update { new_entity_id }`. On success, done; otherwise next attempt.

**4. Device-prefix** (HA derived the entity ID from the device name — no `_2` pattern):
An entity ID alias is registered so that `ha.getState()` and `ha.on()` work under the user-expected ID.

### Post-Registration: area_id and labels

MQTT Discovery has no `area_id` or `labels` field. These values can only be set via the HA Entity Registry API — a WebSocket `config/entity_registry/update` call. This happens in the ACK Poll as soon as the entity appears in the registry:

```
ha.register('sensor.x', { area_id: 'living_room', labels: ['important'] })
  ↓
Publish MQTT Discovery payload
  ↓  ACK Poll (every 500 ms)
Query entity registry → entity found under correct entity_id
  ↓
config/entity_registry/update { area_id: 'living_room', label_ids: [...] }
```

Both `area_id` (direct ID string) and `area` (name → automatically resolved to ID) are accepted. Labels work the same way: label names are resolved against the HA label registry.

---

## 11. Entity Registry: Persistence and Mark-and-Sweep

### Local Registry

WorkerManager maintains three in-memory structures:

| Map | Content |
|---|---|
| `nativeEntities` | `entityId → Discovery payload` (all registered entities) |
| `scriptEntityMap` | `filename → Set<entityId>` (which entities belong to which script) |
| `activeRunEntities` | `filename → Set<entityId>` (which entities were registered in the current run) |

The first two are persisted to `.storage/entity_registry.json` (debounced, 1 second). After an addon restart, the payloads are restored — so entities can be correctly removed even after a restart.

### Mark-and-Sweep

When a script starts, `activeRunEntities.get(filename)` is cleared. Every `ha.register()` call adds the entity ID to this set. After 10 seconds, `_sweepOrphanedDynamicEntities()` runs:

```
knownEntities (registry) - activeRunEntities (this run) = orphaned entities
```

Entities that were registered in the previous run but did not appear in this run are cleared via MQTT Discovery and removed from the registry.

**Exceptions**: Entities registered via `@expose` headers are in `protectedEntities` and are ignored by the sweep.

### Global Orphan Cleanup

`EntityManager.cleanupOrphanedEntities(scripts)` compares the currently existing script filenames (slugified) with registered entities. Entities belonging to a long-deleted script are removed. This also applies to `@expose` entities of deleted scripts.

---

## 12. HA Connection: WebSocket & State Cache

`core/ha-connection.js` encapsulates all HA WebSocket communication.

### Connection Establishment

After establishing the connection, HA immediately sends `auth_required` — the connector sends the token. On `auth_ok`, three things happen simultaneously:
1. `subscribeEvents()` — subscribe to all HA events
2. `fetchInitialStates()` — complete state dump (`get_states`)
3. Resolve the boot Promise

### Local State Cache

All entity states are cached in `this.states` as a Map `entity_id → state_object`. The cache is updated on every `state_changed` event. The cache is passed as `initialStates` when a Worker starts, so scripts can read states synchronously from the very first call (`ha.getState()`).

### Request-Response Pattern

Every WebSocket call gets an incremental `id`. HA's response contains the same `id`. A temporary `message` handler function is registered and removed after receipt. A 5-second timeout prevents hanging Promises.

### Entity Registry API

The following WebSocket commands are used:

| Command | Purpose |
|---|---|
| `config/entity_registry/list` | Retrieve all registered entities |
| `config/entity_registry/update` | Set `area_id`, `labels`, `name`, or `new_entity_id` for an entity |
| `config/entity_registry/remove` | Delete entity from registry |
| `config/device_registry/list` | Retrieve device registry for device cleanup |
| `config/area_registry/list` | Resolve area names → IDs |
| `config/label_registry/list` | Resolve label names → IDs |
| `config/config_entries/list` | Read MQTT broker settings for autodetect |
| `get_states` | Initial state dump |
| `get_config` | HA configuration (language, etc.) |
| `get_services` | Service definitions for IntelliSense |
| `call_service` | Call a service (with optional `return_response`) |

`updateEntityRegistry()` returns `{ success: boolean, error?: string }` — on `success: false`, `error` contains the HA error text (e.g., `"Entity with this ID is already registered"`), enabling clean error diagnosis without a separate try-catch.

### State Machine API

In addition to the Entity Registry, the HA REST API is used for one specific case:

`deleteState(entityId)` — `DELETE /api/states/<entity_id>` — removes a state from HA's state machine. Used exclusively for **orphaned states**: states that exist without a corresponding registry entry and block entity ID assignment (see Case 4 in §10). This method must not be used for states of normal entities.

---

## 13. MQTT Manager: Broker Connection and Command Routing

### Connection Parameters

MqttManager connects to the configured broker (default: `core-mosquitto:1883`). Connection options include:

- **Will message**: `jsa/status = offline` (retained, QoS 1) — automatically set by HA when the connection drops
- **Birth message**: `jsa/status = online` on the `connect` event — signals HA that the addon is available
- **Reconnect period**: Automatic 5-second reconnect on connection loss

### Unified Payload

When `state_topic` and `json_attributes_topic` point to the same topic (the normal case), `publishEntityState()` publishes a single JSON payload:

```json
{
  "state": "42",
  "attributes": { "unit_of_measurement": "clients" },
  "icon": "mdi:wifi"
}
```

HA extracts state via `value_template: "{{ value_json.state }}"`, attributes via `json_attributes_topic` + `value_json.attributes.*`.

### Command Routing

MqttManager subscribes to `jsa/#` and routes incoming messages matching `jsa/<domain>/<script_id>/set` as `command` events. `ScriptCommandRouter` translates these events into `startScript`, `stopScript`, `setState`, or action calls.

### MQTT Autodetect

The Settings UI provides an "Autodetect" button that reads MQTT connection parameters directly from HA's broker configuration. Internally, this calls `config/config_entries/list` on the HA WebSocket, filters for the MQTT integration entry, and extracts `host`, `port`, and authentication data. The addon then pre-fills the Settings fields with the detected values, giving the user immediate visual feedback on success or failure — no manual broker configuration needed in most setups (added in v2.51.6).

### Health Check Watchdog

Every 30 seconds, a watchdog checks whether `client.connected` is still `true`. If not, `status_change: { connected: false }` is emitted. This triggers a `createExposedEntities()` sequence in `EntityManager` when the connection is restored.

---

## 14. TypeScript Pipeline and IntelliSense

### Compiler Manager

TypeScript files (`.ts`) are transpiled by `CompilerManager` using the official TypeScript API (not the `tsc` CLI). The compiled `.js` files land in `.storage/dist/` mirroring the source directory structure.

**Source maps**: `execArgv: ['--enable-source-maps']` in Worker startup ensures that stack traces point to the original `.ts` lines.

The compiler watches for changes via `ScriptWatcher` (chokidar) and automatically transpiles on save. Compilation errors are sent via Socket.io as `compiler_signal` events to the editor, which creates inline error markers from them.

### Type Definition Generator

`TypeDefinitionGenerator` produces four automatically generated files in `.storage/`:

| File | Content |
|---|---|
| `ha-api.d.ts` | Types for the `ha` object (copied from `core/types/ha-api.d.ts`) |
| `entities.d.ts` | All HA entity IDs as a union type for `ha.getState()` autocomplete |
| `store.d.ts` | Current store keys as a `TypedStore` interface |
| `services.d.ts` | ServiceMap with all HA domains and services (from `get_services`) |

Any change to store data or HA states triggers regeneration with debouncing. The frontend receives a `typings_updated` Socket.io event and reloads the definitions into the Monaco editor.

---

## 15. Settings: Schema-Driven UI

`core/settings-schema.js` defines the settings structure as an array of sections with items. The same schema is used for two purposes:

1. **Frontend**: The Settings UI is generated entirely from the schema — no manual HTML
2. **Backend**: Validation of saved settings on load

### Item Types

| Type | Description |
|---|---|
| `text` / `number` / `boolean` | Standard input fields |
| `toggle` | CSS toggle switch (visually prominent, for Danger Zone settings) |
| `select` | Dropdown with `options: [{ value, label }]` |
| `entity-picker` | HA entity autocomplete |
| `mqtt-test` | Special button: tests MQTT connection without saving |
| `mqtt-autodetect` | Special button: reads MQTT configuration from HA and pre-fills fields with in-UI feedback on success/failure |
| `button` | Generic HTTP action button with `actionUrl` |

### Conditions

Items can be conditionally displayed with `condition: { key, value }` — e.g., MQTT fields only when `enabled: true`. The frontend evaluates these conditions in real time.

### `active: false`

Items with `active: false` are defined in the schema but hidden in the UI (e.g., temporarily disabled features). They remain in the schema for easy re-activation.

---

## 16. Capability & Permission System

### Overview

The capability system has two independent layers:

1. **Static analysis (UI)** — `core/capability-analyzer.js` scans the script source via regex and detects used capabilities (`network`, `fs:read`, `fs:write`, `exec`). The script list shows badges for each capability. Badges are gray when declared and detected, amber for undeclared capabilities, red for undeclared `exec`.
2. **Runtime enforcement (Worker)** — `core/worker-wrapper.js` blocks undeclared access at runtime via the `Module._load` hook + `globalThis.fetch` override (network/exec) and via `checkRead()`/`checkWrite()` in `ha.fs` (filesystem).

### `@permission` Tag

Parsed by `core/script-header-parser.js`. The `fs` alias is expanded to `['fs:read', 'fs:write']`. Permissions land as an array in `scriptMeta.permissions` and are passed to the worker via `workerData.permissions`.

### Settings Mapping in `kernel.js`

Settings in `settings.json` are **nested** (`danger.filesystem_enabled`), while `this.settings` in WorkerManager is **flat**. `kernel.js` maps manually on boot and on every `settings_updated` event:

```
danger.filesystem_enabled   → filesystem_enabled
danger.capability_enforcement → capability_enforcement
danger.quota_*              → quota_internal / quota_shared / quota_media
```

New settings in the `danger` section must always be added here.

### `core/capability-analyzer.js`

- Removes the JSDoc header before analysis (prevents false positives from code examples in `@description`)
- `analyze(source)` → `{ detected: string[] }`
- `diff(declared, detected)` → `{ undeclared: string[], unused: string[] }`
- Collapses `fs:read` when `fs:write` is already detected (write implies read)

---

## 17. Card Manager: Script Pack System

`core/card-manager.js` implements the Script Pack feature — the ability to embed a Lovelace Web Component directly in a JSA script file.

### Concept

A Script Pack is a single `.js` (or `.ts`) file containing two things:

1. **Normal JSA script** — backend logic with `ha.on()`, `ha.register()`, `ha.action()`, etc.
2. **`__JSA_CARD__` block** — Base64-encoded Web Component source embedded as a block comment

```
/* __JSA_CARD__
<base64-encoded Web Component source>
__JSA_CARD_END__ */
```

CardManager extracts the block, decodes the Base64, writes the card JS file to `config/www/jsa-cards/`, and registers it as a Lovelace resource via HA WebSocket.

### `installCard(scriptFilePath, options)`

The main entry point. Called by WorkerManager when a worker sends an `install_card` message.

**Flow:**
1. `_extractCardBlock()` — Reads the script file, finds the `/* __JSA_CARD__` block, decodes Base64 → JavaScript source
2. Hash check — SHA-256 of the card source. If `registry[scriptName].hash === hash` and `!options.force` → return early (no write needed)
3. Preamble injection — `JSA_PREAMBLE` is prepended. The preamble contains the `__jsa__` object with `connect()` and `callAction()`; `{{SCRIPT_ID}}` is replaced with the script filename
4. Config wrapping (optional) — If `options.config` is provided, `_wrapWithConfig()` wraps the card in an IIFE that calls `setConfig()` on the first `connectedCallback`
5. Write file — `config/www/jsa-cards/<scriptName>-card.js`
6. Upsert Lovelace resource via `_upsertLovelaceResource()`
7. Persist registry entry — `{ hash, resourceUrl, resourceId, cardName }` in `card-registry.json`

**Dev mode** (`options.devMode = true`): Steps 3–7 are skipped. The method only returns the resource URL without writing anything. Used for the editor preview.

### `removeCard(scriptFilePath)`

Called when a Script Pack is deleted (DELETE route in `scripts-routes.js`):
1. Delete the card file in `config/www/jsa-cards/` (if present)
2. Remove the Lovelace resource via `lovelace/resources/delete` (fire-and-forget)
3. Delete registry entry + persist

### `getCardSource(scriptFilePath)`

Returns the decoded source of the Card block without installing it. Used by the preview endpoint (`GET /:filename/card/preview-html`).

### The `__jsa__` Preamble

Every installed card receives an injected `const __jsa__` constant (not part of the Base64 source, but inserted server-side):

```
Card file = JSA_PREAMBLE(scriptId) + decodedCardSource
```

The preamble implements:
- **`__jsa__.connect(hass)`** — Subscribes to the `jsa_action_result` event on the HA WebSocket connection. Pending Promises are resolved via a `correlationId` Map.
- **`__jsa__.callAction(name, payload)`** — Fires a `jsa_action` event on the HA event bus (`type: 'fire_event'`, `event_type: 'jsa_action'`). The script receives it via `ha.action()`. The result comes back as a `jsa_action_result` event and resolves the Promise. Timeout after 10 seconds.

The `jsa_action` event contains `{ script, action, payload, correlation_id }`. WorkerManager dispatches it via subscriptions to the correct worker.

### Worker Retrieval for Multiple File Extensions

When `callAction` needs to find the running worker associated with a script, it tries multiple filename variants (v2.51.4 fix):

1. Exact filename (e.g., `my_script.ts`)
2. With `.js` extension (e.g., `my_script.js`)
3. Without extension / slug-based lookup

This was necessary because `.ts` scripts run as their compiled `.js` counterpart in WorkerManager — looking up the `.ts` name alone would fail to find the running worker.

### Hash-Based Cache Busting

The resource URL has the format `/local/jsa-cards/<scriptName>-card.js?v=<shortHash>` (first 8 characters of the SHA-256). When the card content changes, the URL changes — all browser tabs will not cache the old version. The URL is updated in the Lovelace resource entry at every `installCard()` call via `lovelace/resources/update`.

### Card Registry

`card-registry.json` in the add-on storage holds:

```json
{
  "my-script": {
    "hash": "abc123...",
    "resourceUrl": "/local/jsa-cards/my-script-card.js?v=abc123ab",
    "resourceId": 42,
    "cardName": "my-script-card"
  }
}
```

`resourceId` is the numeric ID of the Lovelace resource entry — required for updates and deletions.

### Preview Endpoint

`GET /:filename/card/preview-html` serves a complete sandboxed HTML page that:
- Defines HA Web Component stubs (`ha-card`, `ha-icon`, etc.) to render Lovelace cards outside of HA
- Provides a mock `hass` object with `states`, `callService`, `connection`, etc.
- Injects the decoded card source directly (no file write, no Lovelace required)
- Injects a mock `__jsa__` object that forwards `callAction()` via `fetch()` to the JSA HTTP API (instead of the HA Event Bus) — so Script Pack actions work in the preview without an active HA WebSocket connection
- Receives state injection via `postMessage` — the IDE preview panel sends real HA entity states using `postMessage({ type: 'jsa-set-hass', states: {...} })`, which the preview page merges into the mock `hass.states` object and re-renders the card (added in v2.51.3)

---

## 18. Resource Consumption and Known Limits

### RAM Overhead per Worker Thread

Every Worker Thread instantiates its own V8 engine, incurring a baseline overhead of ~20–30 MB. With the configurable `maxOldGenerationSizeMb` (default: 256 MB), there is a hard limit per script.

The `initialStates` object with the complete HA state cache is copied on every worker start. On large HA installations (3000+ entities), this can amount to several MB per worker.

### MQTT Discovery Delay

Between publishing the Discovery payload and the entity being available in HA there is a processing delay (~1–3 seconds). The `ha.register()` call in a script returns immediately, but `ha.getState()` on the new entity may return `undefined` for the first few seconds.

### HA 2026.4 Compatibility Note

`object_id` was removed from MQTT Discovery in HA 2026.4. The addon still sends `object_id` for backward compatibility with HA < 2025.10, but `default_entity_id` is the authoritative field from HA 2025.10 onward.

### WebSocket Message ID Counter

The `msgId` counter in `HAConnector` is a monotonically increasing integer that is never reset. At very long uptimes and very high request counts it could theoretically overflow JavaScript's `Number.MAX_SAFE_INTEGER` — in practice irrelevant (would require billions of requests).

### Script Pack Card Size

The `__JSA_CARD__` block is stored as Base64 inside the script file. Large card bundles (complex Lit/web component, bundled dependencies) can significantly increase the script file size. There is no hard limit enforced, but the full card source is read and decoded on every `installCard()` call and on every preview request — keep card bundles reasonably sized.
