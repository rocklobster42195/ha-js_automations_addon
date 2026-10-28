const { test } = require('node:test');
const assert = require('node:assert/strict');

const { maskSecrets, maskWithNotice, maskDeep, MASK } = require('../js_automations/core/mcp-secret-filter.js');
const { McpEventBuffer } = require('../js_automations/core/mcp-event-buffer.js');

test('named assignments of sensitive keys are masked, quote style kept', () => {
  const input = [
    `const apiKey = 'sk_live_abcdef123456';`,
    `const CONFIG = { password: "hunter2hunter2", claudeApiKey: \`abcd-efgh\` };`,
    `{"access_token": "abc123def456"}`,
    `webhookSecret = 'topsecretvalue'`,
  ].join('\n');
  const { text, masked } = maskSecrets(input);
  assert.equal(masked, 5);
  assert.ok(!/sk_live|hunter2|abcd-efgh|abc123def456|topsecretvalue/.test(text), text);
  assert.ok(text.includes(`apiKey = '${MASK}'`));
  assert.ok(text.includes(`"access_token": "${MASK}"`));
});

test('well-known token formats are masked anywhere', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmMxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const input = [
    `Authorization: Bearer abcdefghijklmnop1234`,
    `token ${jwt}`,
    `key sk-ant-api03-abcdefghijklmnopqrstuvwxyz`,
    `gh ghp_abcdefghijklmnopqrstuvwxyz0123456789`,
    `own jsamcp_0123456789abcdef0123456789abcdef0123456789abcdef`,
    `hex "0123456789abcdef0123456789abcdef"`,
  ].join('\n');
  const { text, masked } = maskSecrets(input);
  assert.equal(masked, 6);
  assert.ok(!/eyJ|sk-ant|ghp_|jsamcp_|0123456789abcdef0123456789abcdef/.test(text), text);
});

test('ordinary code and entity ids are left alone', () => {
  const input = [
    `ha.on('sensor.outside_temperature', (e) => ha.log('temp ' + e.state));`,
    `const timeout = 5000; const keyboard = 'qwertz';`,
    `// the hash 0123456789abcdef0123456789abcdef appears in prose, not in quotes`,
  ].join('\n');
  const { text, masked } = maskSecrets(input);
  assert.equal(masked, 0);
  assert.equal(text, input);
  assert.equal(maskWithNotice(input), input, 'no notice when nothing was masked');
});

test('references and plain URLs are not mistaken for credentials', () => {
  const input = [
    'const TOKEN_URL = "https://account.example.com/auth/token";',
    'headers: { Authorization: `Bearer ${token}` },',
    'const u = { password: "https://user:pw@host/x" };',
  ].join('\n');
  const { text, masked } = maskSecrets(input);
  assert.equal(masked, 1, text);
  assert.ok(text.includes('TOKEN_URL = "https://account.example.com/auth/token"'));
  assert.ok(text.includes('Bearer ${token}'));
  assert.ok(!text.includes('user:pw'), 'URLs with embedded credentials are still masked');
});

test('maskDeep masks string leaves and strings under sensitive keys, leaves other values alone', () => {
  const out = maskDeep({
    note: 'password = "abcdefgh12"',
    apiToken: 'plain-token-value',
    nested: [{ secret: 'x1y2z3', count: 5, ok: true }],
    url: 'https://example.com/a',
  });
  assert.deepEqual(out, {
    note: `password = "${MASK}"`,
    apiToken: MASK,
    nested: [{ secret: MASK, count: 5, ok: true }],
    url: 'https://example.com/a',
  });
  assert.equal(maskDeep(null), null);
});

test('maskWithNotice appends a count', () => {
  assert.match(maskWithNotice(`password = 'abcdefgh'`), /\[1 value\(s\) masked by JSA secret filter\]$/);
});

test('event buffer: newest first, filters by type, entity and age, bounded size', () => {
  const buf = new McpEventBuffer();
  buf.push({ event_type: 'state_changed', data: { entity_id: 'light.a' } });
  buf.push({ event_type: 'custom', data: { x: 1 } });
  buf.push({ event_type: 'state_changed', data: { entity_id: 'light.b' } });
  assert.deepEqual(
    buf.query({ limit: 10 }).map((e) => e.type),
    ['state_changed', 'custom', 'state_changed']
  );
  assert.equal(buf.query({ type: 'custom', limit: 10 }).length, 1);
  assert.deepEqual(
    buf.query({ entityId: 'light.a', limit: 10 }).map((e) => e.data.entity_id),
    ['light.a']
  );
  assert.equal(buf.query({ limit: 1 }).length, 1);
  assert.equal(buf.query({ sinceMs: 1, limit: 10 }).length >= 0, true);
  for (let i = 0; i < 400; i++) buf.push({ event_type: 'n', data: {} });
  assert.equal(buf.query({ limit: 1000 }).length, 300);
});
