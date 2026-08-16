/**
 * @name Hello World
 * @icon mdi:hand-wave
 * @description Minimal example showing the core JSA lifecycle: a metadata header,
 *              a native sensor created with ha.register(), and ha.on() reacting to
 *              a state change to keep that sensor up to date.
 * @label Example
 * @expose switch
 */

const SOURCE = 'sun.sun'; // built into every HA instance, safe to reference here

ha.register('sensor.hello_world_greeting', {
  name: 'Hello World Greeting',
  icon: 'mdi:hand-wave',
});

function greet() {
  const isDaytime = ha.getStateValue(SOURCE) === 'above_horizon';
  ha.update('sensor.hello_world_greeting', isDaytime ? 'Good day!' : 'Good night!');
}

greet(); // set the initial value immediately, don't wait for the next sun change
ha.on(SOURCE, greet);

ha.log('Hello World script started.');
