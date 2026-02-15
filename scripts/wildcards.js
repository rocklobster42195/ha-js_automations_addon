/**
 * @name Wildcard Test
 * @icon mdi:lightbulb-multiple
 * @description Reagiert auf alle Lichter
 * @loglevel info
 */

ha.log("Beobachte alle Switches (switch.*)...");

ha.on('switch.*', (e) => {
    ha.log(`Switch-Event: ${e.entity_id} wechselte von [${e.old_state}] zu [${e.state}]`);
    
    // Teste hier auch den synchronen Cache-Zugriff:
    const friendlyName = e.attributes.friendly_name;
    ha.log(`   Anzeigename: ${friendlyName}`);
});