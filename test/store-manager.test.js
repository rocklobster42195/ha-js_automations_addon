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
