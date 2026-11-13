const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const GitManager = require('../js_automations/core/git-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');
const { registerWriteTools } = require('../js_automations/core/mcp-tools-write.js');
const {
  McpProposalStore,
  hashText,
  MAX_OPEN_PROPOSALS,
  PROPOSAL_TTL_MS,
} = require('../js_automations/core/mcp-proposals.js');
const { isToolEnabled, MCP_TOOL_CATALOG, MCP_ACCESS_LEVELS } = require('../js_automations/core/mcp-tool-catalog.js');
const cardFiles = require('../js_automations/core/card-files.js');

const base = { kind: 'script', card: null, isNew: false, args: {}, baseHash: 'h1', message: 'm', warnings: [] };

test('store: one open proposal per file, follow-ups update it and keep the original base', () => {
  const store = new McpProposalStore();
  const changes = [];
  store.on('changed', () => changes.push(1));
  const first = store.propose({ ...base, filename: 'a.ts', content: 'one' });
  const again = store.propose({ ...base, filename: 'a.ts', content: 'two', baseHash: 'h2' });
  assert.equal(again.id, first.id, 'same file, same proposal');
  assert.equal(again.content, 'two');
  assert.equal(again.baseHash, 'h1', 'the base stays what the file looked like at the start');
  const card = store.propose({ ...base, kind: 'card', filename: 'a.ts', content: 'card' });
  const other = store.propose({ ...base, kind: 'card', filename: 'a.ts', card: 'a-day-card', content: 'day' });
  assert.equal(new Set([first.id, card.id, other.id]).size, 3, 'script, main card and further card are separate');
  assert.equal(store.openCount(), 3);
  assert.ok(changes.length >= 4);
});

test('store: close, latestClosed and what happens to a closed proposal', () => {
  const store = new McpProposalStore();
  const p = store.propose({ ...base, filename: 'a.ts', content: 'one' });
  assert.equal(store.close(p.id, 'rejected', '  wrong  ' + 'x'.repeat(600)).status, 'rejected');
  assert.equal(store.get(p.id).reason.length, 500, 'the reason is capped');
  assert.equal(store.close(p.id, 'applied'), undefined, 'a closed proposal cannot be closed again');
  assert.equal(store.findOpen('script', 'a.ts'), undefined);
  assert.equal(store.latestClosed('script', 'a.ts').id, p.id);
  const next = store.propose({ ...base, filename: 'a.ts', content: 'three' });
  assert.notEqual(next.id, p.id, 'after a close, a new proposal starts');
});

test('store: clearClosed forgets closed proposals and keeps the open ones', () => {
  const store = new McpProposalStore();
  const open = store.propose({ ...base, filename: 'open.ts', content: 'x' });
  const rejected = store.propose({ ...base, filename: 'rejected.ts', content: 'x' });
  const applied = store.propose({ ...base, filename: 'applied.ts', content: 'x' });
  store.close(rejected.id, 'rejected');
  store.close(applied.id, 'applied');
  let changed = 0;
  store.on('changed', () => changed++);
  assert.equal(store.clearClosed(), 2);
  assert.deepEqual(
    store.list().map((p) => p.id),
    [open.id]
  );
  assert.equal(changed, 1);
  assert.equal(store.clearClosed(), 0);
  assert.equal(changed, 1, 'nothing removed, nothing announced');
});

test('store: at most 20 open proposals (the oldest expires) and everything expires after 24 hours', () => {
  let now = 1_000_000;
  const store = new McpProposalStore(() => now);
  for (let i = 0; i < MAX_OPEN_PROPOSALS + 3; i++) {
    now += 10;
    store.propose({ ...base, filename: `f${i}.ts`, content: 'x' });
  }
  assert.equal(store.openCount(), MAX_OPEN_PROPOSALS);
  assert.equal(store.get(1).status, 'expired', 'the oldest ones made room');

  now += PROPOSAL_TTL_MS + 1;
  assert.equal(store.openCount(), 0);
  assert.ok(store.list().every((p) => p.status !== 'open'));
  now += PROPOSAL_TTL_MS + 1;
  assert.equal(store.list().length, 0, 'closed proposals are forgotten after the same time');
});

