# JS-Automation for Home Assistant

**JS-Automation** is a powerful, lightweight, and isolated automation engine for Home Assistant. It allows you to write smart home logic using standard JavaScript (Node.js) with full access to the NPM ecosystem, a built-in web dashboard, and a live code editor.

Unlike native YAML automations, **JS-Automation** leverages the asynchronous nature of JavaScript, making it ideal for complex logic, external API integrations, and reactive hardware control.

---

## 🚀 Key Features

- **Isolated Execution:** Every script runs in its own Node.js `Worker Thread`. If one script crashes, your Home Assistant and other automations stay alive.
- **Built-in Dashboard:** A sleek, responsive web interface to manage your scripts, view live logs, and monitor status.
- **Integrated Code Editor:** Edit your scripts directly in the browser using the **Monaco Editor** (the core of VS Code) with syntax highlighting.
- **Automatic NPM Management:** Just add `@npm package-name` to your script header, and the engine installs it for you.
- **Dynamic IntelliSense:** Automatically generates a `entities.d.ts` file based on your real Home Assistant entities for perfect autocompletion.
- **Zero-Config Add-on:** Designed to run as a local Home Assistant Add-on with auto-authentication via the Supervisor API.

---

## 🛠 Installation (As HA Add-on)

1. **Copy Files:** Copy the project folder into your Home Assistant `/addons/local/js-automation/` directory (via Samba or SSH).
2. **Refresh Add-ons:** Go to **Settings > Add-ons > Add-on Store** and click the three dots in the top right -> **Check for updates**.
3. **Install:** Scroll down to the "Local add-ons" section, find **JS-Automation**, and click **Install**.
4. **Start & Show in Sidebar:** Enable "Show in sidebar" and click **Start**.

All your scripts and data will be stored persistently in `/config/js-automation/`.

---

## 📝 Scripting API

Every script has access to a global `ha` object. No imports required.

### `ha.log(message: string)`
Sends a message to the dashboard's live log console.
```javascript
ha.log("Kitchen motion detected!");
```

### `ha.callService(domain, service, data)`
Executes a service call in Home Assistant.
```javascript
ha.callService('light', 'turn_on', { 
    entity_id: 'light.living_room', 
    brightness: 255 
});
```

### `ha.onStateChange(entityId, callback)`
Reacts in real-time when an entity changes its state.
```javascript
ha.onStateChange('binary_sensor.front_door', (newState) => {
    if (newState.state === 'on') {
        ha.log("Door opened!");
    }
});
```

### `ha.updateState(entityId, state, attributes)`
Creates or updates a virtual entity (sensor) in Home Assistant.
```javascript
ha.updateState('sensor.my_custom_value', 42, { 
    unit_of_measurement: 'points',
    friendly_name: 'Calculated Score'
});
```

---

## 💡 Code Examples

### 1. Simple Synchronisation
Sync two switches so that one follows the other.

```javascript
/**
 * @name Light Linker
 * @icon mdi:link-variant
 */

const MASTER = 'switch.desk_lamp';
const SLAVE = 'switch.floor_lamp';

ha.onStateChange(MASTER, (event) => {
    const action = (event.state === 'on') ? 'turn_on' : 'turn_off';
    ha.callService('switch', action, { entity_id: SLAVE });
    ha.log(`Synced ${SLAVE} to ${event.state}`);
});
```

### 2. External API Integration (Bitcoin Ticker)
Fetch live data from the web and create a sensor in Home Assistant.

```javascript
/**
 * @name Bitcoin Tracker
 * @icon mdi:currency-btc
 * @npm axios
 */

const axios = require('axios');

async function updatePrice() {
    try {
        const response = await axios.get('https://api.coindesk.com/v1/bpi/currentprice.json');
        const price = response.data.bpi.USD.rate_float;
        
        ha.updateState('sensor.bitcoin_price', price, {
            unit_of_measurement: 'USD',
            friendly_name: 'Bitcoin Price',
            icon: 'mdi:currency-btc'
        });
        ha.log(`BTC Price updated: $${price}`);
    } catch (err) {
        ha.error("API Error: " + err.message);
    }
}

// Update every 5 minutes
updatePrice();
setInterval(updatePrice, 300000);
```

---

## ⚙️ Metadata Headers
Use the comment block at the top of your files to configure how the engine handles your script:

- `@name`: The display name in the dashboard.
- `@icon`: Any `mdi:icon-name` to display in the UI.
- `@npm`: Comma-separated list of NPM packages to auto-install.
- `@description`: A short text about what the script does.

---

## 🛠 Local Development (Manual Mode)

If you want to run the engine on your PC instead of as an Add-on:

1. Clone the repository.
2. Create a `.env` file:
   ```env
   HA_URL=http://YOUR_HA_IP:8123
   HA_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
   ```
3. Install dependencies: `npm install`
4. Start the server: `node server.js`
5. Open `http://localhost:3000`.

---

## 🔒 Security
- Scripts run in isolated `Worker Threads`.
- Communication with Home Assistant is handled via a secure WebSocket connection.
- When running as an Add-on, authentication is handled internally via the Home Assistant Supervisor.

---

**Happy Automating!** 🚀
Created with ❤️ for the Home Assistant Community.