/**
 * @name Formatting Helpers
 * @icon mdi:ruler
 * @description A collection of useful formatting and conversion functions.
 * @area 
 * @label 
 * @loglevel info
 */

/**
 * Converts a duration in seconds into a human-readable string like "2h 15min".
 * @param {number} totalSeconds The duration in seconds.
 * @returns {string} The formatted duration string.
 */
function formatDuration(totalSeconds) {
    if (totalSeconds < 0) return "0s";
    if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}min`;
    
    return result.trim();
}

/**
 * Translates a lux value into descriptive levels of darkness.
 * @param {number} luxValue The current illuminance in lux.
 * @returns {'bright'|'daylight'|'twilight'|'dark'|'pitch_black'} A string describing the light level.
 */
function luxToDarkness(luxValue) {
    if (luxValue > 1000) return 'bright';      // Direct sunlight
    if (luxValue > 100) return 'daylight';     // Overcast day
    if (luxValue > 10) return 'twilight';      // Civil twilight
    if (luxValue > 1) return 'dark';           // Deep twilight / Full moon
    return 'pitch_black';                      // No light
}

/**
 * Rounds a number to a specified number of decimal places.
 * @param {number} value The number to round.
 * @param {number} [precision=0] The number of decimal places.
 * @returns {number} The rounded number.
 */
function round(value, precision = 0) {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
}