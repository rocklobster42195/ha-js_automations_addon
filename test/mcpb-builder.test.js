const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const yauzl = require('yauzl');

const { buildManifest, buildMcpb, isBetaVersion } = require('../js_automations/core/mcpb-builder.js');
const mcpRoute = require('../js_automations/routes/mcp-route.js');

const BRIDGE = path.join(__dirname, '../js_automations/mcpb/bridge.js');
const ICON = path.join(__dirname, '../icon.png');

/** Reads every entry of a zip buffer into { name: Buffer }. */
function unzip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const files = {};
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

test('manifest has every field the MCPB spec requires and the user_config the bridge expects', () => {
  const m = buildManifest({ version: '3.1.0', url: 'http://ha.local:3002/mcp', token: 'jsamcp_abc', icon: true });
  for (const field of ['manifest_version', 'name', 'version', 'description', 'author', 'server']) {
    assert.ok(m[field], `missing required field ${field}`);
  }
  assert.equal(m.manifest_version, '0.3');
  assert.equal(m.name, 'js-automations');
  assert.equal(m.author.name, 'JS Automations');
  assert.equal(m.icon, 'icon.png');

  assert.equal(m.tools_generated, true);
  assert.equal(m.prompts_generated, true, 'the server offers prompts at runtime');

  assert.equal(m.server.type, 'node');
  assert.equal(m.server.entry_point, 'server/index.js');
  assert.equal(m.server.mcp_config.command, 'node');
  assert.deepEqual(m.server.mcp_config.args, ['${__dirname}/server/index.js']);

  // Every ${user_config.X} used in env must be a declared user_config entry (and vice versa).
  const used = Object.values(m.server.mcp_config.env).map((v) => /^\$\{user_config\.(\w+)\}$/.exec(v)[1]);
  assert.deepEqual(used.sort(), Object.keys(m.user_config).sort());
  assert.deepEqual(Object.keys(m.server.mcp_config.env).sort(), [
    'JSA_ALLOW_SELF_SIGNED',
    'JSA_MCP_TOKEN',
    'JSA_MCP_URL',
  ]);

  assert.deepEqual(
    [m.user_config.url.type, m.user_config.token.type, m.user_config.allow_self_signed.type],
    ['string', 'string', 'boolean']
  );
  assert.equal(m.user_config.token.sensitive, true);
  assert.equal(m.user_config.url.default, 'http://ha.local:3002/mcp');
  assert.equal(m.user_config.token.default, 'jsamcp_abc');
  assert.equal(m.user_config.allow_self_signed.default, false);
  assert.ok(m.compatibility.platforms.every((p) => ['darwin', 'win32', 'linux'].includes(p)));
});

test('beta add-ons get their own extension name, and the icon is optional', () => {
  assert.equal(isBetaVersion('3.0.3-beta.6'), true);
  assert.equal(isBetaVersion('3.1.0'), false);
  const m = buildManifest({ version: '3.0.3-beta.6', url: 'u', token: 't', icon: false });
  assert.equal(m.name, 'js-automations-beta');
  assert.equal(m.display_name, 'JS Automations (Beta)');
  assert.equal('icon' in m, false);
});

test('the .mcpb is a zip with manifest.json, the bridge and the icon at the paths the manifest names', async () => {
  const zip = await buildMcpb({
    version: '3.1.0',
    url: 'http://ha.local:3002/mcp',
    token: 'jsamcp_abc',
    bridgePath: BRIDGE,
    iconPath: ICON,
  });
  const files = await unzip(zip);
  assert.deepEqual(Object.keys(files).sort(), ['icon.png', 'manifest.json', 'server/index.js']);
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  assert.ok(files[manifest.server.entry_point], 'entry_point exists in the archive');
  assert.ok(files[manifest.icon], 'icon exists in the archive');
  assert.deepEqual(files['server/index.js'], readFileSync(BRIDGE));
  assert.equal(manifest.user_config.token.default, 'jsamcp_abc');
});

test('a missing icon file is skipped without failing', async () => {
  const zip = await buildMcpb({
    version: '3.1.0',
    url: 'u',
    token: 't',
    bridgePath: BRIDGE,
    iconPath: '/does/not/exist.png',
  });
  const files = await unzip(zip);
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'server/index.js']);
  assert.equal('icon' in JSON.parse(files['manifest.json'].toString('utf8')), false);
});

test('GET /mcpb serves the download and validates the url parameter', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-mcpb-route-'));
  const iconPath = path.join(dir, 'icon.png');
  writeFileSync(iconPath, readFileSync(ICON));
  const manager = { getStatus: () => ({}), revealToken: () => 'jsamcp_route', rotateToken: () => 'x' };
  const app = express();
  app.use('/api/mcp', mcpRoute(manager, { list: () => [] }, { version: '3.1.0', bridgePath: BRIDGE, iconPath }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/mcp/mcpb`;

  const ok = await fetch(`${base}?url=${encodeURIComponent('http://ha.local:3002/mcp')}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-disposition'), /attachment; filename="js-automations\.mcpb"/);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const files = await unzip(Buffer.from(await ok.arrayBuffer()));
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  assert.equal(manifest.user_config.url.default, 'http://ha.local:3002/mcp');
  assert.equal(manifest.user_config.token.default, 'jsamcp_route');

  for (const bad of [
    '',
    '?url=',
    '?url=ftp://x/mcp',
    '?url=javascript:alert(1)',
    '?url=notaurl',
    `?url=${encodeURIComponent('http://user:pw@h/mcp')}`,
    `?url=${'a'.repeat(400)}`,
  ]) {
    assert.equal((await fetch(base + bad)).status, 400, bad);
  }
});
