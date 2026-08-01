const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const repoRoot = path.join(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url} to respond: ${lastError?.message}`);
}

test('server boots and serves the dashboard even when Home Assistant is unreachable', async (t) => {
  const port = await getFreePort();
  const scriptsDir = mkdtempSync(path.join(tmpdir(), 'jsa-boot-test-'));

  // Non-addon (dev) mode with HA_URL pointed at a port nothing listens on, so
  // the connection attempt fails fast and deterministically (ECONNREFUSED)
  // instead of depending on DNS behavior for a hostname like "supervisor"
  // that only resolves on a real Supervisor host.
  const env = { ...process.env };
  delete env.SUPERVISOR_TOKEN;
  env.HA_URL = 'http://127.0.0.1:1';
  env.HA_TOKEN = 'test-token';
  env.JSA_SCRIPTS_DIR = scriptsDir;
  env.PORT = String(port);

  const child = spawn('node', ['js_automations/server.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  t.after(() => {
    child.kill('SIGTERM');
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  const exitedEarly = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
  });

  const res = await Promise.race([
    waitForHttpOk(`http://127.0.0.1:${port}/api/status`, 15000),
    exitedEarly.then((code) => {
      throw new Error(`server.js exited early with code ${code} before it started listening.\nstderr:\n${stderr}`);
    }),
  ]);

  const body = await res.json();
  assert.equal(typeof body.version, 'string');
  assert.ok(body.version.length > 0);
});
