# JS Automations for Home Assistant

![Addon](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?logo=home-assistant)
![Version](https://img.shields.io/badge/version-2.43.2-darkgreen)
![Status](https://img.shields.io/badge/status-beta-red)
![Integration](https://img.shields.io/badge/integration-1.2.1-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="https://github.com/rocklobster42195/ha-js_automations_addon/raw/main/docs/images/ui.png" width="800" alt="Web UI des Add-ons">
</p>

> [!IMPORTANT]
> **Project Status: Pre-release**
> This project is functional and used in production environments, but please expect frequent updates and potential breaking changes as we move towards a stable release.

**JS Automations** is a professional-grade JavaScript execution engine for Home Assistant. It allows you to write automations using standard **Node.js** in a secure, isolated environment. With its integrated Web IDE and powerful API, it brings a developer-centric workflow to your smart home.

> 📘 **Deep Dive:** Interested in the internal architecture? Check out the [Technical Documentation](docs/TECH-README.md) or the [API Reference](API_REFERENCE.md).

## Key Features

*   **Thread Isolation:** Each script runs in its own Worker Thread. Crashes are contained and won't affect HA.
*   **Unified Creation Wizard:** Easily create new scripts from templates, upload files, or import code from GitHub/Gist.
*   **Smart Triggers:** ioBroker-inspired `ha.on()` logic supporting Wildcards, Arrays, and Regular Expressions.
*   **Sync State Cache:** Read any Home Assistant state instantly via `ha.states` without async overhead.
*   **Hybrid Architecture:** A built-in custom component bridge allows creating **true native entities** in Home Assistant that survive reboots and are fully editable.
*   **Script Control:** Expose any script as a `switch` or `button` entity via the `@expose` tag for easy dashboard integration.
*   **Persistent Store:** Share variables between scripts or survive reboots with the synchronous `ha.store`.
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
1.  **New:** Start from scratch or select a template (e.g., Interval, State Trigger).
2.  **Upload:** Drag & drop `.js` files directly into the editor.
3.  **Import:** Paste a raw URL (GitHub/Gist) to fetch code from the web.

---

## Native Entities & The Bridge

JS Automations features a unique **Hybrid Architecture**. It includes a lightweight custom component that acts as a bridge between the Node.js engine and Home Assistant Core.

Unlike other add-ons that rely on MQTT or ephemeral HTTP states, this bridge allows JS Automations to register **true native entities** in the Home Assistant Registry.
*   **Persistent:** Entities survive Home Assistant reboots.
*   **Editable:** You can change the icon, name, and area directly in the Home Assistant Device settings.
*   **Zero Config:** No MQTT broker or complex configuration required.

---

## Script Control (@expose)

You can expose any script as a native Home Assistant entity by setting the `@expose` tag (or using the creation wizard).

*   **Switch:** (`@expose switch`) Creates a toggle. `On` means the script is running, `Off` means it's stopped. Perfect for long-running loops or services.
*   **Button:** (`@expose button`) Creates a stateless button. Pressing it starts (or restarts) the script. Ideal for one-off actions.
*   **Entity ID:** `switch.js_automations_<script_name>` or `button.js_automations_<script_name>`

```javascript
/**
 * @name My Awesome Script
 * @expose switch
 * @icon mdi:robot-happy
 */

// This script will have a switch named "switch.js_automations_my_awesome_script"
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
For a complete reference of the `ha` object and other global built-ins, please refer to the API Reference.


---
## Internationalization

The user interface is available in both German and English.
- **Automatic Detection:** The language is automatically chosen based on your browser's settings.
- **Manual Override:** You can force a specific language in settings.

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
        ha.callService('switch', 'turn_on', { entity_id: 'switch.bathroom_fan' });
        
        // Cancel any pending stop timer
        if (stopTimer) clearTimeout(stopTimer);
    } 
    else if (hum < 55) {
        ha.log("Humidity normalized. Stopping fan in 5 minutes.");
        if (stopTimer) clearTimeout(stopTimer);
        
        stopTimer = setTimeout(() => {
            ha.callService('switch', 'turn_off', { entity_id: 'switch.bathroom_fan' });
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
ha.register('sensor.js_trash_tomorrow', {
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

        ha.updateState('sensor.js_trash_tomorrow', trashType);

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
    
    // Select all sensors ending with '_battery'
    const lowDevices = ha.select('sensor.*_battery')
        .where(s => {
            const val = parseFloat(s.state);
            return val < 15 && s.state !== 'unavailable' && s.state !== 'unknown';
        })
        .toArray();

    if (lowDevices.length > 0) {
        const names = lowDevices.map(s => s.attributes.friendly_name || s.entity_id).join(', ');
        ha.warn(`Low battery levels detected: ${names}`);
        
        // Send a persistent notification to the Home Assistant UI
        ha.callService('notify', 'persistent_notification', {
            title: 'Low Battery Alert',
            message: `The following devices need new batteries: ${names}`
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
const RETRY_KEY = 'watchdog_retries';

async function fetchData() {
    try {
        // Simulate API call
        const response = await axios.get('https://api.example.com/data');
        ha.log("Data fetched successfully: " + response.status);
        
        // Success: Reset retry counter and stop
        ha.store.set(RETRY_KEY, 0);
        ha.stop("Job finished successfully");
        
    } catch (e) {
        const retries = ha.store.get(RETRY_KEY) || 0;
        
        if (retries < MAX_RETRIES) {
            ha.warn(`Fetch failed (${e.message}). Restarting (Attempt ${retries + 1}/${MAX_RETRIES})...`);
            ha.store.set(RETRY_KEY, retries + 1);
            ha.restart("API Error - Self Healing");
        } else {
            ha.error(`Failed after ${MAX_RETRIES} attempts. Giving up.`);
            ha.store.set(RETRY_KEY, 0); // Reset for next manual start
            ha.stop("Too many failures");
        }
    }
}

fetchData();
