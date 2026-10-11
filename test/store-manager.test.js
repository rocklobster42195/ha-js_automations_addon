const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const StoreManager = require('../js_automations/core/store-manager.js');

function setup(t) {
  delete process.env.JSA_STORE_KEY;
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-store-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'keys', 'store.key');
  return { dir, keyFile, file: path.join(dir, 'store.json') };
}

const readDisk = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('secrets are encrypted on disk, plain values are not', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('token', 'hunter2-very-secret', 'a.js', true, { scriptId: 'a.js' });
  store.set('plain', 'visible', 'a.js', false, { scriptId: 'a.js' });

  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('hunter2-very-secret'), 'secret must not appear in store.json');
  assert.ok(raw.includes('visible'));

  const disk = readDisk(file);
  assert.equal(disk.token.encrypted, true);
  assert.equal(typeof disk.token.value.data, 'string');
  assert.equal(disk.plain.value, 'visible');
  if (process.platform !== 'win32') assert.equal(statSync(keyFile).mode & 0o077, 0, 'key file is private');

  // A fresh instance with the same key reads the value back (including non-string values).
  store.set('obj', { a: [1, 2] }, 'a.js', true, { scriptId: 'a.js' });
  const again = new StoreManager(dir, keyFile);
  assert.equal(again.data.token.value, 'hunter2-very-secret');
  assert.deepEqual(again.data.obj.value, { a: [1, 2] });
});

test('a new secret is shared only with the script that created it', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('cred', 'x', 'A', true, { scriptId: 'a.js' });

  assert.deepEqual(store.data.cred.sharedWith, ['a.js']);
  assert.equal(store.canRead('cred', 'a.js'), true);
  assert.equal(store.canRead('cred', 'b.js'), false);
  assert.equal(store.canRead('cred'), true, 'administrative callers (UI/REPL) can read');
  assert.equal('cred' in store.valuesFor('b.js'), false);
  assert.equal(store.valuesFor('a.js').cred, 'x');

  // Another script can neither overwrite nor delete it.
  assert.equal(store.set('cred', 'hacked', 'B', undefined, { scriptId: 'b.js' }), false);
  assert.equal(store.delete('cred', 'b.js'), false);
  assert.equal(store.data.cred.value, 'x');
});

test('sharing: explicit list, wildcard, and the writer always keeps access', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('cred', 'x', 'A', true, { scriptId: 'a.js', sharedWith: ['b.js'] });
  assert.deepEqual(store.data.cred.sharedWith.sort(), ['a.js', 'b.js']);
  assert.equal(store.canRead('cred', 'b.js'), true);
  assert.equal(store.canRead('cred', 'c.js'), false);

  store.set('cred', 'y', 'B', undefined, { scriptId: 'b.js', sharedWith: '*' });
  assert.equal(store.data.cred.sharedWith, '*');
  assert.equal(store.canRead('cred', 'c.js'), true);
  assert.equal(store.data.cred.owner, 'A', 'owner is not transferred by an overwrite');

  assert.throws(() => store.set('cred', 'z', 'A', undefined, { scriptId: 'a.js', sharedWith: 'nope' }), TypeError);
});

test('omitting the secret flag keeps a secret secret; false downgrades explicitly', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('cred', 'one', 'A', true, { scriptId: 'a.js' });
  store.set('cred', 'two', 'A', undefined, { scriptId: 'a.js' });
  assert.equal(store.data.cred.isSecret, true);
  assert.ok(!readFileSync(file, 'utf8').includes('two'));

  store.set('cred', 'three', 'A', false, { scriptId: 'a.js' });
  assert.equal(store.data.cred.isSecret, false);
  assert.equal(store.data.cred.sharedWith, undefined);
});

