const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// The port is read when the module loads, so choose it first (parallel test files must not collide).
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.JSA_MCP_PORT = String(PORT);
const McpManager = require('../js_automations/core/mcp-manager.js');
const { McpProtocol } = require('../js_automations/core/mcp-protocol.js');
const { McpActivityLog } = require('../js_automations/core/mcp-activity-log.js');
const { McpFeedbackStore, MENTION_THRESHOLD } = require('../js_automations/core/mcp-feedback-store.js');
const { registerFeedbackTool } = require('../js_automations/core/mcp-tools-feedback.js');
const { MCP_TOOL_CATALOG, isToolEnabled } = require('../js_automations/core/mcp-tool-catalog.js');
const mcpRoute = require('../js_automations/routes/mcp-route.js');

const tmp = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcp-feedback-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('maintainer-only tools are off by default and only follow maintainer mode', () => {
  const meta = MCP_TOOL_CATALOG.find((m) => m.name === 'jsa_feedback');
  assert.equal(meta.maintainerOnly, true);
  assert.equal(isToolEnabled({}, meta), false);
  assert.equal(isToolEnabled({ tool_jsa_feedback: true }, meta), false, 'no settings switch can enable it');
  assert.equal(isToolEnabled({}, meta, true), true);
});

test('store: hard errors are reported at once, normal notes after the threshold, each only once', (t) => {
  const store = new McpFeedbackStore(tmp(t));
  assert.equal(MENTION_THRESHOLD, 3);

  const hard = store.add({
    kind: 'bug',
    severity: 'hard_error',
    title: 'ha.update crashes the worker on null attributes',
  });
  assert.equal(hard.created, true);
  assert.equal(hard.mention, 'now');
  assert.equal(
    store.add({ kind: 'bug', severity: 'hard_error', title: 'ha.update crashes the worker on null attributes' })
      .mention,
    null,
    'not again'
  );

  const mentions = [1, 2, 3, 4, 5].map(
    () => store.add({ kind: 'api', title: 'ha.register options are hard to discover' }).mention
  );
  assert.deepEqual(mentions, [null, null, 'later', null, null]);
});

test('store: a repeated normal note that turns out to be a hard error is reported immediately', (t) => {
  const store = new McpFeedbackStore(tmp(t));
  store.add({ kind: 'bug', title: 'ha.store.get returns undefined after restart' });
  const r = store.add({ kind: 'bug', severity: 'hard_error', title: 'ha.store.get returns undefined after restart' });
  assert.equal(r.note.severity, 'hard_error');
  assert.equal(r.mention, 'now');
});

test('store: similar titles merge, different kinds and topics do not, same_as wins', (t) => {
  const store = new McpFeedbackStore(tmp(t));
  const a = store.add({ kind: 'api', title: 'ha.register options are hard to discover' });
  const b = store.add({ kind: 'api', title: 'ha.register options hard to discover' });
  assert.equal(b.created, false);
  assert.equal(b.note.id, a.note.id);
  assert.equal(b.note.count, 2);

  assert.equal(
    store.add({ kind: 'docs', title: 'ha.register options are hard to discover' }).created,
    true,
    'other kind'
  );
  assert.equal(
    store.add({ kind: 'api', title: 'schedule() cron syntax is not documented' }).created,
    true,
    'other topic'
  );

  const viaId = store.add({ kind: 'feature', title: 'completely different wording', sameAs: a.note.id });
  assert.equal(viaId.note.id, a.note.id);
  assert.equal(viaId.note.count, 3);
  assert.equal(viaId.mention, 'later');
});

test('store: keeps the most detailed text, masks secrets, trims lengths', (t) => {
  const store = new McpFeedbackStore(tmp(t));
  const first = store.add({ kind: 'docs', title: 'authoring guide misses ha.fs', detail: 'short' });
  store.add({
    kind: 'docs',
    title: 'authoring guide misses ha.fs',
    detail: 'a much longer explanation with more context',
  });
  assert.equal(store.list()[0].detail, 'a much longer explanation with more context');
  assert.equal(first.note.id, store.list()[0].id);

  const leaky = store.add({
    kind: 'bug',
    title: 'config',
    detail: `apiKey = 'sk_live_abcdef123456' ${'x'.repeat(3000)}`,
  });
  assert.ok(!leaky.note.detail.includes('sk_live'));
  assert.ok(leaky.note.detail.length <= 1500);
  assert.ok(store.add({ kind: 'bug', title: 'y'.repeat(500) }).note.title.length <= 120);
});

test('store: ordering, removal, persistence, damaged file, bounded size', (t) => {
  const dir = tmp(t);
  const store = new McpFeedbackStore(dir);
  store.add({ kind: 'api', title: 'alpha api topic words' });
  store.add({ kind: 'api', title: 'alpha api topic words' });
  const beta = store.add({ kind: 'feature', title: 'beta feature request here' });
  const hard = store.add({ kind: 'bug', severity: 'hard_error', title: 'gamma crash on startup' });
  assert.deepEqual(
    store.list().map((n) => n.title),
    ['gamma crash on startup', 'alpha api topic words', 'beta feature request here']
  );

  assert.equal(new McpFeedbackStore(dir).list().length, 3, 'reloaded from disk');
  assert.equal(store.remove(beta.note.id), true);
  assert.equal(store.remove('nope'), false);
  assert.equal(new McpFeedbackStore(dir).list().length, 2);

  writeFileSync(path.join(dir, 'mcp-feedback.json'), '{ not json');
  assert.deepEqual(new McpFeedbackStore(dir).list(), []);

  const big = new McpFeedbackStore(tmp(t));
  big.add({ kind: 'bug', severity: 'hard_error', title: 'keep me crash' });
  for (let i = 0; i < 230; i++) big.add({ kind: 'other', title: `unique${i}a unique${i}b unique${i}c` });
  assert.ok(big.list().length <= 200);
  assert.ok(
    big.list().some((n) => n.title === 'keep me crash'),
    'hard errors survive pruning'
  );
  assert.ok(hard.note.id);
});

