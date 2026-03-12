# ✂️ Code Snippets

Hier findest du hilfreiche Schnipsel für alle unterstützten Plattformen. Kopiere sie einfach in dein Skript und passe sie an! 🚀

---

## 🌡️ Sensor
Perfekt für Messwerte wie Temperatur, Luftfeuchtigkeit oder Stromverbrauch.

```javascript
ha.register('sensor.jsa_wohnzimmer_temp', {
    name: 'Wohnzimmer Temperatur',
    icon: 'mdi:thermometer',
    unit_of_measurement: '°C',
    state_class: 'measurement',  // Wichtig für Statistiken
    device_class: 'temperature'
    // device: 'script' // optional: 'script' (default), 'system' or 'none'
});

// Wert aktualisieren
ha.updateState('sensor.jsa_wohnzimmer_temp', 22.5);
```

## 💡 Binary Sensor
Für Ja/Nein Zustände wie Bewegung, Tür offen/zu oder Anwesenheit.

```javascript
ha.register('binary_sensor.bewegung_flur', {
    name: 'Bewegungsmelder Flur',
    type: 'binary_sensor',
    device_class: 'motion', // motion, door, window, presence...
    icon: 'mdi:run'
});

// Zustand setzen (true = an/erkannt, false = aus/ruhe)
ha.updateState('binary_sensor.bewegung_flur', true);
```

## 🔌 Switch
Ein klassischer Schalter. Denke daran, auf Events zu hören!

```javascript
ha.register('switch.mein_schalter', {
    name: 'Kaffeemaschine',
    type: 'switch',
    icon: 'mdi:coffee'
});

// Status setzen
ha.updateState('switch.mein_schalter', 'on');
```

## 🔘 Button
Ein Taster, um Aktionen auszulösen.

```javascript
ha.register('button.neustart', {
    name: 'Server Neustart',
    type: 'button',
    icon: 'mdi:restart'
});

// Button "drücken" (Zeitstempel aktualisieren)
ha.updateState('button.neustart', new Date().toISOString());
```

## 🔢 Number
Ein Schieberegler oder Eingabefeld für Zahlen.

```javascript
ha.register('number.zielwert', {
    name: 'Zieltemperatur',
    type: 'number',
    min: 0,
    max: 100,
    step: 0.5,
    mode: 'slider', // oder 'box'
    unit_of_measurement: '%'
});

ha.updateState('number.zielwert', 42);
```

## 📝 Text
Ein Textfeld für Eingaben.

```javascript
ha.register('text.notiz', {
    name: 'Wichtige Notiz',
    type: 'text',
    min: 0,
    max: 255,
    mode: 'text' // oder 'password'
});

ha.updateState('text.notiz', 'Milch kaufen!');
```

## 📋 Select
Ein Dropdown-Menü mit festen Optionen.

```javascript
ha.register('select.modus', {
    name: 'Betriebsmodus',
    options: ['Eco', 'Standard', 'Turbo'],
    icon: 'mdi:menu',
});

ha.updateState('select.modus', 'Turbo');
```

## ✅ Todo
Eine To-Do Liste. Items werden als Attribute verwaltet.

```javascript
ha.register('todo.einkaufsliste', {
    name: 'Einkaufsliste',
    type: 'todo',
    attributes: {
        items: [
            { uid: '1', summary: 'Milch', status: 'needs_action' },
            { uid: '2', summary: 'Kaffee', status: 'completed' }
        ]
    }
});
```

## ❄️ Climate
Ein Thermostat oder eine Klimaanlage. Etwas komplexer, aber mächtig!

```javascript
ha.register('climate.jsa_wohnzimmer', {
    name: 'Heizung Keller',
    min_temp: 7,
    max_temp: 30,
    hvac_modes: ['off', 'heat', 'auto'],
    preset_modes: ['eco', 'comfort', 'boost'],
    unit_of_measurement: '°C',
    attributes: {
        current_temperature: 21.5,
        temperature: 22, // Zieltemperatur
        preset_mode: 'comfort'
    }
});

// Modus und Temperatur setzen
ha.updateState('climate.jsa_wohnzimmer', 'heat', { temperature: 22.5 });
```

