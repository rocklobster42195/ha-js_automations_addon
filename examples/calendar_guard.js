/**
 * @name Calendar Guard
 * @icon mdi:calendar-check
 * @description Reads a HA calendar and registers a binary sensor that is ON during
 *              vacation/holiday periods. Other automations can use this sensor as a condition.
 * @label Example
 */

// Replace with your calendar entity ID.
const CALENDAR = 'calendar.family';

// Keywords in the event summary that mark a vacation/holiday (case-insensitive).
const KEYWORDS = ['urlaub', 'vacation', 'ferien', 'holiday'];

ha.register('binary_sensor.vacation_mode', {
    name: 'Vacation Mode',
    icon: 'mdi:airplane',
    device_class: 'presence',
    initial_state: 'OFF',
});

async function checkCalendar() {
    const now  = new Date();
    const week = new Date(now.getTime() + 7 * 86400_000);

    try {
        const events = await ha.getCalendarEvents(CALENDAR, { start: now, end: week });

        const active = events.some(e => {
            const summary = (e.summary || '').toLowerCase();
            const inProgress = new Date(e.start) <= now && new Date(e.end) >= now;
            const isVacation = KEYWORDS.some(k => summary.includes(k));
            return inProgress && isVacation;
        });

        ha.update('binary_sensor.vacation_mode', active ? 'ON' : 'OFF');
        ha.log(`Vacation mode: ${active ? 'ON' : 'OFF'}`);
    } catch (err) {
        ha.error(`Calendar fetch failed: ${err.message}`);
    }
}

checkCalendar();
schedule('0 * * * *', checkCalendar); // re-check every hour
