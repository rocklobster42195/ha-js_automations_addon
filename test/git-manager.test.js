const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GitManager = require('../js_automations/core/git-manager.js');

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-git-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptsDir = path.join(dir, 'scripts');
  const remoteDir = path.join(dir, 'remote.git');
  require('node:fs').mkdirSync(scriptsDir);
  execFileSync('git', ['init', '--bare', remoteDir]);

  const settings = { versioning: { git_enabled: true, git_repo_url: remoteDir } };
  const settingsManager = { getSettings: () => settings };
  const logManager = { add: () => {} };
  return { scriptsDir, git: new GitManager(settingsManager, logManager, scriptsDir) };
}

test('ahead counts unpushed commits and resets after push', async (t) => {
  const { scriptsDir, git } = setup(t);

  writeFileSync(path.join(scriptsDir, 'a.ts'), '// a');
  await git.commit('first', { paths: ['a.ts'] });
  assert.equal((await git.getStatus()).ahead, 1);

  writeFileSync(path.join(scriptsDir, 'b.ts'), '// b');
  await git.commit('second', { paths: ['b.ts'] });
  assert.equal((await git.getStatus()).ahead, 2);

  const pushed = await git.push();
  assert.equal(pushed.success, true, pushed.error);
  assert.equal((await git.getStatus()).ahead, 0);

  writeFileSync(path.join(scriptsDir, 'a.ts'), '// a changed');
  await git.commit('third', { paths: ['a.ts'] });
  assert.equal((await git.getStatus()).ahead, 1);
});

test('a script whose deletion was committed can still be restored', async (t) => {
  const { scriptsDir, git } = setup(t);
  const file = path.join(scriptsDir, 'gone.ts');

  writeFileSync(file, '// v1');
  await git.commit('create', { paths: ['gone.ts'] });
  writeFileSync(file, '// v2');
  await git.commit('update', { paths: ['gone.ts'] });

  require('node:fs').unlinkSync(file);
  assert.equal((await git.listDeletedScripts()).length, 1, 'listed while the deletion is uncommitted');
  await git.restoreDeletedScript('gone.ts');
  assert.equal(require('node:fs').readFileSync(file, 'utf8'), '// v2', 'restored from HEAD');

  require('node:fs').unlinkSync(file);
  await git.commit('delete', { paths: ['gone.ts'], includeDeletions: true });
  assert.equal((await git.listDeletedScripts()).length, 1, 'listed after the deletion was committed');
  await git.restoreDeletedScript('gone.ts');
  assert.equal(require('node:fs').readFileSync(file, 'utf8'), '// v2', 'restored from the commit before the deletion');
});

test('the token travels in an Authorization header scoped to the host, never in the URL', () => {
  const config = GitManager.buildAuthConfig('https://github.com/user/repo.git', 'secret-token');
  assert.ok(config.includes('http.followRedirects=true'), 'redirects are followed, also for the push itself');
  const header = config.find((c) => c.startsWith('http.https://github.com/.extraHeader='));
  assert.ok(header, 'scoped to the remote host');
  const basic = header.split('Authorization: Basic ')[1];
  assert.equal(Buffer.from(basic, 'base64').toString('utf8'), 'secret-token:', 'token as user name, empty password');
  assert.ok(
    config.every((c) => !c.includes('secret-token')),
    'the plain token is not part of any value'
  );

  assert.deepEqual(GitManager.buildAuthConfig('https://github.com/user/repo.git', ''), ['http.followRedirects=true']);
  assert.deepEqual(GitManager.buildAuthConfig('git@github.com:user/repo.git', 'secret-token'), [
    'http.followRedirects=true',
  ]);
  assert.deepEqual(GitManager.buildAuthConfig('/srv/remote.git', 'secret-token'), ['http.followRedirects=true']);
  assert.ok(
    GitManager.buildAuthConfig('https://git.example.org:8443/a/b.git', 't')[1].startsWith(
      'http.https://git.example.org:8443/.extraHeader='
    )
  );
});

test('a failed push reports the reason without leaking the token', async (t) => {
  const { scriptsDir, git } = setup(t);
  writeFileSync(path.join(scriptsDir, 'a.ts'), '// a');
  await git.commit('first', { paths: ['a.ts'] });
  // An unreachable HTTPS remote: the push must fail fast (no prompt) and the token must stay out of the message.
  const settings = {
    versioning: { git_enabled: true, git_repo_url: 'https://127.0.0.1:1/x.git', git_token: 'tok-1234567890' },
  };
  const failing = new GitManager({ getSettings: () => settings }, { add: () => {} }, scriptsDir);
  const result = await failing.push();
  assert.equal(result.success, false);
  assert.ok(!String(result.error).includes('tok-1234567890'), 'token is redacted');
  assert.ok(
    !String(result.error).includes(Buffer.from('tok-1234567890:').toString('base64')),
    'header value is redacted'
  );
});
