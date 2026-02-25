/**
 * @name Format Library Demo
 * @icon mdi:ruler
 * @description Zeigt, wie man die format.js Library nutzt.
 * @area 
 * @label Spielwiese
 * @loglevel info
 * @include formatting_helpers.js
 */

ha.log("Start Format Demo...");

// 1. Dauer formatieren
// formatDuration() kommt direkt aus der Library
const seconds = 8105; // 2h 15min 5s
const durationStr = formatDuration(seconds);
ha.log(`Dauer (${seconds}s): ${durationStr}`); 

// 2. Lux Wert interpretieren
const currentLux = 45;
const darkness = luxToDarkness(currentLux);
ha.log(`Helligkeit (${currentLux} lux): ${darkness}`); 

// 3. Runden
const pi = 3.14159265;
const roundedPi = round(pi, 2);
ha.log(`Pi gerundet: ${roundedPi}`); 

ha.log("Demo beendet.");