test('jsa_feedback is hidden outside maintainer mode; instructions and tool replies follow the rules', async (t) => {
  const dir = tmp(t);
  const settings = {
    mcp: { enabled: true, external_url: '', trust_proxy: false, allowlist: '' },
    general: { maintainer_mode: false },
  };
  const settingsManager = { on() {}, getSettings: () => settings };
  const store = new McpFeedbackStore(path.join(dir, 'fb'));
  const manager = new McpManager(settingsManager, { add() {} }, path.join(dir, 'storage'));
  const protocol = new McpProtocol(settingsManager, { add() {} }, new McpActivityLog(), '0.0.0');
  manager.setHandler((req, res) => protocol.handle(req, res));
  registerFeedbackTool(protocol, { store });
  manager.init();
  await new Promise((r) => (manager.server.listening ? r() : manager.server.once('listening', r)));
  t.after(() => manager.stop());

  const connect = async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${manager.revealToken()}`, Connection: 'close' } },
      })
    );
    return client;
  };
  const call = async (client, args) =>
    (await client.callTool({ name: 'jsa_feedback', arguments: args })).content[0].text;

  await t.test('off: no tool, no maintainer instructions', async () => {
    const client = await connect();
    assert.deepEqual((await client.listTools()).tools, []);
    assert.doesNotMatch(client.getInstructions(), /MAINTAINER MODE/);
    await client.close();
  });

  await t.test('on: tool and instructions appear (repo URL included, hard errors called out)', async () => {
    settings.general.maintainer_mode = true;
    const client = await connect();
    assert.deepEqual(
      (await client.listTools()).tools.map((x) => x.name),
      ['jsa_feedback']
    );
    const instructions = client.getInstructions();
    assert.match(instructions, /MAINTAINER MODE/);
    assert.match(instructions, /github\.com\/rocklobster42195\/ha-js_automations_addon/);
    assert.match(instructions, /do not interrupt the task/i);
    assert.match(instructions, /Before you send your final reply, call jsa_feedback/);
    assert.match(instructions, /hard_error and tell the user immediately/);
    assert.match(instructions, /get_api_reference/, 'normal instructions are kept');
    await client.close();
  });

  await t.test('replies tell the assistant whether to stay quiet, speak later or speak now', async () => {
    const client = await connect();
    const quiet = await call(client, { kind: 'api', title: 'ha.on pattern syntax is confusing' });
    assert.match(quiet, /Noted \(fb_/);
    assert.match(quiet, /Nothing to tell the user yet/);

    await call(client, { kind: 'api', title: 'ha.on pattern syntax is confusing' });
    const later = await call(client, { kind: 'api', title: 'ha.on pattern syntax is confusing' });
    assert.match(later, /come up 3 times/);
    assert.match(later, /Mention it to the user ONCE/);

    const hard = await call(client, {
      kind: 'bug',
      severity: 'hard_error',
      title: 'worker dies on circular store value',
      detail: 'ha.store.set(k, circular)',
    });
    assert.match(hard, /^Noted \(fb_/);
    assert.match(hard, /HARD ERROR\. Tell the user about it right away/);

    const next = await call(client, { kind: 'docs', title: 'webhook allowlist format undocumented' });
    assert.match(next, /Existing notes/);
    assert.match(next, /ha\.on pattern syntax is confusing/);
    assert.match(next, /3×/);
    const id = /(fb_\w+) \| api/.exec(next)[1];
    assert.match(await call(client, { kind: 'api', title: 'whatever', same_as: id }), /Noted again \(fb_\w+, now 4×\)/);
    await client.close();
  });
});

test('GET/DELETE /feedback expose the notes to the UI', async (t) => {
  const store = new McpFeedbackStore(tmp(t));
  const note = store.add({ kind: 'feature', title: 'a feature idea worth keeping' }).note;
  let maintainer = true;
  const app = express();
  app.use(
    '/api/mcp',
    mcpRoute(
      { getStatus: () => ({}), revealToken: () => 't', rotateToken: () => 't' },
      { list: () => [] },
      { version: '3.1.0', bridgePath: '', iconPath: '' },
      {
        store,
        isMaintainerMode: () => maintainer,
      }
    )
  );
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/mcp/feedback`;

  const listed = await (await fetch(base)).json();
  assert.equal(listed.maintainerMode, true);
  assert.equal(listed.notes[0].id, note.id);

  maintainer = false;
  assert.equal((await (await fetch(base)).json()).maintainerMode, false);

  assert.equal((await fetch(`${base}/nope`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/${note.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await fetch(base)).json()).notes, []);
  assert.ok(readFileSync);
});
