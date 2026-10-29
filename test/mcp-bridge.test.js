const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { z } = require('zod');

// The port is read when the module loads, so choose it first (parallel test files must not collide).
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');

const BRIDGE = path.join(__dirname, '../js_automations/mcpb/bridge.js');

function bridgeEnv(token, url = `http://127.0.0.1:${PORT}/mcp`) {
  return { ...process.env, JSA_MCP_URL: url, JSA_MCP_TOKEN: token };
}

/** Runs the bridge, feeds it raw lines on stdin and collects what it prints. */
function runBridge(env, lines) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BRIDGE], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) =>
      resolve({
        code,
        stdout,
        stderr,
        messages: stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l)),
      })
    );
    for (const line of lines) child.stdin.write(line + '\n');
    child.stdin.end();
  });
}

test('bridge refuses to start without configuration', async () => {
  const r = await runBridge({ ...process.env, JSA_MCP_URL: '', JSA_MCP_TOKEN: '' }, []);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /JSA_MCP_URL and JSA_MCP_TOKEN/);
});

test('a stdio MCP client reaches the add-on through the bridge', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-bridge-'));
  const settings = { mcp: { enabled: true, external_url: '', trust_proxy: false, allowlist: '' } };
  const settingsManager = { on() {}, getSettings: () => settings };
  const manager = new McpManager(settingsManager, { add() {} }, path.join(dir, 'storage'));
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  protocol.registerTool({
    name: 'read_script',
    title: 'Read script',
    description: 'echo',
    inputSchema: { filename: z.string() },
    readOnly: true,
    handler: ({ filename }) => ({ content: `source of ${filename}` }),
  });
  manager.init();
  await new Promise((r) => (manager.server.listening ? r() : manager.server.once('listening', r)));
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test('initialize, list tools and call a tool over stdio', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BRIDGE],
      env: { ...bridgeEnv(manager.revealToken()), PATH: process.env.PATH },
      stderr: 'pipe',
    });
    await client.connect(transport);
    try {
      assert.match(client.getInstructions(), /get_api_reference/);
      assert.deepEqual(
        (await client.listTools()).tools.map((x) => x.name),
        ['read_script']
      );
      const r = await client.callTool({ name: 'read_script', arguments: { filename: 'demo.ts' } });
      assert.equal(r.content[0].text, 'source of demo.ts');
    } finally {
      await client.close();
    }
  });

  await t.test('notifications get no reply, requests get exactly one, batches keep their ids', async () => {
    const token = manager.revealToken();
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    };
    const r = await runBridge(bridgeEnv(token), [
      JSON.stringify(init),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.messages.map((m) => m.id).sort(), [1, 2]);
    assert.ok(r.messages.find((m) => m.id === 2).result.tools.length === 1);
  });

  await t.test('a wrong token comes back as a JSON-RPC error that names the cause', async () => {
    const r = await runBridge(bridgeEnv('jsamcp_wrong'), [
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
    ]);
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0].id, 7);
    assert.match(r.messages[0].error.message, /HTTP 401/);
    assert.match(r.messages[0].error.message, /token is wrong or was rotated/);
  });

  await t.test('garbage input yields a parse error, not a crash', async () => {
    const r = await runBridge(bridgeEnv(manager.revealToken()), ['this is not json']);
    assert.equal(r.code, 0);
    assert.equal(r.messages[0].error.code, -32700);
  });
});

test('an unreachable server fails each request instead of hanging', async () => {
  const r = await runBridge(bridgeEnv('x', 'http://127.0.0.1:1/mcp'), [
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.messages.length, 1, 'only the request is answered, the notification only logs to stderr');
  assert.equal(r.messages[0].id, 3);
  assert.match(r.messages[0].error.message, /Cannot reach the JS Automations MCP server/);
  assert.match(r.stderr, /Cannot reach/);
});
