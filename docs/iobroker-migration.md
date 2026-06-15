# Migration: ioBroker JavaScript Adapter → JS Automations (JSA)

Coming from the ioBroker JavaScript adapter and moving to Home Assistant with JSA? This page shows what stayed the same, what you need to rethink, and how familiar patterns look in JSA.

---

## What's the Same?

The basic structure will feel familiar:

- **JavaScript and TypeScript** as scripting languages (TypeScript is fully first-class in JSA with complete auto-completion)
- **`on(pattern, callback)`** for reactive state subscriptions
- **`schedule(cronExpression, callback)`** for time-based execution
- **`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`** — standard JS, no changes
- **`async/await` and Promises** — works the same
- **NPM packages** can be used (in JSA declare them via `@npm packagename` in the script header)
- **`await sleep(ms)`** — identical
- **Shared library scripts** — in ioBroker called "Global Scripts", in JSA via `@include file.js` in the header

---

## Concept Mapping

| ioBroker JS Adapter | JSA |
|---|---|
| `getState(id).val` | `ha.getStateValue('entity_id')` |
| `getState(id)` | `ha.getState('entity_id')` |
| `setState(id, val)` on own/virtual states | `ha.update(entityId, state)` |
| `setState(id, val)` on real device states | `ha.call('domain.service', { entity_id })` or `ha.entity(id).turn_on()` |
| `on(pattern, cb)` | `ha.on(pattern, cb)` |
| `schedule(cron, cb)` | `schedule(cron, cb)` |
| `createState(name, val, cfg)` | `await ha.register(entityId, config)` + `ha.update(...)` |
| `log.info(msg)` | `ha.log(msg)` |
| `log.debug(msg)` | `ha.debug(msg)` |
| `log.warn(msg)` | `ha.warn(msg)` |
| `log.error(msg)` | `ha.error(msg)` |
| `$('pattern')` | `ha.select('pattern')` |
| `request(url, cb)` / `httpGet(url, cb)` | `ha.http.get(url)` / `ha.http.post(url, body)` (+ `@permission network`) |
| `sendTo(adapter, cmd, data)` | `ha.call('domain.service', data)` |
| `sendTo('history.0', 'getHistory', { id, start, end })` | `await ha.getHistory(entityId, { start, end })` |
| Global Scripts | `@include file.js` in the script header |
| `existsState(id)` | `ha.entityExists('entity_id')` |
| `getRooms()` / `getFunctions()` | `ha.getAreas()` / `ha.getEntitiesInArea(areaId)` |
| `clearSchedule()` / stop script | `ha.stop()` / `ha.onStop(cb)` |
| Script name, icon, description | JSDoc header: `@name`, `@icon`, `@description` |
| Persistent variables | `ha.persistent(key, defaultValue)` |
| Script-to-script communication | `ha.store.set/get/on()` |

---

## What's Conceptually Different?

### Entities instead of data points

ioBroker data points follow the pattern `adapter.instance.channel.state` — e.g. `hm-rpc.0.ABC123.1.STATE`.

In HA, entities always use the format `domain.entity_name` — e.g. `binary_sensor.front_door` or `light.living_room`. The domain describes the type (light, switch, sensor, binary_sensor, climate, …).

### State changes — two cases

In ioBroker, `setState()` covers both cases: controlling real devices and updating your own virtual states.

In JSA these are two distinct operations:

**Own entities registered with `ha.register()`** → use `ha.update()`:
```js
ha.update('sensor.my_counter', 42.5);
```

**Real device entities** → call the appropriate HA service:

```js
ha.call('light.turn_on', { entity_id: 'light.living_room', brightness: 200 });
ha.call('switch.turn_off', { entity_id: 'switch.garden' });
ha.call('input_boolean.toggle', { entity_id: 'input_boolean.presence' });
```

Or with the fluent API:

```js
ha.entity('light.living_room').turn_on({ brightness: 200 });
```

### No ACK system

ioBroker distinguishes between commanded and confirmed state (ack: true/false). HA does not have this concept — an entity's state always reflects the actual/last known value.

### No `sendTo()`

In ioBroker, scripts communicate with other adapters via `sendTo()`. In HA, services take over that role (`ha.call()`). For script-to-script communication, use `ha.store`:

```js
// Script A writes
ha.store.set('myValue', 42);

// Script B listens
ha.store.on('myValue', (val) => ha.log(`New value: ${val}`));
```

### Everything under `ha.`

Almost all functions go through the global `ha` object. The only global exceptions are `schedule()` and `sleep()`.

### Custom entities via MQTT Discovery

`ha.register()` creates entities via MQTT Discovery — they are real HA entities, appear in the UI, and survive addon restarts.

---

## Code Comparisons

### React to a state change

**ioBroker:**
```js
on('hm-rpc.0.ABC123.1.STATE', function(obj) {
  if (obj.state.val === true) {
    setState('hm-rpc.0.DEF456.1.STATE', true);
  }
});
```

