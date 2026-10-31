const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const cf = require('../js_automations/core/card-files.js');
const CardManager = require('../js_automations/core/card-manager.js');

const header = '/**\n * @name Garmin\n * @description Fitness data\n * @card\n */\nha.log(1);\n';
const MAIN = 'class G extends HTMLElement {}\ncustomElements.define("garmin-card", G);';
const DAY = 'class D extends HTMLElement {}\ncustomElements.define("garmin-day-card", D);';

// A Home Assistant connection that remembers its Lovelace resources.
function fakeHa() {
  const resources = [];
  let next = 1;
  const commands = [];
  return {
    resources,
    commands,
    isReady: true,
    sendCommand: async (type, payload) => {
      commands.push(type);
      if (type === 'lovelace/resources') return { resources: [...resources] };
      if (type === 'lovelace/resources/create') {
        const id = `res-${next++}`;
        resources.push({ id, url: payload.url });
        return { id };
      }
      if (type === 'lovelace/resources/update') {
        const r = resources.find((x) => x.id === payload.resource_id);
        if (r) r.url = payload.url;
        return {};
      }
      if (type === 'lovelace/resources/delete') {
        const i = resources.findIndex((x) => x.id === payload.resource_id);
        if (i >= 0) resources.splice(i, 1);
        return {};
      }
      return {};
    },
  };
}

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-multicard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptsDir = path.join(dir, 'scripts');
  const cardsDir = path.join(scriptsDir, 'cards');
  const storage = path.join(dir, 'storage');
  const www = path.join(dir, 'www', 'jsa-cards');
  mkdirSync(cardsDir, { recursive: true });
  mkdirSync(storage, { recursive: true });
  const script = path.join(scriptsDir, 'garmin.ts');
  writeFileSync(script, header);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  const ha = fakeHa();
  const manager = new CardManager(storage, www, ha, cardsDir);
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  t.after(() => {
    console.log = log;
    console.warn = warn;
  });
  return { dir, scriptsDir, cardsDir, www, script, ha, manager };
}

test('the main card installs as before, a further card gets its own file, resource and registry entry', async (t) => {
  const { www, script, ha, manager } = setup(t);
  const mainUrl = await manager.installCard(script);
  const dayUrl = await manager.installCard(script, { card: 'garmin-day-card' });

  assert.match(mainUrl, /^\/local\/jsa-cards\/garmin-card\.js\?v=[0-9a-f]{8}$/);
  assert.match(dayUrl, /^\/local\/jsa-cards\/garmin-day-card\.js\?v=[0-9a-f]{8}$/);
  assert.deepEqual(readdirSync(www).sort(), ['garmin-card.js', 'garmin-day-card.js']);
  assert.deepEqual(Object.keys(manager.registry).sort(), ['garmin', 'garmin-day-card'], 'main under the script name');
  assert.equal(ha.resources.length, 2);
  assert.deepEqual(ha.resources.map((r) => r.url.split('?')[0]).sort(), [
    '/local/jsa-cards/garmin-card.js',
    '/local/jsa-cards/garmin-day-card.js',
  ]);
  assert.ok(readFileSync(path.join(www, 'garmin-day-card.js'), 'utf8').includes('class D extends HTMLElement'));
  assert.ok(!readFileSync(path.join(www, 'garmin-day-card.js'), 'utf8').includes('class G extends'));
});

test('picker name and description: defaults, the call can override them, a hand-made entry is not doubled', async (t) => {
  const { www, script, manager } = setup(t);
  await manager.installCard(script);
  await manager.installCard(script, { card: 'garmin-day-card' });
  const main = readFileSync(path.join(www, 'garmin-card.js'), 'utf8');
  const day = readFileSync(path.join(www, 'garmin-day-card.js'), 'utf8');
  assert.match(main, /type: 'garmin-card', name: "Garmin", description: "Fitness data", preview: true/);
  assert.match(day, /type: 'garmin-day-card', name: "Garmin – Day", description: "Fitness data", preview: true/);
  assert.match(day, /customCards\.some\(function \(c\) \{ return c\.type === 'garmin-day-card'; \}\)/);

  await manager.installCard(script, {
    card: 'garmin-day-card',
    name: 'Garmin Tag',
    description: 'Ein Tag',
    config: { entity: 'sensor.garmin' },
    force: true,
  });
  const custom = readFileSync(path.join(www, 'garmin-day-card.js'), 'utf8');
  assert.match(custom, /name: "Garmin Tag", description: "Ein Tag"/);
  assert.match(custom, /getStubConfig = function \(\) \{ return \{"entity":"sensor\.garmin"\}; \}/);
  assert.ok(
    !readFileSync(path.join(www, 'garmin-card.js'), 'utf8').includes('sensor.garmin'),
    'the stub config belongs to that card only'
  );
});