## 💡 Light
Lichtsteuerung mit Helligkeit und Farbe.

```javascript
ha.register('light.wohnzimmer_led', {
    name: 'LED Streifen',
    type: 'light',
    supported_color_modes: ['rgb', 'brightness'],
    attributes: {
        brightness: 255,
        rgb_color: [255, 0, 0], // Rot
        effect_list: ['Rainbow', 'Pulse']
    }
});

// Einschalten
ha.updateState('light.wohnzimmer_led', 'on', { brightness: 128 });
```

## 🪟 Cover
Für Rollläden, Jalousien oder Garagentore.

```javascript
ha.register('cover.garage', {
    name: 'Garagentor',
    type: 'cover',
    device_class: 'garage',
    attributes: {
        current_position: 0, // 0 = Geschlossen, 100 = Offen
        current_tilt_position: 50
    }
});

ha.updateState('cover.garage', 'closed');
```

## 💨 Fan
Ventilatorsteuerung mit Geschwindigkeitsstufen.

```javascript
ha.register('fan.deckenventilator', {
    name: 'Deckenventilator',
    type: 'fan',
    attributes: {
        percentage: 33, // Geschwindigkeit in %
        preset_modes: ['auto', 'smart'],
        oscillating: false
    }
});

ha.updateState('fan.deckenventilator', 'on');
```

## 📺 Media Player
Steuere Musik oder Videos.

```javascript
ha.register('media_player.radio', {
    name: 'Küchenradio',
    type: 'media_player',
    device_class: 'speaker',
    attributes: {
        volume_level: 0.5,
        is_volume_muted: false,
        source: 'Radio Bob',
        source_list: ['Radio Bob', 'Sunshine Live'],
        media_title: 'Highway to Hell',
        media_artist: 'AC/DC'
    }
});

ha.updateState('media_player.radio', 'playing');
```

## 🔒 Lock
Ein smartes Türschloss.

```javascript
ha.register('lock.haustuer', {
    name: 'Haustür',
    type: 'lock',
    attributes: {
        code_format: '^\d{4}$', // 4-stelliger PIN
        changed_by: 'Benutzer',
        supports_open: true
    }
});

ha.updateState('lock.haustuer', 'locked');
```

## 🤖 Vacuum
Ein Saugroboter.

```javascript
ha.register('vacuum.robi', {
    name: 'Saugroboter',
    type: 'vacuum',
    attributes: {
        battery_level: 85,
        fan_speed: 'standard',
        fan_speed_list: ['silent', 'standard', 'turbo']
    }
});

ha.updateState('vacuum.robi', 'docked'); // cleaning, docked, paused, idle...
```

## 🚨 Siren
Eine Sirene mit verschiedenen Tönen.

```javascript
ha.register('siren.alarm', {
    name: 'Innensirene',
    type: 'siren',
    attributes: {
        available_tones: ['fire', 'intrusion', 'beep']
    }
});

ha.updateState('siren.alarm', 'on');
```

## 📷 Camera
Eine Kamera, die Bilder oder Streams anzeigt.

```javascript
ha.register('camera.eingang', {
    name: 'Eingangskamera',
    type: 'camera',
    attributes: {
        stream_source: 'rtsp://192.168.1.100/stream',
        // Oder Base64 Bilddaten:
        // image_data_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    }
});

ha.updateState('camera.eingang', 'idle');
```

## 🛡️ Alarm Control Panel
Eine Alarmanlage mit Code-Schutz.

```javascript
ha.register('alarm_control_panel.haus', {
    name: 'Alarmanlage',
    type: 'alarm_control_panel',
    attributes: {
        code_format: 'number', // oder 'text'
        code_arm_required: true,
        changed_by: 'Keypad'
    }
});

ha.updateState('alarm_control_panel.haus', 'disarmed'); // armed_home, armed_away, triggered...
```

