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
const cardFiles = require('../js_automations/core/card-files.js');

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
  // Store entries as the real store reports them: the owner is the script's display name.
  const storeEntries = {
    typed_config: { value: { apiKey: 'filled-in-value-123', city: 'Berlin' }, owner: 'Typed', isSecret: false },
    typed_unset: { value: { apiKey: '' }, owner: 'Typed', isSecret: false },
    typed_vault: { value: null, owner: 'Typed', isSecret: true },
    typed_token: { value: 'tok-123456', owner: 'Typed', isSecret: false },
    other_config: { value: { apiKey: 'other-secret-value' }, owner: 'Somebody Else', isSecret: false },
  };
  const storeManager = { getAllPublic: () => storeEntries };
  const cardsDirOfTest = path.join(scriptsDir, 'cards');
  const cardManager = {
    removeCard: (p) => calls.push(['removeCard', path.basename(p)]),
    // what the real CardManager does: card file first, an embedded block as fallback for the main card
    getCardSource: (p, card) => {
      const fromFile = cardFiles.readCardFile(cardsDirOfTest, cardFiles.cardBase(p), card);
      if (fromFile !== null || card) return fromFile;
      return cardFiles.extractBlocks(readFileSync(p, 'utf8'))[0]?.code ?? null;
    },
  };
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
      tool_edit_script: true,
      tool_edit_card: true,
      tool_save_script_notes: true,
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
    storeManager,
    scriptsDir,
    librariesDir,
    notesDir: path.join(scriptsDir, 'notes'),
    cardsDir: path.join(scriptsDir, 'cards'),
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
  return { manager, scriptsDir, librariesDir, calls, workers, events, git, settings };
}

