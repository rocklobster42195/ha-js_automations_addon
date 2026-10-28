const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const McpManager = require('../js_automations/core/mcp-manager.js');

const PORT = 3002; // fixed in mcp-manager.ts

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

function makeManager(t, dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-test-'))) {
  const settings = { mcp: { enabled: false, external_url: '', trust_proxy: false, allowlist: '' } };
  let listener = null;
  const settingsManager = {
    on: (_event, fn) => (listener = fn),
    getSettings: () => settings,
  };
  const logs = [];
  const logManager = { add: (level, source, message) => logs.push({ level, source, message }) };
  const manager = new McpManager(settingsManager, logManager, dir);
  const update = (patch) => {
    Object.assign(settings.mcp, patch);
    listener(settings);
  };
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, update, dir, logs };
}

const call = (token, { path: p = '/mcp', method = 'POST', body = '{}' } = {}) =>
  fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: {
      Connection: 'close',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === 'GET' ? undefined : body,
  });

test('token is generated once, persisted and rotatable', (t) => {
  const { manager, dir } = makeManager(t);
  const token = manager.revealToken();
  assert.match(token, /^jsamcp_[0-9a-f]{48}$/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'mcp.json'), 'utf8')).token, token);

  // A second manager on the same storage dir (e.g. after a restart) keeps the token.
  const again = makeManager(t, dir).manager;
  assert.equal(again.revealToken(), token);

  const rotated = manager.rotateToken();
  assert.notEqual(rotated, token);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'mcp.json'), 'utf8')).token, rotated);
  assert.ok(manager.getStatus().rotated);
});

test('server follows the enabled setting and enforces auth, allowlist and lockout', async (t) => {
  if (!(await portIsFree(PORT))) return t.skip(`port ${PORT} is in use`);
  const { manager, update } = makeManager(t);
  manager.init();
  assert.equal(manager.getStatus().running, false, 'disabled by default → not listening');

  update({ enabled: true });
  await new Promise((r) => manager.server.once('listening', r).listening && r());
  assert.equal(manager.getStatus().running, true);
  const token = manager.revealToken();

  await t.test('valid token reaches the handler, missing/wrong token → 401', async () => {
    assert.equal((await call(token)).status, 501, 'default handler until the protocol layer is installed');
    manager.setHandler((req, res) => res.json({ echoed: req.body }));
    const ok = await call(token, { body: '{"a":1}' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { echoed: { a: 1 } });
    assert.equal((await call()).status, 401);
    assert.equal((await call('nope')).status, 401);
  });

  await t.test('only /mcp exists', async () => {
    assert.equal((await call(token, { path: '/other' })).status, 404);
  });

  await t.test('allowlist rejects other IPs, accepts matching ranges', async () => {
    update({ allowlist: '10.0.0.0/8' });
    assert.equal((await call(token)).status, 403);
    update({ allowlist: '10.0.0.0/8, 127.0.0.0/8' });
    assert.equal((await call(token)).status, 200);
    update({ allowlist: '' });
  });

  await t.test('rotating the token invalidates the old one immediately', async () => {
    const fresh = manager.rotateToken();
    assert.equal((await call(token)).status, 401);
    assert.equal((await call(fresh)).status, 200);
  });

  await t.test('5 bad tokens lock the IP out, even for the correct token', async () => {
    const good = manager.revealToken();
    for (let i = 0; i < 5; i++) assert.equal((await call('bad')).status, 401); // a successful call resets the counter
    assert.equal((await call(good)).status, 429);
  });

  await t.test('disabling the setting stops the server', async () => {
    update({ enabled: false });
    assert.equal(manager.getStatus().running, false);
    await assert.rejects(call(manager.revealToken()));
  });
});
