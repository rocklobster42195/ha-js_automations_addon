/**
 * @name Battery Scanner
 * @icon mdi:battery-alert
 * @description Alerts when any battery sensor drops below the configured threshold,
 *              reports LOWBAT, or becomes unavailable.
 * @label Example
 */

const scriptName = ha.getHeader('name');
ha.log(`'${scriptName}' started.`);

// Threshold below which a battery is considered low (%)
const LOW_BATTERY_THRESHOLD = 25;

// Regex matches common HA battery sensor naming conventions
const batteryRegex = /^(sensor|binary_sensor)\..*_batter(y|ie)(_level|ladung)?$/i;

function sendAlerts(title, message) {
    ha.notify(message, { title, persistent: true });
    ha.notify(message, { title });
}

async function scanBatteries() {
    const lowDevices = ha.select(batteryRegex)
        .where(s => {
            const val = parseFloat(s.state);
            const isLowLevel  = !isNaN(val) && val < LOW_BATTERY_THRESHOLD;
            const isUnavailable = s.state === 'unavailable';
            const isLowBat    = s.state?.toUpperCase() === 'LOWBAT';
            return isLowLevel || isUnavailable || isLowBat;
        })
        .toArray();

    if (lowDevices.length > 0) {
        const names = lowDevices.map(s => {
            const name = s.attributes.friendly_name || s.entity_id;
            return `${name} (${s.state})`;
        }).join(', ');
        ha.warn(`Battery issues: ${names}`);
        sendAlerts('Battery Alert', `The following devices need attention: ${names}`);
    } else {
        const total = ha.select(batteryRegex).toArray().length;
        ha.log(`All ${total} batteries are healthy.`);
    }
}

// Run once on startup, then daily at 18:00
scanBatteries();
schedule('0 18 * * *', scanBatteries);

// Immediate alert when a battery entity becomes unavailable
ha.on(batteryRegex, (event) => {
    if (event.state === 'unavailable' && event.old_state !== 'unavailable') {
        const name = event.attributes.friendly_name || event.entity_id;
        ha.warn(`Battery entity went unavailable: ${event.entity_id}`);
        sendAlerts('Battery Unavailable', `${name} is no longer reachable`);
    }
});
