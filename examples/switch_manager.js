/**
 * @name Switch Manager
 * @icon mdi:toggle-switch
 * @description Verarbeitet Tastendrücke und Schalteraktionen
 * @label System
 * @loglevel debug
 */

ha.log('Skript gestartet...');

const buttonMappings = {
    // OppleHZ
    'event.opple_hz_action': {
        'button_2_single': { entity: 'switch.3fachleiste_l1', service: 'toggle' },  
        'button_3_single': { entity: 'switch.schaltaktor_wandlampen_gerat_wandlampen', service: 'toggle' },
        'button_4_single': { entity: 'switch.3fachleiste_l3', service: 'toggle' },
        'button_6_single': { entity: 'light.deckenfluter_hz', service: 'toggle', data: { brightness_pct: 50 } }
    },
};

// Hilfsfunktion: Führt die Aktion aus, wenn sie im Mapping existiert
function executeAction(entityId, actionState) {
    const switchMapping = buttonMappings[entityId];
    if (!switchMapping) return;

    const actionDef = switchMapping[actionState];
    if (actionDef) {
        const targetEntity = actionDef.entity;
        const targetService = actionDef.service || 'toggle';
        const domain = targetEntity.split('.')[0];

        const serviceData = { 
            entity_id: targetEntity, 
            ...(actionDef.data || {}) 
        };

        ha.debug(`Aktion ausgeführt: ${entityId} -> ${actionState} => ${domain}.${targetService}`);
        ha.callService(domain, targetService, serviceData);
    }
}

const allTriggers = Object.keys(buttonMappings);
ha.on(allTriggers, (e) => {
    // FIX: Bei Event-Entitäten ist der State ein Zeitstempel. Die Aktion steht in attributes.event_type.
    // Wir prüfen event_type (HA Standard) und action (Z2M Legacy)
    const attrs = e.attributes || {};
    const action = attrs.event_type || attrs.action || e.state;
    
    ha.debug(`Event empfangen: ${e.entity_id} -> ${action}`);
    executeAction(e.entity_id, action);
});