test('the access level "propose" enables the same tools as "write" but is its own level', () => {
  assert.ok(MCP_ACCESS_LEVELS.includes('propose'));
  assert.ok(MCP_ACCESS_LEVELS.indexOf('propose') < MCP_ACCESS_LEVELS.indexOf('write'));
  for (const meta of MCP_TOOL_CATALOG.filter((m) => !m.maintainerOnly)) {
    assert.equal(
      isToolEnabled({ access_level: 'propose' }, meta),
      isToolEnabled({ access_level: 'write' }, meta),
      meta.name
    );
  }
  const tool = (name) => MCP_TOOL_CATALOG.find((m) => m.name === name);
  assert.equal(isToolEnabled({ access_level: 'propose' }, tool('write_script')), true);
  assert.equal(isToolEnabled({ access_level: 'control' }, tool('write_script')), false);
  assert.equal(isToolEnabled({ access_level: 'propose' }, tool('delete_script')), false, 'delete keeps its own switch');
});

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-prop-'));
  const scriptsDir = path.join(dir, 'scripts');
  const librariesDir = path.join(scriptsDir, 'libraries');
  const storageDir = path.join(dir, 'storage');
  for (const d of [librariesDir, storageDir]) mkdirSync(d, { recursive: true });
  copyFileSync(path.join(__dirname, '../js_automations/core/types/ha-api.d.ts'), path.join(storageDir, 'ha-api.d.ts'));
  writeFileSync(path.join(storageDir, 'entities.d.ts'), 'interface HAEntities {}\ninterface GlobalStoreSchema {}\n');
  writeFileSync(path.join(storageDir, 'services.d.ts'), 'interface ServiceMap {}\n');

  const cardsDir = path.join(scriptsDir, 'cards');
  const workerManager = { workers: new Map(), stopScript() {}, purgeWebhooksForScript() {} };
  const cardManager = {
    removeCard() {},
    getCardSource: (p, card) => {
      const fromFile = cardFiles.readCardFile(cardsDir, cardFiles.cardBase(p), card);
      if (fromFile !== null || card) return fromFile;
      return cardFiles.extractBlocks(readFileSync(p, 'utf8'))[0]?.code ?? null;
    },
  };
  const settings = {
    mcp: {
      enabled: true,
      external_url: '',
      trust_proxy: false,
      allowlist: '',
      access_level: 'propose',
      tool_delete_script: true,
    },
    versioning: {},
  };
  const settingsManager = { on() {}, getSettings: () => settings };
  const gitManager = new GitManager(settingsManager, { add() {} }, scriptsDir);
  const manager = new McpManager(settingsManager, { add() {} }, storageDir);
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  const proposals = new McpProposalStore();
  const events = [];
  const tools = registerWriteTools(protocol, {
    workerManager,
    cardManager,
    depManager: { prune: async () => {} },
    gitManager,
    storeManager: { getAllPublic: () => ({}) },
    scriptsDir,
    librariesDir,
    notesDir: path.join(scriptsDir, 'notes'),
    cardsDir,
    storageDir,
    typesDir: path.join(__dirname, '../js_automations/core/types'),
    notifyStatusUpdate: () => events.push('status'),
    notifyContentChanged: (f) => events.push(`changed:${f}`),
    proposals,
    isProposeMode: () => settings.mcp.access_level === 'propose',
  });
  manager.init();
  t.after(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, scriptsDir, cardsDir, settings, proposals, tools, events };
}

