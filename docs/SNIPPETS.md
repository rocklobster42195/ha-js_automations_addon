# ✂️ Code Snippets

Here you will find helpful snippets for all supported platforms. Just copy them into your script and adapt them to your needs! 🚀

---

## 🌡️ Sensor
Perfect for measuring values like temperature, humidity, or power consumption.

```javascript
ha.register('sensor.jsa_living_room_temp', {
    name: 'Living Room Temperature',
    icon: 'mdi:thermometer',
    unit_of_measurement: '°C',
    state_class: 'measurement',  // Important for long-term statistics
    device_class: 'temperature'
});

// Update value
ha.updateState('sensor.jsa_living_room_temp', 22.5);
```

## 💡 Binary Sensor
For yes/no states like motion, door open/closed, or presence.

```javascript
ha.register('binary_sensor.motion_hallway', {
    name: 'Hallway Motion',
    type: 'binary_sensor',
    device_class: 'motion', // motion, door, window, presence...
    icon: 'mdi:run'
});

// Set state (true = on/detected, false = off/clear)
ha.updateState('binary_sensor.motion_hallway', true);
```

## 🔌 Switch
A classic toggle switch. Remember to listen for events!

```javascript
ha.register('switch.my_switch', {
    name: 'Coffee Machine',
    type: 'switch',
    icon: 'mdi:coffee'
});

// Set state
ha.updateState('switch.my_switch', 'on');
```

## 🔘 Button
A momentary button to trigger actions.

```javascript
ha.register('button.restart', {
    name: 'Server Restart',
    type: 'button',
    icon: 'mdi:restart'
});

// "Press" button (updates timestamp)
ha.updateState('button.restart', new Date().toISOString());
```

## 🔢 Number
A slider or input field for numeric values.

```javascript
ha.register('number.target_value', {
    name: 'Target Temperature',
    type: 'number',
    min: 0,
    max: 100,
    step: 0.5,
    mode: 'slider', // or 'box'
    unit_of_measurement: '%'
});

ha.updateState('number.target_value', 42);
```

## 📝 Text
A text input field.

```javascript
ha.register('text.note', {
    name: 'Important Note',
    type: 'text',
    min: 0,
    max: 255,
    mode: 'text' // or 'password'
});

ha.updateState('text.note', 'Buy milk!');
```

## 📋 Select
A dropdown menu with predefined options.

```javascript
ha.register('select.mode', {
    name: 'Operation Mode',
    options: ['Eco', 'Standard', 'Turbo'],
    icon: 'mdi:menu',
});

ha.updateState('select.mode', 'Turbo');
```

## ✅ Todo
A to-do list. Items are managed as attributes.

```javascript
ha.register('todo.shopping_list', {
    name: 'Shopping List',
    type: 'todo',
    attributes: {
        items: [
            { uid: '1', summary: 'Milk', status: 'needs_action' },
            { uid: '2', summary: 'Coffee', status: 'completed' }
        ]
    }
});
```

## ❄️ Climate
A thermostat or air conditioner. Complex but powerful!

```javascript
ha.register('climate.jsa_living_room', {
    name: 'Basement Heating',
    min_temp: 7,
    max_temp: 30,
    hvac_modes: ['off', 'heat', 'auto'],
    preset_modes: ['eco', 'comfort', 'boost'],
    unit_of_measurement: '°C',
    attributes: {
        current_temperature: 21.5,
        temperature: 22, // Target temperature
        preset_mode: 'comfort'
    }
});

// Set mode and temperature
ha.updateState('climate.jsa_living_room', 'heat', { temperature: 22.5 });
```

## 💡 Light
Light control with brightness and color.

```javascript
ha.register('light.living_room_led', {
    name: 'LED Strip',
    type: 'light',
    supported_color_modes: ['rgb', 'brightness'],
    attributes: {
        brightness: 255,
        rgb_color: [255, 0, 0], // Red
        effect_list: ['Rainbow', 'Pulse']
    }
});

// Turn on
ha.updateState('light.living_room_led', 'on', { brightness: 128 });
```

## 🪟 Cover
For blinds, shutters, or garage doors.

```javascript
ha.register('cover.garage', {
    name: 'Garage Door',
    type: 'cover',
    device_class: 'garage',
    attributes: {
        current_position: 0, // 0 = Closed, 100 = Open
        current_tilt_position: 50
    }
});

ha.updateState('cover.garage', 'closed');
```

## 💨 Fan
Fan control with speed percentages.

```javascript
ha.register('fan.ceiling_fan', {
    name: 'Ceiling Fan',
    type: 'fan',
    attributes: {
        percentage: 33, // Speed in %
        preset_modes: ['auto', 'smart'],
        oscillating: false
    }
});

ha.updateState('fan.ceiling_fan', 'on');
```

## 📺 Media Player
Control music or videos.

```javascript
ha.register('media_player.radio', {
    name: 'Kitchen Radio',
    type: 'media_player',
    device_class: 'speaker',
    attributes: {
        volume_level: 0.5,
        is_volume_muted: false,
        source: 'Radio Rock',
        source_list: ['Radio Rock', 'Electronic FM'],
        media_title: 'Highway to Hell',
        media_artist: 'AC/DC'
    }
});

ha.updateState('media_player.radio', 'playing');
```

## 🔒 Lock
A smart door lock.

```javascript
ha.register('lock.front_door', {
    name: 'Front Door',
    type: 'lock',
    attributes: {
        code_format: '^\d{4}$', // 4-digit PIN
        changed_by: 'User',
        supports_open: true
    }
});

ha.updateState('lock.front_door', 'locked');
```

## 🤖 Vacuum
A robotic vacuum cleaner.

```javascript
ha.register('vacuum.robi', {
    name: 'Robot Vacuum',
    type: 'vacuum',
    attributes: {
        battery_level: 85,
        fan_speed: 'standard',
        fan_speed_list: ['silent', 'standard', 'turbo']
    }
});

ha.updateState('vacuum.robi', 'docked'); // cleaning, docked, paused, idle...
```

## 🌦️ Weather
Display custom weather data.

```javascript
ha.register('weather.garden', {
    name: 'Garden Weather Station',
    type: 'weather',
    attributes: {
        temperature: 18.5,
        humidity: 60,
        pressure: 1013,
        wind_speed: 15,
        wind_bearing: 270,
        condition: 'partlycloudy', // sunny, rainy, cloudy...
        forecast_daily: [
            { datetime: '2023-10-28', condition: 'sunny', temperature: 20, templow: 10 }
        ]
    }
});
```

## 🔄 Update
Indicates if a firmware update is available.

```javascript
ha.register('update.printer', {
    name: 'Printer Firmware',
    type: 'update',
    attributes: {
        installed_version: '1.0.0',
        latest_version: '1.2.0',
        release_summary: 'Bugfixes and performance improvements',
        release_url: 'https://example.com/release',
        in_progress: false
    }
});

// State is the installed version (or null)
ha.updateState('update.printer', '1.0.0');
```

## ⚡ Event
Fire events without a persistent state (e.g., doorbell).

```javascript
ha.register('event.doorbell', {
    name: 'Doorbell',
    type: 'event',
    attributes: {
        event_types: ['press', 'double_press']
    }
});

// Fire event
ha.updateState('event.doorbell', 'press');
```