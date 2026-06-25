/**
 * @name Sequential Logic
 * @icon mdi:playlist-play
 * @description Demonstrates ha.waitFor() and the fluent entity API for sequential,
 *              event-driven logic — open the garage, wait until it is fully open,
 *              then ramp the light: full brightness for 2 s, then dim to 40%.
 * @label Example
 * @expose button
 */

async function openGarage() {
    ha.log('Opening garage…');

    // 1. Trigger the cover
    await ha.entity('cover.garage_door').open_cover();

    // 2. Wait until HA confirms it is open (timeout: 30 s)
    try {
        await ha.waitFor('cover.garage_door', 'eq', 'open', { timeout: 30_000 });
    } catch {
        ha.error('Garage did not open within 30 s — aborting.');
        ha.notify('Garage door failed to open!', { title: 'Garage', persistent: true });
        return;
    }

    ha.log('Garage is open — activating light sequence.');

    // 3. Fluent chain: full brightness → wait 2 s → dim to 40%
    await ha.entity('light.garage_light')
        .turn_on({ brightness: 255 })
        .then(l => l.wait(2000))
        .then(l => l.turn_on({ brightness: 100 }));

    ha.log('Sequence complete.');
}

openGarage();
