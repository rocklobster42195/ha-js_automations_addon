const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// The port is read when the module loads, so choose it first (parallel test files must not collide).
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');
const { registerControlTools } = require('../js_automations/core/mcp-tools-control.js');

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-control-'));
  const scriptsDir = path.join(dir, 'scripts');
  const librariesDir = path.join(scriptsDir, 'libraries');
  mkdirSync(librariesDir, { recursive: true });
  writeFileSync(path.join(scriptsDir, 'job.js'), `/**\n * @name Job\n * @npm axios, lodash\n */\nha.log('x');\n`);
  writeFileSync(path.join(scriptsDir, 'plain.js'), `ha.log('plain');\n`);
  writeFileSync(path.join(scriptsDir, 'blocked.js'), `ha.log('blocked');\n`);
  writeFileSync(path.join(librariesDir, 'lib.js'), `exports.x = 1;\n`);

  const calls = [];
  const workers = new Map();
  const workerManager = {
    workers,
    settings: { restart_protection_count: 5, restart_protection_time: 60000 },
    isRestartBlocked: (name) => name === 'blocked.js',
    startScript: (fullPath) => {
      calls.push(['start', path.basename(fullPath)]);
      if (fullPath.endsWith('plain.js') || fullPath.endsWith('blocked.js')) return false; // simulates "could not start"
      workers.set(path.basename(fullPath), {});
      return true;
    },
    stopScript: (name, reason) => {
      calls.push(['stop', name, reason]);
      workers.delete(name);
    },
  };
  const depManager = { install: async (deps) => calls.push(['install', deps]) };
  const stateManager = { saveScriptStarted: (name) => calls.push(['saved', name]) };
  const haConnector = {
    callService: async (domain, service, data, expectResponse) => {
      calls.push(['service', domain, service, data, expectResponse]);
      return service === 'get_forecasts' ? { forecast: [1, 2] } : undefined;
    },
  };
  let statusUpdates = 0;

  const settings = {
    mcp: { enabled: true, external_url: '', trust_proxy: false, allowlist: '', tool_call_service: true },
  };
  const settingsManager = { on() {}, getSettings: () => settings };
  const manager = new McpManager(settingsManager, { add() {} }, path.join(dir, 'storage'));
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  registerControlTools(protocol, {
    workerManager,
    depManager,
    stateManager,
    haConnector,
    scriptsDir,
    librariesDir,
    notifyStatusUpdate: () => statusUpdates++,
    settleMs: 0,
  });
  manager.init();
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, calls, workers, settings, statusUpdates: () => statusUpdates };
}

test('control tools start, stop and restart scripts and call services', async (t) => {
  const { manager, calls, workers, settings, statusUpdates } = setup(t);
  await new Promise((r) => (manager.server.listening ? r() : manager.server.once('listening', r)));
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${manager.revealToken()}`, Connection: 'close' } },
    })
  );
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content[0].text, isError: !!r.isError };
  };

  await t.test('start_script installs @npm deps, starts, records state, reports running', async () => {
    const r = await call('start_script', { filename: 'job.js' });
    assert.equal(r.isError, false);
    assert.match(r.text, /"job\.js" is running/);
    assert.deepEqual(calls.splice(0), [
      ['install', ['axios', 'lodash']],
      ['start', 'job.js'],
      ['saved', 'job.js'],
    ]);
    assert.ok(statusUpdates() > 0);
    assert.match((await call('start_script', { filename: 'job.js' })).text, /already running/);
  });

  await t.test('restart_script stops then starts', async () => {
    const r = await call('restart_script', { filename: 'job.js' });
    assert.match(r.text, /"job\.js" is running/);
    const names = calls.splice(0).map((c) => c[0]);
    assert.deepEqual(names, ['stop', 'install', 'start', 'saved']);
  });

  await t.test('stop_script stops a running script, tolerates a stopped one', async () => {
    assert.match((await call('stop_script', { filename: 'job.js' })).text, /stopped/);
    assert.equal(workers.has('job.js'), false);
    assert.match((await call('stop_script', { filename: 'job.js' })).text, /not running/);
    calls.length = 0;
  });

  await t.test('a script that fails to start is reported as an error', async () => {
    const r = await call('start_script', { filename: 'plain.js' });
    assert.equal(r.isError, true);
    assert.match(r.text, /could not be started/);
  });

  await t.test('a start refused by the restart protection says so', async () => {
    const r = await call('start_script', { filename: 'blocked.js' });
    assert.equal(r.isError, true);
    assert.match(r.text, /restart protection is active/);
  });

  await t.test('libraries, unknown names and path tricks are refused', async () => {
    for (const filename of ['lib.js', 'libraries/lib.js', 'nope.js', '../x.js', 'a.blocks']) {
      const r = await call('start_script', { filename });
      assert.equal(r.isError, true, filename);
    }
  });

  await t.test('call_service forwards the call and returns the response', async () => {
    calls.length = 0;
    const ok = await call('call_service', { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a' } });
    assert.equal(ok.text, 'Service called.');
    assert.deepEqual(calls.pop(), ['service', 'light', 'turn_on', { entity_id: 'light.a' }, false]);
    const withData = await call('call_service', { domain: 'weather', service: 'get_forecasts', return_response: true });
    assert.deepEqual(JSON.parse(withData.text), { forecast: [1, 2] });
  });

  await t.test('call_service refuses host-level services and malformed names', async () => {
    for (const [domain, service] of [
      ['homeassistant', 'restart'],
      ['homeassistant', 'stop'],
      ['hassio', 'host_shutdown'],
      ['shell_command', 'anything'],
      ['light', 'turn_on; rm'],
      ['Light', 'turn_on'],
    ]) {
      const r = await call('call_service', { domain, service });
      assert.equal(r.isError, true, `${domain}.${service}`);
    }
    assert.ok(!calls.some((c) => c[0] === 'service' && c[1] === 'hassio'));
  });

  await t.test('call_service is hidden while its switch is off', async () => {
    settings.mcp.tool_call_service = false;
    const names = (await client.listTools()).tools.map((x) => x.name).sort();
    assert.deepEqual(names, ['restart_script', 'start_script', 'stop_script']);
    settings.mcp.tool_call_service = true;
  });
});
