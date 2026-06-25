/**
 * @name MQTT Bridge
 * @icon mdi:transit-connection-variant
 * @description Bridges raw MQTT topics from a custom/DIY device to HA entities.
 *              Subscribes to sensor topics and publishes commands back via a switch entity.
 * @label Example
 */

// Topic prefix of your device — adjust to match your MQTT setup.
const DEVICE_PREFIX = 'mydevice/sensor1';

// ─── Entities ─────────────────────────────────────────────────────────────────

ha.register('sensor.mydevice_temperature', {
    name: 'DIY Temperature',
    icon: 'mdi:thermometer',
    device_class: 'temperature',
    unit_of_measurement: '°C',
    state_class: 'measurement',
    expire_after: 120, // mark unavailable if no MQTT message for 2 min
});

ha.register('sensor.mydevice_humidity', {
    name: 'DIY Humidity',
    device_class: 'humidity',
    unit_of_measurement: '%',
    state_class: 'measurement',
    expire_after: 120,
});

ha.register('switch.mydevice_relay', {
    name: 'DIY Relay',
    icon: 'mdi:electric-switch',
    initial_state: 'OFF',
});

// ─── Subscribe ────────────────────────────────────────────────────────────────

// JSON payload: { "temperature": 21.5, "humidity": 55 }
ha.mqtt.subscribe(`${DEVICE_PREFIX}/state`, (topic, payload) => {
    ha.debug(`MQTT received on ${topic}:`, payload);

    if (payload.temperature !== undefined)
        ha.update('sensor.mydevice_temperature', payload.temperature);

    if (payload.humidity !== undefined)
        ha.update('sensor.mydevice_humidity', payload.humidity);
});

// ─── Publish commands ─────────────────────────────────────────────────────────

// Mirror switch state changes back to the device via MQTT
ha.on('switch.mydevice_relay', ({ state }) => {
    ha.mqtt.publish(`${DEVICE_PREFIX}/set`, { relay: state === 'ON' });
    ha.debug(`Published relay → ${state}`);
});

ha.log('MQTT Bridge started.');

ha.onStop(() => {
    ha.log('MQTT Bridge stopped — subscriptions cleaned up automatically.');
});
