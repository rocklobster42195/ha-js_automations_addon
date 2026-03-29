# JS Automations for Home Assistant

![Addon](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?logo=home-assistant)
![Version](https://img.shields.io/badge/version-2.48.6-darkgreen)
![Status](https://img.shields.io/badge/status-beta-red)
![Integration](https://img.shields.io/badge/integration-2.1.2-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="https://github.com/rocklobster42195/ha-js_automations_addon/raw/main/docs/images/ui.png" width="800" alt="Web UI des Add-ons">
</p>

> [!IMPORTANT]
> **Project Status: Pre-release**
> This project is functional and used in production environments, but please expect frequent updates and potential breaking changes as we move towards a stable release.

**JS Automations** is a professional-grade JavaScript and TypeScript execution engine for Home Assistant. It allows you to write automations using standard **Node.js** or **TypeScript** in a secure, isolated environment. With its integrated Web IDE and powerful API, it brings a developer-centric workflow to your smart home.

> 📘 **Deep Dive:** Interested in the internal architecture? Check out the [Technical Documentation](docs/TECH-README.md) or the [API Reference](API_REFERENCE.md).

## Key Features

*   **Native TypeScript Support:** Write robust automations with full type-safety. Scripts are automatically transpiled in the background.
*   **Pro-Grade IntelliSense:** The IDE provides deep autocomplete for all your Home Assistant entities, services (including field descriptions), and even your custom global store keys.
*   **Fluent API:** Interact with entities using a natural syntax: `ha.entity('light.kitchen').state` or `ha.entity('light.kitchen').turn_on()`.
*   **Thread Isolation:** Each script runs in its own Worker Thread. Crashes are contained and won't affect HA.
*   **Hybrid Architecture:** A built-in custom component bridge allows creating **true native entities** in Home Assistant that survive reboots and are fully editable.
*   **Unified Creation Wizard:** Easily create new scripts from templates, upload files, or import code from GitHub/Gist.
*   **Smart Triggers:** ioBroker-inspired `ha.on()` logic supporting Wildcards, Arrays, and Regular Expressions.
*   **Complex Conditions:** Use `await ha.waitUntil()` to pause scripts until multiple conditions are met.
*   **Source Map Support:** Error logs point directly to your original TypeScript source lines, making debugging effortless.
*   **Sync State Cache:** Read any Home Assistant state instantly via `ha.states` without async overhead. Includes safe helper functions like `ha.getStateValue()` for convenient access.
*   **Script Control:** Expose any script as a `switch` or `button` entity via the `@expose` tag for easy dashboard integration.
*   **Persistent Store:** Share variables between scripts or survive reboots with the synchronous `ha.store`.
*   **Magic Variables (`ha.persistent`):** Work with persistent data like normal objects. Changes to top-level and **nested properties** are automatically saved.
*   **Smart Batching:** Use `.throttle(ms)` on selectors to prevent overwhelming RF gateways (like Homematic or Zigbee) by spacing out commands.
*   **Awaitable Actions:** All service calls return promises. Use `await` to ensure commands are received before moving to the next step.
*   **Store Explorer:** Visual interface to view, edit, and delete global variables in `ha.store` (supports **Secrets**).
*   **Global Libraries:** Create reusable code modules and include them in any script using the `@include` tag.
*   **Automatic NPM:** Packages defined in the header are automatically installed in a persistent hidden directory.
*   **Managed Lifecycle:** Scripts stop automatically when finished unless they have active listeners (Cron/Events).
*   **Self-Healing:** Scripts can restart themselves on error using `ha.restart()` to build robust automations.
*   **Smart Organization:** Scripts are automatically grouped by their `@label`. The sidebar headers inherit the **icon and color** directly from your Home Assistant Label Registry and are collapsible for a better overview.

---

## Local Development Setup

1.  **Clone the repository** and navigate into the directory.
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Start the server:**
    ```bash
    npm run dev
    ```
4.  **Follow the setup wizard:** On the first run, a wizard will automatically start in your terminal. It will ask for your Home Assistant URL and a Long-Lived Access Token.
5.  **Done!** The wizard creates a `.env` file for you, and the server will start. The UI is available at `http://localhost:PORT`.

---

## Unified Creation Wizard

The **+** button opens the new creation wizard, offering three ways to add scripts:
1.  **New:** Start from scratch (JavaScript or TypeScript) or select a template.
2.  **Upload:** Drag & drop `.js` files directly into the editor.
3.  **Import:** Paste a raw URL (GitHub/Gist) to fetch code from the web.

---

## 🚀 TypeScript & IntelliSense

JS Automations treats TypeScript as a first-class citizen. This isn't just syntax highlighting; it's a full development environment:

*   **Live Entity Discovery:** The engine dynamically generates type definitions for your specific Home Assistant instance. When you type `ha.states['`, you get a list of your actual entities.
*   **Typed Store:** Work with the global store (`ha.store`) and get type hints for existing keys and their values.
*   **Automatic Transpilation:** No `tsc` commands needed. Save a `.ts` file, and the internal **Compiler Manager** handles the rest, outputting optimized code to a secure `dist` directory.
*   **Strict Mode:** The compiler runs in strict mode by default, catching potential `null` or `undefined` errors before your script even runs.

```typescript
const stats = ha.persistent<ScriptStats>("my_stats", { runCount: 0 });
```

---

## Native Entities & The Bridge

JS Automations features a unique **Hybrid Architecture**. It includes a lightweight custom component that acts as a bridge between the Node.js engine and Home Assistant Core.

Unlike other add-ons that rely on MQTT or ephemeral HTTP states, this bridge allows JS Automations to register **true native entities** in the Home Assistant Registry.
*   **Persistent:** Entities survive Home Assistant reboots.
*   **Editable:** You can change the icon, name, and area directly in the Home Assistant Device settings.
*   **Integration-like:** Build custom logic that provides devices and entities appearing natively in Home Assistant.
*   **Zero Config:** No MQTT broker or complex configuration required.

### Smart Device Linking (`ha.register`)

When creating custom entities via `ha.register()`, you can control how the entity is grouped in Home Assistant using the `device` parameter:

*   **`device: 'script'` (Default / Optional):** The entity is assigned to the device named after your script. Since this is the default, you can simply omit the `device` parameter. Deleting the script automatically removes the device and its entities.
*   **`device: 'system'`:** The entity is assigned to the central "JS Automations" device. Ideal for global helpers or status sensors.
*   **`device: 'none'`:** The entity is not assigned to any device and appears as a standalone entity in Home Assistant.

```javascript
ha.register('select.heating_mode', {
    name: 'Heating Mode',
    options: ['Off', 'Auto', 'Eco', 'Guest'],
    device: 'system' // Groups it in the main "JS Automations" device
});

// Or simply (defaults to 'script'):
ha.register('sensor.my_value', {
    name: 'My local sensor'
});
```

> [!TIP]
> Regardless of device linking, the internal **Mark-and-Sweep** cleanup ensures that orphaned entities are removed when the parent script is deleted.

---

## Script Control (@expose)

You can expose any script as a native Home Assistant entity by setting the `@expose` tag (or using the creation wizard).

*   **Switch:** (`@expose switch`) Creates a toggle. `On` means the script is running, `Off` means it's stopped. Perfect for long-running loops or services.
*   **Button:** (`@expose button`) Creates a stateless button. Pressing it starts (or restarts) the script. Ideal for one-off actions.
*   **Entity ID:** `switch.jsa_<script_name>` or `button.jsa_<script_name>`

```javascript
/**
 * @name My Awesome Script
 * @expose switch
 * @icon mdi:robot-happy
 */

// This script will have a switch named "switch.jsa_my_awesome_script"
```

---

## The Metadata Header

Every script starts with a JSDoc-style header. This configures the engine's behavior.

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
 */
```
---

### Log Manager

All script outputs are captured by the central **Log Manager**.
*   **Live Stream:** View logs in real-time in the dashboard IDE.
*   **History:** Access past logs via the "Logs" tab in the UI.
*   **Levels:** Filter by `info`, `warn`, `error`, or `debug` (configurable per script via `@loglevel`).

---

## Live Status Bar

For all you control freaks and data junkies, the IDE includes a configurable live status bar in the footer. It's your personal dashboard for monitoring the addon's health and your most critical entities.

You get three slots to display what matters most:
*   **CPU Load:** See if a script is pushing the limits or just chilling out.
*   **RAM Usage:** The ultimate weapon against memory leaks. Watch your script's memory grow and intervene before it's too late.
*   **Any HA Entity:** Pin any entity from Home Assistant directly to the footer. Keep an eye on your front door sensor, the current energy price, or simply whether the sun is up (`sun.sun`). Why? Because you can.

Each metric comes with a mini **sparkline graph**, giving you an at-a-glance history of the last few moments.

---

## Store Explorer

The **Store Explorer** provides a graphical user interface for the `ha.store`.
*   **Visual Management:** View all global variables in a sortable table.
*   **Live Updates:** See values, owners, and last update timestamps.
*   **Edit & Delete:** Modify values directly or remove obsolete keys.
*   **Search:** Filter keys and values to find specific data quickly.
*   **Secrets Management:** Mark variables as "Secret" to mask their values in the UI (e.g., `••••••••`). This is perfect for storing API keys, tokens, or passwords that your scripts need but shouldn't be visible on screen.

## Expert Mode

> **Note:** Currently, Expert Mode is **permanently enabled** for all users. It might become a configurable option in a future release.

*   **Store Explorer:** Access the global variable database via the header button.
*   **Clear Server Logs:** Button to permanently delete the entire server-side log history.

---

## Global Libraries

Stop copying and pasting code! With Global Libraries, you can write functions once and use them everywhere.

### 1. Creating a Library
When creating a new script, select **Global Library** as the type.
*   Libraries are saved in a dedicated `libraries/` subfolder.
*   They are **passive**: They do not have a Start/Stop button and do not run on their own.
*   They can define their own `@npm` dependencies.

### 2. Using a Library
To use a library in your automation, simply add the `@include` tag to your header:

```javascript
/**
 * @name Living Room Lights
 * @include utils.js, lighting_scenes.js
 */

// Now you can use functions defined in utils.js
const isDark = utils.isDarkOutside();
```

### 3. IntelliSense
The integrated editor is smart enough to read your libraries. When you type a function name from an included library, you will get **autocomplete** and parameter hints, just like with built-in functions.

---

## API Documentation
For a complete reference of the `ha` object and other global built-ins, please refer to the [API Reference](API_REFERENCE.md).


---
## Internationalization (UI & Scripts)

The addon supports multiple languages for both the user interface and for your scripts.

### UI Language
The user interface is available in both German and English.
- **Automatic Detection:** The language is automatically chosen based on your browser's settings.
- **Manual Override:** You can force a specific language in the addon's settings.

### Script Language (`ha.language` & `ha.localize`)
You can make your scripts multilingual using `ha.language` and `ha.localize`. The language is determined automatically from Home Assistant or can be set in the add-on settings. This is especially useful for sending notifications in the user's preferred language.

```javascript
const message = ha.localize({
    en: "The washing machine is finished.",
    de: "Die Waschmaschine ist fertig."
});

ha.callService('notify', 'mobile_app', { message });
```


## 📘 Getting Started with TypeScript

TypeScript support is built-in and requires zero configuration. Here is how to get the most out of it:

1.  **Create a TS Script:** Open the **Creation Wizard** (+), enter a name, and make sure to select the **TS** button in the language selection.
2.  **Entity Autocomplete:** Start typing `ha.states['`. The editor will automatically list all entities currently existing in your Home Assistant instance.
3.  **Service Type-Safety:** Use `ha.callService()`. TypeScript will validate the domain, the service name, and even the required fields (like `entity_id` or `brightness`).
4.  **Typed Persistence:** Use interfaces to make your global store data robust:

```typescript
interface WeatherData {
    temp: number;
    condition: string;
    is_raining: boolean;
}

// The <T> generic tells TypeScript what to expect in the store
const weather = ha.persistent<WeatherData>("my_weather_cache", {
    temp: 0,
    condition: "unknown",
    is_raining: false
});

ha.log(weather.temp); // TypeScript knows this is a number
```

### 💡 Pro Tip: Custom Libraries
If you create a **Global Library** as a `.ts` file, you can use `export` to share types and functions. Use the `@include my_lib.ts` tag in your main script, and Monaco will provide IntelliSense for your library functions automatically.

---

## Complete Examples

### Smart Bathroom Fan
Logic: Run fan if humidity is > 65% for 5 minutes, then stop.

```javascript
/**
 * @name Bathroom Fan Logic
 * @loglevel info
 */

let stopTimer = null;

ha.on('sensor.bathroom_humidity', (e) => {
    const hum = parseFloat(e.state);
    
    if (hum > 65) {
        ha.log("Humidity high! Starting fan.");
        ha.entity('switch.bathroom_fan').turn_on();
        
        // Cancel any pending stop timer
        if (stopTimer) clearTimeout(stopTimer);
    } 
    else if (hum < 55) {
        ha.log("Humidity normalized. Stopping fan in 5 minutes.");
        if (stopTimer) clearTimeout(stopTimer);
        
        stopTimer = setTimeout(() => {
            ha.entity('switch.bathroom_fan').turn_off();
            ha.log("Fan stopped.");
        }, 300000);
    }
});

// Cleanup timer if script is updated/stopped
ha.onStop(() => {
    if (stopTimer) clearTimeout(stopTimer);
});
```

### Trash Collection Monitor (`@npm` Example)
This script uses the `node-ical` package to check an online calendar for upcoming trash collections and creates a sensor in Home Assistant.

```javascript
/**
 * @name Trash Collection Calendar
 * @icon mdi:trash-can
 * @description Checks an iCal link for tomorrow's trash collection.
 * @npm node-ical
 * @loglevel info
 */

const ical = require('node-ical');
const CALENDAR_URL = "https://your-calendar-link.ics";

// Register the sensor once
ha.register('sensor.jsa_trash_tomorrow', {
    name: 'Trash Collection Tomorrow',
    icon: 'mdi:delete-alert'
});

async function checkTrash() {
    try {
        const data = await ical.async.fromURL(CALENDAR_URL);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0,0,0,0);

        let trashType = "None";
        
        for (let k in data) {
            const event = data[k];
            if (event.type === 'VEVENT') {
                const eventDate = new Date(event.start);
                eventDate.setHours(0,0,0,0);

                if (eventDate.getTime() === tomorrow.getTime()) {
                    trashType = event.summary;
                    ha.log(`Collection tomorrow: ${trashType}`);
                    break;
                }
            }
        }

        ha.update('sensor.jsa_trash_tomorrow', trashType);

    } catch (e) {
        ha.error("Calendar check failed: " + e.message);
    }
}

// Check every day at 18:00 (6 PM)
schedule('0 18 * * *', checkTrash);

// Run once on startup
checkTrash();
```

### Intelligence with `ha.select` (Battery Guardian)
Instead of writing 50 separate automations, this script scans your entire home for low battery levels in a single sweep.

```javascript
/**
 * @name Battery Guardian
 * @icon mdi:battery-alert
 * @description Alerts if any battery level drops below 15%
 */

async function scanBatteries() {
    ha.log("Starting battery scan...");
    
    // Select all battery sensors and filter for low levels
    const lowBatteries = ha.select('sensor.*_battery')
        .where(s => {
            const val = parseFloat(s.state);
            return val < 15 && s.state !== 'unavailable' && s.state !== 'unknown';
        });

    if (lowBatteries.count > 0) {
        const names = lowBatteries.map(s => s.attributes.friendly_name || s.entity_id).join(', ');
        ha.warn(`Low battery levels detected: ${names}`);
        
        ha.call('notify.persistent_notification', {
            title: 'Battery Alert',
            message: `The following devices need attention: ${names}`
        });
    } else {
        ha.log("All batteries are within the healthy range.");
    }
}

// Check every Sunday at 10:00 AM
schedule('0 10 * * 0', scanBatteries);

// Run once on startup
scanBatteries();
```

### Self-Healing Script (Watchdog)
This example demonstrates how to use `ha.restart()` and `ha.stop()` to build robust automations that recover from errors automatically.

```javascript
/**
 * @name API Watchdog
 * @icon mdi:dog-side
 * @description Fetches data and restarts itself on failure (max 3 times).
 * @npm axios
 */
const axios = require('axios');
const MAX_RETRIES = 3;

// This object's properties, including nested ones, will survive script restarts.
const memory = ha.persistent('watchdog_memory', { 
    status: { retries: 0, last_error: null } 
});

async function fetchData() {
    try {
        // Simulate API call
        const response = await axios.get('https://api.example.com/data');
        ha.log("Data fetched successfully: " + response.status);

        // Success: Reset retry counter and stop
        memory.status.retries = 0; // This nested change is automatically saved!
        ha.stop("Job finished successfully");

    } catch (e) {
        if (memory.status.retries < MAX_RETRIES) {
            ha.warn(`Fetch failed (${e.message}). Restarting (Attempt ${memory.status.retries + 1}/${MAX_RETRIES})...`);
            memory.status.retries++; // The increment is also saved automatically
            memory.status.last_error = e.message;
            ha.restart("API Error - Self Healing");
        } else {
            ha.error(`Failed after ${MAX_RETRIES} attempts. Giving up.`);
            memory.status.retries = 0; // Reset for the next manual run
            ha.stop("Too many failures");
        }
    }
}

fetchData();
```

### Data Transformation with `.map()`
The `.map()` function allows you to transform the results of a `ha.select()` query directly into an array of different values, such as names or attributes. This is more efficient and leads to cleaner code than iterating with `.each()`.

```javascript
/**
 * @name List Active Lights
 * @icon mdi:lightbulb-group
 * @description Creates a comma-separated list of all currently active lights.
 * @expose button
 */

// Select all lights that are 'on' and directly map the result to an array of their names.
const activeLightNames = ha.select('light.*')
    .where(light => light.state === 'on')
    .map(light => light.attributes.friendly_name || light.entity_id);

if (activeLightNames.length > 0) {
    const list = activeLightNames.join(', ');
    ha.log(`The following lights are currently on: ${list}`);
    
    // You can now use this list in a notification.
    ha.call('notify.persistent_notification', {
        title: 'Active Lights',
        message: list
    });

} else {
    ha.log("All lights are currently off.");
}

// Since this script has no listeners (like ha.on or schedule),
// it will stop automatically after execution.
// Pressing the button will run it again.
```

### Sequential Logic with `ha.waitFor()`

The `ha.waitFor()` function allows you to write complex, sequential automations that read like a simple, step-by-step script. It pauses the script's execution until a specific state is reached, eliminating "callback hell" and the need for manual timers.

This example opens a garage door, waits for it to be fully open, and only then turns on the light.

```javascript
/**
 * @name Smart Garage Opener
 * @icon mdi:garage-open-variant
 * @description Opens the garage door and turns on the light only after the door is fully open.
 * @expose button
 */

// The main logic must be in an 'async' function to use 'await'.
async function openGarageSequence() {
    const door = ha.entity('cover.garage_door');
    const light = ha.entity('light.garage_light');

    ha.log('Starting garage sequence...');
    
    // Open the door and wait for HA confirmation
    await door.open_cover();

    try {
        // Pause the script here and wait for the door's state to become 'open'.
        await ha.waitFor(door.entity_id, 'eq', 'open', { timeout: 30000 });

        ha.log('Door open. Setting ambiance...');
        
        // Chain actions: Turn on light, wait 2s, then dim it
        await light.turn_on({ brightness: 255 })
                   .then(l => l.wait(2000))
                   .then(l => l.turn_on({ brightness: 100 }));

    } catch (e) {
        // This code runs if the 30-second timeout was reached.
        ha.error(`Garage door did not open in time! Error: ${e.message}`);
    }
}

// Run the main function.
openGarageSequence();
```

### Complex Conditions with `ha.waitUntil()`

While `ha.waitFor()` is great for single events, `ha.waitUntil()` shines when you need to wait for a complex state involving multiple entities. It repeatedly checks a condition you provide and only continues when it returns `true`.

This example waits until both the TV and the soundbar are on before setting a "Movie Time" scene.

```javascript
/**
 * @name Movie Time Scene
 * @icon mdi:movie-open
 * @description Waits for TV and Soundbar to be on, then dims the lights.
 * @expose button
 */

async function movieTime() {
    const isReady = () => 
        ha.getStateValue('media_player.living_room_tv') === 'on' &&
        ha.getStateValue('switch.living_room_soundbar') === true;

    if (isReady()) {
        ha.log("TV and Soundbar are already on.");
    } else {
        ha.log("Waiting for TV and Soundbar to be turned on...");
        await ha.waitUntil(isReady, { timeout: 120000 }); // Wait up to 2 minutes
    }

    ha.log("Movie time is ready! Dimming lights.");
    ha.entity('scene.movie_dim').turn_on();
}

movieTime();
```