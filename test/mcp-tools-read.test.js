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
const { McpEventBuffer } = require('../js_automations/core/mcp-event-buffer.js');
const { registerReadTools } = require('../js_automations/core/mcp-tools-read.js');

const CARD_SOURCE = 'class DemoCard extends HTMLElement {}';

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-tools-'));
  const scriptsDir = path.join(dir, 'scripts');
  const librariesDir = path.join(scriptsDir, 'libraries');
  const docsDir = path.join(dir, 'docs');
  const typesDir = path.join(dir, 'types');
  for (const d of [librariesDir, path.join(docsDir, 'guide'), typesDir]) mkdirSync(d, { recursive: true });

  const files = {
    'hello.js': `/**\n * @name Hello Script\n * @description Says hello\n * @permission network\n */\nconst API_KEY = 'abcd1234secretvalue';\nha.log('hi');\n`,
    'carded.ts': `/**\n * @name Carded\n * @card\n */\nha.log('card');\n\n/* __JSA_CARD__\n${Buffer.from(CARD_SOURCE).toString('base64')}\n__JSA_CARD_END__ */\n`,
    'broken.js': `/** @name Broken */\nha.log('x');\n`,
    'flow.blocks': '{}',
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(scriptsDir, name), content);
  writeFileSync(path.join(librariesDir, 'helper.js'), `/** @name Helper */\nexports.x = 1;\n`);
  writeFileSync(path.join(docsDir, 'guide', 'authoring.md'), '# Authoring guide');
  writeFileSync(path.join(typesDir, 'ha-api.d.ts'), 'declare const ha: any;');

  const now = Date.now();
  const history = [
    { ts: now - 3600e3, level: 'info', source: 'Hello Script', scriptId: 'hello.js', message: 'old line' },
    { ts: now - 5e3, level: 'info', source: 'Hello Script', scriptId: 'hello.js', message: 'hello started' },
    {
      ts: now - 4e3,
      level: 'error',
      source: 'Broken',
      scriptId: 'broken.js',
      message: 'TypeError: x is not a function\n  at broken.js:2',
    },
    { ts: now - 3e3, level: 'error', source: 'System', message: 'Compile error in broken.js: Unexpected token' },
    { ts: now - 2e3, level: 'debug', source: 'Broken', scriptId: 'broken.js', message: 'debug noise' },
    { ts: now - 1e3, level: 'warn', source: 'Other', message: 'token = "abcdefghijkl" leaked' },
  ];

  const workerManager = {
    workers: new Map([['hello.js', {}]]),
    lastExitState: new Map([['broken.js', 'error']]),
    startTimes: new Map(),
    getScripts: () => [
      path.join(scriptsDir, 'hello.js'),
      path.join(scriptsDir, 'carded.ts'),
      path.join(scriptsDir, 'broken.js'),
      path.join(scriptsDir, 'flow.blocks'),
      path.join(librariesDir, 'helper.js'),
    ],
    getEntityConflicts: () => ({}),
    getScriptStats: () => undefined,
  };
  const cardManager = {
    registry: {},
    wwwCardsDir: path.join(dir, 'www'),
    getCardSource: (p) => (p.endsWith('carded.ts') ? CARD_SOURCE : null),
  };
  const haConnector = {
    getStates: () => [
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light', brightness: 200 } },
      { entity_id: 'light.hall', state: 'off', attributes: { friendly_name: 'Hall' } },
      { entity_id: 'sensor.temp', state: '21.5', attributes: { friendly_name: 'Outside Temp' } },
    ],
  };
  const storeManager = {
    getAllPublic: () => ({
      guest_mode: { value: true, owner: 'hello.js', isSecret: false, updated: '2026-01-01T00:00:00Z', accessed: '' },
      wifi_password: {
        value: 'hunter2hunter2',
        owner: 'hello.js',
        isSecret: false,
        updated: '2026-01-01T00:00:00Z',
        accessed: '',
      },
      api_credentials: {
        value: null,
        owner: 'hello.js',
        isSecret: true,
        updated: '2026-01-01T00:00:00Z',
        accessed: '',
      },
      config: {
        value: { url: 'x', note: 'password = "abcdefgh12"' },
        owner: 'a.js',
        isSecret: false,
        updated: '2026-01-01T00:00:00Z',
        accessed: '',
      },
    }),
  };
  const eventBuffer = new McpEventBuffer();
  eventBuffer.push({
    event_type: 'state_changed',
    data: { entity_id: 'light.kitchen', old_state: { state: 'off' }, new_state: { state: 'on' } },
  });
  eventBuffer.push({ event_type: 'my_event', data: { a: 1 } });

  const settings = { mcp: { enabled: true, external_url: '', trust_proxy: false, allowlist: '' } };
  const settingsManager = { on() {}, getSettings: () => settings };
  const logManager = { add() {}, getHistory: () => history };
  const manager = new McpManager(settingsManager, { add() {} }, path.join(dir, 'storage'));
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  registerReadTools(protocol, {
    workerManager,
    logManager,
    storeManager,
    haConnector,
    cardManager,
    eventBuffer,
    scriptsDir,
    librariesDir,
    docsDir,
    typesDir,
  });
  manager.init();
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, settings };
}

