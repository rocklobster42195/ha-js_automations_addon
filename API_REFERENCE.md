# 📖 API Reference

This document provides a detailed overview of the `ha` object and other global built-ins available in JS Automations scripts.

---

## `ha` Object

The `ha` object provides a comprehensive set of functions to interact with Home Assistant, manage script lifecycle, and utilize persistent storage.

### 1. Logging & Debugging
Control visibility via the `@loglevel` header (debug, info, warn, error).

```javascript
ha.debug("Variable x is: " + x); // Only visible if @loglevel is debug
ha.log("Automation started");    // Standard white log
ha.warn("Battery is low!");      // Yellow log
ha.error("API failed!");         // Red log (marks script as crashed)
```

### 2. Lifecycle Control (`ha.restart` / `ha.stop`)
Scripts can control their own lifecycle.

```javascript
ha.restart("Something went wrong, trying again..."); // Restarts the script
ha.stop("Job finished successfully.");             // Stops the script
```

### 3. Reactive Triggers (`ha.on`)
React to changes in Home Assistant. **Using this keeps your script running.**

```javascript
// --- Single Entity ---
ha.on('binary_sensor.front_door', (e) => {
    ha.log(`Door is now ${e.state}`); // e.state is 'on' or 'off'
});

// --- Wildcards (Match multiple) ---
ha.on('light.living_room_*', (e) => {
    ha.log(`${e.attributes.friendly_name} changed to ${e.state}`);
});

// --- Regular Expressions (Advanced) ---
ha.on(/^sensor\..*_humidity$/, (e) => {
    ha.log(`${e.entity_id} reports ${e.state}% humidity`);
});

// --- Arrays ---
ha.on(['input_boolean.test', 'switch.garden'], (e) => {
    ha.log("One of the tracked entities changed");
});

// --- Filters & Thresholds ---
// Run only if value increases ('gt' = greater than old value)
ha.on('sensor.power_usage', 'gt', (e) => {
    ha.log(`Power usage went up: ${e.state}`);
});

// Run only if value is greater than threshold (25)
ha.on('sensor.temperature', 'gt', 25, (e) => {
    ha.warn("It's getting hot!");
});
```

### 4. Reading States (`ha.states`)
The cache is updated in real-time. No `await` required.

```javascript
const temp = ha.states['sensor.outdoor_temp'].state;
const name = ha.states['sensor.outdoor_temp'].attributes.friendly_name;

if (parseFloat(temp) > 25) {
    ha.log(`It is hot in ${name}`);
}

// --- Helper Methods ---
// Automatically converts state to Number or Boolean ('on'->true)
const tempNum = ha.getStateValue('sensor.outdoor_temp'); // e.g. 25.5
const isLightOn = ha.getStateValue('light.kitchen');     // e.g. true

// Get a specific attribute directly
const level = ha.getAttr('sensor.battery', 'battery_level');

// Get group members as array
const lights = ha.getGroupMembers('group.living_room_lights');

// Read values from the script header (@name super_script)
const scriptName = ha.getHeader('name', 'script');
```

### 5. Setting States & Creating Sensors (`ha.updateState`)
Create virtual sensors or update existing ones directly in HA.

```javascript
// Register the entity once (Persistent)
ha.register('sensor.js_energy_total', {
    name: 'Total Calculated Energy',
    icon: 'mdi:transmission-tower',
    unit: 'kWh',                    // Alias for unit_of_measurement
    area: 'kitchen',                // Optional: Assign to an Area
    labels: ['energy', 'solar'],    // Optional: Add Labels
    initial_state: 1250.5           // Optional: Set initial value
});

// Update only the value
ha.update('sensor.js_energy_total', 1251.0);

// Update only the icon (keeps current value)
ha.update('sensor.js_energy_total', { icon: 'mdi:flash-alert' });
```

### 6. Calling Services (`ha.callService`)
Trigger any action in Home Assistant.

```javascript
// Turn on a light with attributes
ha.callService('light', 'turn_on', {
    entity_id: 'light.kitchen',
    brightness: 150,
    rgb_color: [255, 0, 0]
});

// Send a notification
ha.callService('notify', 'mobile_app_phone', {
    title: 'Security Alert',
    message: 'Motion detected in the garage!'
});
```

### 7. Entity Selectors (`ha.select`)
Perform bulk actions on groups of entities.

```javascript
// Turn off all lights in a specific area
ha.select('light.*')
  .where(l => l.attributes.area === 'Living Room')
  .turnOff();

// Find all sensors with low battery
const lowBatteries = ha.select('sensor.*_battery_level')
  .where(s => parseFloat(s.state) < 10)
  .toArray();

ha.log(`Found ${lowBatteries.length} sensors with low battery.`);

// --- Groups ---
// Expand a group to its members and control them
ha.select('group.living_room_lights')
  .expand() // Resolves the group to individual lights
  .turnOff();

// --- Groups ---
// Expand a group to its members and control them
ha.select('group.living_room_lights')
  .expand() // Resolves the group to individual lights
  .turnOff();
```

### 8. Persistent Store (`ha.store`)
Share data across scripts or reboots. Synchronous read/write.

```javascript
// Set a value
ha.store.set('guest_mode', true);

// Read a value (synchronous)
if (ha.store.val.guest_mode === true) {
    ha.log("Guest mode is active");
}

// React to changes (Cross-Script Communication)
ha.store.on('guest_mode', (newValue, oldValue) => {
    ha.log(`Guest mode changed from ${oldValue} to ${newValue}`);
});

// Delete a value
ha.store.delete('temp_variable');
```

---

## Global Built-ins

No need to `require` these, they are always available.

### `axios`
Standard library for HTTP requests.
```javascript
async function checkWeather() {
    const res = await axios.get('https://api.weather.com/v1/...');
    ha.log("Temp: " + res.data.temp);
}
```

### `schedule(cron, callback)`
Time-based execution using CRON syntax. **Keeps script running.**
```javascript
// Every day at 07:30
schedule('30 7 * * *', () => {
    ha.log("Time to wake up!");
});
```

### `sleep(ms)`
Pause execution in async functions.
```javascript
async function sequence() {
    ha.callService('light', 'turn_on', { entity_id: 'light.test' });
    await sleep(2000); // wait 2 seconds
    ha.callService('light', 'turn_off', { entity_id: 'light.test' });
}
```