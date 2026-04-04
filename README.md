# JS Automations for Home Assistant

![Addon](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?logo=home-assistant)
![Version](https://img.shields.io/badge/version-2.49.0-darkgreen)
![Status](https://img.shields.io/badge/status-beta-red)
![License](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="https://github.com/rocklobster42195/ha-js_automations_addon/raw/main/docs/images/ui.png" width="800" alt="Web UI des Add-ons">
</p>

> [!IMPORTANT]
> **Project Status: Pre-release**
> This project is functional and used in production environments, but please expect frequent updates and potential breaking changes as we move towards a stable release.

**JS Automations** is a professional-grade JavaScript and TypeScript execution engine for Home Assistant. Write automations using standard **Node.js** or **TypeScript** in a secure, isolated environment — with a built-in Web IDE and a powerful `ha` API that puts developer-grade tooling into your smart home.

> 📘 **Deep Dive:** Interested in the internal architecture? Check out the [Technical Documentation](TECH-README.md) or the [API Reference](API_REFERENCE.md).

---

## Key Features

- **TypeScript-native with live IntelliSense** — Full autocomplete for your actual HA entities, services (including field types), and custom store keys. Updated automatically as your home changes.
- **Thread Isolation** — Every script runs in its own Worker Thread. Crashes are fully contained and never affect Home Assistant or other scripts.
- **Native HA Entities** — Register persistent entities directly in Home Assistant via `ha.register()`. They survive reboots and are editable in the HA device settings.
- **Fluent & Awaitable API** — Interact with entities naturally: `await ha.entity('light.kitchen').turn_on({ brightness: 200 })`. Chain commands, wait for confirmations, build readable sequential logic.
- **Smart Triggers** — `ha.on()` supports wildcards, arrays, and RegExp. `ha.waitFor()` pauses until a state is reached. `ha.waitUntil()` waits for complex multi-entity conditions.
- **Persistent Store & Magic Variables** — Share data between scripts or survive reboots with `ha.store`. Use `ha.persistent()` to work with persistent objects as if they were plain JavaScript — nested property changes are saved automatically.
- **Global Libraries & Auto-NPM** — Write shared code once, `@include` it anywhere. npm packages listed in the script header are installed automatically.
- **Integrated Web IDE** — Monaco editor with syntax highlighting, live logs, a real-time status bar, and a smart snippet system. Press `Shift+Enter` after `ha.notify` and get a fully filled-out template.

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

Register persistent, native Home Assistant entities via MQTT Discovery. They appear in HA's entity registry, survive reboots, and are fully editable (name, icon, area) in the device settings.

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
