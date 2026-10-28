const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const WebhookManager = require('../js_automations/core/webhook-manager.js');

const PORT = 3001; // fixed in webhook-manager.ts

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

function makeManager(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-webhook-test-'));
  const logs = [];
  const settingsManager = { on() {}, getSettings: () => ({ webhook: {} }) };
  const logManager = { add: (level, source, message) => logs.push({ level, source, message }) };
  const manager = new WebhookManager(settingsManager, logManager, dir);
  // Echo handler standing in for the worker: answer every request with { ok: true }.
  manager.on('request', (ev) => manager.resolveResponse(ev.correlationId, { isJson: true, body: { ok: true } }));
  t.after(() => {
    manager.unregisterAllForScript('a.js');
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, logs };
}

const call = (id, { method = 'POST', token } = {}) =>
  fetch(`http://127.0.0.1:${PORT}/webhook/${id}`, {
    method,
    headers: { Connection: 'close', ...(token ? { 'X-Webhook-Secret': token } : {}) },
    body: method === 'GET' ? undefined : '{}',
  });

test('webhook auth, allowlist, rate limit and backoff behave as documented', async (t) => {
  if (!(await portIsFree(PORT))) return t.skip(`port ${PORT} is in use`);
  const { manager } = makeManager(t);

  await t.test('valid token → 200', async () => {
    manager.register('auth', { scriptFilename: 'a.js' });
    const res = await call('auth', { token: manager.revealToken('auth') });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  await t.test('missing token → 401, wrong method → 405, unknown id → 404', async () => {
    assert.equal((await call('auth')).status, 401);
    assert.equal((await call('auth', { method: 'GET', token: manager.revealToken('auth') })).status, 405);
    assert.equal((await call('nope')).status, 404);
  });

  await t.test('5 bad tokens lock the IP out, even for the correct token', async () => {
    manager.register('lock', { scriptFilename: 'a.js' });
    const good = manager.revealToken('lock');
    for (let i = 0; i < 5; i++) assert.equal((await call('lock', { token: 'bad' })).status, 401);
    assert.equal((await call('lock', { token: good })).status, 429);
    // The lockout is scoped to the webhook id.
    manager.register('lock2', { scriptFilename: 'a.js' });
    assert.equal((await call('lock2', { token: manager.revealToken('lock2') })).status, 200);
  });

  await t.test('allowlist: CIDR outside → 403, exact IPv4 match (incl. ::ffff: mapped) → 200', async () => {
    manager.register('cidr', { scriptFilename: 'a.js', noAuth: true, allowlist: ['10.0.0.0/8'] });
    assert.equal((await call('cidr')).status, 403);
    manager.register('exact', { scriptFilename: 'a.js', noAuth: true, allowlist: ['127.0.0.1'] });
    assert.equal((await call('exact')).status, 200);
    manager.register('range', { scriptFilename: 'a.js', noAuth: true, allowlist: ['127.0.0.0/8'] });
    assert.equal((await call('range')).status, 200);
  });

  await t.test('rate limit: 61st request within the window → 429', async () => {
    manager.register('rate', { scriptFilename: 'a.js', noAuth: true });
    for (let i = 0; i < 60; i++) assert.equal((await call('rate')).status, 200);
    assert.equal((await call('rate')).status, 429);
  });
});
