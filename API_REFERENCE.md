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
        ha.entity('cover.garage_door').open_cover();

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
    ha.entity('group.living_room_lights').turn_off();
    ha.entity('media_player.tv').turn_on();

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

### 7.1. Sending Notifications (`ha.notify`)

A convenient shortcut for sending notifications via Home Assistant's `notify` domain. Defaults to `notify.notify`, which broadcasts to all configured notifiers (e.g., all registered mobile apps).

```javascript
// Simple message — sent to all notifiers via notify.notify
ha.notify("The washing machine is done!");

// With title
ha.notify("Motion detected!", { title: "Security Alert" });

// Target a specific notifier (both forms work)
ha.notify("Dinner is ready!", {
    title: "Kitchen",
    target: "notify.mobile_app_my_phone"
    // or: target: "mobile_app_my_phone"
});

// Persistent notification (visible in HA Web UI/Browser sidebar)
ha.notify("Backup completed successfully", {
    title: "System",
    persistent: true
});

// With extra data (e.g. actionable notification on mobile)
ha.notify("Garage door left open. Close it?", {
    title: "Garage",
    target: "mobile_app_my_phone",
    data: {
        actions: [
            { action: "CLOSE_GARAGE", title: "Close now" },
            { action: "IGNORE",        title: "Ignore"    }
        ]
    }
});
```

> **Tip:** Combine `ha.notify()` with `ha.localize()` to send multilingual notifications to every household member automatically.

### 7.2. Actionable Notifications (`ha.ask`)

`ha.ask()` sends a notification with buttons and **waits for the user to tap one**. It returns a `Promise<string | null>` — the chosen action string, or `defaultAction` (`null` by default) when the timeout expires.

Use this in an `async` function with `await`.

```javascript
async function checkGarage() {
    const isOpen = ha.getStateValue('cover.garage_door') === 'open';
    if (!isOpen) return;

    const answer = await ha.ask("The garage door is still open. What should I do?", {
        title: "Garage Alert",
        timeout: 60000,        // 60 s to answer (default)
        defaultAction: "SNOOZE", // what to do when nobody answers in time
        actions: [
            { action: "CLOSE",  title: "Close now"          },
            { action: "SNOOZE", title: "Remind in 30 min"   },
            { action: "IGNORE", title: "Ignore for tonight" },
        ]
    });

    if (answer === "CLOSE") {
        ha.entity('cover.garage_door').close_cover();
        ha.log("Garage door closed by user.");
    } else if (answer === "SNOOZE" || answer === null) {
        // defaultAction === "SNOOZE", so a timeout lands here too
        ha.log("Snoozed — will remind again in 30 minutes.");
        setTimeout(checkGarage, 30 * 60 * 1000);
    } else {
        ha.log("User chose to ignore the garage door.");
    }
}
```

**How it works under the hood:**

1. `ha.ask()` sends an actionable notification via `ha.notify()`.
2. It waits (without blocking) for the user to tap a button on their phone.
3. The first person to tap wins — multiple devices can receive the notification, but only the first response counts.
4. If no one responds within `timeout` ms, the Promise resolves with `defaultAction` (default `null`).

**Tips:**

- **Snooze / re-notify pattern:** Set `defaultAction: "SNOOZE"` and call the same function again from a `setTimeout` for an automatic reminder loop.
- **Target a specific device:** Use `target: "mobile_app_my_phone"` so only one person gets the question.
- **Multiple concurrent asks:** Safe — each call has an internal unique ID so responses are never mixed up.
- **Keep actions short:** iOS limits notification button titles to ~20 characters.

### 8. Entity Selectors (`ha.select`)
Perform bulk actions on groups of entities. `ha.select()` returns a chainable selector object that allows you to filter, transform, and act on multiple entities at once.

**Example 1: Monitoring with `.toArray()`**
Find all sensors with low battery and log their names.

```javascript
const lowBatteries = ha.select('sensor.*_battery_level')
  .where(s => parseFloat(s.state) < 15)
  .toArray();

if (lowBatteries.length > 0) {
    const names = lowBatteries.map(s => s.attributes.friendly_name || s.entity_id);
    ha.warn(`Low battery: ${names.join(', ')}`);
```

**Example 2: Bulk Actions**
Turn off all lights in a specific area.

```javascript
ha.select('light.*')
  .where(light => light.attributes.area === 'Living Room')
  .turn_off();
```

**Example 3: Working with Groups**
Expand a group to its members and control them individually.