test('an unchanged card is not written again, a changed one only reloads itself', async (t) => {
  const { cardsDir, www, script, manager } = setup(t);
  const first = await manager.installCard(script, { card: 'garmin-day-card' });
  await manager.installCard(script);
  const again = await manager.installCard(script, { card: 'garmin-day-card' });
  assert.equal(again, first, 'same hash, same URL');

  const mainBefore = manager.registry.garmin.resourceUrl;
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY + '\n// v2');
  const changed = await manager.installCard(script, { card: 'garmin-day-card' });
  assert.notEqual(changed, first, 'the changed card gets a new URL');
  assert.equal(manager.registry.garmin.resourceUrl, mainBefore, 'the main card is untouched');
  assert.ok(readFileSync(path.join(www, 'garmin-day-card.js'), 'utf8').includes('// v2'));
});

test('invalid or missing cards are rejected with a clear message', async (t) => {
  const { script, manager } = setup(t);
  await assert.rejects(() => manager.installCard(script, { card: 'other-card' }), /Invalid card name "other-card"/);
  await assert.rejects(() => manager.installCard(script, { card: '../x' }), /Invalid card name/);
  await assert.rejects(
    () => manager.installCard(script, { card: 'garmin-night-card' }),
    /Card "garmin-night-card" not found: expected the file cards\/garmin-night-card\.js/
  );
  await manager.installCard(script, { card: 'garmin-card' }); // the main card by its own name
  assert.deepEqual(Object.keys(manager.registry), ['garmin']);
});

test('the cleanup keeps the cards of a script and removes those that have no file any more', async (t) => {
  const { cardsDir, www, script, ha, manager } = setup(t);
  await manager.installCard(script);
  await manager.installCard(script, { card: 'garmin-day-card' });
  assert.deepEqual(manager.knownCardNames([script]), ['garmin-card', 'garmin-day-card']);

  await manager.performStartupCleanup(manager.knownCardNames([script]));
  assert.deepEqual(readdirSync(www).sort(), ['garmin-card.js', 'garmin-day-card.js'], 'nothing is orphaned');
  assert.equal(ha.resources.length, 2);

  rmSync(path.join(cardsDir, 'garmin-day-card.js'));
  await manager.performStartupCleanup(manager.knownCardNames([script]));
  assert.deepEqual(readdirSync(www), ['garmin-card.js']);
  assert.equal(ha.resources.length, 1);
  assert.deepEqual(Object.keys(manager.registry), ['garmin']);
});

test('deleting the script removes every installed card, its files and resources', async (t) => {
  const { cardsDir, www, script, ha, manager } = setup(t);
  await manager.installCard(script);
  await manager.installCard(script, { card: 'garmin-day-card' });
  manager.removeCard(script);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(existsSync(www) ? readdirSync(www) : [], []);
  assert.deepEqual(Object.keys(manager.registry), []);
  assert.deepEqual(cf.listCardNames(cardsDir, 'garmin'), [], 'the source files go too');
  assert.equal(ha.resources.length, 0);
});

test('listCards names the main card first, also for an old embedded one', async (t) => {
  const { scriptsDir, script, manager } = setup(t);
  assert.deepEqual(manager.listCards(script), [{ name: 'garmin-card' }, { name: 'garmin-day-card' }]);
  const legacy = path.join(scriptsDir, 'old.js');
  writeFileSync(legacy, `${header}\n${cf.encodeBlock(MAIN)}\n`);
  assert.deepEqual(manager.listCards(legacy), [{ name: 'old-card', embedded: true }]);
  assert.equal(manager.getCardSource(script, 'garmin-card'), MAIN, 'the main card also by its own name');
  assert.equal(manager.getCardSource(script, 'garmin-day-card'), DAY);
});
