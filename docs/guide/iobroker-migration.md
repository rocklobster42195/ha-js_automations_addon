# Migrating from ioBroker

This guide helps you turn scripts from the ioBroker JavaScript adapter into JS Automations (JSA) scripts — by hand or with an AI assistant connected through the [MCP server](./mcp.md) (the prompt **Convert an ioBroker script** follows exactly this guide).

The code translates easily. What takes thought is the **data model**:

| ioBroker                                                                 | JS Automations / Home Assistant                                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Objects tree with adapter-specific state IDs (`hm-rpc.0.ABC123.STATE`)   | Entities with IDs like `light.bathroom` or `binary_sensor.bathroom_occupancy`                                        |
| Typed values (`true`, `21.5`)                                            | State is always a **string** (`'on'`, `'21.5'`); `ha.getStateValue()` converts to number/boolean                     |
| One state per datapoint, attributes as separate states                   | One entity with a state plus **attributes**                                                                          |
| `setState(id, value)` writes to a datapoint (and the adapter acts on it) | **Service calls** (`ha.call('light.turn_on', {...})`) act on devices; `ha.update()` is for entities your script owns |
| `ack` flag, `from`, object `ts`/`lc`                                     | No equivalent (see `last_changed` in `ha.states[id]`)                                                                |
| Script-wide variables live only while the script runs                    | Same, but `ha.persistent()` keeps values across restarts                                                             |

## Step 1: Map the IDs

List every ioBroker ID the script touches (in `on()`, `getState()`, `setState()`, `$()`…) and find the matching Home Assistant entity. This is the one step that cannot be automated safely — **do not guess IDs**.

- Zigbee2MQTT in ioBroker: `zigbee2mqtt.0.<ieee>.occupancy` → in HA the entity is named after the device: `binary_sensor.<device_name>_occupancy`.
- A Home Assistant entity that ioBroker only mirrored (e.g. `mqtt-client.0.<ha_topic>.input_boolean.awake.state`) is simply the original entity: `input_boolean.awake`.
- A group's scene button (`…group_2.scene_0`) may exist as a `scene.*` entity; if not, Zigbee2MQTT can recall it by MQTT (`ha.mqtt.publish('zigbee2mqtt/<group>/set', { scene_recall: 0 })`, needs `@permission mqtt` — check the Zigbee2MQTT documentation).
- Datapoints of `0_userdata.0.*` that scripts used as a message bus between each other become `ha.fireEvent()` / `ha.onEvent()` or `ha.store`.

Put **all mapped entity IDs, thresholds, times and texts into one typed config block** (see [Authoring Scripts](./authoring.md)) — then fixing a wrong mapping later is a one-line change in the Store Explorer, not a code edit. Check at start that every configured entity exists (`ha.entityExists()`) and log the missing ones.

## Step 2: Translate the API

### Triggers and time

| ioBroker                                                              | JSA                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `on('id', cb)`                                                        | `ha.on('entity_id', cb)`                                                                                                                               |
| `on({ id, change: 'ne' }, cb)`                                        | `ha.on(id, 'ne', cb)` — the filters **`ne`, `eq`, `gt`, `ge`, `lt`, `le`** have the same names; `ha.on(id, 'gt', 25, cb)` compares against a threshold |
| `on({ id, val: true }, cb)`                                           | `ha.on(id, 'eq', 'on', cb)` or check `e.state === 'on'` inside the callback                                                                            |
| `obj.state.val` / `obj.oldState.val` / `obj.id`                       | `e.state` / `e.old_state` (strings) / `e.entity_id`; attributes in `e.attributes`                                                                      |
| `on({ id: /regex/ })`, `$('channel[id=…]')`                           | `ha.on(/regex/, cb)`, `ha.on('light.kitchen_*', cb)`, `ha.select(...)`                                                                                 |
| `schedule('0 4 * * *', cb)`                                           | `schedule('0 4 * * *', cb)` — the same 5-field cron                                                                                                    |
| `schedule({ astro: 'sunset' }, cb)`, `getAstroDate()`, `isAstroDay()` | no built-in; use the `sun.sun` entity or the astro library (`examples/libraries/astro.js`, `@include`)                                                 |
| `compareTime('21:15', '23:59', 'between')`                            | a small helper (below) or `isTimeBetween()` from the astro library; both handle ranges across midnight                                                 |
| `formatDate(new Date(), 'WW', 'de')`                                  | plain JavaScript: `new Date().toLocaleDateString('de-DE', { weekday: 'long' })` or `getDay()` (0 = Sunday)                                             |
| `setTimeout` / `clearTimeout` / `setInterval`                         | the same globals; `sleep(ms)` / `await sleep(1000)` for sequences                                                                                      |
| `setStateDelayed()`                                                   | `setTimeout`                                                                                                                                           |
| `onStop(cb)`, `stopScript()`                                          | `ha.onStop(cb)`, `ha.stop()`                                                                                                                           |

### Reading and writing