async function connect(manager) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${manager.revealToken()}`, Connection: 'close' } },
    })
  );
  return client;
}

test('read tools expose scripts, logs, events, entities and docs', async (t) => {
  const { manager, settings } = setup(t);
  await new Promise((r) => (manager.server.listening ? r() : manager.server.once('listening', r)));
  const client = await connect(manager);
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content[0].text, isError: !!r.isError };
  };

  await t.test('all eight read tools are listed, nothing from other groups', async () => {
    const names = (await client.listTools()).tools.map((x) => x.name).sort();
    assert.deepEqual(names, [
      'get_api_reference',
      'get_entity',
      'get_events',
      'get_logs',
      'get_script_errors',
      'list_entities',
      'list_scripts',
      'read_script',
    ]);
  });

  await t.test('list_scripts: metadata + status, Blockly hidden, libraries marked', async () => {
    const { scripts } = JSON.parse((await call('list_scripts')).text);
    assert.deepEqual(scripts.map((s) => s.filename).sort(), ['broken.js', 'carded.ts', 'hello.js', 'helper.js']);
    const hello = scripts.find((s) => s.filename === 'hello.js');
    assert.equal(hello.name, 'Hello Script');
    assert.equal(hello.status, 'running');
    assert.deepEqual(hello.permissions, ['network']);
    assert.equal(scripts.find((s) => s.filename === 'broken.js').status, 'error');
    assert.equal(scripts.find((s) => s.filename === 'helper.js').kind, 'library');
    assert.equal(scripts.find((s) => s.filename === 'carded.ts').card, true);
  });

  await t.test('read_script: masks secrets, appends plain card source, rejects bad names', async () => {
    const hello = await call('read_script', { filename: 'hello.js' });
    assert.ok(hello.text.includes("const API_KEY = '***'"));
    assert.ok(!hello.text.includes('abcd1234secretvalue'));
    assert.match(hello.text, /masked by JSA secret filter/);

    const carded = await call('read_script', { filename: 'carded.ts' });
    assert.ok(carded.text.includes(CARD_SOURCE));
    assert.ok(!carded.text.includes('__JSA_CARD__'), 'base64 block must be stripped');

    assert.equal((await call('read_script', { filename: 'libraries/helper.js' })).isError, false);
    for (const bad of ['../secrets.js', 'flow.blocks', 'nope.js', '..\\x.js', 'x.d.ts']) {
      assert.equal((await call('read_script', { filename: bad })).isError, true, bad);
    }
  });

  await t.test('get_logs: filters by script, level, age and text; masks secrets', async () => {
    const hello = (await call('get_logs', { script: 'hello.js' })).text;
    assert.match(hello, /hello started/);
    assert.match(hello, /old line/);
    assert.equal(
      (await call('get_logs', { script: 'Hello Script', since_minutes: 30 })).text.includes('old line'),
      false
    );

    const broken = (await call('get_logs', { script: 'broken.js' })).text;
    assert.match(broken, /TypeError/);
    assert.ok(!broken.includes('debug noise'), 'default level is info');
    assert.match((await call('get_logs', { script: 'broken.js', level: 'debug' })).text, /debug noise/);

    assert.match((await call('get_logs', { level: 'error' })).text, /Compile error in broken\.js/);
    assert.match((await call('get_logs', { search: 'STARTED' })).text, /hello started/);
    const leaked = (await call('get_logs', { level: 'warn' })).text;
    assert.ok(leaked.includes('token = "***"') && !leaked.includes('abcdefghijkl'));
    assert.equal((await call('get_logs', { search: 'zzz-no-match' })).text, 'No matching log entries.');
  });

  await t.test('get_script_errors: status, own errors and compiler messages', async () => {
    const r = await call('get_script_errors', { filename: 'broken.js' });
    assert.match(r.text, /status: error/);
    assert.match(r.text, /TypeError: x is not a function/);
    assert.match(r.text, /Compile error in broken\.js/);
    assert.match((await call('get_script_errors', { filename: 'hello.js' })).text, /status: running/);
    assert.equal((await call('get_script_errors', { filename: 'nope.js' })).isError, true);
  });

  await t.test('get_events: formats state changes and other events', async () => {
    const all = (await call('get_events')).text.split('\n');
    assert.equal(all.length, 2);
    assert.match(all[1], /state_changed light\.kitchen: off -> on/);
    assert.match(all[0], /my_event \{"a":1\}/);
    assert.match((await call('get_events', { entity_id: 'light.kitchen' })).text, /light\.kitchen/);
    assert.equal((await call('get_events', { event_type: 'nothing' })).text, 'No matching events in the buffer.');
  });

  await t.test('list_entities / get_entity', async () => {
    const lights = (await call('list_entities', { domain: 'light' })).text;
    assert.match(lights, /2 match/);
    assert.match(lights, /light\.kitchen \| on \| Kitchen Light/);
    assert.ok(!lights.includes('sensor.temp'));
    assert.match((await call('list_entities', { search: 'outside' })).text, /sensor\.temp/);
    assert.match((await call('get_entity', { entity_id: 'light.kitchen' })).text, /"brightness": 200/);
    assert.equal((await call('get_entity', { entity_id: 'light.nope' })).isError, true);
  });

  await t.test('get_store: off by default, never returns secrets, masks sensitive keys', async () => {
    assert.ok(!(await client.listTools()).tools.some((x) => x.name === 'get_store'));
    settings.mcp.tool_get_store = true;
    const all = (await call('get_store')).text;
    assert.match(all, /guest_mode \| true \| owner: hello\.js/);
    assert.match(all, /api_credentials \| \(secret, value withheld\)/);
    assert.match(all, /wifi_password \| \*\*\* \(masked: sensitive key name\)/);
    assert.ok(!all.includes('hunter2hunter2'));
    assert.ok(!all.includes('abcdefgh12'), 'sensitive text inside a plain value is masked as well');
    assert.match((await call('get_store', { key: 'guest_mode' })).text, /^guest_mode/);
    assert.equal((await call('get_store', { search: 'zzz' })).text, 'No matching store entries.');
    delete settings.mcp.tool_get_store;
  });

  await t.test('get_api_reference: topic list, a topic, missing file', async () => {
    assert.match((await call('get_api_reference')).text, /authoring: /);
    assert.equal((await call('get_api_reference', { topic: 'authoring' })).text, '# Authoring guide');
    assert.equal((await call('get_api_reference', { topic: 'types' })).text, 'declare const ha: any;');
    assert.equal((await call('get_api_reference', { topic: 'cards' })).isError, true, 'file missing in this fixture');
  });
});
