# JS Automations for Home Assistant

**JS Automations** is a high-performance, isolated JavaScript automation engine for Home Assistant. It provides a full-blown Web IDE to write, manage, and debug your smart home logic using standard Node.js.

## 🚀 Key Features

- **Isolated Execution:** Every script runs in its own `Worker Thread`. A crash in one script never affects your Home Assistant or other automations.
- **ioBroker-style Subscriptions:** Powerful event handling with wildcards (`light.*`), arrays, and Regex support.
- **Synchronous Access:** Access all Home Assistant states (`ha.states`) and global variables (`ha.store.val`) instantly without `await`.
- **Integrated IDE:** Built-in Monaco Editor (VS Code core) with live logs and dynamic IntelliSense for all your HA entities.
- **Automatic NPM Management:** Add `@npm package-name` to your script header, and the engine handles the installation.
- **Persistent Storage:** A global key-value store that survives restarts and allows data sharing between scripts.

## 🛠 Installation

1. Copy the project folder to `/addons/local/js-automation/` on your Home Assistant machine.
2. Go to **Settings > Add-ons > Add-on Store** -> **Check for updates**.
3. Find **JS Automations** in the "Local Add-ons" section and click **Install**.
4. Enable "Show in sidebar" and click **Start**.

## 📝 Scripting API

### `ha.on(pattern, callback)`
Subscribe to state changes using strings, wildcards, arrays, or Regex.
```javascript
ha.on('light.*', (e) => {
    ha.log(`Light ${e.entity_id} is now ${e.state}`);
});
```

### `ha.states`
Synchronous access to the current state of any entity.
```javascript
if (ha.states['sun.sun'].state === 'below_horizon') {
    ha.log("It is dark outside!");
}
```

### `ha.store`
Persistent data sharing between scripts.
```javascript
ha.store.set('alarm_active', true); // Write
const status = ha.store.val.alarm_active; // Read (synchronous)
```

### Global Built-ins
- `axios`: For HTTP requests.
- `schedule(cron, callback)`: For time-based triggers.
- `sleep(ms)`: Simple async delay.