const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The environment of the server process: a snippet must not see these.
process.env.HA_TOKEN = 'SECRET-TOKEN-VALUE';
process.env.SUPERVISOR_TOKEN = 'SECRET-SUPERVISOR-VALUE';

const workerManager = require('../js_automations/core/worker-manager.js');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'jsa-snippet-'));
workerManager.setStorageDir(storage);

let hits = 0;
const server = http.createServer((req, res) => {
  hits++;
  res.end('{"hello":"world"}');
});
const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

after(() => {
  server.close();
  fs.rmSync(storage, { recursive: true, force: true });
  // The WorkerManager singleton keeps timers alive that the test process has no use for.
  setImmediate(() => process.exit(0));
});

const snippet = (code, timeoutMs = 10000) => workerManager.runRepl(code, { restricted: true, timeoutMs });
const lines = (r) => r.logs.map((l) => `${l.level}: ${l.message}`);
const crashText = (r) => r.logs.find((l) => l.message.startsWith('🔥 CRASH: '))?.message ?? '';

test('a restricted snippet prints through console.* and ha.log and ends when it is done', async () => {
  const started = Date.now();
  const r = await snippet(`console.log('a', {x: 1}); ha.log('b'); console.warn('w'); console.error('e');`);
  assert.deepEqual(lines(r), ['info: a {\n  "x": 1\n}', 'info: b', 'warn: w', 'error: e']);
  assert.equal(r.error, null);
  assert.ok(Date.now() - started < 5000, 'it does not wait for the timeout');
});

test('it ends promptly even after ha.store.get installed a message listener', async () => {
  const started = Date.now();
  const r = await snippet(`console.log(JSON.stringify(ha.store.get('anything') ?? null));`);
  assert.deepEqual(lines(r), ['info: null']);
  assert.equal(r.error, null);
  assert.ok(Date.now() - started < 5000);
});

test('network works: a connection to another host is attempted, not refused', async () => {
  // 192.0.2.0/24 (TEST-NET-1) is reserved and unroutable: the attempt fails or times out, but is not refused by the sandbox.
  const r = await snippet(
    `try { await fetch('http://192.0.2.1:9/', { signal: AbortSignal.timeout(1500) }); console.log('reached'); } catch (e) { console.log('error: ' + e.name + ' ' + ((e.cause && e.cause.message) || e.message)); }`,
    10000
  );
  const out = lines(r).join('|');
  assert.match(out, /error: /, out);
  assert.doesNotMatch(out, /PermissionDenied|add-on itself/, out);
});

test('the add-on itself cannot be reached: loopback, localhost, own addresses and local sockets', async () => {
  await listening;
  const port = server.address().port;
  const own = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  const targets = [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`];
  if (own) targets.push(`http://${own.address}:${port}/`);
  const before = hits;
  for (const url of targets) {
    const viaFetch = await snippet(
      `try { const r = await fetch('${url}'); console.log('reached ' + r.status); } catch (e) { console.log('error: ' + ((e.cause && e.cause.message) || e.message)); }`
    );
    assert.match(lines(viaFetch).join('|'), /connections to the add-on itself/, `fetch ${url}: ${lines(viaFetch)}`);
    const viaHttp = await snippet(
      `await new Promise((res) => { require('http').get('${url}').on('error', (e) => { console.log('error: ' + e.message); res(); }).on('response', () => { console.log('reached'); res(); }); });`
    );
    assert.match(lines(viaHttp).join('|'), /connections to the add-on itself/, `http ${url}: ${lines(viaHttp)}`);
  }
  const socket = await snippet(
    `await new Promise((res) => { const s = require('net').connect('${process.platform === 'win32' ? '\\\\\\\\.\\\\pipe\\\\zz' : '/var/run/docker.sock'}'); s.on('error', (e) => { console.log('error: ' + e.message); res(); }); s.on('connect', () => { console.log('connected'); res(); }); });`
  );
  assert.match(lines(socket).join('|'), /connections to the add-on itself \(a local socket\)/, lines(socket).join('|'));
  assert.equal(hits, before, 'the server was never reached');
});

test('a package may load fs itself, only the snippet is blocked', async () => {
  const pkgDir = path.join(storage, 'node_modules', 'zzpkg');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'index.js'), "module.exports = typeof require('fs').readdirSync;");
  const viaPackage = await snippet(`console.log(require('zzpkg'));`);
  assert.deepEqual(lines(viaPackage), ['info: function']);
  const direct = await snippet(`console.log(typeof require('fs').readdirSync);`);
  assert.match(crashText(direct), /not available in run_snippet/);
});

test('files, processes and host details are not available', async () => {
  for (const mod of ['fs', 'node:fs', 'fs/promises', 'child_process', 'os', 'worker_threads', 'vm']) {
    const r = await snippet(`require('${mod}'); console.log('loaded');`);
    assert.match(crashText(r), /not available in run_snippet/, mod);
    assert.ok(!lines(r).includes('info: loaded'), mod);
  }
});

test('the add-on tokens are not in the environment of a snippet', async () => {
  const r = await snippet(`console.log('HA=' + process.env.HA_TOKEN + ' SUP=' + process.env.SUPERVISOR_TOKEN);`);
  assert.deepEqual(lines(r), ['info: HA=undefined SUP=undefined']);
});

test('nothing in Home Assistant can be changed: service calls and store writes are refused', async () => {
  const call = await snippet(`ha.call('light.turn_on', { entity_id: 'light.x' }); console.log('after');`);
  assert.ok(
    lines(call).some((l) => /ha\.call is not available in run_snippet/.test(l)),
    lines(call).join('|')
  );
  const store = await snippet(`ha.store.set('k', 'v'); ha.store.delete('k'); console.log('after');`);
  assert.ok(lines(store).some((l) => /store_set is not available/.test(l)));
  assert.ok(lines(store).some((l) => /store_delete is not available/.test(l)));
});

test('a thrown error comes back as a crash line with the message, a hanging snippet hits the timeout', async () => {
  const thrown = await snippet(`throw new Error('boom');`);
  assert.match(crashText(thrown), /^🔥 CRASH: boom/);
  const hang = await snippet(`setInterval(() => {}, 1000); await new Promise(() => {});`, 1500);
  assert.match(hang.error, /Timeout: snippet execution exceeded 1.5 seconds/);
});

test('the unrestricted REPL keeps its full access (Expert Mode)', async () => {
  const r = await workerManager.runRepl(`console.log(typeof require('fs').readdirSync);`, {});
  assert.equal(r.error, null);
  assert.ok(r.logs.length === 0 || r.logs.every((l) => l.level !== 'error'));
});