## 📍 Device Tracker
Verfolge den Standort von Personen oder Geräten.

```javascript
ha.register('device_tracker.mein_handy', {
    name: 'Mein Handy',
    type: 'device_tracker',
    attributes: {
        source_type: 'gps',
        latitude: 52.5200,
        longitude: 13.4050,
        gps_accuracy: 20,
        battery_level: 65
    }
});

ha.updateState('device_tracker.mein_handy', 'home'); // oder 'not_home'
```

## 🌦️ Weather
Eigene Wetterdaten anzeigen.

```javascript
ha.register('weather.garten', {
    name: 'Wetterstation Garten',
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

## 📅 Date
Ein Datumsauswahl-Feld.

```javascript
ha.register('date.urlaub_start', {
    name: 'Urlaubsbeginn',
    type: 'date',
    icon: 'mdi:calendar'
});

ha.updateState('date.urlaub_start', '2023-12-24');
```

## 🕒 Time
Ein Zeitauswahl-Feld.

```javascript
ha.register('time.wecker', {
    name: 'Weckzeit',
    type: 'time',
    icon: 'mdi:clock'
});

ha.updateState('time.wecker', '07:30:00');
```

## 📆 Datetime
Datum und Zeit kombiniert.

```javascript
ha.register('datetime.termin', {
    name: 'Nächster Termin',
    type: 'datetime',
    icon: 'mdi:calendar-clock'
});

ha.updateState('datetime.termin', '2023-12-24T18:00:00');
```

## 🔄 Update
Zeigt an, ob ein Firmware-Update verfügbar ist.

```javascript
ha.register('update.drucker', {
    name: 'Drucker Firmware',
    type: 'update',
    attributes: {
        installed_version: '1.0.0',
        latest_version: '1.2.0',
        release_summary: 'Bugfixes und Performance-Verbesserungen',
        release_url: 'https://example.com/release',
        in_progress: false
    }
});

// Status ist die installierte Version (oder null)
ha.updateState('update.drucker', '1.0.0');
```

## ⚡ Event
Feuere Ereignisse ohne dauerhaften Zustand (z.B. Türklingel).

```javascript
ha.register('event.tuerklingel', {
    name: 'Türklingel',
    type: 'event',
    attributes: {
        event_types: ['press', 'double_press']
    }
});

// Event feuern
ha.updateState('event.tuerklingel', 'press');
```

## 📱 Remote
Eine Fernbedienung.

```javascript
ha.register('remote.tv', {
    name: 'Fernseher Remote',
    type: 'remote',
    attributes: {
        current_activity: 'Netflix',
        activity_list: ['TV', 'Netflix', 'YouTube']
    }
});

ha.updateState('remote.tv', 'on');
```

## 💧 Humidifier
Luftbefeuchter steuern.

```javascript
ha.register('humidifier.schlafzimmer', {
    name: 'Luftbefeuchter',
    type: 'humidifier',
    device_class: 'humidifier', // oder 'dehumidifier'
    attributes: {
        humidity: 45, // Zielwert
        mode: 'auto',
        available_modes: ['auto', 'sleep', 'baby'],
        min_humidity: 30,
        max_humidity: 80
    }
});

ha.updateState('humidifier.schlafzimmer', 'on');
```

## 🚰 Valve
Ein Ventil für Wasser oder Gas.

```javascript
ha.register('valve.bewaesserung', {
    name: 'Gartenbewässerung',
    type: 'valve',
    device_class: 'water', // water, gas
    reports_position: true, // Aktiviert Positions-Slider
    optimistic: true, // UI aktualisiert sofort
    attributes: {
        current_position: 0 // 0 = zu, 100 = offen
    }
});

ha.updateState('valve.bewaesserung', 'closed'); // open, closed, opening, closing
```