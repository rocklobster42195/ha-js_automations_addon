# Native Entities (`ha.register`)

`ha.register()` creates a real Home Assistant entity via MQTT Discovery. It appears in HA's entity registry like any other entity and survives HA reboots — but it becomes **unavailable** while its script isn't running. The last state is retained by the MQTT broker and restored automatically the moment the script starts again.

```javascript
ha.register('sensor.outside_temp', {
  name: 'Outside Temperature',
  icon: 'mdi:thermometer',
  unit: '°C',
  device_class: 'temperature',
  state_class: 'measurement',
  initial_state: 0,
});

ha.register('select.heating_mode', {
  name: 'Heating Mode',
  options: ['Off', 'Auto', 'Eco', 'Guest'],
});
```

Supported domains: `sensor`, `binary_sensor`, `switch`, `select`, `number`, `text`, `button`. Domains that need specialized MQTT fields (`light`, `climate`, `cover`, ...) aren't supported — control those through `ha.call()`/`ha.entity()` on entities that already exist instead.

Update the state at any time with `ha.update()`:

```javascript
ha.update('sensor.outside_temp', 21.5, { icon: 'mdi:sun-thermometer' });
```

## Device grouping

Give several entities a shared device card in the HA UI with the `device` option:

```javascript
ha.register('sensor.weather_temp', {
  name: 'Temperature',
  unit: '°C',
  device_class: 'temperature',
  device: { name: 'Weather Station', manufacturer: 'AcmeCorp', model: 'v2' },
});

ha.register('sensor.weather_humidity', {
  name: 'Humidity',
  unit: '%',
  device_class: 'humidity',
  device: { name: 'Weather Station' }, // same name → same device
});
```

Supported device fields: `name`, `manufacturer`, `model`, `sw_version`, `hw_version`, `configuration_url`. `device: true` uses the script's own name as the device name with default metadata.

> **Entity ID note:** once `device` is set, HA derives the entity_id from the device + entity name slugs, ignoring the exact string you passed to `ha.register()`. Omit `device` when you need an exact, predictable entity_id.

> **Mark-and-Sweep:** entities a script stops registering are automatically removed from Home Assistant the next time that script runs — no manual cleanup needed for entities you've simply deleted from the code.

## Staying available while stopped

By default, an entity goes `unavailable` in HA the instant its script stops. For values that are still meaningful after the script exits — a last measured temperature, a counter — set `stale_ok: true` so the entity's availability is tied only to the add-on's own status, not the individual script's:

```javascript
ha.register('sensor.outside_temp', {
  name: 'Outside Temperature',
  unit: '°C',
  stale_ok: true,
  expire_after: 3600, // fall back to unavailable after 1h without an update anyway
});
```

Combine with `expire_after` if a stale value should still eventually be flagged unavailable on its own.

## Removing entities at runtime (`ha.unregister`)

Mark-and-Sweep only runs when a script restarts. A script managing a _changing_ set of dynamically-created entities — one per discovered device, say — needs to remove a single one immediately when that item disappears:

```javascript
ha.unregister('sensor.device_123_battery');
```

This tears down the entity's MQTT Discovery config and clears its retained state without restarting the script. Entities declared via the `@expose` header tag are managed automatically and can't be unregistered this way.

## Reading state back

Alongside `ha.register()`/`ha.update()`, the usual read APIs work on any entity — yours or HA's own: `ha.states`, `ha.getState()`, `ha.getAttr()`, `ha.getStateValue()`, `ha.entityExists()`. See the [API Reference](../API_REFERENCE.md) for the full list, and [`ha.entity()`](../API_REFERENCE.md#10-haentity--fluent-entity-api) for a typed, chainable way to call services on one entity at a time.
