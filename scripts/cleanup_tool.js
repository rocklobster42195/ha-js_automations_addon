/**
 * @name Cleanup Tool
 * @icon mdi:trash-can
 * @description Löscht verwaiste Entitäten der JS Automations Integration.
 */

const IDS_TO_DELETE = [
    'switch.js_automations_testskript',
    'switch.js_automations_integration_check',
    'sensor.test'          
];

async function run() {
    ha.log("🧹 Starte Aufräumen...");

    for (const uid of IDS_TO_DELETE) {
        try {
            // Wir rufen den Service der Integration auf
            await ha.callService('js_automations', 'remove_entity', { 
                unique_id: uid 
            });
            
            ha.log(`✅ Löschbefehl für '${uid}' gesendet.`);
        } catch (e) {
            // Fehler sind normal, wenn die ID gar nicht existiert
            ha.warn(`⚠️ Konnte '${uid}' nicht löschen (evtl. existiert sie nicht): ${e.message}`);
        }
    }
    
    ha.log("🏁 Fertig. Bitte prüfe in Home Assistant, ob die Entitäten weg sind.");
    ha.log("Hinweis: Leere Geräte verschwinden oft erst nach einem HA-Neustart.");
}

run();
