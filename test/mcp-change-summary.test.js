const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeChange } = require('../js_automations/core/mcp-change-summary');

const V1 = `/**\n * @name Garage Watch\n * @permission network\n */\nconst CONFIG = { minutes: 5 };\nfunction checkDoor() {\n  ha.log('x');\n}\n`;

test('a new file is named by its header title and size', () => {
  assert.equal(describeChange('garage.ts', null, V1), 'create garage.ts "Garage Watch" (8 lines)');
  assert.equal(describeChange('x.js', null, "ha.log('a');\n\nha.log('b');\n"), 'create x.js (2 lines)');
});

test('an update counts added and removed lines and names what it touches', () => {
  const v2 = V1.replace('minutes: 5', 'minutes: 10') + 'function warnLater() {\n  ha.notify("x");\n}\n';
  const text = describeChange('garage.ts', V1, v2);
  assert.match(text, /^update garage\.ts: \+4\/-1 lines/);
  assert.match(text, /touches CONFIG, warnLater/);
});

test('header tags and ha.* registrations show up as what was touched', () => {
  const v2 = V1.replace(' * @permission network', ' * @permission network\n * @expose switch');
  assert.match(describeChange('garage.ts', V1, v2), /touches @expose/);
  const v3 = V1 + "ha.on('light.a', () => {});\n";
  assert.match(describeChange('garage.ts', V1, v3), /touches ha\.on/);
});

test('moved lines and blank lines are not changes', () => {
  const moved = V1.split('\n').reverse().join('\n') + '\n\n';
  assert.equal(describeChange('garage.ts', V1, moved), 'update garage.ts (no content change)');
});

test('never just "update <file>": there is always a count or a note', () => {
  for (const after of [V1 + '// c\n', V1.replace('5', '6'), V1 + '\n', 'ha.log(1);\n']) {
    const text = describeChange('a.ts', V1, after);
    assert.match(text, /^update a\.ts( \(|: \+)/, text);
  }
});

test('at most three names are listed', () => {
  const after = V1 + 'function a1(){}\nfunction a2(){}\nfunction a3(){}\nfunction a4(){}\n';
  const names = describeChange('a.ts', V1, after)
    .match(/touches (.*)$/)[1]
    .split(', ');
  assert.equal(names.length, 3);
});