```javascript
await ha.select('light.*')
  .where(l => l.attributes.area === 'Living Room')
  .throttle(500) // 500ms pause between each light command
  .turn_off()
  .wait(1000);   // Wait 1s after the last command
ha.log("All lights turned off sequentially.");
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
**Primitive values** are also supported. When the default value is a `string`, `number`, or `boolean`, `ha.persistent` returns a `{ value }` wrapper instead of a proxy:

```javascript
// Primitive counter — use the .value property to read/write
const counter = ha.persistent('my_counter', 0);
counter.value++;          // Incremented and automatically saved
ha.log(counter.value);    // 1 (even after a restart)

// TypeScript: inferred as { value: number }
const flag = ha.persistent('feature_flag', false);
flag.value = true;
```


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

---

## Filesystem API (`ha.fs`)

`ha.fs` provides sandboxed file access. It is only available when **Settings → Danger Zone → Enable Filesystem Access** is turned on.

### Virtual Roots

| Prefix | Maps to | Purpose |
|---|---|---|
| `internal://` | `/config/js-automations/data/` | Script-private persistent data |
| `shared://` | `/share/` | Cross-addon data exchange, NAS mounts |
| `media://` | `/media/` | Camera snapshots, audio, images |

Path traversal (`../`) is always blocked. `move()` requires both paths to be within the same virtual root.

### `@permission` Tag

Scripts using `ha.fs` should declare the required permissions in their header:

```javascript
/**
 * @name My Script
 * @permission fs:read, fs:write
 */
```

When **Capability Enforcement** is enabled (default: on), calling `ha.fs` methods without the matching `@permission` throws a `PermissionDeniedError` at runtime.

### Methods

| Method | Permission | Description |
|---|---|---|
| `ha.fs.read(path, encoding?)` | `fs:read` | Read file as UTF-8 string (default) or `Buffer` (`'binary'`) |
| `ha.fs.write(path, data)` | `fs:write` | Write or overwrite a file. Creates parent directories. |
| `ha.fs.append(path, data)` | `fs:write` | Append to a file. Creates it if needed. |
| `ha.fs.exists(path)` | `fs:read` | Returns `true` if the path exists. |
| `ha.fs.list(path)` | `fs:read` | Lists directory entries. Directories are suffixed with `/`. |
| `ha.fs.stat(path)` | `fs:read` | Returns `{ size, modified: Date, isDirectory }`. |
| `ha.fs.move(src, dest)` | `fs:write` | Move or rename. Both paths must share the same virtual root. |
| `ha.fs.delete(path)` | `fs:write` | Delete a file or directory (recursive). |
| `ha.fs.watch(path, callback)` | `fs:read` | Watch for changes. Returns an unsubscribe function. |
| `ha.fs.rotate(path, options?)` | `fs:write` | Log rotation. Renames `.log` → `.1.log` → `.2.log` … |

### Storage Quotas

Per-root size limits can be configured under **Settings → Danger Zone** (visible when filesystem access is enabled). `0` = unlimited.

### Examples

```javascript
/**
 * @name CSV Logger
 * @permission fs:write
 */

// Append a row
const row = `${new Date().toISOString()},${price}\n`;
await ha.fs.append('internal://prices.csv', row);

// Rotate when file exceeds 5 MB, keep 3 backups
await ha.fs.rotate('internal://prices.csv', { maxSize: '5MB', keep: 3 });
```

```javascript
/**
 * @name Config Watcher
 * @permission fs:read
 */

let config = JSON.parse(await ha.fs.read('shared://my-script/config.json'));

const stop = ha.fs.watch('shared://my-script/config.json', async () => {
    config = JSON.parse(await ha.fs.read('shared://my-script/config.json'));
    ha.log('Config reloaded');
});

ha.onStop(() => stop());
```

---

## Capability & Permission System

Scripts can declare which sensitive capabilities they use via `@permission` in the script header. This serves two purposes: **transparency** (the script list shows badges for each declared/detected capability) and optionally **enforcement** (undeclared capabilities throw at runtime).

### Permission Tokens

| Token | What it covers | Enforcement |
|---|---|---|
| `network` | `fetch()`, `http`, `https`, `axios`, `got`, … | ✓ (Module._load hook + fetch override) |
| `fs:read` | `ha.fs.read`, `.exists`, `.list`, `.stat`, `.watch` | ✓ |
| `fs:write` | `ha.fs.write`, `.append`, `.delete`, `.move`, `.rotate` | ✓ |
| `fs` | Alias for `fs:read` + `fs:write` | ✓ |
| `exec` | `child_process` (`exec`, `spawn`, …) | ✓ |

### Auto-Detection

The UI statically analyses script source at load time and highlights any capability that is used but not declared (amber badge) or declared but not detected (dimmed badge). Enforcement is a separate runtime mechanism.