test('write tools check, write, commit and delete safely', async (t) => {
  const { manager, scriptsDir, librariesDir, calls, workers, events, git, settings } = setup(t);
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

  await t.test('write_script description carries the core authoring rules', async () => {
    const { tools } = await client.listTools();
    const description = tools.find((x) => x.name === 'write_script').description;
    assert.match(description, /const CONFIG/);
    assert.match(description, /ONE ha.persistent object per script/);
    assert.match(description, /credentials never go into the source/);
  });

  await t.test('maintainer mode never puts instructions into the write result', async () => {
    const src = `/**\n * @name Remind\n */\nha.log('x');\n`;
    const plain = await call('write_script', { filename: 'remind.js', content: src });
    assert.doesNotMatch(plain.text, /jsa_feedback/);
    settings.general = { maintainer_mode: true };
    const maintainer = await call('write_script', { filename: 'remind.js', content: src + '// again\n' });
    delete settings.general;
    assert.doesNotMatch(maintainer.text, /jsa_feedback/, 'a tool result must not tell the assistant what to do');
    await call('delete_script', { filename: 'remind.js' });
  });

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
    assert.match(r.text, /topic "services"/);
    assert.match(r.text, /before you report the script as done/);
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

  await t.test('write_card stores the card as a file, moves an old block out and validates', async () => {
    const next = 'class Other extends HTMLElement {}\ncustomElements.define("other-card", Other);';
    const cardFile = (name) => path.join(scriptsDir, 'cards', name + '.js');
    const ok = await call('write_card', { filename: 'carded.ts', source: next });
    assert.equal(ok.isError, false, ok.text);
    assert.equal(readFileSync(cardFile('carded-card'), 'utf8'), next);
    const after = readFileSync(file('carded.ts'), 'utf8');
    assert.ok(!after.includes('__JSA_CARD__'), 'the old embedded block left the script');
    assert.doesNotMatch(ok.text, /no "@card" tag/);
    assert.match(
      git('show', '--stat', '--format=', 'HEAD'),
      /cards\/carded-card\.js/,
      'the card file is in the commit'
    );

    const noTag = await call('write_card', { filename: 'demo.ts', source: next });
    assert.match(noTag.text, /no "@card" tag/);
    assert.ok(existsSync(cardFile('demo-card')));
    assert.ok(!readFileSync(file('demo.ts'), 'utf8').includes('__JSA_CARD'));

    const further = await call('write_card', { filename: 'demo.ts', source: next, card: 'demo-day-card' });
    assert.equal(further.isError, false, further.text);
    assert.match(further.text, /not installed yet/);
    assert.ok(existsSync(cardFile('demo-day-card')));
    assert.equal((await call('write_card', { filename: 'demo.ts', source: next, card: 'other-card' })).isError, true);
    assert.equal((await call('write_card', { filename: 'demo.ts', source: next, card: '../x' })).isError, true);

    const bad = await call('write_card', { filename: 'carded.ts', source: 'class {' });
    assert.equal(bad.isError, true);
    assert.equal(readFileSync(cardFile('carded-card'), 'utf8'), next, 'a rejected card leaves the file alone');
    assert.equal((await call('write_card', { filename: 'nope.ts', source: next })).isError, true);
    assert.equal((await call('write_card', { filename: 'carded.ts', source: '   ' })).isError, true);
  });

  await t.test('edit_script changes a few lines, reports like write_script and is all-or-nothing', async () => {
    const src = '/**\n * @name Edit Me\n */\nconst LIMIT = 10;\nha.log("a");\nha.log("b");\n';
    assert.equal((await call('write_script', { filename: 'edit_me.js', content: src })).isError, false);
    const before = subjects().length;

    const ok = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [{ old_string: 'const LIMIT = 10;', new_string: 'const LIMIT = 20;' }],
      message: 'raise limit',
    });
    assert.equal(ok.isError, false, ok.text);
    assert.match(ok.text, /Applied 1 replacement/);
    assert.match(readFileSync(file('edit_me.js'), 'utf8'), /LIMIT = 20/);
    assert.equal(subjects()[0], 'mcp: raise limit');
    assert.equal(subjects().length, before + 1);

    const two = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [
        { old_string: 'LIMIT = 20', new_string: 'LIMIT = 30' },
        { old_string: 'LIMIT = 30;', new_string: 'LIMIT = 40;' },
      ],
    });
    assert.equal(two.isError, false, two.text);
    assert.match(readFileSync(file('edit_me.js'), 'utf8'), /LIMIT = 40;/);

    const unchanged = readFileSync(file('edit_me.js'), 'utf8');
    const missing = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [
        { old_string: 'LIMIT = 40;', new_string: 'LIMIT = 50;' },
        { old_string: 'nowhere', new_string: 'x' },
      ],
    });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /Edit 2 of 2.*not found/);
    const many = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [{ old_string: 'ha.log("', new_string: 'ha.warn("' }],
    });
    assert.equal(many.isError, true);
    assert.match(many.text, /matches 2 times/);
    assert.equal(readFileSync(file('edit_me.js'), 'utf8'), unchanged, 'a failed edit changes nothing');

    const all = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [{ old_string: 'ha.log("', new_string: 'ha.warn("', replace_all: true }],
    });
    assert.match(all.text, /Applied 2 replacement/);

    const broken = await call('edit_script', {
      filename: 'edit_me.js',
      edits: [{ old_string: 'ha.warn("a");', new_string: 'ha.warn(' }],
    });
    assert.equal(broken.isError, true);
    assert.match(broken.text, /syntax errors/);
    assert.match(readFileSync(file('edit_me.js'), 'utf8'), /ha\.warn\("a"\);/, 'a syntax error blocks the edit');

    assert.equal(
      (await call('edit_script', { filename: 'nope.js', edits: [{ old_string: 'a', new_string: 'b' }] })).isError,
      true
    );
    assert.equal((await call('edit_script', { filename: 'edit_me.js', edits: [] })).isError, true);
  });

  await t.test('edit_script keeps an old embedded card block and never touches it', async () => {
    const legacy = `/**\n * @name Legacy Edit\n * @card dev\n */\nha.log('legacy');\n\n${cardBlock(CARD_SRC)}\n`;
    writeFileSync(file('legacy_edit.js'), legacy);
    const r = await call('edit_script', {
      filename: 'legacy_edit.js',
      edits: [{ old_string: "ha.log('legacy');", new_string: "ha.log('edited');" }],
    });
    assert.equal(r.isError, false, r.text);
    const after = readFileSync(file('legacy_edit.js'), 'utf8');
    assert.match(after, /ha\.log\('edited'\);/);
    assert.ok(after.includes(Buffer.from(CARD_SRC).toString('base64')), 'the block is still there');
    assert.equal((after.match(/__JSA_CARD__/g) || []).length, 1);
  });

  await t.test('edit_card edits the card file, also an old embedded one, and a further card', async () => {
    const cardFile = (n) => path.join(scriptsDir, 'cards', n + '.js');
    const body =
      'class Edit extends HTMLElement {\n  label() { return "Ausreichend"; }\n}\ncustomElements.define("edit-me-card", Edit);';
    assert.equal((await call('write_card', { filename: 'edit_me.js', source: body })).isError, false);

    const ok = await call('edit_card', {
      filename: 'edit_me.js',
      edits: [{ old_string: '"Ausreichend"', new_string: '"Gut"' }],
      message: 'wording',
    });
    assert.equal(ok.isError, false, ok.text);
    assert.match(ok.text, /Applied 1 replacement/);
    assert.match(readFileSync(cardFile('edit_me-card'), 'utf8'), /"Gut"/);
    assert.equal(subjects()[0], 'mcp: wording');
    assert.match(git('show', '--stat', '--format=', 'HEAD'), /cards\/edit_me-card\.js/);

    const miss = await call('edit_card', { filename: 'edit_me.js', edits: [{ old_string: 'zzz', new_string: 'y' }] });
    assert.equal(miss.isError, true);
    const syntax = await call('edit_card', {
      filename: 'edit_me.js',
      edits: [{ old_string: 'class Edit extends HTMLElement {', new_string: 'class Edit extends HTMLElement {{' }],
    });
    assert.equal(syntax.isError, true);
    assert.match(readFileSync(cardFile('edit_me-card'), 'utf8'), /class Edit/, 'a broken card edit changes nothing');

    const e = [{ old_string: 'a', new_string: 'b' }];
    assert.equal(
      (await call('edit_card', { filename: 'edit_me.js', card: 'edit_me-day-card', edits: e })).isError,
      true
    );
    assert.equal((await call('edit_card', { filename: 'edit_me.js', card: 'other-card', edits: e })).isError, true);
    await call('write_card', { filename: 'edit_me.js', source: body, card: 'edit_me-day-card' });
    const further = await call('edit_card', {
      filename: 'edit_me.js',
      card: 'edit_me-day-card',
      edits: [{ old_string: 'Ausreichend', new_string: 'Tag' }],
    });
    assert.equal(further.isError, false, further.text);
    assert.match(readFileSync(cardFile('edit_me-day-card'), 'utf8'), /Tag/);
    assert.match(readFileSync(cardFile('edit_me-card'), 'utf8'), /Gut/, 'the main card is untouched');

    const embedded = `/**\n * @name Emb\n * @card dev\n */\nha.log(1);\n\n${cardBlock('class A {}\nconst x = 1;')}\n`;
    writeFileSync(file('emb.js'), embedded);
    const mig = await call('edit_card', {
      filename: 'emb.js',
      edits: [{ old_string: 'const x = 1;', new_string: 'const x = 2;' }],
    });
    assert.equal(mig.isError, false, mig.text);
    assert.match(readFileSync(cardFile('emb-card'), 'utf8'), /const x = 2;/);
    assert.ok(!readFileSync(file('emb.js'), 'utf8').includes('__JSA_CARD'), 'the block left the script');
  });

  await t.test('write_script drops the placeholder read_script shows instead of a card block', async () => {
    const src =
      '/**\n * @name Placeholder\n */\nha.log(1);\n\n/* card source: not included here, read it with read_script part "card" (or "all") */\n';
    const r = await call('write_script', { filename: 'placeholder.js', content: src });
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(readFileSync(file('placeholder.js'), 'utf8'), /card source/);
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

  await t.test('notes are saved, kept out of Git on their own and committed with the script', async () => {
    const before = subjects();
    const saved = await call('save_script_notes', { filename: 'typed.ts', content: '# Typed\n- quirk A' });
    assert.equal(saved.isError, false, saved.text);
    const noteFile = path.join(scriptsDir, 'notes', 'typed.md');
    assert.ok(existsSync(noteFile));
    assert.deepEqual(subjects(), before, 'saving notes makes no commit of its own');

    await call('save_script_notes', { filename: 'typed.ts', content: '- quirk B' });
    assert.match(readFileSync(noteFile, 'utf8'), /quirk A[\s\S]*quirk B/, 'append keeps the earlier text');

    const secret = await call('save_script_notes', {
      filename: 'typed.ts',
      content: "const apiKey = 'abcd1234secretvalue'",
    });
    assert.equal(secret.isError, true);

    const src = readFileSync(file('typed.ts'), 'utf8');
    await call('write_script', { filename: 'typed.ts', content: src + '// touched\n', message: 'x'.repeat(300) });
    assert.ok(subjects()[0].length <= 'mcp: '.length + 120, 'a long message is cut, not rejected');
    assert.match(
      git('log', '-2', '--stat', '--format='),
      /notes\/typed\.md/,
      'notes ride along with the commits of their script'
    );
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
    assert.match(r.text, /Store entries of this script remain/);
    assert.match(r.text, /typed_config \(credential-like field filled in: apiKey\)/);
    assert.match(r.text, /typed_token \(credential-like field filled in: typed_token\)/);
    assert.match(r.text, /typed_unset[;.]/, 'an empty credential field is listed but not flagged');
    assert.match(r.text, /typed_vault \(secret\)/);
    assert.ok(!r.text.includes('other_config'), "another script's entries are not mentioned");
    assert.ok(!r.text.includes('filled-in-value-123') && !r.text.includes('tok-123456'), 'values are never shown');
    assert.ok(events.includes('changed:typed.ts'), 'open editor tabs are told the file is gone');
    assert.equal((await call('delete_script', { filename: 'typed.ts' })).isError, true);

    calls.length = 0;
    const lib = await call('delete_script', { filename: 'libraries/helpers.ts' });
    assert.doesNotMatch(lib.text, /Store entries/, 'libraries own no store entries');
    assert.ok(!calls.some((c) => c[0] === 'removeCard'), 'libraries have no card');
  });
});