test('public views never contain secret values', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  const events = [];
  store.on('changed', (e) => events.push(e));
  store.set('cred', 'topsecret', 'A', true, { scriptId: 'a.js' });
  store.set('plain', 'ok', 'A', false, { scriptId: 'a.js' });

  const pub = store.getAllPublic();
  assert.equal(pub.cred.value, null);
  assert.equal(pub.cred.isSecret, true);
  assert.deepEqual(pub.cred.sharedWith, ['a.js']);
  assert.equal(pub.plain.value, 'ok');
  assert.ok(!JSON.stringify(events).includes('topsecret'), 'socket events must not leak secrets');
  assert.equal(store.reveal('cred').value, 'topsecret');
});

test('legacy plaintext secrets are migrated to encrypted storage and stay visible to all scripts', (t) => {
  const { dir, keyFile, file } = setup(t);
  const stamp = '2026-01-01T00:00:00.000Z';
  writeFileSync(
    file,
    JSON.stringify({
      legacy_secret: { value: 'old-plaintext', owner: 'X', isSecret: true, updated: stamp, accessed: stamp },
      legacy_plain: { value: 'hello', owner: 'X', isSecret: false, updated: stamp, accessed: stamp },
    })
  );

  const store = new StoreManager(dir, keyFile);
  assert.equal(store.data.legacy_secret.value, 'old-plaintext');
  assert.equal(store.data.legacy_secret.sharedWith, '*');
  assert.equal(store.canRead('legacy_secret', 'any.js'), true);

  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('old-plaintext'), 'plaintext must be gone from disk after migration');
  assert.ok(raw.includes('hello'));
  assert.ok(existsSync(keyFile));

  // Idempotent: a second load decrypts instead of re-migrating.
  const again = new StoreManager(dir, keyFile);
  assert.equal(again.data.legacy_secret.value, 'old-plaintext');
});

test('no key file is created while the store holds no secrets', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('plain', 1, 'A', false, { scriptId: 'a.js' });
  assert.equal(existsSync(keyFile), false);
});

test('a lost key locks secrets without destroying them', (t) => {
  const { dir, keyFile, file } = setup(t);
  const first = new StoreManager(dir, keyFile);
  first.set('cred', 'precious', 'A', true, { scriptId: 'a.js' });
  const blobBefore = readDisk(file).cred.value;

  rmSync(keyFile); // key lost (e.g. restored on another instance)
  const locked = new StoreManager(dir, keyFile);
  assert.equal(locked.data.cred.locked, true);
  assert.equal(locked.data.cred.value, null);
  assert.equal(locked.canRead('cred', 'a.js'), false);
  assert.equal(locked.canRead('cred'), false);
  assert.equal(locked.reveal('cred').locked, true);
  assert.equal(existsSync(keyFile), false, 'a new key must not be generated just by loading');

  // Writing something else must not drop or alter the locked blob.
  locked.set('plain', 1, 'A', false, { scriptId: 'a.js' });
  assert.deepEqual(readDisk(file).cred.value, blobBefore);

  // Creating a new secret generates a fresh key; the old entry stays locked (different key id).
  locked.set('fresh', 'new', 'A', true, { scriptId: 'a.js' });
  const reloaded = new StoreManager(dir, keyFile);
  assert.equal(reloaded.data.fresh.value, 'new');
  assert.equal(reloaded.data.cred.locked, true);
  assert.deepEqual(readDisk(file).cred.value, blobBefore);

  // Re-entering the value from the UI (administrative caller) unlocks it.
  assert.equal(reloaded.set('cred', 'again', 'User', true, {}), true);
  assert.equal(reloaded.data.cred.locked, undefined);
  assert.equal(new StoreManager(dir, keyFile).data.cred.value, 'again');
});

test('a ciphertext cannot be moved to another key', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('a', 'value-a', 'X', true, { scriptId: 'x.js' });
  store.set('b', 'value-b', 'X', true, { scriptId: 'x.js' });
  const disk = readDisk(file);
  disk.b.value = disk.a.value; // swap ciphertext
  writeFileSync(file, JSON.stringify(disk));

  const reloaded = new StoreManager(dir, keyFile);
  assert.equal(reloaded.data.a.value, 'value-a');
  assert.equal(reloaded.data.b.locked, true);
});

