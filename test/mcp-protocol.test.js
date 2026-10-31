const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { z } = require('zod');

// The port is read when the module loads, so choose it first (parallel test files must not collide).
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');
const { MCP_TOOL_CATALOG, isToolEnabled } = require('../js_automations/core/mcp-tool-catalog.js');

const URL_ = new URL(`http://127.0.0.1:${PORT}/mcp`);

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

test('catalog defaults: write group, get_store, call_service and delete_script are off', () => {
  const off = MCP_TOOL_CATALOG.filter((m) => !m.maintainerOnly && !isToolEnabled({}, m)).map((m) => m.name);
  assert.deepEqual(off.sort(), [
    'call_service',
    'delete_script',
    'edit_card',
    'edit_script',
    'get_store',
    'save_script_notes',
    'write_card',
    'write_script',
  ]);
  assert.equal(
    isToolEnabled(
      { tool_get_store: true },
      MCP_TOOL_CATALOG.find((m) => m.name === 'get_store')
    ),
    true
  );
});

test('registering a tool outside the catalog is rejected', () => {
  const protocol = new McpProtocol({ getSettings: () => ({}) }, { add() {} }, new McpActivityLog(), '0.0.0');
  assert.throws(() =>
    protocol.registerTool({ name: 'nope', title: 't', description: 'd', handler: () => ({ content: '' }) })
  );
});

test('MCP client can list and call tools; switches and auth are enforced', async (t) => {
  if (!(await portIsFree(PORT))) return t.skip(`port ${PORT} is in use`);

  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-proto-'));
  const settings = { mcp: { enabled: true, external_url: '', trust_proxy: false, allowlist: '' } };
  const settingsManager = { on() {}, getSettings: () => settings };
  const logs = [];
  const logManager = { add: (level, source, message) => logs.push({ level, message }) };
  const activity = new McpActivityLog();
  const manager = new McpManager(settingsManager, logManager, dir);
  const protocol = new McpProtocol(settingsManager, logManager, activity, '9.9.9');
  manager.setHandler((req, res) => protocol.handle(req, res));
  protocol.registerTool({
    name: 'list_scripts',
    title: 'List scripts',
    description: 'test tool',
    readOnly: true,
    handler: () => ({ content: { scripts: ['a.js'] } }),
  });
  protocol.registerTool({
    name: 'read_script',
    title: 'Read script',
    description: 'echo the filename',
    inputSchema: { filename: z.string() },
    readOnly: true,
    handler: ({ filename }) => ({ content: `source of ${filename}` }),
  });
  protocol.registerTool({
    name: 'get_logs',
    title: 'Get logs',
    description: 'always fails',
    handler: () => {
      throw new Error('boom');
    },
  });
  protocol.registerTool({
    name: 'write_script',
    title: 'Write script',
    description: 'off by default',
    handler: () => ({ content: 'written' }),
  });
  manager.init();
  await new Promise((r) => (manager.server.listening ? r() : manager.server.once('listening', r)));
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const connect = async (token) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(URL_, {
      requestInit: { headers: { Authorization: `Bearer ${token}`, Connection: 'close' } },
    });
    await client.connect(transport);
    return client;
  };

  await t.test('client without a valid token cannot connect', async () => {
    await assert.rejects(connect('wrong'));
  });

  const client = await connect(manager.revealToken());
  t.after(() => client.close());

  await t.test('only enabled tools are listed; switching one on applies to the next request', async () => {
    let names = (await client.listTools()).tools.map((x) => x.name).sort();
    assert.deepEqual(names, ['get_logs', 'list_scripts', 'read_script']);
    settings.mcp.tool_write_script = true;
    settings.mcp.tool_list_scripts = false;
    names = (await client.listTools()).tools.map((x) => x.name).sort();
    assert.deepEqual(names, ['get_logs', 'read_script', 'write_script']);
    delete settings.mcp.tool_write_script;
    delete settings.mcp.tool_list_scripts;
  });

  await t.test('tool results, arguments and errors come through', async () => {
    const ok = await client.callTool({ name: 'list_scripts', arguments: {} });
    assert.equal(ok.isError, undefined);
    assert.deepEqual(JSON.parse(ok.content[0].text), { scripts: ['a.js'] });

    const withArgs = await client.callTool({ name: 'read_script', arguments: { filename: 'x.ts' } });
    assert.equal(withArgs.content[0].text, 'source of x.ts');

    const failed = await client.callTool({ name: 'get_logs', arguments: {} });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /boom/);
  });

  await t.test('a switched-off tool cannot be called', async () => {
    const res = await client.callTool({ name: 'write_script', arguments: {} }).catch((e) => ({ error: e }));
    assert.ok(res.error || res.isError, 'call must fail');
  });

  await t.test('a connecting client is noted in the system log, with its name and address', () => {
    const line = logs.find((l) => /Client connected: test 1.0.0 from /.test(l.message));
    assert.ok(line, JSON.stringify(logs));
    assert.equal(line.level, 'info');
  });

  await t.test('every call lands in the activity log (newest first)', () => {
    const entries = activity.list();
    assert.deepEqual(
      entries.map((e) => [e.tool, e.ok]),
      [
        ['get_logs', false],
        ['read_script', true],
        ['list_scripts', true],
      ]
    );
    assert.equal(entries[1].target, 'x.ts');
    assert.equal(entries[0].error, 'boom');
    assert.ok(entries.every((e) => typeof e.durationMs === 'number' && e.ip));
  });
});
