/**
 * @name Store & Logic Test
 * @icon mdi:memory
 */

async function run() {
    // 1. Wert setzen
    ha.store.set('test_status', 'aktiv');

    // 2. Auf Event warten
    ha.on('switch.*', (e) => {
        const currentMode = ha.store.val.test_status;

        if (currentMode === 'aktiv' && e.state === 'on') {
            ha.log(`🚀 Schalter ${e.entity_id} gedrückt! Modus: ${currentMode}`);
        }
    });
}

run();