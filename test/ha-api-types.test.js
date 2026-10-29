const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { checkScript } = require('../js_automations/core/mcp-script-check.js');

const TYPES_DIR = path.join(__dirname, '../js_automations/core/types');

/** Type-checks a snippet against the real bundled ha-api.d.ts (no generated typings, like a fresh install). */
function typeIssues(t, source, storageFiles = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-types-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(storageFiles)) writeFileSync(path.join(dir, name), content);
  const r = checkScript(source, 'case.ts', { storageDir: dir, typesDir: TYPES_DIR, targetDir: dir });
  assert.deepEqual(r.syntaxErrors, []);
  return r.typeIssues.map((i) => i.code + ' ' + i.message);
}

test('ha.persistent() with a primitive default accepts values of the same primitive type', (t) => {
  assert.deepEqual(
    typeIssues(
      t,
      [
        "const flag = ha.persistent('flag', false);",
        'flag.value = true;',
        "const counter = ha.persistent('counter', 0);",
        'counter.value++;',
        'counter.value = 42;',
        "const name = ha.persistent('name', '');",
        "name.value = 'abc';",
        "const explicit = ha.persistent<boolean>('explicit', false);",
        'explicit.value = true;',
      ].join('\n')
    ),
    []
  );
});

test('ha.persistent() still rejects a value of the wrong type', (t) => {
  const issues = typeIssues(t, ["const counter = ha.persistent('counter', 0);", "counter.value = 'text';"].join('\n'));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /TS2322.*string.*number/);

  const flag = typeIssues(t, ["const flag = ha.persistent('flag', false);", 'flag.value = 1;'].join('\n'));
  assert.equal(flag.length, 1);
  assert.match(flag[0], /TS2322.*number.*boolean/);
});

test('the object overload of ha.persistent() is unchanged', (t) => {
  assert.deepEqual(
    typeIssues(t, ["const o = ha.persistent('o', { a: 1, b: 'x' });", 'o.a = 2;', "o.b = 'y';"].join('\n')),
    []
  );
  const issues = typeIssues(t, ["const o = ha.persistent('o', { a: 1 });", "o.a = 'x';"].join('\n'));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /TS2322/);
});

test('the check uses the bundled ha-api.d.ts, not a stale copy in the storage folder', (t) => {
  // A copy from an old add-on version would make ha.persistent() fail or ha look like "any".
  const stale = '/// <reference path="./entities.d.ts" />\ndeclare const ha: { log(m: string): void };\n';
  const issues = typeIssues(t, "ha.persistent('a', 1);", { 'ha-api.d.ts': stale });
  assert.deepEqual(issues, []);
  const unknown = typeIssues(t, 'ha.definitelyNotAnApi();', { 'ha-api.d.ts': stale });
  assert.equal(unknown.length, 1, 'the real, current types are applied');
  assert.match(unknown[0], /definitelyNotAnApi/);
});

test('ha.states can be indexed with an entity ID held in a variable, known IDs stay precisely typed', (t) => {
  const entities = 'interface HAEntities { "light.kitchen": HAState<HAAttributes>; }';
  assert.deepEqual(
    typeIssues(
      t,
      [
        'const id: string = "sensor.anything";',
        "const lux = ha.states[id]?.state === 'on';",
        "const kitchen: string = ha.states['light.kitchen'].state;",
        'const cfg = { dark: "binary_sensor.dark" };',
        "if (ha.states[cfg.dark]?.state === 'off') ha.log('dark');",
      ].join('\n'),
      { 'entities.d.ts': entities }
    ),
    []
  );
});

test('a service field with a text selector accepts a number as well as a string', (t) => {
  const services = 'interface ServiceMap { number: { set_value: { value: string | number } } }';
  assert.deepEqual(
    typeIssues(
      t,
      [
        "ha.call('number.set_value', { entity_id: 'number.x', value: 42 });",
        "ha.call('number.set_value', { entity_id: 'number.x', value: '42' });",
      ].join('\n'),
      { 'services.d.ts': services }
    ),
    []
  );
});

test('ha.call() with an entity_id stays free of "union too complex" errors on an instance with many entities', (t) => {
  const domains = ['sensor', 'light', 'switch', 'number', 'input_number', 'cover'];
  let entities = 'interface HAEntities {\n';
  for (let i = 0; i < 1500; i++)
    entities += '  "' + domains[i % domains.length] + '.dev_' + i + '": HAState<HAAttributes>;\n';
  entities += '}\n';
  // One service that declares an entity_id field is enough: its entity_id type was intersected with the
  // generic one (two entity-ID unions) and TypeScript gave up on every ha.call() — real HA instances have
  // several such services (homeassistant.update_entity, ...).
  const services =
    'interface ServiceMap {\n  light: { turn_off: {}; turn_on: {} };\n  number: { set_value: { value: string | number } };\n' +
    '  homeassistant: { update_entity: { entity_id: any } };\n}\n';
  const issues = typeIssues(
    t,
    [
      "ha.call('light.turn_off', { entity_id: 'light.dev_1' });",
      'const id: string = "light.dev_2";',
      "ha.call('light.turn_off', { entity_id: id });",
      "ha.call('light.turn_off', { entity_id: ['light.dev_1', id] });",
      'const domain = id.split(".")[0];',
      "if (domain === 'number') ha.call(`${domain}.set_value`, { entity_id: id, value: 21 });",
    ].join('\n'),
    { 'entities.d.ts': entities, 'services.d.ts': services }
  );
  assert.deepEqual(issues, []);
});
