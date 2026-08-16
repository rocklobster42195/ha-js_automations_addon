# JS Automations for Home Assistant

![Addon](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?logo=home-assistant)
![Version](https://img.shields.io/badge/version-3.0.0-darkgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
[![CI](https://github.com/rocklobster42195/ha-js_automations_addon/actions/workflows/ci.yml/badge.svg)](https://github.com/rocklobster42195/ha-js_automations_addon/actions/workflows/ci.yml)
[![Ko-fi](https://img.shields.io/badge/support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/rocklobster42195)

<p align="center">
  <img src="https://github.com/rocklobster42195/ha-js_automations_addon/raw/main/docs/images/ui.png" width="800" alt="Add-on Web UI">
</p>

**JS Automations** is a Home Assistant **add-on** for developers ready to leave YAML behind. Write automations in **Node.js** or **TypeScript**, run them in a secure, isolated environment, and control your home through a developer-grade `ha` API — complete with a built-in Web IDE.

> [!NOTE]
> **Actively evolving:** JS Automations is stable enough for daily/production use, but it's still a young project under active development. New features and improvements land regularly, so expect more frequent updates than a fully mature add-on — check the [releases](https://github.com/rocklobster42195/ha-js_automations_addon/releases) for what's new. Feedback and bug reports are always welcome!

> [!TIP]
> **API Reference:** Complete reference for all `ha` methods → [API Reference](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/API_REFERENCE.md)

> **Script Library:** Browse and import ready-to-use scripts → [ha-jsa-library](https://rocklobster42195.github.io/ha-jsa-library/)

> **Deep Dive:** Internal architecture and advanced concepts → [Technical Documentation](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/TECH-README.md)

---

## Key Features

- **TypeScript-native with live IntelliSense** — Full autocomplete for your actual HA entities, services (including field types), and custom store keys. Updated automatically as your home changes.
- **NEW: Visual Scripting (Blockly)** — Build automations by dragging blocks instead of writing code: triggers, conditions, entity/service calls, MQTT, webhooks, Calendar/Todo, and more. A "Show Code" panel reveals the generated JavaScript live, and any block script can be duplicated as an editable `.js` file the moment you outgrow the blocks. See the [Blockly guide](./docs/guide/blockly.md).
- **Thread Isolation** — Every script runs in its own Worker Thread. Crashes are fully contained and never affect Home Assistant or other scripts.
- **Native HA Entities** — Register Home Assistant entities via MQTT Discovery using `ha.register()`. State is retained across reboots. Entities become unavailable while their script is stopped, unless opted out via `stale_ok`. Remove one at runtime with `ha.unregister()`. Optionally group multiple entities under a named HA device. Unknown fields in the config are passed through directly into the Discovery payload, enabling complex domains like `light`, `climate`, or `cover`.
- **Service Response Data** — `await ha.call('weather.get_forecasts', { entity_id, type: 'daily' }, { returnResponse: true })` awaits the response payload for "response-only"/"response-optional" services instead of firing-and-forgetting.
- **Smart Triggers** — `ha.on()` supports wildcards, arrays, and RegExp. `ha.waitFor()` pauses until a state is reached. `ha.waitUntil()` waits for complex multi-entity conditions.
- **Fluent & Awaitable API** — Interact with entities naturally: `await ha.entity('light.kitchen').turn_on({ brightness: 200 })`. Chain commands, wait for confirmations, build readable sequential logic.
- **Integrated Web IDE** — Monaco editor with syntax highlighting, live logs, a real-time status bar, and a smart snippet system. Press `Shift+Enter` after `ha.notify` and get a fully filled-out template.
- **Persistent Store & Magic Variables** — Share data between scripts or survive reboots with `ha.store`. Use `ha.persistent()` to work with persistent objects as if they were plain JavaScript — nested property changes are saved automatically.
- **Developer Tools (Expert Mode)** — Enable **Settings → General → Expert Mode** to reveal a split developer panel next to the log console with three tools: **Event Inspector** (live HA event stream with entity filter), **Live REPL** (run ad-hoc JavaScript with full `ha` API access against your live instance), and **Breakpoints** (`ha.breakpoint('label', { vars })` pauses execution and displays variables in a built-in variable inspector — click Continue to resume).
- **Direct MQTT Access (`ha.mqtt`)** — Subscribe to any broker topic and publish messages directly — no HA entity required. Supports `+` and `#` wildcards. Payloads are auto-parsed as JSON. Ideal for raw Tasmota/Shelly/Zigbee2MQTT events, inter-script messaging, and building custom HA devices with complex domains.
- **Webhook Receiver (`ha.onWebhook`)** — Let external services push data into your scripts and get a real response back. Unlike HA's built-in webhook automations (fire-and-forget, always an empty `200 OK`), JSA webhooks are fully bidirectional: your handler receives the complete request and returns any HTTP status code and body. Tokens are auto-generated and managed by JSA, never in script code. A dedicated Webhook Panel (Developer Tools) shows all active endpoints with copy-ready URLs and token management (reveal / rotate). Requires a dedicated port; does not work through the Nabu Casa tunnel.
- **Deep HA API Access** — `ha.renderTemplate()` evaluates Jinja2 templates, `ha.getCalendarEvents()` and `ha.getTodoItems()` access HA calendar and todo entities, `ha.getEntitiesWithLabel()` and `ha.getAreasInFloor()` query the label and floor registries, `ha.onEvent()` subscribes to any HA event bus event (NFC tags, automation triggers, custom events), and `ha.fireEvent()` fires custom events for inter-script communication.
- **Filesystem API (`ha.fs`)** — Read, write, append, list, watch, and rotate files across three sandboxed virtual roots: `internal://` (script-private data), `shared://` (/share, NAS mounts), `media://` (/media). Opt-in via Settings → Danger Zone.
- **History & Computed Helpers (`ha.history`)** — Fetch raw state history and pre-aggregated long-term statistics. Six built-in computation functions — `trend()`, `derivative()` (linear or polynomial fit), `integral()`, `stats()`, `timeSince()`, `timeInState()` — work on HA entities or any external data array, no helper entities required.
- **Global Libraries & Auto-NPM** — Write shared code once, `@include` it anywhere. npm packages listed in the script header are installed automatically.
- **Capability Transparency** — Scripts declare `@permission network`, `@permission fs:write`, etc. in their header. The script list shows capability badges, warns about undeclared usage, and can enforce permissions at runtime.
- **Script Packs** — Embed a Lovelace card directly inside a script. One file contains backend logic _and_ a custom dashboard card. The add-on installs the card automatically as a Lovelace resource. The card communicates back to the script via `__jsa__.callAction()` — no MQTT, no webhooks needed. `ha.frontend.cacheAsset(url)` downloads and caches external images/assets (team logos, album art, ...) under `config/www/` once, returning a stable local URL — no more hotlinked images breaking on flaky dashboard devices when the source is slow or unreachable. See the [Script Packs guide](./docs/guide/card-packs.md).

---

## Installation

### Home Assistant Add-on (Normal)

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the **⋮** menu (top right) → **Repositories** and add:
   ```
   https://github.com/rocklobster42195/ha-js_automations_addon
   ```
3. Find **JS Automations** in the store and click **Install**.
4. After installation, go to the add-on's **Configuration** tab to set your preferences.
5. Start the add-on. Open the Web UI via the **Open Web UI** button.

> [!IMPORTANT]
> **MQTT Broker strongly recommended.** Entities registered via `ha.register()` use MQTT Discovery and require a broker (e.g. the [Mosquitto add-on](https://github.com/home-assistant/addons/tree/master/mosquitto)) to survive Home Assistant reboots. Without MQTT, registered entities will disappear after a restart.

### Local Development Setup

1. **Clone the repository** and navigate into the directory.
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the server:**
   ```bash
   npm run dev
   ```
4. **Follow the setup wizard:** On the first run, a wizard will start in your terminal asking for your Home Assistant URL and a Long-Lived Access Token.
5. **Done!** The wizard creates a `.env` file, and the server starts. The UI is available at `http://localhost:PORT`.

---

## Quick Start: Hello World

Every script starts with a JSDoc-style header that configures the engine's behavior, then uses the `ha` object to talk to Home Assistant. This one file shows the core lifecycle end to end: a header, a native entity, and a reaction to a state change.

```javascript
/**
 * @name Hello World
 * @icon mdi:hand-wave
 * @description Minimal example: a metadata header, a native sensor, and ha.on()
 *              reacting to a state change to keep that sensor up to date.
 * @label Example
 * @expose switch
 */

const SOURCE = 'sun.sun'; // built into every HA instance, safe to reference here

ha.register('sensor.hello_world_greeting', {
  name: 'Hello World Greeting',
  icon: 'mdi:hand-wave',
});

function greet() {
  const isDaytime = ha.getStateValue(SOURCE) === 'above_horizon';
  ha.update('sensor.hello_world_greeting', isDaytime ? 'Good day!' : 'Good night!');
}

greet(); // set the initial value immediately, don't wait for the next sun change
ha.on(SOURCE, greet);

ha.log('Hello World script started.');
```

- **`@name`/`@icon`/`@description`/`@label`** — shown in the sidebar; `@label` groups scripts and, if a matching HA Label exists, inherits its icon and color (see [Creation Wizard](./docs/guide/creation-wizard.md#what-label-and-area-actually-do)).
- **`@expose switch`** — exposes the _script itself_ as a toggle entity (`On` = running, `Off` = stopped). Use `@expose button` instead for a one-off action that (re)starts the script on press.
- **`ha.register()`** — creates a real HA entity via MQTT Discovery; see [Native Entities](./docs/guide/native-entities.md).
- **`ha.on()`** — reacts to a state change; combine with `ha.update()`/`ha.entity()` to act on it.

The full header tag reference (`@npm`, `@include`, `@area`, `@permission`, `@card`, ...) and the complete `ha` API are in the [API Reference](./docs/API_REFERENCE.md). The example itself lives at [`examples/hello_world.js`](./examples/hello_world.js).

---

## TypeScript & IntelliSense

TypeScript support is built-in and requires zero configuration.

- **Live Entity Discovery:** Type definitions for your HA instance are generated automatically. `ha.states['` shows your actual entities with correct attribute types.
- **Typed Services:** `ha.call()` validates the domain, service name, and required fields.
- **Typed Store:** `ha.store.get()` and `ha.store.set()` are aware of your existing keys and their types.
- **Automatic Transpilation:** Save a `.ts` file — the internal **Compiler Manager** transpiles it immediately. No `tsc` commands needed.
- **Source Maps:** Error logs point to your original TypeScript source lines, not the compiled output.
- **Strict Mode:** Catches potential `null` and `undefined` errors before your script runs.

```typescript
interface WeatherData {
  temp: number;
  condition: string;
}

const weather = ha.persistent<WeatherData>('weather_cache', { temp: 0, condition: 'unknown' });
ha.log(weather.temp); // TypeScript knows this is a number
```

> **Pro Tip:** Global Libraries saved as `.ts` files can `export` types and functions. Use `@include my_lib.ts` and get full IntelliSense for your library in any script that includes it.

---

## Learn More

The topics below have grown too deep for a README section — each has its own guide with worked examples and (where a picture beats a paragraph) screenshots:

- **[Native Entities (`ha.register`)](./docs/guide/native-entities.md)** — MQTT Discovery entities, device grouping, staying available while stopped, `ha.unregister()`.
- **[Notifications (`ha.notify` & `ha.ask`)](./docs/guide/notifications.md)** — simple, persistent, and actionable (button-response) notifications.
- **[Creation Wizard](./docs/guide/creation-wizard.md)** — the **+** button's New / Upload / Import modes.
- **[Script Packs (JSA Card Packs)](./docs/guide/card-packs.md)** — bundling a Lovelace card and its backend logic in one file, the `__jsa__` bridge, and the [Script Library](https://rocklobster42195.github.io/ha-jsa-library/).
- **[Visual Scripting (Blockly)](./docs/guide/blockly.md)** — the block palette, Show Code, and how block errors trace back to the exact block.

Global Libraries (write once with `@include`, share across scripts — passive, no Start/Stop) are covered above under Key Features.

---

## Internationalization

### UI Language

The user interface is available in German and English, auto-detected from your browser. Override via add-on settings.

### Script Language (`ha.localize`)

```javascript
const message = ha.localize({
  en: 'The washing machine is finished.',
  de: 'Die Waschmaschine ist fertig.',
});
ha.notify(message);
```

The language is detected from Home Assistant or can be set in the add-on settings.

---

## Log Manager

All script output is captured by the central Log Manager.

- **Live Stream:** View logs in real-time in the IDE.
- **History:** Access past logs via the "Logs" tab.
- **Levels:** `debug`, `info`, `warn`, `error` — configurable per script via `@loglevel`.

---

## Live Status Bar

A configurable live status bar in the footer lets you monitor add-on health and critical entities at a glance. Three slots, each with a mini sparkline graph:

- **CPU Load** — spot runaway scripts.
- **RAM Usage** — catch memory leaks early.
- **Any HA Entity** — pin any entity from your home (energy price, door sensor, `sun.sun`, …).

---

## Store Explorer

A graphical UI for `ha.store`:

- **Visual table** with keys, values, owners, and timestamps.
- **Live updates** as scripts write to the store.
- **Edit & Delete** values directly.
- **Secrets:** Mark values as secret to mask them in the UI (e.g., API keys, tokens).

---

## API Documentation

For a complete reference of all `ha` methods, see the [API Reference](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/API_REFERENCE.md).

---

## Examples

Ready-to-use example scripts covering common patterns (humidity control, trash calendars, API watchdogs, MQTT bridging, calendar guards, and more) are included in the [`examples/`](https://github.com/rocklobster42195/ha-js_automations_addon/tree/main/examples) folder of this repository.
