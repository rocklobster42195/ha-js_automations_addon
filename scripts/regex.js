/**
 * @name RegEx
 * @icon mdi:script-text
 * @description 
 * @area 
 * @label 
 */

ha.log("Automation 'RegEx' gestartet.");
sdfs
// Reagiere auf Zustandsänderungen (ioBroker-Style)
ha.on('light.*', (event) => {
     ha.log(`Licht ${event.entity_id} ist jetzt ${event.state}`);
});