| ioBroker                                             | JSA                                                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `getState(id).val`                                   | `ha.getStateValue('entity_id')` (number/boolean converted: `'on'` → `true`) or raw `ha.states['entity_id'].state`                              |
| attributes stored as separate states                 | `ha.getAttr('entity_id', 'brightness')`                                                                                                        |
| `existsState(id)`                                    | `ha.entityExists(id)`                                                                                                                          |
| `setState(deviceId, true/false)`                     | `ha.call('light.turn_on', { entity_id })`, `ha.call('switch.turn_off', …)`, `ha.call('scene.turn_on', …)`, or `ha.entity('light.x').turn_on()` |
| `setState(id, value)` on your own state              | `ha.register('sensor.my_state', {...})` once, then `ha.update('sensor.my_state', value)` — the entity then shows up in Home Assistant          |
| `createState()`, `0_userdata.0.*` for internal state | `ha.persistent('key', default)` (survives restarts) or a plain variable                                                                        |
| `sendTo('telegram.0', …)`, pushover, email           | `ha.notify(message, { target: 'notify.xyz' })`; `ha.ask()` for actionable notifications                                                        |
| TTS via a userdata state                             | `ha.call('tts.speak', { entity_id: 'tts.xyz', media_player_entity_id: 'media_player.xyz', message })`                                          |
| `httpGet()` / `httpPost()`, `request`                | `ha.http.get()` / `ha.http.post()` with `@permission network`; `@npm axios` for more                                                           |
| `exec()`                                             | `child_process` with `@permission exec`                                                                                                        |
| `readFile()` / `writeFile()`                         | `ha.fs.*` with `@permission fs`                                                                                                                |
| `getObject`, `getEnums`, rooms/functions             | Area, Label and Floor APIs                                                                                                                     |
| history adapter via `sendTo`                         | `ha.history.get()`, `ha.history.statistics()`                                                                                                  |
| `require('module')`                                  | `@npm module` in the header                                                                                                                    |
| `log(msg, 'info' \| 'warn' \| 'error' \| 'debug')`   | `ha.log` / `ha.warn` / `ha.error` / `ha.debug`; a `DEBUG` flag becomes `@loglevel debug`                                                       |

Everything is documented in the [API Reference](../API_REFERENCE.md).

### Things without a one-to-one equivalent

- The **`ack` flag** (commands vs. confirmations) — Home Assistant has no such distinction; drop `ack` conditions.
- **Adapter-specific datapoints** (`sendTo` to an adapter, objects another adapter created) — find the HA integration that offers the same, or call its service.
- **ioBroker Blockly / Node-RED style rules** — not covered; JS Automations has its own Blockly editor.
- **Virtual datapoints written by several scripts** — decide whether they should become a real entity (`ha.register`), a store value or an event.

## Step 3: Check the result

1. Read the script top to bottom for **semantics**, not syntax: values are strings, `'ne'` triggers on state changes (a changed attribute alone keeps the state, so it does not match), time ranges across midnight, and the unit of timeouts (ioBroker uses milliseconds).
2. Start the script and read the log: the start-up check lists every configured ID that does not exist in Home Assistant — fix those first.
3. Test with real events before relying on it — and keep the old script until you have seen it work.

## Worked example

An ioBroker script for a bathroom: motion switches on a light group (scene by brightness, time and an "awake" switch) and off again after a timeout; in the evening it reminds about dental care.

<details>
<summary>The ioBroker original (abridged)</summary>

```javascript
const illuminationThreshold = 150;
const motionTimeout = 420 * 1000;
var teethCareReminderSent = false;
var motionTimer = null;

on({ id: 'zigbee2mqtt.0.0xAAAA.occupancy', change: 'ne' }, function (obj) {
  const motionDetected = obj.state?.val === true;
  if (motionDetected) {
    if (motionTimer) clearTimeout(motionTimer);
    let illumination = getState('zigbee2mqtt.0.0xBBBB.illuminance').val;
    let awake = getState('mqtt-client.0.HA.input_boolean.awake.state').val;
    if (illumination < illuminationThreshold) {
      if (awake) {
        if (compareTime('05:00', '20:59', 'between')) setState('zigbee2mqtt.0.group_2.scene_0', true);
        else setState('zigbee2mqtt.0.group_2.scene_1', true);
      } else setState('zigbee2mqtt.0.group_2.scene_2', true);
    }
    if (compareTime('21:15', '23:59', 'between') && !teethCareReminderSent) {
      setState(
        '0_userdata.0.TTS.say',
        formatDate(new Date(), 'WW', 'de') === 'Mittwoch' ? 'Floss tonight.' : 'Wear the splint.'
      );
      teethCareReminderSent = true;
    }
  } else {
    if (motionTimer) clearTimeout(motionTimer);
    motionTimer = setTimeout(function () {
      setState('zigbee2mqtt.0.group_2.state', false);
    }, motionTimeout);
  }
});

schedule('0 4 * * *', function () {
  teethCareReminderSent = false;
});
```

</details>

The JSA version. The IDs are examples — replace them according to step 1. The ioBroker script checked "no new motion within the timeout" a second time inside the timer; since the timer is cancelled by every new motion, that check could never fail and is dropped.

