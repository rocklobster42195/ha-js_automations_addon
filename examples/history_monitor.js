/**
 * @name History Monitor
 * @icon mdi:chart-line
 * @description Demonstrates ha.history: monitors a numeric sensor for trend, rate of
 *              change, and daily statistics, then notifies when the trend flips.
 * @label Example
 */

// Replace with any numeric sensor in your HA instance.
const SENSOR = 'sensor.living_room_temperature';

// Minimum slope (units/hour) before the trend counts as moving.
const SENSITIVITY = 0.2;

let lastTrend = null;

async function analyze() {
    // 1. Trend direction over the last 30 minutes
    const trend = await ha.history.trend(SENSOR, { period: '30m', sensitivity: SENSITIVITY });

    // Notify when the trend flips direction
    if (lastTrend !== null && trend !== lastTrend && trend !== 'stable') {
        ha.notify(
            `${SENSOR} is now ${trend} (was ${lastTrend})`,
            { title: 'Temperature Trend', persistent: true }
        );
    }
    lastTrend = trend;

    // 2. Rate of change: degrees per minute
    const rate = await ha.history.derivative(SENSOR, { period: '30m', unit: 'minute' });

    // 3. Daily statistics
    const stats = await ha.history.stats(SENSOR, { period: '24h' });

    ha.log(
        `Trend: ${trend} | ` +
        `Rate: ${rate.toFixed(3)}°/min | ` +
        `24h avg: ${stats.mean.toFixed(1)}° | ` +
        `min: ${stats.min.toFixed(1)}° | max: ${stats.max.toFixed(1)}°`
    );

    // 4. Time since the sensor last changed state (useful for binary_sensor too)
    const ms = await ha.history.timeSince(SENSOR);
    ha.debug(`Last state change: ${Math.round(ms / 60000)} min ago`);
}

analyze();
schedule('*/5 * * * *', analyze);
