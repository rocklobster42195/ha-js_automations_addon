# ⚡ JS Automations for Home Assistant

**JS Automations** is a high-performance, isolated, and developer-friendly JavaScript execution engine for Home Assistant. It bridges the gap between simple YAML automations and complex AppDaemon python scripts, offering a full **Web IDE** experience with **Node.js**.

![Version](https://img.shields.io/badge/version-2.13.2-blue) ![Node](https://img.shields.io/badge/node-%3E%3D20-green) ![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Add--on-blue)

## 🚀 Key Features

*   **🛡️ Isolated Worker Threads:** Every script runs in its own thread. A syntax error or infinite loop in one script **never** crashes your Home Assistant.
*   **💻 Integrated Web IDE:** Built-in Monaco Editor (VS Code core) with dark mode, live logs, and **real-time IntelliSense** for your entities.
*   **⚡ Synchronous State Cache:** Access all Home Assistant states instantly (`ha.states`) without `await` or API delays.
*   **🧠 Global Store:** Share data between scripts and keep variables persistent across restarts (`ha.store`).
*   **📦 Auto-NPM:** Just add `@npm package` to your header, and the system installs it automatically.
*   **🎨 Smart UI:** Compact list view, live status icons, filtering, and metadata management (Area/Labels).
*   **🔋 Batteries Included:** `axios` (HTTP), `node-cron` (Scheduling), and `sleep` are built-in globally.

---

## 🛠 Installation

### As Home Assistant Add-on (Recommended)
1.  Copy the `js-automation_addon` folder to your Home Assistant's `/addons/local/` directory (using Samba or SSH).
2.  Go to **Settings > Add-ons > Add-on Store**.
3.  Click the three dots (top right) -> **Check for updates**.
4.  Install **JS Automations** from the "Local" section.
5.  Start the Add-on and open the Web UI via the Sidebar.

### Local Development
1.  Clone this repository.
2.  Run `npm install`.
3.  Create a `.env` file: `HA_URL=http://YOUR_IP:8123` and `HA_TOKEN=YOUR_TOKEN`.
4.  Run `npm run dev`.

---

## 📚 Scripting API Reference

The global `ha` object is available in every script. No imports needed.

### 1. Triggers & Events (`ha.on`)
Subscribe to state changes using specific IDs, Arrays, Wildcards, or Regex.

```javascript
// Single entity
ha.on('light.kitchen', (e) => { ... });

// Multiple entities
ha.on(['light.kitchen', 'light.livingroom'], (e) => { ... });

// Wildcards (ioBroker style)
ha.on('binary_sensor.*_occupancy', (e) => { ... });

// Regex (Advanced)
ha.on(/^sensor\..*_battery$/, (e) => { ... });
```

### 2. State Access (`ha.states`)
Access the current state of *any* entity synchronously. The cache is always up-to-date.

```javascript
// No await needed!
if (ha.states['sun.sun'].state === 'above_horizon') {
    ha.log("It's daytime!");
}
```

### 3. Global Store (`ha.store`)
Save data persistently. Values survive script restarts and Add-on reboots.

```javascript
// Write
ha.store.set('coffee_count', 42);

// Read (Synchronous!)
const count = ha.store.val.coffee_count;
ha.log(`Coffees today: ${count}`);
```

### 4. Controlling Home Assistant
Call services or create your own virtual sensors.

```javascript
// Call Service
ha.callService('light', 'turn_on', {
    entity_id: 'light.kitchen',
    brightness: 255
});

// Create/Update Virtual Entity (Sensor)
ha.updateState('sensor.js_calculation', 123.45, {
    unit_of_measurement: 'EUR',
    friendly_name: 'Daily Cost'
});
```

### 5. Logging & Debugging
Control console noise using Log-Levels.

```javascript
ha.debug("Detailed variable dump..."); // Only visible if @loglevel is 'debug'
ha.log("Standard info message");       // Standard
ha.warn("Something looks odd");        // Yellow
ha.error("Critical failure!");         // Red (and marks script as crashed)
```

---

## 📝 Metadata Headers

Configure your script using JSDoc-style comments at the top of the file.

```javascript
/**
 * @name Bitcoin Alarm           // Display name in UI
 * @icon mdi:currency-btc        // Icon in UI
 * @description Checks price...  // Tooltip description
 * @area Office                  // HA Area (Room)
 * @label Finance                // HA Label
 * @loglevel info                // debug | info | warn | error
 * @npm lodash, moment           // Auto-install NPM packages
 */
```

---

## 💡 Code Examples

### Example 1: The "Cronjob"
Runs every morning at 08:00. The worker stays alive automatically.

```javascript
/**
 * @name Morning Routine
 * @icon mdi:clock-outline
 */

ha.log("Scheduler started.");

schedule('0 8 * * *', () => {
    ha.log("Good morning! Turning on coffee machine.");
    ha.callService('switch', 'turn_on', { entity_id: 'switch.coffee_plug' });
});
```

### Example 2: HTTP Request & Virtual Sensor
Fetches data from an API and creates a sensor in HA. `axios` is built-in.

```javascript
/**
 * @name Crypto Tracker
 * @icon mdi:finance
 */

async function fetchPrice() {
    try {
        const res = await axios.get('https://api.coindesk.com/v1/bpi/currentprice.json');
        const rate = res.data.bpi.USD.rate_float;
        
        ha.updateState('sensor.btc_usd', rate, {
            unit_of_measurement: 'USD',
            friendly_name: 'Bitcoin Price'
        });
        ha.log(`Updated: $${rate}`);
    } catch (e) {
        ha.error("API Error: " + e.message);
    }
}

fetchPrice();
// Update every 10 minutes
setInterval(fetchPrice, 600000); 
```

### Example 3: Smart Light Sync (Reactive)
Mirrors the state of one light to another.

```javascript
/**
 * @name Mirror Lights
 * @icon mdi:link-variant
 */

const MASTER = 'light.living_room';
const SLAVE = 'light.hallway_led';

ha.on(MASTER, (e) => {
    // Only react if state actually changed
    if (e.state === e.old_state) return;

    const action = e.state === 'on' ? 'turn_on' : 'turn_off';
    
    // Copy attributes like color
    const data = { entity_id: SLAVE };
    if (action === 'turn_on' && e.attributes.rgb_color) {
        data.rgb_color = e.attributes.rgb_color;
    }

    ha.callService('light', action, data);
});
```

---

## 📂 Project Structure

- **/core**: Backend logic (Worker management, HA connection, Store).
- **/public**: Frontend (Monaco Editor, UI logic).
- **/scripts**: Your user scripts (mapped to `/config/js-automation`).

---

### License
MIT