```typescript
/**
 * @name Bathroom Motion Light
 * @icon mdi:motion-sensor
 * @description Motion turns the bathroom light on (scene depends on brightness, time and the awake switch) and off after a timeout; evening dental-care reminder.
 * @label Bathroom
 */

interface BathroomConfig {
  // Mapped Home Assistant entities (adjust to your installation)
  motionSensor: string;
  illuminanceSensor: string;
  awakeSwitch: string;
  lightGroup: string;
  sceneNormal: string;
  sceneDimmed: string;
  sceneTactical: string;
  ttsEntity: string;
  ttsPlayer: string;
  // Behavior
  illuminationThreshold: number; // lux; brighter than this keeps the light off
  motionTimeoutMin: number; // minutes without motion until the light goes off
  normalFrom: string; // "normal" scene between these times, "dimmed" otherwise
  normalTo: string;
  reminderFrom: string;
  reminderTo: string;
}

const DEFAULT_CONFIG: BathroomConfig = {
  motionSensor: 'binary_sensor.bathroom_motion_occupancy',
  illuminanceSensor: 'sensor.bathroom_motion_illuminance',
  awakeSwitch: 'input_boolean.awake',
  lightGroup: 'light.bathroom_group',
  sceneNormal: 'scene.bathroom_normal',
  sceneDimmed: 'scene.bathroom_dimmed',
  sceneTactical: 'scene.bathroom_tactical',
  ttsEntity: 'tts.home_assistant_cloud',
  ttsPlayer: 'media_player.bathroom_speaker',
  illuminationThreshold: 150,
  motionTimeoutMin: 7,
  normalFrom: '05:00',
  normalTo: '20:59',
  reminderFrom: '21:15',
  reminderTo: '23:59',
};

// Entity IDs, thresholds and times live in the store (Store Explorer → bathroom_motion_light_config).
// Changes to the entity IDs need a restart of the script.
const cfg = ha.persistent<BathroomConfig>('bathroom_motion_light_config', DEFAULT_CONFIG);
// The type argument matters: without it TypeScript infers the literal type `false` and `reminderSent.value = true` fails.
const reminderSent = ha.persistent<boolean>('bathroom_reminder_sent', false);

const missing = [
  cfg.motionSensor,
  cfg.illuminanceSensor,
  cfg.awakeSwitch,
  cfg.lightGroup,
  cfg.sceneNormal,
  cfg.sceneDimmed,
  cfg.sceneTactical,
].filter((id) => !ha.entityExists(id));
if (missing.length) ha.warn(`Entities not found in Home Assistant — adjust the config: ${missing.join(', ')}`);

let offTimer: ReturnType<typeof setTimeout> | null = null;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True if now is within [from, to]; ranges across midnight are handled. */
function isBetween(from: string, to: string): boolean {
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  const a = toMinutes(from);
  const b = toMinutes(to);
  return a <= b ? now >= a && now <= b : now >= a || now <= b;
}

function remind(): void {
  const wednesday = new Date().getDay() === 3;
  const message = wednesday ? 'Floss and tooth gel tonight.' : 'Remember the splint.';
  ha.call('tts.speak', { entity_id: cfg.ttsEntity, media_player_entity_id: cfg.ttsPlayer, message });
  reminderSent.value = true;
  ha.debug('Dental-care reminder sent.');
}

function onMotion(): void {
  if (offTimer) {
    clearTimeout(offTimer);
    offTimer = null;
  }
  const lux = Number(ha.getStateValue(cfg.illuminanceSensor));
  const awake = ha.getStateValue(cfg.awakeSwitch) === true; // 'on' → true

  if (lux < cfg.illuminationThreshold) {
    const scene = awake
      ? isBetween(cfg.normalFrom, cfg.normalTo)
        ? cfg.sceneNormal
        : cfg.sceneDimmed
      : cfg.sceneTactical;
    ha.call('scene.turn_on', { entity_id: scene });
    ha.debug(`Scene ${scene}`);
  } else {
    ha.debug('Too bright — light stays off.');
  }

  if (isBetween(cfg.reminderFrom, cfg.reminderTo) && !reminderSent.value) remind();
}

function onNoMotion(): void {
  if (offTimer) clearTimeout(offTimer);
  offTimer = setTimeout(() => {
    offTimer = null;
    ha.call('light.turn_off', { entity_id: cfg.lightGroup });
    ha.debug(`Light off after ${cfg.motionTimeoutMin} min without motion.`);
  }, cfg.motionTimeoutMin * 60_000);
}

// 'ne' = only when the state value actually changed (like ioBroker's change: 'ne')
ha.on(cfg.motionSensor, 'ne', (e) => (e.state === 'on' ? onMotion() : onNoMotion()));

schedule('0 4 * * *', () => {
  reminderSent.value = false;
});
```

What changed besides syntax: the booleans became `'on'`/`'off'`, the timeout is a configurable number of minutes, `teethCareReminderSent` survives a restart, the 04:00 reset keeps its cron, `DEBUG` logging is the script's log level (`@loglevel debug`), and the German weekday text compare became a number (`getDay() === 3`).
