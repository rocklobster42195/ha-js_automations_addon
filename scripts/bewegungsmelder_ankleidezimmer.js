/**
 * @name Bewegungsmelder Ankleidezimmer
 * @icon mdi:motion-sensor
 * @description Schaltet Licht bei Bewegung (wenn wach) und nach 2 Min Inaktivität aus.
 * @loglevel error
 * @area Schlafzimmer
 * @label 
 */

// Speicher für den Ausschalttimer
let offTimer = null;

const SENSOR = 'binary_sensor.bewegungsmelder_sz_occupancy';
const LIGHT = 'switch.schaltaktor_ankleide_ankleide';
const AWAKE_LOCK = 'input_boolean.awake';

ha.log("Skript 'Ankleidezimmer' aktiv. Überwache Sensor...");

ha.on(SENSOR, (e) => {
    
    // FALL 1: Bewegung erkannt
    if (e.state === 'on') {
        ha.log("🏃 Bewegung erkannt.");

        // Laufenden Ausschalttimer stoppen (entspricht mode: restart)
        if (offTimer) {
            clearTimeout(offTimer);
            offTimer = null;
            ha.debug("Ausschalttimer abgebrochen.");
        }

        // Bedingung prüfen: Nur einschalten, wenn wir wach sind
        // Wir nutzen den synchronen Cache (ha.states)
        if (ha.states[AWAKE_LOCK]?.state === 'on') {
            ha.callService('switch', 'turn_on', { entity_id: LIGHT });
        } else {
            ha.debug("Licht bleibt aus, da input_boolean.awake auf 'off' steht.");
        }
    }

    // FALL 2: Keine Bewegung mehr
    else if (e.state === 'off') {
        ha.log("⏳ Keine Bewegung mehr. Starte Timer (2 Min)...");

        // Sicherheitshalber alten Timer löschen
        if (offTimer) clearTimeout(offTimer);

        // Timer für 2 Minuten setzen (120.000 ms)
        offTimer = setTimeout(() => {
            ha.log("🌑 2 Minuten um. Schalte Licht aus.");
            ha.callService('switch', 'turn_off', { entity_id: LIGHT });
            offTimer = null;
        }, 120000);
    }
});

// Aufräumen, falls das Skript gestoppt wird (v2.15+ Feature-Vorbereitung)
ha.onStop(() => {
    if (offTimer) clearTimeout(offTimer);
});