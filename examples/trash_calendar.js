/**
 * @name Trash Calendar
 * @icon mdi:trash-can
 * @description Reads a public iCal calendar (e.g. from your municipality) and registers
 *              a sensor showing tomorrow's trash collection type. Sends a reminder at 18:00.
 * @label Example
 * @npm node-ical
 */

const ical = require('node-ical');

// Public iCal URL of your waste collection calendar
const CALENDAR_URL = 'https://your-municipality.example/trash.ics';

ha.register('sensor.trash_tomorrow', {
    name: 'Trash Collection Tomorrow',
    icon: 'mdi:delete-alert',
});

async function checkTrash() {
    try {
        const data = await ical.async.fromURL(CALENDAR_URL);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        let type = 'None';
        for (const key in data) {
            const event = data[key];
            if (event.type !== 'VEVENT') continue;
            const eventDay = new Date(event.start);
            eventDay.setHours(0, 0, 0, 0);
            if (eventDay.getTime() === tomorrow.getTime()) {
                type = event.summary;
                break;
            }
        }

        ha.update('sensor.trash_tomorrow', type);
        ha.log(`Trash tomorrow: ${type}`);

        if (type !== 'None') {
            ha.notify(`Reminder: ${type} collection tomorrow.`, {
                title: '🗑️ Trash Reminder',
            });
        }
    } catch (err) {
        ha.error(`Calendar fetch failed: ${err.message}`);
    }
}

checkTrash();
schedule('0 18 * * *', checkTrash); // check daily at 18:00
