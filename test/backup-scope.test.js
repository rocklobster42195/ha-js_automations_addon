const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isDerivedArtifact, DERIVED_ARTIFACT_GLOBS } = require('../js_automations/core/backup-scope.js');

test('secrets that must never leave the machine are outside the backup scope', () => {
  for (const file of ['.storage/store.key', '.storage/store.json.pre-encryption', '.storage/mcp.json']) {
    assert.equal(isDerivedArtifact(file), true, file);
    assert.ok(DERIVED_ARTIFACT_GLOBS.includes(file), `${file} must also be in the archiver ignore list`);
  }
});

test('real user state stays in the backup', () => {
  for (const file of [
    '.storage/settings.json',
    '.storage/store.json',
    '.storage/mcp-feedback.json',
    'demo.ts',
    'libraries/helper.ts',
  ]) {
    assert.equal(isDerivedArtifact(file), false, file);
  }
});