test('JSA_STORE_KEY overrides the key file', (t) => {
  const { dir, keyFile } = setup(t);
  process.env.JSA_STORE_KEY = 'from-env';
  t.after(() => delete process.env.JSA_STORE_KEY);
  const store = new StoreManager(dir, keyFile);
  store.set('cred', 'x', 'A', true, { scriptId: 'a.js' });
  assert.equal(existsSync(keyFile), false);
  assert.equal(new StoreManager(dir, keyFile).data.cred.value, 'x');
});

test('pruneByOwner leaves secrets alone', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('tmp', 1, 'A', false, { scriptId: 'a.js' });
  store.set('cred', 'x', 'A', true, { scriptId: 'a.js', sharedWith: '*' });
  assert.equal(store.pruneByOwner('A'), 1);
  assert.ok(store.data.cred);
  assert.equal(store.data.tmp, undefined);
});

test('renameScript carries sharing over to the new file name', (t) => {
  const { dir, keyFile } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('cred', 'x', 'A', true, { scriptId: 'old.js', sharedWith: ['other.js'] });
  store.set('all', 'y', 'A', true, { scriptId: 'old.js', sharedWith: '*' });
  store.set('mine', 'z', 'B', true, { scriptId: 'unrelated.js' });
  const events = [];
  store.on('changed', (e) => events.push(e.key));

  assert.deepEqual(store.renameScript('old.js', 'new.js'), ['cred']);
  assert.deepEqual(store.data.cred.sharedWith.sort(), ['new.js', 'other.js']);
  assert.equal(store.canRead('cred', 'new.js'), true);
  assert.equal(store.canRead('cred', 'old.js'), false);
  assert.equal(store.data.all.sharedWith, '*');
  assert.deepEqual(events, ['cred']);
  assert.deepEqual(new StoreManager(dir, keyFile).data.cred.sharedWith.sort(), ['new.js', 'other.js']);
});

test('first encryption keeps a plaintext safety copy that is never overwritten', (t) => {
  const { dir, keyFile, file } = setup(t);
  const legacy = { tok: { value: 'legacy-secret', owner: 'a', isSecret: true, updated: 'x', accessed: 'x' } };
  writeFileSync(file, JSON.stringify(legacy));

  new StoreManager(dir, keyFile);
  const bak = file + '.pre-encryption';
  assert.ok(existsSync(bak));
  assert.deepEqual(JSON.parse(readFileSync(bak, 'utf8')), legacy);
  assert.ok(!readFileSync(file, 'utf8').includes('legacy-secret'));

  // A later boot must not replace the safety copy with the already-encrypted file.
  new StoreManager(dir, keyFile);
  assert.deepEqual(JSON.parse(readFileSync(bak, 'utf8')), legacy);
});

test('safety copy expires after 14 days, but not while a secret is locked', (t) => {
  const { dir, keyFile, file } = setup(t);
  writeFileSync(file, JSON.stringify({ tok: { value: 'v', owner: 'a', isSecret: true, updated: 'x', accessed: 'x' } }));
  new StoreManager(dir, keyFile);
  const bak = file + '.pre-encryption';
  const old = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  require('node:fs').utimesSync(bak, old, old);

  // Wrong key: the secret is locked, the plaintext copy is the only way back and must stay.
  rmSync(keyFile);
  writeFileSync(keyFile, 'a'.repeat(64));
  new StoreManager(dir, keyFile);
  assert.ok(existsSync(bak), 'kept while locked');

  rmSync(file);
  writeFileSync(file, JSON.stringify({}));
  new StoreManager(dir, keyFile);
  assert.ok(!existsSync(bak), 'removed once old and nothing is locked');
});

