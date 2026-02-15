/**
 * @name Wildcard Test
 * @icon mdi:lightbulb-multiple
 * @description Reagiert auf alle Lichter
 */

ha.log("Beobachte alle Lichter (light.*)...");

ha.on('light.*', (e) => {
    ha.log(`💡 Licht-Event: ${e.entity_id} wechselte von [${e.old_state}] zu [${e.state}]`);
    
    // Teste hier auch den synchronen Cache-Zugriff:
    const friendlyName = e.attributes.friendly_name;
    ha.log(`   Anzeigename: ${friendlyName}`);
});