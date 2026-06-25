/**
 * @name Switch Manager
 * @icon mdi:toggle-switch
 * @description Routes button/remote event actions to target entities.
 *              Supports toggle, turn_on, turn_off, and any other HA service.
 * @label Example
 * @loglevel debug
 */

ha.log('Script started.');

// Map event entity IDs to their action → target definitions.
// Replace the entity IDs and actions with your actual device values.
// Action strings depend on the integration (Z2M, deCONZ, ZHA, etc.).
const buttonMappings = {
    'event.living_room_remote': {
        'button_1_single': { entity: 'light.living_room',  service: 'toggle' },
        'button_2_single': { entity: 'switch.fan',         service: 'toggle' },
        'button_3_single': { entity: 'light.kitchen',      service: 'toggle' },
        'button_4_single': { entity: 'light.floor_lamp',   service: 'turn_on', data: { brightness_pct: 50 } },
    },
    'event.bedroom_switch': {
        'single':  { entity: 'light.bedroom', service: 'toggle' },
        'double':  { entity: 'light.bedroom', service: 'turn_on', data: { brightness_pct: 10 } },
        'long':    { entity: 'light.bedroom', service: 'turn_off' },
    },
};

function executeAction(entityId, actionState) {
    const mapping = buttonMappings[entityId];
    if (!mapping) return;

    const def = mapping[actionState];
    if (!def) return;

    const domain = def.entity.split('.')[0];
    const serviceData = { entity_id: def.entity, ...(def.data || {}) };

    ha.debug(`${entityId} → ${actionState} → ${domain}.${def.service}`);
    ha.callService(domain, def.service || 'toggle', serviceData);
}

ha.on(Object.keys(buttonMappings), (e) => {
    // Event entities: action is in attributes (event_type for HA standard, action for Z2M legacy)
    const action = e.attributes?.event_type || e.attributes?.action || e.state;
    ha.debug(`Event received: ${e.entity_id} → ${action}`);
    executeAction(e.entity_id, action);
});
