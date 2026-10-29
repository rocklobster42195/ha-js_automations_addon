const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// The port is read when the module loads, so choose it first (parallel test files must not collide).
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const GitManager = require('../js_automations/core/git-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');
const { registerWriteTools } = require('../js_automations/core/mcp-tools-write.js');

const CARD_SRC = 'class DemoCard extends HTMLElement {}\ncustomElements.define("demo-card", DemoCard);';
const cardBlock = (src) => `/* __JSA_CARD__\n${Buffer.from(src).toString('base64')}\n__JSA_CARD_END__ */`;

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-write-'));
  const scriptsDir = path.join(dir, 'scripts');
  const librariesDir = path.join(scriptsDir, 'libraries');
  const storageDir = path.join(dir, 'storage');
  for (const d of [librariesDir, storageDir]) mkdirSync(d, { recursive: true });
  // Typings the type check runs against: the real ha-api.d.ts plus empty generated ones.
  copyFileSync(path.join(__dirname, '../js_automations/core/types/ha-api.d.ts'), path.join(storageDir, 'ha-api.d.ts'));
  writeFileSync(path.join(storageDir, 'entities.d.ts'), 'interface HAEntities {}\ninterface GlobalStoreSchema {}\n');
  writeFileSync(path.join(storageDir, 'services.d.ts'), 'interface ServiceMap {}\n');

  const calls = [];
  const workers = new Map();
  const workerManager = {
    workers,
    stopScript: (n, r) => calls.push(['stop', n, r]),
    purgeWebhooksForScript: (n) => calls.push(['purge', n]),
  };
  const cardManager = { removeCard: (p) => calls.push(['removeCard', path.basename(p)]) };
  const depManager = { prune: async () => calls.push(['prune']) };
  const events = [];

  const settings = {
    mcp: {
      enabled: true,
      external_url: '',
      trust_proxy: false,
      allowlist: '',
      tool_write_script: true,
      tool_write_card: true,
      tool_delete_script: true,
    },
    versioning: {},
  };
  const settingsManager = { on() {}, getSettings: () => settings };
  const gitManager = new GitManager(settingsManager, { add() {} }, scriptsDir);
  const manager = new McpManager(settingsManager, { add() {} }, storageDir);
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  registerWriteTools(protocol, {
    workerManager,
    cardManager,
    depManager,
    gitManager,
    scriptsDir,
    librariesDir,
    storageDir,
    typesDir: path.join(__dirname, '../js_automations/core/types'),
    notifyStatusUpdate: () => events.push('status'),
    notifyContentChanged: (f) => events.push(`changed:${f}`),
  });
  manager.init();
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: scriptsDir, encoding: 'utf8' });
  return { manager, scriptsDir, librariesDir, calls, workers, events, git };
}