test('in propose mode the write tools leave proposals and touch no file', async (t) => {
  const { manager, scriptsDir, cardsDir, settings, proposals, tools, events } = setup(t);
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
  const file = (n) => path.join(scriptsDir, n);
  const V1 = `/**\n * @name Demo\n */\nconst x: number = 1;\nha.log(String(x));\n`;

  await t.test('a new script becomes a proposal; nothing is written, committed or announced', async () => {
    const r = await call('write_script', { filename: 'demo.ts', content: V1, message: 'first version' });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /saved as proposal #1\. It is NOT applied/);
    assert.match(r.text, /Do not restart the script/);
    assert.match(r.text, /Type check: no problems found/);
    assert.equal(existsSync(file('demo.ts')), false);
    assert.deepEqual(events, []);
    const p = proposals.findOpen('script', 'demo.ts');
    assert.equal(p.isNew, true);
    assert.equal(p.baseHash, null);
    assert.equal(p.message, 'mcp: first version');
  });

  await t.test('syntax errors are still reported at once and create no proposal', async () => {
    const r = await call('write_script', { filename: 'broken.ts', content: 'const = ;' });
    assert.equal(r.isError, true);
    assert.match(r.text, /Not written — syntax errors/);
    assert.equal(proposals.findOpen('script', 'broken.ts'), undefined);
  });

  await t.test('edit_script builds on the pending proposal, also for a file that does not exist yet', async () => {
    const r = await call('edit_script', {
      filename: 'demo.ts',
      edits: [{ old_string: 'const x: number = 1;', new_string: 'const x: number = 2;' }],
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Applied 1 replacement/);
    assert.match(r.text, /Proposal #1 for "demo\.ts" updated \(still a new file\)\. It is NOT applied/);
    assert.ok(!r.text.includes('saved as proposal'), 'a follow-up does not claim to be a new file again');
    assert.equal(proposals.list().filter((p) => p.status === 'open').length, 1, 'still one proposal for the file');
    assert.ok(proposals.findOpen('script', 'demo.ts').content.includes('const x: number = 2;'));
    const second = await call('edit_script', {
      filename: 'demo.ts',
      edits: [{ old_string: 'ha.log(String(x));', new_string: 'ha.log("x=" + x);' }],
    });
    assert.equal(second.isError, false, second.text);
    const content = proposals.findOpen('script', 'demo.ts').content;
    assert.ok(content.includes('number = 2;') && content.includes('"x=" + x'), 'both edits are in the proposal');
    assert.equal(existsSync(file('demo.ts')), false);
  });

  await t.test('applying writes the file through the normal path, commits and closes the proposal', async () => {
    const result = await tools.applyProposal(proposals.findOpen('script', 'demo.ts').id);
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /Created script "demo\.ts"/);
    assert.ok(readFileSync(file('demo.ts'), 'utf8').includes('"x=" + x'));
    assert.deepEqual(
      events.filter((e) => e.startsWith('changed:')),
      ['changed:demo.ts']
    );
    assert.equal(proposals.findOpen('script', 'demo.ts'), undefined);
    assert.equal(proposals.latestClosed('script', 'demo.ts').status, 'applied');
    const again = await tools.applyProposal(1);
    assert.equal(again.ok, false);
    assert.match(again.message, /already applied/);
  });

  await t.test(
    'a proposal for an existing file records the file as it was and goes stale when it changes',
    async () => {
      const before = readFileSync(file('demo.ts'), 'utf8');
      const r = await call('write_script', { filename: 'demo.ts', content: before + '// more\n' });
      assert.equal(r.isError, false, r.text);
      const p = proposals.findOpen('script', 'demo.ts');
      assert.equal(p.isNew, false);
      assert.equal(p.baseHash, hashText(before));
      assert.equal(
        p.message,
        'mcp: update demo.ts: +1/-0 lines',
        'no message given: the proposal still has a real subject'
      );
      assert.equal(tools.proposalBefore(p), before, 'the diff view shows the file as it is now');

      writeFileSync(file('demo.ts'), before + '// the user edited it meanwhile\n');
      const result = await tools.applyProposal(p.id);
      assert.equal(result.ok, false);
      assert.match(result.message, /changed after this proposal/);
      assert.equal(proposals.get(p.id).status, 'stale');
      assert.ok(
        readFileSync(file('demo.ts'), 'utf8').includes('the user edited it meanwhile'),
        'the user work is untouched'
      );
    }
  );

  await t.test('a new file that appeared in the meantime also makes the proposal stale', async () => {
    await call('write_script', { filename: 'late.ts', content: V1 });
    const p = proposals.findOpen('script', 'late.ts');
    writeFileSync(file('late.ts'), '// someone created it\n');
    assert.equal((await tools.applyProposal(p.id)).ok, false);
    assert.equal(proposals.get(p.id).status, 'stale');
  });

  await t.test('the list knows early whether a proposal is outdated and says what it changes', async () => {
    await call('write_script', { filename: 'early.ts', content: V1 });
    const created = proposals.findOpen('script', 'early.ts');
    const infoNew = tools.proposalInfo(created);
    assert.equal(infoNew.stale, false);
    assert.match(infoNew.change, /^create early\.ts/);

    assert.equal((await tools.applyProposal(created.id)).ok, true);
    await call('write_script', { filename: 'early.ts', content: V1 + '// more\n' });
    const change = proposals.findOpen('script', 'early.ts');
    const infoChange = tools.proposalInfo(change);
    assert.equal(infoChange.stale, false);
    assert.match(infoChange.change, /^update early\.ts: \+1\/-0 lines/);

    writeFileSync(file('early.ts'), V1 + '// changed behind the back\n');
    assert.equal(tools.proposalInfo(change).stale, true, 'detected without trying to apply');
    assert.equal(proposals.get(change.id).status, 'open', 'asking does not close it');
  });

  await t.test('card changes become proposals too and are applied to the card file', async () => {
    const card = 'class DemoCard extends HTMLElement {}\ncustomElements.define("demo-card", DemoCard);';
    const r = await call('write_card', { filename: 'demo.ts', source: card });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /proposal #\d+/);
    assert.equal(existsSync(path.join(cardsDir, 'demo-card.js')), false);
    const edit = await call('edit_card', {
      filename: 'demo.ts',
      edits: [{ old_string: 'demo-card', new_string: 'demo-card-x' }],
    });
    assert.equal(edit.isError, false, edit.text);
    const p = proposals.findOpen('card', 'demo.ts');
    assert.ok(p.content.includes('demo-card-x'));
    assert.equal(tools.proposalBefore(p), '', 'a new card has nothing to compare with');
    const applied = await tools.applyProposal(p.id);
    assert.equal(applied.ok, true, applied.message);
    assert.ok(readFileSync(path.join(cardsDir, 'demo-card.js'), 'utf8').includes('demo-card-x'));
  });

  await t.test('rejecting closes a proposal and the file stays as it is', async () => {
    const before = readFileSync(file('demo.ts'), 'utf8');
    await call('write_script', { filename: 'demo.ts', content: before + '// rejected idea\n' });
    const p = proposals.findOpen('script', 'demo.ts');
    proposals.close(p.id, 'rejected', 'not wanted');
    assert.equal(readFileSync(file('demo.ts'), 'utf8'), before);
    assert.equal((await tools.applyProposal(p.id)).ok, false);
  });

  await t.test('level "write" writes directly, as before', async () => {
    settings.mcp.access_level = 'write';
    const open = proposals.list().filter((p) => p.status === 'open').length;
    const r = await call('write_script', { filename: 'direct.ts', content: V1 });
    assert.match(r.text, /Created script "direct\.ts"/);
    assert.ok(existsSync(file('direct.ts')));
    assert.equal(proposals.list().filter((p) => p.status === 'open').length, open);
  });

  await t.test('delete_script is refused at the level "propose" and the file stays', async () => {
    settings.mcp.access_level = 'propose';
    const r = await call('delete_script', { filename: 'demo.ts' });
    assert.equal(r.isError, true);
    assert.match(r.text, /not available at the access level "Propose"/);
    assert.ok(existsSync(file('demo.ts')));
  });
});
