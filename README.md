# JS Automations for Home Assistant

![Addon](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?logo=home-assistant)
![Version](https://img.shields.io/badge/version-2.53.1-darkgreen)
![Status](https://img.shields.io/badge/status-beta-red)
![License](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="https://github.com/rocklobster42195/ha-js_automations_addon/raw/main/docs/images/ui.png" width="800" alt="Web UI des Add-ons">
</p>

> [!IMPORTANT]
> **Project Status: Pre-release**
> This project is functional and used in production environments, but please expect frequent updates and potential breaking changes as we move towards a stable release.

**JS Automations** is a professional-grade JavaScript and TypeScript execution engine for Home Assistant. Write automations using standard **Node.js** or **TypeScript** in a secure, isolated environment — with a built-in Web IDE and a powerful `ha` API that puts developer-grade tooling into your smart home.

> [!TIP]
> **API Reference:** Complete reference for all `ha` methods → [API Reference](API_REFERENCE.md)

> 💡 **Script Library:** Browse and import ready-to-use scripts → [ha-jsa-library](https://rocklobster42195.github.io/ha-jsa-library/)

> 📘 **Deep Dive:** Internal architecture and advanced concepts → [Technical Documentation](TECH-README.md)

---

## Key Features

- **TypeScript-native with live IntelliSense** — Full autocomplete for your actual HA entities, services (including field types), and custom store keys. Updated automatically as your home changes.
- **Thread Isolation** — Every script runs in its own Worker Thread. Crashes are fully contained and never affect Home Assistant or other scripts.
- **Native HA Entities** — Register Home Assistant entities via MQTT Discovery using `ha.register()`. State is retained across reboots. Entities become unavailable while their script is stopped. Optionally group multiple entities under a named HA device.
- **Fluent & Awaitable API** — Interact with entities naturally: `await ha.entity('light.kitchen').turn_on({ brightness: 200 })`. Chain commands, wait for confirmations, build readable sequential logic.
- **Smart Triggers** — `ha.on()` supports wildcards, arrays, and RegExp. `ha.waitFor()` pauses until a state is reached. `ha.waitUntil()` waits for complex multi-entity conditions.
- **Persistent Store & Magic Variables** — Share data between scripts or survive reboots with `ha.store`. Use `ha.persistent()` to work with persistent objects as if they were plain JavaScript — nested property changes are saved automatically.
- **Global Libraries & Auto-NPM** — Write shared code once, `@include` it anywhere. npm packages listed in the script header are installed automatically.
- **Filesystem API (`ha.fs`)** — Read, write, append, list, watch, and rotate files across three sandboxed virtual roots: `internal://` (script-private data), `shared://` (/share, NAS mounts), `media://` (/media). Opt-in via Settings → Danger Zone.
- **Deep HA API Access** — `ha.getStatistics()` reads Energy Dashboard data, `ha.renderTemplate()` evaluates Jinja2, `ha.getCalendarEvents()` and `ha.getTodoItems()` access HA calendar/todo entities, `ha.getEntitiesWithLabel()` and `ha.getAreasInFloor()` query the label and floor registries, `ha.onEvent()` subscribes to any HA event bus event (NFC, automation triggers, custom events), and `ha.fireEvent()` fires custom events for inter-script communication.
- **Capability Transparency** — Scripts declare `@permission network`, `@permission fs:write`, etc. in their header. The script list shows capability badges, warns about undeclared usage, and can enforce permissions at runtime.
- **Integrated Web IDE** — Monaco editor with syntax highlighting, live logs, a real-time status bar, and a smart snippet system. Press `Shift+Enter` after `ha.notify` and get a fully filled-out template.
- **Developer Tools (Expert Mode)** — Enable **Settings → General → Expert Mode** to reveal a split developer panel next to the log console with three tools: **Event Inspector** (live HA event stream with entity filter), **Live REPL** (run ad-hoc JavaScript with full `ha` API access against your live instance), and **Breakpoints** (`ha.breakpoint('label', { vars })` pauses execution and displays variables in a built-in variable inspector — click Continue to resume).
- **Script Packs** — Embed a Lovelace card directly inside a script. One file contains backend logic *and* a custom dashboard card. The add-on installs the card automatically as a Lovelace resource. The card communicates back to the script via `__jsa__.callAction()` — no MQTT, no webhooks needed.

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

## The Metadata Header

Every script starts with a JSDoc-style header that configures the engine's behavior.

```javascript
/**
 * @name Battery Monitor
 * @icon mdi:battery-alert
 * @description Checks all battery levels daily
 * @loglevel info
 * @npm lodash
 * @include telegram_helper.js
 * @area Technical Room
 * @label Maintenance
 * @expose switch
 */
```

| Tag | Description |
|---|---|
| `@name` | Human-readable script name shown in the sidebar |
| `@icon` | MDI icon for the script and its exposed entity |
| `@description` | Short description (shown in the UI) |
| `@loglevel` | Minimum log level: `debug`, `info`, `warn`, `error` |
| `@npm` | Auto-installed npm packages (space or comma separated) |
| `@include` | Library files to load (from the `libraries/` folder) |
| `@area` | Home Assistant area to assign the exposed entity to |
| `@label` | HA Label for sidebar grouping — inherits icon and color from the HA Label Registry |
| `@expose` | Expose as `switch` or `button` entity in HA |
| `@permission` | Declare required capabilities: `network`, `fs:read`, `fs:write`, `exec` (comma-separated) |
| `@card` | Mark script as a Script Pack. Use `@card dev` during development (preview only, no Lovelace install) |

---

## Script Control (`@expose`)

Expose any script as a native Home Assistant entity using the `@expose` tag.

- **`@expose switch`** — Creates a toggle. `On` = script running, `Off` = stopped. Perfect for long-running loops.
- **`@expose button`** — Creates a stateless button. Pressing it starts or restarts the script. Ideal for one-off actions.
- **Entity ID:** `switch.jsa_<script_name>` or `button.jsa_<script_name>`

```javascript
/**
 * @name My Script
 * @expose switch
 * @icon mdi:robot-happy
 */
```

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
interface WeatherData { temp: number; condition: string; }

const weather = ha.persistent<WeatherData>("weather_cache", { temp: 0, condition: "unknown" });
ha.log(weather.temp); // TypeScript knows this is a number
```

> **Pro Tip:** Global Libraries saved as `.ts` files can `export` types and functions. Use `@include my_lib.ts` and get full IntelliSense for your library in any script that includes it.

---

## Native Entities (`ha.register`)

Register Home Assistant entities via MQTT Discovery. They appear in HA's entity registry and survive reboots — but an entity becomes **unavailable** while its script is not running. State is preserved in the MQTT broker and automatically restored when the script starts again.

```javascript
ha.register('sensor.outside_temp', {
    name: 'Outside Temperature',
    icon: 'mdi:thermometer',
    unit: '°C',
    device_class: 'temperature',
    state_class: 'measurement',
    initial_state: 0,
});

ha.register('select.heating_mode', {
    name: 'Heating Mode',
    options: ['Off', 'Auto', 'Eco', 'Guest'],
});
```

Supported domains: `sensor`, `switch`, `select`, `number`, `text`, `button`.

Update state at any time with `ha.update()`:

```javascript
ha.update('sensor.outside_temp', 21.5, { icon: 'mdi:sun-thermometer' });
```

### Device Grouping

Use the `device` option to group multiple entities under a shared device card in the HA UI:

```javascript
ha.register('sensor.weather_temp', {
    name: 'Temperature',
    unit: '°C',
    device_class: 'temperature',
    device: {
        name: 'Weather Station',
        manufacturer: 'AcmeCorp',
        model: 'v2',
    },
});

ha.register('sensor.weather_humidity', {
    name: 'Humidity',
    unit: '%',
    device_class: 'humidity',
    device: { name: 'Weather Station' }, // same name → same device
});
```

Supported device fields: `name`, `manufacturer`, `model`, `sw_version`, `hw_version`, `configuration_url`. Pass `device: true` to use the script name as the device name with default metadata.

> **Entity ID note:** When `device` is set, HA generates the entity_id from the device and entity name slugs, ignoring the path you specified. Omit `device` for exact entity_id control.

> **Mark-and-Sweep:** Entities that are no longer registered by a script are automatically removed from Home Assistant when the script runs again.

---

## Notifications (`ha.notify` & `ha.ask`)

Send notifications via any configured HA notify service. `ha.ask()` sends an **actionable notification** and returns a Promise that resolves with the button the user tapped — or a default value when the timeout expires.

> **Note:** `ha.ask()` and actionable features of `ha.notify()` require the **Home Assistant Companion App** (iOS/Android). They are not compatible with the web browser's dashboard for user interaction.

```javascript
// Simple notification
ha.notify("Motion detected!", {
    title: "Security",
    target: "notify.mobile_app_my_phone",
});

// Persistent notification (visible in HA Web UI/Browser)
ha.notify("Backup completed successfully", {
    title: "System",
    persistent: true
});

// Actionable notification — waits for user response
const answer = await ha.ask("Garage door is open. Close it?", {
    title: "Garage Alert",
    target: "notify.mobile_app_my_phone",
    timeout: 60000,
    defaultAction: "SNOOZE",
    actions: [
        { action: "CLOSE",  title: "Close now" },
        { action: "SNOOZE", title: "Remind in 30 min" },
        { action: "IGNORE", title: "Ignore" },
    ],
});

if (answer === "CLOSE") ha.entity('cover.garage_door').close_cover();
if (answer === "SNOOZE" || answer === null) setTimeout(checkGarage, 30 * 60 * 1000);
```

Requires the Home Assistant Companion App on at least one device.

---

## Unified Creation Wizard

The **+** button opens the creation wizard with three modes:
1. **New:** Start from scratch (JavaScript or TypeScript) or pick a template.
2. **Upload:** Drag & drop `.js` / `.ts` files directly into the editor.
3. **Import:** Paste a raw URL (GitHub/Gist) to fetch code from the web.

> 💡 **Script Library:** Browse and import ready-to-use scripts at [ha-jsa-library](https://rocklobster42195.github.io/ha-jsa-library/) — clicking "Add to JSA" opens the import wizard with the URL pre-filled.

---

## Global Libraries

Write reusable code once, use it everywhere.

- Libraries live in a dedicated `libraries/` subfolder.
- They are **passive** — no Start/Stop button, they don't run on their own.
- They can declare their own `@npm` dependencies.
- IntelliSense works across scripts: functions and types from an included library are available in Monaco.

```javascript
/**
 * @name Living Room Lights
 * @include utils.js, lighting_scenes.js
 */

const isDark = utils.isDarkOutside();
```

---

## The JSA Pack Philosophy

Traditional smart home development splits every feature across two separate worlds: automation logic lives in scripts or YAML, and the dashboard lives in Lovelace as a separate card. They communicate awkwardly — via entities, MQTT helpers, or REST hooks — and must be maintained, versioned, and deployed independently.

**Script Packs collapse this boundary.**

A Script Pack is a single `.js` (or `.ts`) file that contains:

1. **Backend logic** — the normal JSA script: `ha.on()`, `ha.register()`, `ha.registerAction()`, NPM packages, TypeScript types, persistent state.
2. **Frontend card** — a standard Web Component (no framework required) embedded in a `__JSA_CARD__` block. The add-on extracts and installs it automatically as a Lovelace resource.
3. **The `__jsa__` bridge** — injected by the add-on at install time, lets the card call named script actions directly: `await __jsa__.callAction('refresh')`. The result flows back as a Promise.

The result is a **deployable mini-integration**: one URL pasted into the import wizard gives you a running script with native HA entities *and* a ready-to-use dashboard card — no HACS, no manual resource management, no copy-pasting between files.

### What this enables

- **One-file distribution** — Share a Script Pack as a GitHub Gist. Anyone imports the URL; the add-on handles NPM packages, TypeScript compilation, entity registration, and card installation automatically.
- **Direct card-to-script communication** — Card buttons trigger script actions; scripts update entities; cards re-render from live `hass` state. The full interaction loop without infrastructure overhead.
- **Integrated development** — A dedicated card editor tab in the IDE, a live preview panel with real HA entity data, and width presets to simulate actual Lovelace column sizes.

---

## Script Packs

A Script Pack embeds a Lovelace card directly inside a JSA script. The add-on extracts the card on install and registers it automatically as a Lovelace resource.

### Authoring

Add `@card` (or `@card dev` for development mode) to the script header, then append a `__JSA_CARD__` block containing your Web Component source as Base64:

```javascript
/**
 * @name Bundesliga Live
 * @npm axios
 * @card dev
 */

ha.register('sensor.bundesliga_score', { name: 'BL Score' });

ha.action('refresh', async () => {
    // fetch and update entity
});

/* __JSA_CARD__
<base64-encoded Web Component source>
__JSA_CARD_END__ */
```

The card editor tab in the IDE handles encoding automatically — you write plain JavaScript, the tab stores Base64.

### The `__jsa__` Bridge

The add-on injects a `__jsa__` object into every installed card:

```javascript
class MyCard extends HTMLElement {
    set hass(h) {
        __jsa__.connect(h); // one-time setup
        this.render(h.states['sensor.bundesliga_score']);
    }

    async onRefreshClick() {
        await __jsa__.callAction('refresh');
        // hass will be pushed again automatically after the action completes
    }
}
customElements.define('my-card', MyCard);
```

`callAction(name, payload)` fires a `jsa_action` event on the HA event bus. The script receives it via `ha.registerAction()` and the result is returned as a resolved Promise.

### Card States in the Script List

The script list icon (`mdi:view-dashboard-outline`) reflects the card's install state:
- **Orange** — `@card dev`: card block exists, dev-mode preview only, not installed
- **Dark gray** — card block exists but not yet installed to Lovelace
- **Light gray** — card is installed and active

---

## Internationalization

### UI Language
The user interface is available in German and English, auto-detected from your browser. Override via add-on settings.

### Script Language (`ha.localize`)

```javascript
const message = ha.localize({
    en: "The washing machine is finished.",
    de: "Die Waschmaschine ist fertig.",
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

For a complete reference of all `ha` methods, see the [API Reference](API_REFERENCE.md).

---

## Examples

### Smart Bathroom Fan

```javascript
/**
 * @name Bathroom Fan Logic
 * @loglevel info
 */

let stopTimer = null;

ha.on('sensor.bathroom_humidity', (e) => {
    const hum = parseFloat(e.state);

    if (hum > 65) {
        ha.entity('switch.bathroom_fan').turn_on();
        if (stopTimer) clearTimeout(stopTimer);
    } else if (hum < 55) {
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
            ha.entity('switch.bathroom_fan').turn_off();
        }, 300000);
    }
});

ha.onStop(() => { if (stopTimer) clearTimeout(stopTimer); });
```

---

### Trash Collection Monitor (`@npm` example)

```javascript
/**
 * @name Trash Collection Calendar
 * @icon mdi:trash-can
 * @npm node-ical
 */

const ical = require('node-ical');
const CALENDAR_URL = "https://your-calendar-link.ics";

ha.register('sensor.trash_tomorrow', { name: 'Trash Collection Tomorrow', icon: 'mdi:delete-alert' });

async function checkTrash() {
    try {
        const data = await ical.async.fromURL(CALENDAR_URL);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        let trashType = "None";
        for (let k in data) {
            const event = data[k];
            if (event.type === 'VEVENT') {
                const d = new Date(event.start);
                d.setHours(0, 0, 0, 0);
                if (d.getTime() === tomorrow.getTime()) { trashType = event.summary; break; }
            }
        }
        ha.update('sensor.trash_tomorrow', trashType);
    } catch (e) {
        ha.error("Calendar check failed: " + e.message);
    }
}

schedule('0 18 * * *', checkTrash);
checkTrash();
```

---

### Battery Guardian (`ha.select`)

Instead of 50 separate automations, scan your entire home in one sweep:

```javascript
/**
 * @name Battery Guardian
 * @icon mdi:battery-alert
 */

async function scanBatteries() {
    const low = ha.select('sensor.*_battery')
        .where(s => parseFloat(s.state) < 15 && s.state !== 'unavailable');

    if (low.count > 0) {
        const names = low.toArray()
            .map(s => s.attributes.friendly_name || s.entity_id)
            .join(', ');
        ha.notify(`Low battery: ${names}`, { title: 'Battery Alert' });
    }
}

schedule('0 10 * * 0', scanBatteries);
scanBatteries();
```

---

### Self-Healing Script (Watchdog)

```javascript
/**
 * @name API Watchdog
 * @icon mdi:dog-side
 * @npm axios
 */

const axios = require('axios');
const MAX_RETRIES = 3;
const memory = ha.persistent('watchdog_memory', { status: { retries: 0, last_error: null } });

async function fetchData() {
    try {
        await axios.get('https://api.example.com/data');
        memory.status.retries = 0; // nested change saved automatically
        ha.stop("Done");
    } catch (e) {
        if (memory.status.retries < MAX_RETRIES) {
            memory.status.retries++;
            memory.status.last_error = e.message;
            ha.restart("API Error");
        } else {
            memory.status.retries = 0;
            ha.stop("Too many failures");
        }
    }
}

fetchData();
```

---

### Sequential Logic with `ha.waitFor()`

Open the garage door and turn on the light only after it is fully open:

```javascript
/**
 * @name Smart Garage Opener
 * @expose button
 */

async function openGarage() {
    await ha.entity('cover.garage_door').open_cover();

    try {
        await ha.waitFor('cover.garage_door', 'eq', 'open', { timeout: 30000 });

        await ha.entity('light.garage_light')
            .turn_on({ brightness: 255 })
            .then(l => l.wait(2000))
            .then(l => l.turn_on({ brightness: 100 }));
    } catch (e) {
        ha.error("Door did not open in time: " + e.message);
    }
}

openGarage();
```

---

### Actionable Notification with `ha.ask()`

```javascript
/**
 * @name Garage Door Watcher
 * @expose switch
 */

async function checkGarage() {
    if (ha.getStateValue('cover.garage_door') !== 'open') return;

    const answer = await ha.ask("Garage door is open — what should I do?", {
        title: "Garage Alert",
        target: "notify.mobile_app_my_phone",
        timeout: 60000,
        defaultAction: "SNOOZE",
        actions: [
            { action: "CLOSE",  title: "Close now"        },
            { action: "SNOOZE", title: "Remind in 30 min" },
            { action: "IGNORE", title: "Ignore"            },
        ],
    });

    if (answer === "CLOSE") {
        ha.entity('cover.garage_door').close_cover();
        ha.notify("Garage door closed.", { title: "Garage" });
    } else if (answer === "SNOOZE" || answer === null) {
        setTimeout(checkGarage, 30 * 60 * 1000);
    }
}

ha.on('cover.garage_door', (e) => { if (e.state === 'open') checkGarage(); });
```
