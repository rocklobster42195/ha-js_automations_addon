const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cf = require('../js_automations/core/card-files.js');
const GitManager = require('../js_automations/core/git-manager.js');
const CardManager = require('../js_automations/core/card-manager.js');

const MAIN = 'class Main extends HTMLElement {}';
const DAY = 'class Day extends HTMLElement {}';
const SCRIPT = '/**\n * @name Garmin\n */\nha.log(1);\n';

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-cards-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptsDir = path.join(dir, 'scripts');
  const cardsDir = path.join(scriptsDir, 'cards');
  mkdirSync(scriptsDir);
  return { dir, scriptsDir, cardsDir };
}

test('card names: only "<script>-…" belongs to a script, the main card is "<script>-card"', (t) => {
  const { cardsDir } = setup(t);
  assert.equal(cf.cardFilePath(cardsDir, 'garmin'), path.join(cardsDir, 'garmin-card.js'));
  assert.equal(cf.cardFilePath(cardsDir, 'garmin', 'garmin-day-card'), path.join(cardsDir, 'garmin-day-card.js'));
  for (const bad of ['other-card', 'garmin-', '../garmin-x', 'garmin-Day', 'garmin x']) {
    assert.equal(cf.cardFilePath(cardsDir, 'garmin', bad), null, bad);
  }

  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  cf.writeCardFile(cardsDir, 'garmin_phone', undefined, MAIN);
  assert.deepEqual(cf.listCardNames(cardsDir, 'garmin'), ['garmin-card', 'garmin-day-card']);
  assert.deepEqual(cf.listCardNames(cardsDir, 'garmin_phone'), ['garmin_phone-card']);
  assert.deepEqual(cf.listCardNames(cardsDir, 'nothing'), []);
});

test('renaming a script moves its cards, deleting removes them', (t) => {
  const { cardsDir } = setup(t);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  cf.moveCardFiles(cardsDir, 'garmin', 'fenix');
  assert.deepEqual(cf.listCardNames(cardsDir, 'garmin'), []);
  assert.deepEqual(cf.listCardNames(cardsDir, 'fenix'), ['fenix-card', 'fenix-day-card']);
  assert.equal(cf.readCardFile(cardsDir, 'fenix', 'fenix-day-card'), DAY);
  assert.equal(cf.removeCardFiles(cardsDir, 'fenix').length, 2);
  assert.deepEqual(cf.listCardNames(cardsDir, 'fenix'), []);
});

test('packing puts the main card first and unpacking restores the files', (t) => {
  const { cardsDir } = setup(t);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);

  const packed = cf.packScript(cardsDir, 'garmin.ts', SCRIPT);
  const blocks = cf.extractBlocks(packed);
  assert.deepEqual(
    blocks.map((b) => b.name),
    [null, 'garmin-day-card'],
    'unnamed main block first, so older versions read it'
  );
  assert.equal(blocks[0].code, MAIN);
  assert.equal(cf.packScript(cardsDir, 'nocards.ts', SCRIPT), SCRIPT, 'no cards, nothing changes');

  // import under another name: the card files follow the new script name
  const other = path.join(cardsDir, '..', 'other-cards');
  const unpacked = cf.unpackScript(other, 'fenix', packed);
  assert.ok(!unpacked.includes('__JSA_CARD__'));
  assert.equal(cf.readCardFile(other, 'fenix'), MAIN);
  assert.equal(cf.readCardFile(other, 'fenix', 'fenix-garmin-day-card'), DAY);
});

test('duplicating renames the prefix of further cards to the copy', (t) => {
  const { cardsDir } = setup(t);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  const packed = cf.packScript(cardsDir, 'garmin.ts', SCRIPT);
  const target = path.join(cardsDir, '..', 'copy-cards');
  cf.unpackScript(target, 'garmin_copy', packed, 'garmin');
  assert.deepEqual(cf.listCardNames(target, 'garmin_copy'), ['garmin_copy-card', 'garmin_copy-day-card']);
});

