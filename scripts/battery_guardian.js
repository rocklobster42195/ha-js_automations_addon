/**
 * @name Battery Guardian
 * @icon mdi:battery-alert
 * @description Alerts if any battery level drops below 15%
 * @area Badezimmer
 * @label Alarme
 * @loglevel debug
 */

async function scanBatteries() {
    ha.debug("Starting battery scan...");
    
    // Select all sensors ending with '_battery'
    const lowDevices = ha.select('sensor.*_battery')
        .where(s => {
            const val = parseFloat(s.state);
            return val < 15 && s.state !== 'unavailable' && s.state !== 'unknown';
        })
        .toArray();

    if (lowDevices.length > 0) {
        const names = lowDevices.map(s => s.attributes.friendly_name || s.entity_id).join(', ');
        ha.warn(`Low battery levels detected: ${names}`);
        
        // Send a persistent notification to the Home Assistant UI
        ha.callService('notify', 'persistent_notification', {
            title: 'Low Battery Alert',
            message: `The following devices need new batteries: ${names}`
        });
    } else {
        ha.debug(`All ${ha.select('sensor.*_battery').toArray().length} batteries are within the healthy range.`);
    }
}

// Check everyday at 18:00h
schedule('0 18 * * *', scanBatteries);

// Run once on startup
scanBatteries();