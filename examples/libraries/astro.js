/**
 * @name Astro & Time Library
 * @description Helper für Sonnenstände, Zeitberechnungen und Arbeitstage.
 * @npm suncalc
 */
const SunCalc = require('suncalc');

// Wir holen die Koordinaten einmalig beim Laden der Library
const zone = ha.states['zone.home'];
const LAT = zone ? zone.attributes.latitude : 52.52; // Fallback Berlin
const LON = zone ? zone.attributes.longitude : 13.40;

module.exports = {
    isDark,
    isTimeBetween,
    getEventTime,
    isWorkday,
    getSunPosition
};

/**
 * Prüft, ob wir uns zwischen zwei Zeitpunkten befinden.
 * Versteht Uhrzeiten ("23:00") und Events ("sunset", "sunrise + 30m").
 * Behandelt automatisch Tageswechsel (z.B. 22:00 bis 06:00).
 */
function isTimeBetween(startStr, endStr) {
    const now = new Date();
    const start = parseTime(startStr, now);
    const end = parseTime(endStr, now);

    if (start < end) {
        // Normaler Bereich: 08:00 - 20:00
        return now >= start && now <= end;
    } else {
        // Über Mitternacht: 22:00 - 06:00
        return now >= start || now <= end;
    }
}

/**
 * Einfacher Helper: Ist es dunkel?
 * Nutzt 'nauticalDusk' (wenn Konturen schwer erkennbar werden) als Standard.
 */
function isDark() {
    return isTimeBetween('nauticalDusk', 'nauticalDawn');
}

/**
 * Gibt das Date-Objekt für einen Zeit-String zurück (z.B. "sunset + 10m").
 * Wrapper für internen Parser.
 */
function getEventTime(str) {
    return parseTime(str, new Date());
}

/**
 * Prüft, ob heute ein Arbeitstag ist.
 * Prüft primär einen Sensor, Fallback auf Wochenende (Sa/So).
 * @param {string} [workday_sensor='binary_sensor.workday_sensor'] Entity ID des Sensors.
 */
function isWorkday(workday_sensor = 'binary_sensor.workday_sensor') {
    // 1. HA Sensor prüfen (zuverlässigster Weg)
    if (ha.states[workday_sensor]) {
        return ha.states[workday_sensor].state === 'on';
    }

    // 2. Fallback: Simpler Wochenend-Check
    const day = new Date().getDay(); // 0=Sonntag, 6=Samstag
    if (day === 0 || day === 6) {
        return false;
    }

    return true;
}

/**
 * Gibt die aktuelle Sonnenposition basierend auf den Home Assistant Koordinaten zurück.
 * @returns {{azimuth: number, altitude: number, isUp: boolean}}
 */
function getSunPosition() {
    const position = SunCalc.getPosition(new Date(), LAT, LON);
    return {
        azimuth: position.azimuth * 180 / Math.PI + 180, // 0° = Nord, 180° = Süd
        altitude: position.altitude * 180 / Math.PI,      // 0° = Horizont
        isUp: position.altitude > 0
    };
}

// --- Interne Helper ---

function parseTime(str, now) {
    // 1. Einfache Uhrzeit "HH:MM"
    if (str.match(/^\d{1,2}:\d{2}$/)) {
        const [h, m] = str.split(':');
        const d = new Date(now);
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        return d;
    }

    // 2. Astro-Logik: "sunset", "dusk + 30m", "sunrise - 1h"
    // Berechne Sonnenzeiten für HEUTE
    const times = SunCalc.getTimes(now, LAT, LON);
    
    // Regex für "event" + optionaler "operator" + "offset" + "unit"
    // Matches: "sunset", "sunset + 30m", "sunrise - 1h"
    const regex = /^([a-zA-Z]+)(?:\s*([\+\-])\s*(\d+)([mh]))?$/;
    const match = str.trim().match(regex);

    if (!match) {
        ha.error(`AstroLib: Unbekanntes Zeitformat '${str}'`);
        return now;
    }

    const eventName = match[1]; // z.B. "sunset"
    let time = times[eventName];

    // Fallback Mapping für SunCalc Namen
    if (!time) {
        // Mapping HA Begriffe -> SunCalc Begriffe
        const map = {
            'dusk': 'nauticalDusk',
            'dawn': 'nauticalDawn',
            'noon': 'solarNoon'
        };
        time = times[map[eventName] || eventName];
    }

    if (!time) {
        ha.error(`AstroLib: Event '${eventName}' existiert nicht in SunCalc.`);
        return now;
    }

    // Offset berechnen
    if (match[2] && match[3]) {
        const operator = match[2]; // + oder -
        const value = parseInt(match[3]);
        const unit = match[4]; // m oder h
        
        let offsetMs = value * 60 * 1000; // Minuten in ms
        if (unit === 'h') offsetMs *= 60; // Stunden

        if (operator === '+') time = new Date(time.getTime() + offsetMs);
        else time = new Date(time.getTime() - offsetMs);
    }

    return time;
}
