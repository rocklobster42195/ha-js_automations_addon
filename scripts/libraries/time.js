/**
 * @name Time & Astro Helpers
 * @description Functions for time-based and astronomical calculations.
 * @icon mdi:clock
 * @npm suncalc
 */

const suncalc = require('suncalc');

/**
 * Checks if the current day is a workday.
 * It checks for weekends and can be extended with a holiday sensor.
 * For a real implementation, use a workday sensor from Home Assistant.
 * @param {string} [workday_sensor='binary_sensor.workday_sensor'] The entity_id of a workday sensor.
 * @returns {boolean} True if it's a workday.
 */
function isWorkday(workday_sensor = 'binary_sensor.workday_sensor') {
    // 1. Check HA sensor first (most reliable)
    if (ha.states[workday_sensor]) {
        return ha.states[workday_sensor].state === 'on';
    }

    // 2. Fallback: Simple weekend check
    const day = new Date().getDay(); // 0=Sunday, 6=Saturday
    if (day === 0 || day === 6) {
        return false;
    }

    // Default assumption if no sensor is found
    return true;
}

/**
 * Checks if the current time is between a start and end time string.
 * Handles overnight ranges (e.g., "22:00" to "06:00").
 * @param {string} start Time string "HH:MM".
 * @param {string} end Time string "HH:MM".
 * @returns {boolean} True if the current time is within the range.
 */
function getTimeRange(start, end) {
    const now = new Date();
    const startTime = new Date();
    const endTime = new Date();

    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);

    startTime.setHours(startHour, startMinute, 0, 0);
    endTime.setHours(endHour, endMinute, 0, 0);

    // Handle overnight case (e.g., 22:00 - 06:00)
    if (endTime < startTime) {
        // If current time is after start OR before end, we are in the range.
        return now >= startTime || now < endTime;
    } else {
        // Normal day case
        return now >= startTime && now < endTime;
    }
}

/**
 * Returns sun position data for Home Assistant's location.
 * Requires HA to have latitude/longitude configured.
 * @returns {{azimuth: number, altitude: number, isUp: boolean}|null} Sun position object or null if location is missing.
 */
function sunPos() {
    // We need location from Home Assistant config
    const lat = ha.states['zone.home']?.attributes.latitude;
    const lon = ha.states['zone.home']?.attributes.longitude;

    if (!lat || !lon) {
        ha.warn("Cannot calculate sun position: Home location (zone.home) not found in HA.");
        return null;
    }

    const position = suncalc.getPosition(new Date(), lat, lon);
    
    return {
        // Azimuth in degrees (0° = North, 180° = South)
        azimuth: position.azimuth * 180 / Math.PI + 180,
        // Altitude in degrees (0° = horizon)
        altitude: position.altitude * 180 / Math.PI,
        isUp: position.altitude > 0
    };
}