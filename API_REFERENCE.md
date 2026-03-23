# 📖 API Reference

This document provides a detailed overview of the `ha` object and other global built-ins available in JS Automations scripts.

---

## `ha` Object

The `ha` object provides a comprehensive set of functions to interact with Home Assistant, manage script lifecycle, and utilize persistent storage.

### 0. Internationalization (`ha.language` & `ha.localize`)
Access the preferred language (configured in settings or automatically detected from Home Assistant) and translate strings easily.

```javascript
if (ha.language === 'de') {
    ha.log("Guten Morgen!");
}

// Or use the helper function
const msg = ha.localize({
    en: 'Hello World',
    de: 'Hallo Welt',
    fr: 'Bonjour le monde'
}, 'Hello World'); // Fallback
```

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

### 4. Waiting for States (`ha.waitFor` / `ha.waitUntil`)
Pause script execution until a specific condition is met, without complex callbacks. These functions return a `Promise` and are best used inside `async` functions with `await`.

#### `ha.waitFor`
Waits for a single state-change event to occur for a specific entity or pattern. It resolves with the event object once the condition is met or rejects if a timeout is reached.

```javascript
async function openGarage() {
    // This script might be triggered by a button press
    if (ha.states['cover.garage_door'].state === 'closed') {
        ha.log('Opening garage door...');
        ha.callService('cover', 'open_cover', { entity_id: 'cover.garage_door' });

        try {
            // Wait for the door to be fully open, with a 30-second timeout
            await ha.waitFor('cover.garage_door', 'eq', 'open', { timeout: 30000 });
            ha.log('Garage door is now open.');
        } catch (e) {
            ha.error('Garage door did not open in time.');
        }
    }
}
```

#### `ha.waitUntil`
Waits until a custom condition function returns `true`. This is ideal for complex scenarios involving multiple entities or attributes. The condition is checked efficiently whenever *any* state changes, and also on a regular poll interval.

```javascript
async function startMovieMode() {
    ha.log('Starting movie mode...');
    ha.callService('light', 'turn_off', { entity_id: 'group.living_room_lights' });
    ha.callService('media_player', 'turn_on', { entity_id: 'media_player.tv' });

    // Wait until all lights are off AND the TV is on
    await ha.waitUntil(() => {
        const lightsOff = ha.getStateValue('group.living_room_lights') === 'off';
        const tvOn = ha.getStateValue('media_player.tv') === 'playing';
        return lightsOff && tvOn;
    }, { timeout: 45000 }); // 45s timeout

    ha.log('Movie mode is active!');
}
```

### 5. Reading States (`ha.states`)
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

### 6. Setting States & Creating Sensors (`ha.updateState`)
Create virtual sensors or update existing ones directly in HA.

```javascript
// Register the entity once (Persistent)
ha.register('sensor.energy_total', {
    name: 'Total Calculated Energy',
    icon: 'mdi:transmission-tower',
    unit: 'kWh',                    // Alias for unit_of_measurement
    area: 'kitchen',                // Optional: Assign to an Area
    labels: ['energy', 'solar'],    // Optional: Add Labels
    initial_state: 1250.5           // Optional: Set initial value
});

// Update only the value
ha.update('sensor.energy_total', 1251.0);

// Update only the icon (keeps current value)
ha.update('sensor.energy_total', { icon: 'mdi:flash-alert' });
```

### 7. Calling Services (`ha.callService`)
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

### 8. Entity Selectors (`ha.select`)
Perform bulk actions on groups of entities. `ha.select()` returns a chainable selector object that allows you to filter, transform, and act on multiple entities at once.

**Chainable Methods:**
*   `.where(callback)`: Filters the selection based on a condition.
*   `.map(callback)`: Transforms the selection into a new array of values.
*   `.each(callback)`: Executes a function for each entity.
*   `.turnOn()`, `.turnOff()`: Calls the respective service on all selected entities.
*   `.expand()`: Expands any groups in the selection into their individual members.
*   `.toArray()`: Returns the final selection as a raw array of state objects.

**Example 1: Data Transformation with `.map()`**
Find all sensors with low battery and create a list of their names.

```javascript
// Find all sensors with a battery level below 15%
const lowBatteryNames = ha.select('sensor.*_battery_level')
  .where(s => parseFloat(s.state) < 15)
  .map(s => s.attributes.friendly_name || s.entity_id); // Transform into an array of names

if (lowBatteryNames.length > 0) {
    ha.warn(`Low battery: ${lowBatteryNames.join(', ')}`);
}
```

**Example 2: Bulk Actions**
Turn off all lights in a specific area.

```javascript
ha.select('light.*')
  .where(light => light.attributes.area === 'Living Room')
  .turnOff();
```

**Example 3: Working with Groups**
Expand a group to its members and control them individually.

```javascript
ha.select('group.all_fans')
  .expand() // Resolves the group to its individual fan entities
  .turnOff();
```

### 9. Persistent Store (`ha.store`)
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

### 10. Automatic Persistent State (`ha.persistent`)
`ha.persistent` offers a "magic" way to store data that saves automatically. It's perfect for managing complex state objects like arrays or nested data without manually calling `ha.store.set()` after every change.

It returns a special proxied object. Any modification to this object (adding a property, changing a value, deleting a key) will automatically trigger a debounced save to the persistent store.

```javascript
// Get a reference to a persistent object.
// If 'shoppingList' doesn't exist in the store, it will be initialized with this array.
const shoppingList = ha.persistent('shoppingList', ['milk', 'bread']);

ha.log(`Current list: ${shoppingList.join(', ')}`);

// Just modify the array directly...
shoppingList.push('eggs');

// ...and it's automatically saved! No need to call ha.store.set().
// After a restart, the list will be ['milk', 'bread', 'eggs'].

// It also works for deep, nested objects.
const settings = ha.persistent('my_app_settings', { notifications: { enabled: true } });
settings.notifications.enabled = false; // This change is also saved automatically.
```
**Note:** This is best used for objects and arrays. For simple primitive values (like a single boolean or number), `ha.store.set()` is slightly more efficient.


### 11. Global Error Handling (`ha.onError`)
Define a global "catch-all" function to handle uncaught exceptions and unhandled promise rejections. This does **not** replace `try/catch` blocks, which should still be used for predictable errors.

Instead, `ha.onError` acts as a safety net for unexpected errors, especially those from asynchronous operations or third-party libraries. It allows you to perform cleanup, log detailed information, or attempt a recovery, like restarting the script.

```javascript
ha.onError((error) => {
    // Log the unexpected error
    ha.error(`A critical, unhandled error occurred: ${error.message}`);
    ha.error(error.stack); // Log the full stack trace for debugging

    // Attempt to recover by restarting the script in 10 seconds
    ha.log('Attempting to restart script in 10 seconds...');
    setTimeout(() => ha.restart(), 10000);
});
```

---

## Global Built-ins

Functions that are always available in the global scope.

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

---

## NPM Packages

You can use any package from NPM by declaring it in the script header. The system will automatically install it.

### `axios` (HTTP Requests)

`axios` is a popular library for making HTTP requests. To use it, you must declare it in your script header and `require` it.

```javascript
/**
 * @name Weather Checker
 * @npm axios
 */
const axios = require('axios');

async function checkWeather() {
    const res = await axios.get('https://api.weather.com/v1/...');
    ha.log("Temp: " + res.data.temp);
}
```
The system automatically applies important default settings to the `axios` instance (like disabling keep-alive) to prevent scripts from hanging, so you don't have to worry about complex configuration.