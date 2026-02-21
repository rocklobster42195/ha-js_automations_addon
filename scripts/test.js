/**
 * @name Test
 * @icon mdi:robot-excited
 * @description Intellisense-Test
 * @area REG77
 * @label spielwiese
 * @loglevel info
 */

ha.callService('switch', 'turn_on', { entity_id: 'switch.3fachleiste_l1' });

ha.log("Message");