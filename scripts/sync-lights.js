/**
 * @name Licht-Sync (L2 -> L3)
 * @icon mdi:sync
 * @description Wenn L2 geschaltet wird, zieht L3 nach.
 */

ha.log("🔗 Synchronisation gestartet: L3 folgt L2");

// Entity IDs (bitte kurz in deinem HA prüfen, ob die Namen exakt stimmen!)
const MASTER = 'switch.3fachleiste_l2';
const SLAVE = 'switch.3fachleiste_l1';

// 1. Der Event-Listener
ha.onStateChange(MASTER, (newState) => {
    const status = newState.state; // 'on' oder 'off'
    
    ha.log(`Master (L2) ist jetzt: ${status} -> Schalte Slave (L1)...`);

    // 2. Die Aktion
    if (status === 'on') {
        ha.callService('switch', 'turn_on', { entity_id: SLAVE });
    } else {
        ha.callService('switch', 'turn_off', { entity_id: SLAVE });
    }
});