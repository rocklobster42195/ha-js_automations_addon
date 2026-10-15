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
