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

### 3. Breakpoints (`ha.breakpoint`) *(Expert Mode)*
Pauses script execution and displays variables in the **Breakpoints** tab of the developer tools. Click **Continue** in the UI to resume. Auto-resumes after 60 seconds.

> Requires **Expert Mode** to be enabled in Settings → General.

```javascript
const temp = ha.getState('sensor.outdoor_temp')?.state;

ha.breakpoint('before decision', {
    temp,
    threshold: 20,
    isWarm: parseFloat(temp) > 20,
});

// execution pauses here until Continue is clicked
if (parseFloat(temp) > 20) {
    ha.call('fan.turn_on', { entity_id: 'fan.living_room' });
}
```

The second argument accepts any key/value pairs and is shown as a variable inspector in the UI.

### 4. Watch & Inspect *(Expert Mode)*

#### `ha.watch(label, fn)` — Live tile
Registers an expression that re-evaluates on every HA state change and displays the result as a **live tile** at the top of the **WATCH** tab. Multiple scripts can each register their own watches.

> Requires **Expert Mode** to be enabled in Settings → General.

```javascript
// Full state object → shows entity icon + state value automatically
ha.watch('Shelly Plug', () => ha.getState('switch.shelly_plug_s'));

// Works with any expression — boolean renders green/red
ha.watch('Heating ON', () => ha.getState('climate.living_room')?.state === 'heat');

// Computed number
ha.watch('Lights on', () => ha.select('light.*').where(s => s.state === 'on').count);
```

> **Tip:** Returning the full state object (`ha.getState(...)` without `?.state`) automatically shows the entity's icon in the tile and derives the correct color from the state.

#### `ha.inspect(label, vars)` — One-shot snapshot
Sends a timestamped variable snapshot to the **Inspect** list at the bottom of the **WATCH** tab. Non-blocking — execution continues immediately.

```javascript
const motion = ha.getState('binary_sensor.hallway_motion')?.state;
const light  = ha.getState('light.hallway')?.state;

ha.inspect('hallway check', { motion, light, ts: new Date().toISOString() });

// execution continues here without pausing
```

### 5. Reactive Triggers (`ha.on`)
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

// Check whether an entity exists before reading its state
if (ha.entityExists('sensor.my_sensor')) {
    const val = ha.getStateValue('sensor.my_sensor');
}

// Read values from the script header (@name super_script)
const scriptName = ha.getHeader('name', 'script');
```

### 6. Setting States & Creating Sensors (`ha.update`)
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

### 7. Calling Services (`ha.call`)
Trigger any action in Home Assistant.

```javascript
// Turn on a light with attributes
ha.call('light.turn_on', {
    entity_id: 'light.kitchen',
    brightness: 150,
    rgb_color: [255, 0, 0]
});