**JSA:**
```js
ha.on('binary_sensor.front_door', ({ state }) => {
  if (state === 'on') {
    ha.call('switch.turn_on', { entity_id: 'switch.outdoor_light' });
  }
});
```

---

### Create and update a custom entity

**ioBroker:**
```js
createState('javascript.0.myCounter', 0, { type: 'number', unit: 'kWh' });
setState('javascript.0.myCounter', 42.5);
```

**JSA:**
```js
await ha.register('sensor.my_counter', {
  name: 'My Counter',
  unit: 'kWh',
  device_class: 'energy',
  state_class: 'total_increasing',
});
ha.update('sensor.my_counter', 42.5);
```

---

### Time-based execution

**ioBroker:**
```js
schedule('0 7 * * 1-5', function() {
  log('Good morning!');
});

// ioBroker also supports object-style shorthand:
schedule({ hour: 7, minute: 0, dayOfWeek: [1, 2, 3, 4, 5] }, cb);
```

**JSA:**
```js
// Standard cron — identical to ioBroker
schedule('0 7 * * 1-5', () => {
  ha.log('Good morning!');
});

// Human-readable shorthands (new in JSA):
schedule('every weekday at 7:00', () => ha.log('Good morning!'));
schedule('every 15m', () => ha.log('Quarter-hour tick'));
schedule('every day at 8:30', cb);
schedule('every weekend at 10:00', cb);
schedule('every monday at 9:00', cb);
```

---

### HTTP request

**ioBroker:**
```js
// request / httpGet are built-in
httpGet('https://api.example.com/data', (err, res) => {
  log(res.data);
});
httpPost('https://api.example.com/submit', { key: 'value' }, (err, res) => {
  log(res.data);
});
```

**JSA:**
```js
/**
 * @permission network
 */

// Convenience wrapper — automatic JSON parsing, throws on non-2xx
const data = await ha.http.get('https://api.example.com/data');
ha.log(data.temperature);

await ha.http.post('https://api.example.com/submit', { key: 'value' });

// For advanced cases (streaming, interceptors) use fetch() directly:
const res = await fetch('https://api.example.com/data');
const data = await res.json();
```

---

### Persistent variable

**ioBroker:**
```js
// workaround: create a dedicated data point
createState('javascript.0.counter', 0);
// ... setState every time the value changes
```

**JSA:**
```js
const counter = ha.persistent('counter', 0);
counter.value++;  // auto-saved, survives restarts
```

---

### Check if an entity exists

**ioBroker:**
```js
if (existsState('hm-rpc.0.ABC123.1.STATE')) {
  const val = getState('hm-rpc.0.ABC123.1.STATE').val;
}
```

**JSA:**
```js
if (ha.entityExists('sensor.my_sensor')) {
  const val = ha.getStateValue('sensor.my_sensor');
}
```

---

### Query rooms / areas

**ioBroker:**
```js
// getRooms() returns the room groups an object belongs to
const rooms = getRooms();
// getMembers('enum.rooms.living_room') returns all member IDs
```

**JSA:**
```js
// List all areas
const areas = ha.getAreas();
// → [{ area_id: 'living_room', name: 'Living Room' }, ...]

// Get all entities in an area
const entities = ha.getEntitiesInArea('living_room');
// → ['light.floor_lamp', 'sensor.temperature', ...]

// Example: turn off all lights in every area
for (const area of ha.getAreas()) {
  for (const entityId of ha.getEntitiesInArea(area.area_id)) {
    if (entityId.startsWith('light.')) {
      ha.entity(entityId).turn_off();
    }
  }
}
```

---

### Read state history

**ioBroker:**
```js
sendTo('history.0', 'getHistory', {
  id: 'hm-rpc.0.ABC123.1.POWER',
  start: Date.now() - 24 * 3600 * 1000,
  end: Date.now(),
  count: 100,
}, (result) => {
  result.result.forEach(entry => log(`${entry.ts}: ${entry.val}`));
});
```

**JSA:**
```js
const history = await ha.getHistory('sensor.power_usage', {
  start: new Date(Date.now() - 24 * 60 * 60 * 1000),
  end: new Date(),
});
// → [{ state: '123.4', last_changed: '2026-06-14T10:00:00.000Z' }, ...]
history.forEach(entry => ha.log(`${entry.last_changed}: ${entry.state}`));
```

---

## Migration Tips

- **Find entity IDs**: In HA under *Settings → Devices & Services → Entities*, or in the Developer Tools
- **Discover services**: *Developer Tools → Services* lists all available services with their parameters
- **Use TypeScript**: JSA auto-generates types for all entities and services — auto-completion saves a lot of time
- **Add `@loglevel debug`** in the header to see all log output during development
- **Prefer `ha.waitFor()` over polling**: Instead of `setInterval()` to check states, use `await ha.waitFor(pattern)` — more efficient and readable
- **Use `ha.ask()`** for interactive notifications — users can respond directly from the HA app
