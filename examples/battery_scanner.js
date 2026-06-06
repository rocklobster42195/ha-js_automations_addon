/**
 * @name Battery Scanner
 * @icon mdi:battery-alert
 * @description Alerts if any battery level drops below 25%, is LOWBAT or unavailable
 * @label Alarm
 */
const scriptName = ha.getHeader('name');
ha.log(`'${scriptName}' started...`);

const batteryRegex = /^(sensor|binary_sensor)\..*_batter(y|ie)(_level|ladung)?$/i;

async function scanBatteries() {

    const lowDevices = ha.select(batteryRegex)
        .where(s => {
            const stateValue = s.state;
            const val = parseFloat(stateValue);

            // 1. Check for numeric value below 25
            const isLowLevel = !isNaN(val) && val < 25;
            
            // 2. Check for "unavailable" state
            const isUnavailable = stateValue === 'unavailable';
            
            // 3. Check for "LOWBAT" state (case-insensitive)
            const isLowBat = stateValue && stateValue.toUpperCase() === 'LOWBAT';

            // Return true if ANY of the conditions are met
            return isLowLevel || isUnavailable || isLowBat;
        })
        .toArray();

    if (lowDevices.length > 0) {
        // Create list of names with their current state for better info
        const names = lowDevices.map(s => {
            const name = s.attributes.friendly_name || s.entity_id;
            return `${name} (${s.state})`;
        }).join(', ');

        ha.warn(`Battery issues detected: ${names}`);

        // Send a persistent notification to the Home Assistant UI
        ha.call('notify.persistent_notification', {
            title: 'Battery Alert',
            message: `The following devices need attention: ${names}`
        });

        // Send a mobile push notification
        ha.notify(`The following devices need attention: ${names}`, {
            title: 'Battery Alert',
            target: 'notify.mobile_app_pixel_7a',
        });
    } else {
        const totalChecked = ha.select(batteryRegex).toArray().length;
        ha.log(`All ${totalChecked} batteries are healthy and connected.`);
    }
}

// Run once on startup to catch already-problematic states
scanBatteries();

// Check everyday at 18:00h
schedule('0 18 * * *', scanBatteries);

// Immediately alert when any battery entity goes unavailable
ha.on(batteryRegex, (event) => {
    if (event.state === 'unavailable' && event.old_state !== 'unavailable') {
        const name = event.attributes.friendly_name || event.entity_id;
        ha.warn(`Battery entity went unavailable: ${event.entity_id}`);
        ha.notify(`${name} is no longer reachable`, {
            title: 'Battery Unavailable',
            target: 'notify.mobile_app_pixel_7a',
        });
        ha.call('notify.persistent_notification', {
            title: 'Battery Unavailable',
            message: `${name} is no longer reachable`
        });
    }
});