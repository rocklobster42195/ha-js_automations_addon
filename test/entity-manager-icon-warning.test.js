const { test } = require('node:test');
const assert = require('node:assert/strict');
const EntityManager = require('../js_automations/core/entity-manager');

// EntityManager's constructor starts a file watcher and wires up half the kernel; the method under test only needs
// its log sink and the set of entities it has already mentioned.
function make() {
  const em = Object.create(EntityManager.prototype);
  const logs = [];
  em.warnedEntities = new Set();
  em.workerManager = { emit: (_event, data) => logs.push(data) };
  return { em, logs };
}

test('a custom icon next to a device_class is only a hint, not a warning', () => {
  const { em, logs } = make();
  em._warnIconConflict('sensor.garmin_last_activity', 'timestamp');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'info', 'every start of a healthy script would otherwise fill the log with warnings');
  assert.equal(logs[0].source, 'System');
  assert.match(logs[0].message, /sensor\.garmin_last_activity/);
  assert.match(logs[0].message, /device_class 'timestamp'/);
  assert.ok(!logs[0].message.includes('⚠️'), 'no warning sign for a hint');
});

test('the hint appears once per entity, not on every publish', () => {
  const { em, logs } = make();
  em._warnIconConflict('sensor.a', 'duration');
  em._warnIconConflict('sensor.a', 'duration');
  em._warnIconConflict('sensor.b', 'duration');
  assert.equal(logs.length, 2);
});
