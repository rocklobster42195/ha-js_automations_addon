const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const ScriptHeaderParser = require('../js_automations/core/script-header-parser.js');

function parse(t, header) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-header-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'demo.ts');
  writeFileSync(file, `/**\n${header}\n */\nha.log('x');\n`);
  return ScriptHeaderParser.parse(file);
}

// worker-manager decides "preview only" from meta.card === 'dev'; there is no meta.headers object.
test('@card is exposed as meta.card: true, "dev" or null', (t) => {
  assert.equal(parse(t, ' * @card dev').card, 'dev');
  assert.equal(parse(t, ' * @card').card, true);
  assert.equal(parse(t, ' * @name Nothing').card, null);
  assert.equal(parse(t, ' * @card dev').headers, undefined);
});
