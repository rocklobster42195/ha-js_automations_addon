/**
 * @name Template Sensor
 * @icon mdi:code-braces
 * @description Shows how to use ha.renderTemplate() to evaluate Jinja2 expressions
 *              inside a script — useful for logic that is easier to express in HA templates
 *              than in plain JavaScript (relative times, area helpers, etc.).
 * @label Example
 */

// ─── Entities ─────────────────────────────────────────────────────────────────

ha.register('sensor.lights_on_count', {
    name: 'Lights On',
    icon: 'mdi:lightbulb-group',
    unit_of_measurement: 'lights',
    state_class: 'measurement',
});

ha.register('sensor.sun_next_event_in', {
    name: 'Sun Next Event In',
    icon: 'mdi:weather-sunset',
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function update() {
    try {
        // 1. Count all lights that are currently on using a Jinja2 expression
        const lightsOn = await ha.renderTemplate(
            "{{ states.light | selectattr('state', 'eq', 'on') | list | count }}"
        );
        ha.update('sensor.lights_on_count', Number(lightsOn));

        // 2. Human-readable time until the next sun event (sunrise or sunset)
        const nextEvent = await ha.renderTemplate(`
            {% set next = state_attr('sun.sun', 'next_rising') %}
            {% set rising_in = (next | as_datetime - now()).total_seconds() %}
            {% if rising_in > 0 %}
              Sunrise in {{ relative_time(next | as_datetime) }}
            {% else %}
              Sunset in {{ relative_time(state_attr('sun.sun', 'next_setting') | as_datetime) }}
            {% endif %}
        `);
        ha.update('sensor.sun_next_event_in', nextEvent.trim());

        ha.debug(`Updated template sensors — ${lightsOn} lights on`);
    } catch (err) {
        ha.error(`Template render failed: ${err.message}`);
    }
}

update();
schedule('* * * * *', update); // update every minute