test('an old single-block pack still unpacks into the main card', (t) => {
  const { cardsDir } = setup(t);
  const old = `${SCRIPT}\n${cf.encodeBlock(MAIN)}\n`;
  const rest = cf.unpackScript(cardsDir, 'garmin', old);
  assert.equal(cf.readCardFile(cardsDir, 'garmin'), MAIN);
  assert.equal(rest, SCRIPT.trimEnd() + '\n');
});

test('CardManager: the card file wins over an embedded block, the block is the fallback', (t) => {
  const { dir, scriptsDir, cardsDir } = setup(t);
  const script = path.join(scriptsDir, 'garmin.ts');
  writeFileSync(script, `${SCRIPT}\n${cf.encodeBlock('class Old extends HTMLElement {}')}\n`);
  const manager = new CardManager(path.join(dir, 'storage'), path.join(dir, 'www'), null, cardsDir);
  mkdirSync(path.join(dir, 'storage'), { recursive: true });

  assert.equal(manager.getCardSource(script), 'class Old extends HTMLElement {}');
  assert.equal(manager.hasCardSource(script), true);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  assert.equal(manager.getCardSource(script), MAIN);
  assert.equal(manager.getCardSource(script, 'garmin-day-card'), null);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  assert.equal(manager.getCardSource(script, 'garmin-day-card'), DAY);

  manager.removeCard(script);
  assert.deepEqual(cf.listCardNames(cardsDir, 'garmin'), [], 'the card files go with the script');
});

test('Git: card files ride with their script commit and a card change marks the script as changed', async (t) => {
  const { scriptsDir, cardsDir } = setup(t);
  const settings = { versioning: {} };
  const git = new GitManager({ getSettings: () => settings }, { add: () => {} }, scriptsDir);
  const run = (...args) => execFileSync('git', args, { cwd: scriptsDir, encoding: 'utf8' });

  writeFileSync(path.join(scriptsDir, 'garmin.ts'), SCRIPT);
  writeFileSync(path.join(scriptsDir, 'other.ts'), SCRIPT);
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN);
  cf.writeCardFile(cardsDir, 'garmin', 'garmin-day-card', DAY);
  cf.writeCardFile(cardsDir, 'other', undefined, MAIN);

  assert.equal((await git.getStatus()).hasRepo, false, 'no repo yet');

  await git.commit('garmin', { paths: ['garmin.ts'] });
  const files = run('show', '--stat', '--format=', 'HEAD');
  assert.match(files, /garmin\.ts/);
  assert.match(files, /cards\/garmin-card\.js/);
  assert.match(files, /cards\/garmin-day-card\.js/);
  assert.doesNotMatch(files, /other/, "another script's card is not swept up");

  // editing only the card shows the script as changed (that is what the Commit button works on)
  cf.writeCardFile(cardsDir, 'garmin', undefined, MAIN + '\n// changed');
  const changed = (await git.getStatus()).changedFiles;
  assert.ok(changed.includes('garmin.ts'), changed.join());
  await git.commit('card only', { paths: ['garmin.ts'] });
  assert.match(run('show', '--stat', '--format=', 'HEAD'), /cards\/garmin-card\.js/);

  // deleting the script with its cards: the deletion commit takes the cards along and a restore brings them back
  rmSync(path.join(scriptsDir, 'garmin.ts'));
  cf.removeCardFiles(cardsDir, 'garmin');
  await git.commit('delete garmin', { paths: ['garmin.ts'], includeDeletions: true });
  assert.match(run('show', '--stat', '--format=', 'HEAD'), /cards\/garmin-day-card\.js/);
  const deleted = (await git.listDeletedScripts()).map((d) => d.path);
  assert.ok(deleted.includes('garmin.ts'));
  assert.ok(!deleted.some((p) => p.startsWith('cards/')), 'cards are not offered as deleted scripts');

  await git.restoreDeletedScript('garmin.ts');
  assert.ok(existsSync(path.join(scriptsDir, 'garmin.ts')));
  assert.equal(readFileSync(path.join(cardsDir, 'garmin-card.js'), 'utf8'), MAIN + '\n// changed');
  assert.equal(readFileSync(path.join(cardsDir, 'garmin-day-card.js'), 'utf8'), DAY);
});
