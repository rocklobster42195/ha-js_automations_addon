/**
 * @name Mein Schalter-Link
 * @icon mdi:link-variant
 */

ha.log("Verbindung aktiv. Schalte Licht aus...");

// 1. Sofort-Aktion
ha.callService('switch', 'turn_off', { entity_id: 'switch.3fachleiste_l1' });

// 2. Reagieren auf einen anderen Schalter (Sync)
ha.onStateChange('switch.3fachleiste_l2', (newState) => {
    ha.log(`Anderer Schalter ist jetzt: ${newState.state}`);
    
    // Schalte unsere Dose synchron mit
    const action = newState.state === 'on' ? 'turn_on' : 'turn_off';
    ha.callService('switch', action, { entity_id: 'switch.3fachleiste_l1' });
});