test('encryption disabled: secrets are written back as plaintext in the pre-encryption format', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('tok', 'hunter2', 'A', true, { scriptId: 'a.js', sharedWith: ['b.js'] });
  assert.equal(readDisk(file).tok.encrypted, true);

  const rolled = new StoreManager(dir, keyFile, { encryption: false });
  assert.equal(rolled.data.tok.value, 'hunter2');
  const disk = readDisk(file);
  assert.equal(disk.tok.value, 'hunter2');
  assert.equal(disk.tok.isSecret, true);
  assert.equal(disk.tok.encrypted, undefined, 'older versions see a plain value');
  assert.deepEqual(disk.tok.sharedWith.sort(), ['a.js', 'b.js']);

  // Writes in rollback mode stay plaintext too.
  rolled.set('tok2', 'second', 'A', true, { scriptId: 'a.js' });
  assert.equal(readDisk(file).tok2.value, 'second');
});

test('re-enabling encryption re-encrypts a rolled-back store and keeps the sharing lists', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile);
  store.set('tok', 'hunter2', 'A', true, { scriptId: 'a.js', sharedWith: ['b.js'] });
  new StoreManager(dir, keyFile, { encryption: false });

  const again = new StoreManager(dir, keyFile);
  assert.deepEqual(again.data.tok.sharedWith.sort(), ['a.js', 'b.js']);
  assert.equal(readDisk(file).tok.encrypted, true);
  assert.ok(!readFileSync(file, 'utf8').includes('hunter2'));
});

test('rollback removes the safety copy and leaves locked secrets untouched', (t) => {
  const { dir, keyFile, file } = setup(t);
  writeFileSync(file, JSON.stringify({ tok: { value: 'v', owner: 'a', isSecret: true, updated: 'x', accessed: 'x' } }));
  new StoreManager(dir, keyFile);
  assert.ok(existsSync(file + '.pre-encryption'));

  const rolled = new StoreManager(dir, keyFile, { encryption: false });
  assert.equal(readDisk(file).tok.value, 'v');
  assert.ok(!existsSync(file + '.pre-encryption'));
  assert.equal(rolled.data.tok.locked, undefined);

  // With a lost key the blob cannot be decrypted: it stays encrypted on disk, not destroyed.
  const other = setup(t);
  const s = new StoreManager(other.dir, other.keyFile);
  s.set('tok', 'v', 'A', true, { scriptId: 'a.js' });
  rmSync(other.keyFile);
  const lockedRollback = new StoreManager(other.dir, other.keyFile, { encryption: false });
  assert.equal(lockedRollback.data.tok.locked, true);
  assert.equal(readDisk(other.file).tok.encrypted, true);
});

test('setEncryption switches at runtime: encrypts with a safety copy, and writes plaintext back', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile, { encryption: false });
  store.set('tok', 'hunter2', 'A', true, { scriptId: 'a.js', sharedWith: ['b.js'] });
  assert.equal(readDisk(file).tok.value, 'hunter2');

  store.setEncryption(true);
  assert.equal(readDisk(file).tok.encrypted, true);
  assert.ok(!readFileSync(file, 'utf8').includes('hunter2'));
  assert.deepEqual(JSON.parse(readFileSync(file + '.pre-encryption', 'utf8')).tok.value, 'hunter2');

  store.setEncryption(false);
  const disk = readDisk(file);
  assert.equal(disk.tok.value, 'hunter2');
  assert.equal(disk.tok.encrypted, undefined);
  assert.deepEqual(disk.tok.sharedWith.sort(), ['a.js', 'b.js']);
  assert.ok(!existsSync(file + '.pre-encryption'));

  // Calls that change nothing do not touch the disk.
  const before = readFileSync(file, 'utf8');
  store.setEncryption(false);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('setEncryption(true) with no secrets creates neither key nor safety copy', (t) => {
  const { dir, keyFile, file } = setup(t);
  const store = new StoreManager(dir, keyFile, { encryption: false });
  store.set('plain', 'x', 'A', false, { scriptId: 'a.js' });
  store.setEncryption(true);
  assert.ok(!existsSync(keyFile));
  assert.ok(!existsSync(file + '.pre-encryption'));
});
