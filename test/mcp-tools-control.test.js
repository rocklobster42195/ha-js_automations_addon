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
  let replImpl = async () => ({ logs: [], error: null });
  const workerManager = {
    workers,
    runRepl: (code, options) => {
      calls.push(['repl', code, options]);
      return replImpl(code, options);
    },
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
    mcp: {
      enabled: true,
      external_url: '',
      trust_proxy: false,
      allowlist: '',
      tool_call_service: true,
    },
  };
  const settingsManager = { on() {}, getSettings: () => settings };
  const manager = new McpManager(settingsManager, { add() {} }, path.join(dir, 'storage'));
  const activity = new McpActivityLog();
  const protocol = new McpProtocol(settingsManager, { add() {} }, activity, '0.0.0');
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
  return {
    manager,
    calls,
    workers,
    settings,
    activity,
    setRepl: (fn) => (replImpl = fn),
    statusUpdates: () => statusUpdates,
  };
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

test('run_snippet runs the code in the restricted mode and reports what it printed', async (t) => {
  const { manager, calls, settings, activity, setRepl } = setup(t);
  settings.mcp.tool_run_snippet = true;
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
  const repl = () => calls.filter((c) => c[0] === 'repl');

  await t.test('output is returned as untrusted data, runs restricted with the default timeout', async () => {
    setRepl(async () => ({
      logs: [
        { level: 'info', message: 'hello' },
        { level: 'warn', message: 'careful' },
      ],
      error: null,
    }));
    const r = await call('run_snippet', { code: "ha.log('hello')" });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /^\[Untrusted content below/);
    assert.match(r.text, /hello\n\[warn\] careful/);
    assert.deepEqual(repl()[0][2], { restricted: true, timeoutMs: 15000 });
    assert.equal(repl()[0][1], "ha.log('hello')");
  });

  await t.test('timeout_seconds is passed on and limited to 60', async () => {
    await call('run_snippet', { code: 'x', timeout_seconds: 40 });
    assert.equal(repl().at(-1)[2].timeoutMs, 40000);
    assert.equal(
      (await call('run_snippet', { code: 'x', timeout_seconds: 61 })).isError,
      true,
      'above the schema maximum'
    );
  });

  await t.test('a crash line becomes a clean error, credentials in the output are masked', async () => {
    setRepl(async () => ({
      logs: [
        { level: 'info', message: "const apiKey = 'abcd1234secretvalue'" },
        { level: 'error', message: '🔥 CRASH: boom\nError: boom\n    at line 2' },
      ],
      error: null,
    }));
    const r = await call('run_snippet', { code: 'throw new Error("boom")' });
    assert.equal(r.isError, true);
    assert.match(r.text, /Error: boom/);
    assert.doesNotMatch(r.text, /at line 2/, 'the stack is not sent');
    assert.doesNotMatch(r.text, /abcd1234secretvalue/);
  });

  await t.test('a timeout is reported as an error, silence is explained', async () => {
    setRepl(async () => ({ logs: [], error: 'Timeout: snippet execution exceeded 15 seconds.' }));
    const slow = await call('run_snippet', { code: 'x' });
    assert.equal(slow.isError, true);
    assert.match(slow.text, /Timeout/);
    setRepl(async () => ({ logs: [], error: null }));
    assert.match((await call('run_snippet', { code: 'x' })).text, /printed nothing/);
  });

  await t.test('long output is cut', async () => {
    setRepl(async () => ({ logs: [{ level: 'info', message: 'x'.repeat(30000) }], error: null }));
    const r = await call('run_snippet', { code: 'x' });
    assert.ok(r.text.length < 21000, String(r.text.length));
    assert.match(r.text, /output cut at 20000 characters/);
  });

  await t.test('only one snippet at a time, an empty snippet is refused', async () => {
    let release;
    setRepl(
      () =>
        new Promise((resolve) => (release = () => resolve({ logs: [{ level: 'info', message: 'done' }], error: null })))
    );
    const first = call('run_snippet', { code: 'slow' });
    await new Promise((r) => setTimeout(r, 50));
    const second = await call('run_snippet', { code: 'again' });
    assert.equal(second.isError, true);
    assert.match(second.text, /still running/);
    release();
    assert.match((await first).text, /done/);
    assert.equal((await call('run_snippet', { code: '   ' })).isError, true);
  });

  await t.test('the MCP tab gets the code and the output of every run', async () => {
    setRepl(async () => ({ logs: [{ level: 'info', message: 'seen' }], error: null }));
    await call('run_snippet', { code: 'ha.log("seen")' });
    const entry = activity.list().find((e) => e.tool === 'run_snippet');
    assert.ok(entry.detail.includes('ha.log("seen")'), entry.detail);
    assert.ok(entry.detail.includes('--- output ---') && entry.detail.includes('seen'));
  });

  await t.test('it is off unless it has its own switch, whatever the access level is', async () => {
    delete settings.mcp.tool_run_snippet;
    settings.mcp.access_level = 'write';
    const { tools } = await client.listTools();
    assert.ok(!tools.some((x) => x.name === 'run_snippet'));
    settings.mcp.tool_run_snippet = true;
    assert.ok((await client.listTools()).tools.some((x) => x.name === 'run_snippet'));
  });
});
