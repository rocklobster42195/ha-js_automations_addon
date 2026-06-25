/**
 * @name Bathroom Fan
 * @icon mdi:fan
 * @description Turns on the fan when humidity exceeds a threshold and keeps it running
 *              for a cooldown period after the humidity drops back — a classic debounce pattern.
 * @label Example
 */

const HUMIDITY_SENSOR = 'sensor.bathroom_humidity';
const FAN_SWITCH      = 'switch.bathroom_fan';
const THRESHOLD_ON    = 65; // % — turn fan on above this
const THRESHOLD_OFF   = 55; // % — start cooldown timer below this
const COOLDOWN_MS     = 5 * 60 * 1000; // 5 minutes after humidity drops

let cooldownTimer = null;

ha.on(HUMIDITY_SENSOR, (e) => {
    const hum = parseFloat(e.state);
    if (isNaN(hum)) return;

    if (hum > THRESHOLD_ON) {
        // Cancel any pending cooldown — humidity is still high
        if (cooldownTimer) {
            clearTimeout(cooldownTimer);
            cooldownTimer = null;
        }
        ha.entity(FAN_SWITCH).turn_on();
        ha.debug(`Humidity ${hum}% — fan on`);

    } else if (hum < THRESHOLD_OFF) {
        // Start cooldown only if the fan is currently on and no timer is pending
        if (!cooldownTimer && ha.getStateValue(FAN_SWITCH) === 'on') {
            ha.debug(`Humidity ${hum}% — starting ${COOLDOWN_MS / 60000} min cooldown`);
            cooldownTimer = setTimeout(() => {
                ha.entity(FAN_SWITCH).turn_off();
                ha.debug('Cooldown complete — fan off');
                cooldownTimer = null;
            }, COOLDOWN_MS);
        }
    }
});

ha.onStop(() => {
    if (cooldownTimer) clearTimeout(cooldownTimer);
});

ha.log('Bathroom Fan script started.');
