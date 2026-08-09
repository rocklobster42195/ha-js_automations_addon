/**
 * @name Sun Watch Demo
 * @icon mdi:weather-sunset
 * @description Demonstrates ha.watch() using the sun.sun entity, which is always
 *              available on every HA instance — no configuration needed to try it.
 * @label Example
 */

ha.log(`'${ha.getHeader('name')}' started.`);

ha.watch('Sun state', () => ha.getState('sun.sun'));
ha.watch('Above horizon', () => ha.getStateValue('sun.sun') === 'above_horizon');
ha.watch('Next setting', () => ha.getAttr('sun.sun', 'next_setting'));
ha.watch('Next rising', () => ha.getAttr('sun.sun', 'next_rising'));
