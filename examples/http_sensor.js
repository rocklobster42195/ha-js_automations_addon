/**
 * @name Open-Meteo Weather
 * @icon mdi:weather-partly-cloudy
 * @description Fetches current weather from the Open-Meteo API (free, no API key required)
 *              and registers temperature, humidity, and wind speed as HA sensors.
 * @label Example
 * @permission network
 */

// Coordinates are read from the HA home zone — edit the fallback if needed.
const zone = ha.getState('zone.home');
const LAT  = zone?.attributes.latitude  ?? 52.52;
const LON  = zone?.attributes.longitude ?? 13.40;

const API_URL =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`;

ha.register('sensor.open_meteo_temperature', {
    name: 'Outside Temperature',
    icon: 'mdi:thermometer',
    device_class: 'temperature',
    unit_of_measurement: '°C',
    state_class: 'measurement',
    suggested_display_precision: 1,
});

ha.register('sensor.open_meteo_humidity', {
    name: 'Outside Humidity',
    icon: 'mdi:water-percent',
    device_class: 'humidity',
    unit_of_measurement: '%',
    state_class: 'measurement',
});

ha.register('sensor.open_meteo_wind_speed', {
    name: 'Wind Speed',
    icon: 'mdi:weather-windy',
    unit_of_measurement: 'km/h',
    state_class: 'measurement',
});

async function fetchWeather() {
    try {
        const data = await ha.http.get(API_URL);
        const c = data.current;

        ha.update('sensor.open_meteo_temperature', c.temperature_2m);
        ha.update('sensor.open_meteo_humidity',    c.relative_humidity_2m);
        ha.update('sensor.open_meteo_wind_speed',  c.wind_speed_10m);

        ha.debug(`Weather updated — ${c.temperature_2m}°C, ${c.relative_humidity_2m}% RH, ${c.wind_speed_10m} km/h`);
    } catch (err) {
        ha.error(`Open-Meteo fetch failed: ${err.message}`);
    }
}

fetchWeather();
schedule('*/15 * * * *', fetchWeather); // refresh every 15 minutes
