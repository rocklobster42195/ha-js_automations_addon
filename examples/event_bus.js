/**
 * @name Event Bus
 * @icon mdi:transit-connection
 * @description Demonstrates ha.onEvent() and ha.fireEvent() for reacting to HA bus
 *              events and for script-to-script communication via custom events.
 *
 *              Part 1 — Listening: reacts to NFC tag scans and automation triggers.
 *              Part 2 — Broadcasting: fires a custom event other scripts can subscribe to.
 *
 *              To receive the custom event in another script:
 *              ha.onEvent('jsa_scene_activated', e => ha.log(e.data.scene));
 * @label Example
 */

// ─── Part 1: Listen to HA bus events ──────────────────────────────────────────

// React to NFC tag scans (requires HA mobile companion app or NFC integration)
ha.onEvent('tag_scanned', (event) => {
    const tagId = event.data.tag_id;
    ha.log(`NFC tag scanned: ${tagId}`);

    // Map tag IDs to scene names and broadcast them
    const sceneMap = {
        'aabbccdd-1234': 'movie',
        'eeff0011-5678': 'dinner',
        '99887766-abcd': 'goodnight',
    };

    const scene = sceneMap[tagId];
    if (scene) {
        activateScene(scene);
    } else {
        ha.warn(`Unknown tag: ${tagId}`);
    }
});

// Listen to HA automation triggers (useful for cross-script coordination)
ha.onEvent('automation_triggered', (event) => {
    ha.debug(`Automation fired: ${event.data.name}`);
});

// ─── Part 2: Fire custom events (script-to-script communication) ───────────────

function activateScene(scene) {
    ha.log(`Activating scene: ${scene}`);

    // Apply the scene in HA
    ha.call('scene.turn_on', { entity_id: `scene.${scene}` });

    // Broadcast a custom event so other scripts can react without tight coupling.
    // Any script can listen with: ha.onEvent('jsa_scene_activated', handler)
    ha.fireEvent('jsa_scene_activated', { scene, activatedAt: new Date().toISOString() });
}

// ─── Example: trigger a scene from a button entity ────────────────────────────

ha.register('button.activate_movie_scene', {
    name: 'Movie Scene',
    icon: 'mdi:movie-open',
});

ha.on('button.activate_movie_scene', () => activateScene('movie'));

ha.log('Event Bus example started.');
