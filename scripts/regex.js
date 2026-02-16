/**
 * @name RegEx
 * @icon mdi:script-text
 * @description 
 * @area REG77
 * @label 
 */

ha.log("Automation 'RegEx' gestartet.");

// Reagiere auf Zustandsänderungen (ioBroker-Style)
ha.on('light.*', (event) => {
     ha.log(`Licht ${event.entity_id} ist jetzt ${event.state}`);
});