test('write tools check, write, commit and delete safely', async (t) => {
  const { manager, scriptsDir, librariesDir, calls, workers, events, git } = setup(t);
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
  const file = (name) => path.join(scriptsDir, name);
  const subjects = () => git('log', '--format=%s').trim().split('\n');

  await t.test('creates a new TypeScript script with a Git commit and notifies the editor', async () => {
    const src = `/**\n * @name Demo\n */\nconst x: number = 1;\nha.log(String(x));\n`;
    const r = await call('write_script', { filename: 'demo.ts', content: src, message: 'first version' });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Created script "demo\.ts"/);
    assert.match(r.text, /Type check: no problems found/);
    assert.equal(readFileSync(file('demo.ts'), 'utf8'), src);
    assert.equal(subjects()[0], 'mcp: first version');
    assert.ok(events.includes('changed:demo.ts') && events.includes('status'));
    assert.ok(!existsSync(file('demo.ts.mcp-tmp')), 'temp file must be gone');
  });

  await t.test('uncommitted local edits are snapshotted before an update overwrites them', async () => {
    writeFileSync(
      file('demo.ts'),
      `/** @name Demo */\nconst userEdit = 1; // typed by the user, never committed\nha.log('u');\n`
    );
    const r = await call('write_script', { filename: 'demo.ts', content: `/** @name Demo */\nha.log('from ai');\n` });
    assert.match(r.text, /Updated script "demo\.ts"/);
    const log = subjects();
    assert.equal(log[0], 'mcp: update demo.ts');
    assert.equal(log[1], 'mcp: snapshot before changing demo.ts');
    assert.match(git('show', 'HEAD~1:demo.ts'), /typed by the user/);
  });

  await t.test('syntax errors block the write and leave the file untouched', async () => {
    const before = readFileSync(file('demo.ts'), 'utf8');
    const r = await call('write_script', { filename: 'demo.ts', content: `ha.log('oops'\nconst = ;\n` });
    assert.equal(r.isError, true);
    assert.match(r.text, /Not written — syntax errors/);
    assert.match(r.text, /line \d+:\d+ TS\d+/);
    assert.equal(readFileSync(file('demo.ts'), 'utf8'), before);
  });

  await t.test('credentials in the source are flagged, empty persisted credentials are not', async () => {
    const leaky = await call('write_script', {
      filename: 'leaky.ts',
      content: "/** @name Leaky */\nconst apiKey = 'sk_live_abcdef123456';\nha.log('x');\n",
    });
    assert.equal(leaky.isError, false);
    assert.match(leaky.text, /WARNING: 1 value\(s\) in the source look like credentials/);
    assert.match(leaky.text, /empty fields of the persisted config/);
    assert.ok(existsSync(file('leaky.ts')), 'still written, the assistant is told to fix it');

    const clean = await call('write_script', {
      filename: 'clean.ts',
      content:
        "/** @name Clean */\ninterface C { apiKey: string }\nconst config = ha.persistent<C>('clean_config', { apiKey: '' });\nif (!config.apiKey) ha.warn('API key missing');\n",
    });
    assert.doesNotMatch(clean.text, /look like credentials/);
  });

  await t.test('type problems are returned as warnings but the file is written', async () => {
    const r = await call('write_script', {
      filename: 'typed.ts',
      content: `/** @name Typed */\nha.definitelyNotAnApi();\n`,
    });
    assert.equal(r.isError, false);
    assert.match(r.text, /Type warnings \(\d+\)/);
    assert.match(r.text, /definitelyNotAnApi/);
    assert.ok(existsSync(file('typed.ts')));
  });

  await t.test('an existing card survives a write without a card block (placeholder stripped)', async () => {
    writeFileSync(file('carded.ts'), `/** @name Carded\n * @card\n */\nha.log('a');\n\n${cardBlock(CARD_SRC)}\n`);
    const r = await call('write_script', {
      filename: 'carded.ts',
      content: `/** @name Carded\n * @card\n */\n/* card source: see the "Card source" section below */\nha.log('b');\n`,
    });
    assert.equal(r.isError, false, r.text);
    const after = readFileSync(file('carded.ts'), 'utf8');
    assert.ok(after.includes("ha.log('b')"));
    assert.ok(!after.includes('card source: see'));
    assert.ok(after.includes(Buffer.from(CARD_SRC).toString('base64')), 'card block preserved');
    const rejected = await call('write_script', { filename: 'carded.ts', content: `ha.log(1);\n${cardBlock('x')}` });
    assert.equal(rejected.isError, true);
    assert.match(rejected.text, /write_card/);
  });

  await t.test('write_card replaces the block, validates syntax and warns about a missing @card tag', async () => {
    const next = 'class Other extends HTMLElement {}\ncustomElements.define("other-card", Other);';
    const ok = await call('write_card', { filename: 'carded.ts', source: next });
    assert.equal(ok.isError, false, ok.text);
    const after = readFileSync(file('carded.ts'), 'utf8');
    assert.ok(after.includes(Buffer.from(next).toString('base64')));
    assert.ok(!after.includes(Buffer.from(CARD_SRC).toString('base64')));
    assert.equal((after.match(/__JSA_CARD__/g) || []).length, 1);
    assert.doesNotMatch(ok.text, /no "@card" tag/);

    const noTag = await call('write_card', { filename: 'demo.ts', source: next });
    assert.match(noTag.text, /no "@card" tag/);
    assert.match(readFileSync(file('demo.ts'), 'utf8'), /__JSA_CARD_END__/);

    const bad = await call('write_card', { filename: 'carded.ts', source: 'class {' });
    assert.equal(bad.isError, true);
    assert.equal((await call('write_card', { filename: 'nope.ts', source: next })).isError, true);
    assert.equal((await call('write_card', { filename: 'carded.ts', source: '   ' })).isError, true);
  });

  await t.test('libraries land in libraries/, names and conflicts are validated', async () => {
    const lib = await call('write_script', {
      filename: 'libraries/helpers.ts',
      content: `/** @name Helpers */\nexport const a = 1;\n`,
    });
    assert.equal(lib.isError, false, lib.text);
    assert.match(lib.text, /Created library "helpers\.ts"/);
    assert.ok(existsSync(path.join(librariesDir, 'helpers.ts')));

    const viaKind = await call('write_script', { filename: 'more.js', kind: 'library', content: `exports.b = 2;\n` });
    assert.ok(existsSync(path.join(librariesDir, 'more.js')), viaKind.text);

    assert.match((await call('write_script', { filename: 'demo.js', content: `ha.log(1);\n` })).text, /already exists/);
    for (const filename of ['Upper.ts', 'has space.ts', '../evil.ts', 'x.blocks', 'x.d.ts', 'x.txt']) {
      assert.equal((await call('write_script', { filename, content: 'ha.log(1);' })).isError, true, filename);
    }
    assert.ok(!existsSync(path.join(scriptsDir, '..', 'evil.ts')));
  });

  await t.test('a running script is flagged for restart', async () => {
    workers.set('demo.ts', {});
    const r = await call('write_script', { filename: 'demo.ts', content: `/** @name Demo */\nha.log('again');\n` });
    assert.match(r.text, /running with the previous version — call restart_script/);
    workers.clear();
  });

  await t.test('delete_script stops, removes, cleans up and commits the deletion', async () => {
    calls.length = 0;
    const r = await call('delete_script', { filename: 'typed.ts' });
    assert.equal(r.isError, false, r.text);
    assert.ok(!existsSync(file('typed.ts')));
    assert.deepEqual(
      calls.map((c) => c[0]),
      ['stop', 'purge', 'removeCard', 'prune']
    );
    assert.equal(subjects()[0], 'mcp: delete typed.ts');
    assert.match(git('show', 'HEAD~1:typed.ts'), /definitelyNotAnApi/, 'last state is in history');
    assert.equal((await call('delete_script', { filename: 'typed.ts' })).isError, true);

    calls.length = 0;
    await call('delete_script', { filename: 'libraries/helpers.ts' });
    assert.ok(!calls.some((c) => c[0] === 'removeCard'), 'libraries have no card');
  });
});