// Send a notification
ha.call('notify.mobile_app_phone', {
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

### `schedule(expression, callback)`
Time-based execution. **Keeps script running.**

Accepts standard 5-field cron expressions **or** human-readable shorthand strings:

| Shorthand | Equivalent cron |
|---|---|
| `'every 15m'` | `*/15 * * * *` |
| `'every hour'` | `0 * * * *` |
| `'every day at 7:30'` | `30 7 * * *` |
| `'every weekday at 6:00'` | `0 6 * * 1-5` |
| `'every weekend at 10:00'` | `0 10 * * 6,0` |
| `'every monday at 9:00'` | `0 9 * * 1` |

```javascript
// Shorthand
schedule('every day at 7:30', () => {
    ha.log("Time to wake up!");
});

schedule('every 15m', () => {
    ha.log("Quarter-hour tick");
});

// Classic cron expression still works
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

## HTTP API (`ha.http`)

`ha.http` is a thin convenience wrapper around the native `fetch` API for common GET/POST use-cases. It automatically parses JSON responses and throws on non-2xx status codes.

Requires `@permission network` in the script header.

```javascript
/**
 * @permission network
 */

// GET — returns parsed JSON or plain text
const data = await ha.http.get('https://api.example.com/data');
ha.log(data.temperature);

// POST with JSON body
const result = await ha.http.post('https://api.example.com/submit', { key: 'value' });

// With extra fetch options (custom headers, timeout via AbortSignal, etc.)
const data = await ha.http.get('https://api.example.com/data', {
    headers: { 'Authorization': 'Bearer my-token' },
});
```

> **Note:** For more complex HTTP scenarios (streaming, interceptors, retry logic) use `fetch` directly or install `axios` via npm.

---

## Area API

JSA exposes the Home Assistant area and entity registry so you can query which entities belong to a room without hardcoding entity IDs.

The data is fetched once on startup. If you add/reassign entities to areas after the script starts, restart the script to pick up the changes.

```javascript
// List all areas
const areas = ha.getAreas();
// → [{ area_id: 'living_room', name: 'Living Room' }, ...]

for (const area of areas) {
    ha.log(`${area.name} (${area.area_id})`);
}

// Get all entity IDs in a specific area
const entities = ha.getEntitiesInArea('living_room');
// → ['light.floor_lamp', 'sensor.temperature', ...]

// Turn off all lights in the living room
ha.select(ha.getEntitiesInArea('living_room').filter(id => id.startsWith('light.'))).turn_off();
```

---

## History API

`ha.getHistory()` fetches the recorded state history for an entity from Home Assistant's history system. It wraps the WebSocket `history/history_during_period` command.

Use this in an `async` function with `await`.

```javascript
// Last 24 hours (default)
const history = await ha.getHistory('sensor.power_usage');
ha.log(`${history.length} data points`);

// Custom time window
const history = await ha.getHistory('sensor.power_usage', {
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    end: new Date(),
});

// Each entry has at least: state, last_changed
for (const entry of history) {
    ha.log(`${entry.last_changed}: ${entry.state}`);
}

// Include full attributes (minimalResponse: false)
const full = await ha.getHistory('climate.living_room', {
    start: new Date(Date.now() - 3600 * 1000),
    minimalResponse: false,
});
ha.log(full[0]?.attributes?.current_temperature);
```

> **Note:** History availability depends on the HA recorder integration being configured. Long time windows may return large datasets.

---

## Statistics API

`ha.getStatistics()` fetches **aggregated long-term statistics** from HA's recorder — the same data that powers the Energy Dashboard. Unlike `getHistory()` which returns every raw state change, statistics are pre-aggregated into hourly or daily buckets (mean, min, max, sum).

Use this in an `async` function with `await`.

```javascript
// Energy usage over the past 7 days (daily buckets)
const stats = await ha.getStatistics('sensor.power_usage', {
    start: new Date(Date.now() - 7 * 86400_000),
    period: 'day',
    types: ['mean', 'sum'],
});

for (const entry of stats) {
    ha.log(`${entry.start}: avg=${entry.mean?.toFixed(1)}W, total=${entry.sum?.toFixed(0)}Wh`);
}

// Last 24 hours at hourly resolution (default)
const hourly = await ha.getStatistics('sensor.power_usage');
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `start` | `Date` | 24 hours ago | Start of the window |
| `end` | `Date` | — | End of the window (optional) |
| `period` | `'hour' \| 'day' \| '5minute'` | `'hour'` | Aggregation bucket size |
| `types` | `string[]` | `['mean','min','max','sum']` | Which aggregates to include |

Each entry: `{ start: string, mean?: number, min?: number, max?: number, sum?: number }`

---

## Template API

`ha.renderTemplate()` evaluates a **Jinja2 template** via HA's template engine — giving access to all HA template functions: `states()`, `distance()`, `relative_time()`, `area_entities()`, and everything else available in HA templates.

```javascript
// Read a state via template
const sunState = await ha.renderTemplate("{{ states('sun.sun') }}");
ha.log(sunState); // → 'above_horizon'

// Distance from person to zone
const dist = await ha.renderTemplate(
    "{{ distance('person.boris', 'zone.home') | round(1) }}"
);
ha.log(`${dist} km from home`);

// Time until next event
const msg = await ha.renderTemplate(
    "Sun sets in {{ relative_time(states.sun.sun.attributes.next_setting) }}."
);
ha.notify(msg);
```

Returns a `string`, `number`, or `boolean` — matching whatever the template evaluates to.

---

## Calendar API

`ha.getCalendarEvents()` fetches events from any HA calendar entity (Google Calendar, CalDAV, local calendars).

```javascript
const events = await ha.getCalendarEvents('calendar.family', {
    start: new Date(),
    end: new Date(Date.now() + 7 * 86400_000),
});

// Check for school holidays
const isHoliday = events.some(e => e.summary.toLowerCase().includes('ferien'));
if (isHoliday) ha.log('School holiday this week!');

// List upcoming all-day events
for (const event of events.filter(e => e.all_day)) {
    ha.log(`${event.start}: ${event.summary}`);
}
```

Each event: `{ summary, start, end, all_day, description?, location? }`

`start` and `end` are ISO strings. All-day events have date-only strings (e.g. `'2026-06-20'`); timed events include a time component.

---

## Todo API

`ha.getTodoItems()` reads items from a HA todo list entity (Google Tasks, CalDAV, local).

```javascript
const items = await ha.getTodoItems('todo.shopping_list');

const pending = items.filter(i => i.status === 'needs_action');
ha.log(`${pending.length} items left on the shopping list`);

// Notify if anything is overdue
const today = new Date().toISOString().slice(0, 10);
for (const item of pending) {
    if (item.due && item.due < today) {
        ha.notify(`Overdue: ${item.summary}`);
    }
}
```

Each item: `{ uid, summary, status: 'needs_action' | 'completed', due?, description? }`

---

## Label API

HA 2023.6+ supports **labels** — a flexible tagging system for entities across areas. JSA exposes the label registry so scripts can query entities by label.

The data is fetched once on startup. Restart the script if labels or assignments change.

```javascript
// List all labels
const labels = ha.getLabels();
// → [{ label_id: 'night_lights', name: 'Night Lights', color: 'blue' }, ...]

// Get entities with a specific label (by ID or name)
const nightLights = ha.getEntitiesWithLabel('night_lights');
// → ['light.hallway', 'light.staircase', ...]

// Turn off all "vacation safe" devices
for (const id of ha.getEntitiesWithLabel('vacation_safe')) {
    ha.entity(id).turn_off();
}
```

---

## Floor API

HA 2024.2+ supports **floors** as a grouping level above areas. Useful for multi-story homes.

The data is fetched once on startup. Restart the script if floors or assignments change.

```javascript
// List all floors
const floors = ha.getFloors();
// → [{ floor_id: 'ground_floor', name: 'Ground Floor', level: 0 }, ...]

// Get all areas on a specific floor
const areas = ha.getAreasInFloor('ground_floor');
// → [{ area_id: 'living_room', name: 'Living Room', floor_id: 'ground_floor' }, ...]

// Turn off all lights on the ground floor
for (const area of ha.getAreasInFloor('Erdgeschoss')) {
    ha.select(ha.getEntitiesInArea(area.area_id).filter(id => id.startsWith('light.'))).turn_off();
}
```

---

## Custom Events (`ha.onEvent` / `ha.fireEvent`)

`ha.onEvent()` subscribes to **any event on the HA event bus** — not just `state_changed`. This includes automation triggers, NFC tag scans, calendar events, service calls, and custom inter-script signals.

`ha.fireEvent()` publishes a custom event that other scripts (or HA automations) can react to.

**Listening to HA events:**
```javascript
// React when any automation is triggered
ha.onEvent('automation_triggered', (event) => {
    ha.log(`Automation fired: ${event.data.name}`);
});

// Log every light service call
ha.onEvent('call_service', (event) => {
    if (event.data.domain === 'light') {
        ha.log(`Light service called: ${event.data.service}`);
    }
});

// React to an NFC tag scan
ha.onEvent('tag_scanned', (event) => {
    ha.log(`Tag: ${event.data.tag_id} scanned by ${event.data.device_id}`);
});
```

**Inter-script signalling:**
```javascript
// Script A — fire an event
ha.fireEvent('my_app_event', { command: 'refresh', source: 'script_a' });

// Script B — listen for it
ha.onEvent('my_app_event', (event) => {
    if (event.data.command === 'refresh') ha.log('Refresh triggered!');
});
```

`ha.onEvent()` keeps the worker alive as long as the listener is registered (same behaviour as `ha.on()`).

> **Note:** `ha.fireEvent()` fires the event on the HA event bus. Any HA automation with an `event` trigger can also react to it.

> **`ha.fireEvent` vs. `ha.action`** — Use `ha.fireEvent` for broadcasts where you don't need a response and any number of listeners (including HA automations) may react. Use [`ha.action`](#action-handlers-haaction) when a UI, card, or button entity calls your script by name and you need to return a value.

---

## Action Handlers (`ha.action`)

`ha.action()` registers a **named handler** inside your script that external callers can invoke directly and await a return value from.

| | `ha.fireEvent` | `ha.action` |
|---|---|---|
| Direction | Broadcast | Targeted |
| Receivers | Any listener (HA + other scripts) | This script, by name |
| Return value | No | Yes |
| Who triggers it | You call it yourself | UI / Card / Button entity |

**Triggered from a Lovelace card:**
```javascript
// Script side
ha.action('get_data', async ({ filter }) => {
    return await fetchData(filter);
});

// Card side (JavaScript)
const result = await __jsa__.callAction('get_data', { filter: 'active' });
```

**Triggered by a button entity press:**
```javascript
ha.action('refresh', async () => { await update(); });
ha.register('button.my_refresh', { name: 'Refresh', action: 'refresh' });
```

**With payload and return value:**
```javascript
ha.action('set-team', async ({ teamId }) => {
    CONFIG.teamId = teamId;
    await update();
    return { ok: true };
});
```

> **Note:** `ha.action` handlers only exist while the script is running. If the script is stopped, calls to `__jsa__.callAction()` will time out after 10 seconds.

---

## MQTT API (`ha.mqtt`)

`ha.mqtt` gives scripts a direct line to the MQTT broker — no HA entity in between, no polling. Subscribe to any topic, react to raw hardware messages, publish commands, or use MQTT as an inter-script bus that survives HA restarts.

Subscriptions are scoped to the script and cleaned up automatically when the script stops or restarts.

### `ha.mqtt.subscribe(topic, callback)` → unsubscribe function

Subscribes to an MQTT topic. Wildcards are supported:
- `+` — matches any **single** level (e.g. `shellies/+/light/0/status`)
- `#` — matches **all remaining** levels (e.g. `zigbee2mqtt/#`). Must be the last segment.

Payloads are **automatically parsed as JSON** when valid; otherwise delivered as a plain string.

Returns an **unsubscribe function** — call it to stop listening.

```javascript
// Single topic
ha.mqtt.subscribe('tasmota/sensor1/tele/SENSOR', (topic, payload) => {
    ha.log(`Temperature: ${payload.SI7021?.Temperature}`);
});

// Wildcard — all Shelly light status topics
ha.mqtt.subscribe('shellies/+/light/0/status', (topic, payload) => {
    const device = topic.split('/')[1];
    ha.log(`${device} is ${payload.ison ? 'on' : 'off'} at ${payload.brightness}%`);
});

// Multi-level wildcard
ha.mqtt.subscribe('zigbee2mqtt/#', (topic, payload) => {
    ha.log(`Zigbee message on ${topic}`);
});

// Manual unsubscribe
const unsub = ha.mqtt.subscribe('my/topic', (topic, payload) => { /* ... */ });
unsub(); // stops listening
```

### `ha.mqtt.publish(topic, payload, options?)`

Publishes a message to any MQTT topic. Objects are automatically serialized to JSON.

```javascript
// Turn on a Shelly dimmer directly via MQTT
ha.mqtt.publish('shellies/dimmer1/light/0/set', { turn: 'on', brightness: 80 });

// Plain string payload
ha.mqtt.publish('my/flag', 'ready');

// With retain flag (broker keeps the last message for late subscribers)
ha.mqtt.publish('my/status', 'online', { retain: true });

// With QoS
ha.mqtt.publish('critical/alert', 'fire!', { qos: 1 });
```

### Use Cases

**Talk directly to hardware** — React to Tasmota / Shelly / Zigbee2MQTT raw messages without creating HA entities:
```javascript
ha.mqtt.subscribe('tasmota/hallway_switch/stat/POWER', (topic, payload) => {
    if (payload === 'ON') ha.call('light.turn_on', { entity_id: 'light.hallway', transition: 1 });
    else ha.call('light.turn_off', { entity_id: 'light.hallway', transition: 1 });
});
```

**Zigbee2MQTT button actions without HA integration** — If you run Z2M without the HA integration (or want to process raw payloads before they reach HA), subscribe directly to the broker:
```javascript
ha.mqtt.subscribe('zigbee2mqtt/my_remote/action', (topic, payload) => {
    if (payload === 'brightness_up_click') ha.entity('light.living_room').turn_on({ brightness_step: 30 });
});
```
> **Note:** With the Z2M HA integration active, button actions are already exposed as `event` (or `action` sensor) entities and work with `ha.on()` — `ha.mqtt.subscribe()` is only needed when running without the integration or when you need the raw MQTT payload.

**Inter-script communication via MQTT** — Broker-persistent, survives HA restarts:
```javascript
// Script A — publish
ha.mqtt.publish('jsa/app/mode', { value: 'away' }, { retain: true });

// Script B — subscribe
ha.mqtt.subscribe('jsa/app/mode', (topic, payload) => {
    ha.log(`Mode changed to: ${payload.value}`);
});
```

**Custom HA device with complex domain** — Combine `ha.register()` passthrough fields with `ha.mqtt.subscribe()`:
```javascript
ha.register('light.my_diy_light', {
    name: 'DIY LED Strip',
    device_class: 'light',
    // Raw Discovery fields passed through as-is:
    brightness_command_topic: 'diy/led/brightness/set',
    brightness_state_topic:   'diy/led/brightness',
    brightness_scale: 255,
    command_topic: 'diy/led/set',
    state_topic:   'diy/led/state',
});

ha.mqtt.subscribe('diy/led/+/set', (topic, payload) => {
    if (topic.includes('brightness')) {
        ha.update('light.my_diy_light', 'ON', { brightness: Number(payload) });
        // … forward to real hardware …
    }
});
ha.mqtt.subscribe('diy/led/set', (topic, payload) => {
    ha.update('light.my_diy_light', payload === 'ON' ? 'on' : 'off');
});
```

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