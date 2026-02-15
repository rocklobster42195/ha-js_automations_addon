/**
 * @name Cache Check
 * @icon mdi:memory
 */

async function run() {
    ha.log("Prüfe synchronen Zustands-Cache...");
    
    // Wähle eine Entity-ID aus deinem System, die sicher existiert
    const testId = 'sun.sun'; 
    
    // KEIN await nötig!
    const data = ha.states[testId];
    
    if (data) {
        ha.log(`✅ Cache-Treffer für ${testId}!`);
        ha.log(`   Zustand: ${data.state}`);
        ha.log(`   Letzte Änderung: ${data.last_changed}`);
    } else {
        ha.error(`❌ ${testId} nicht im Cache gefunden!`);
    }
    
    ha.log("Test beendet.");
}

run();