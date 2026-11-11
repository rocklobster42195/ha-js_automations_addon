const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const BackupManager = require('../js_automations/core/backup-manager');

test('backup progress lines use the System source so the global log level hides them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jsa-backup-log-'));
  const scripts = path.join(root, 'scripts');
  const backups = path.join(root, 'backups');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(path.join(backups, 'pre-restore'), { recursive: true });
  writeFileSync(path.join(scripts, 'a.js'), 'ha.log(1)');
  const settings = new EventEmitter();
  settings.getSettings = () => ({ backup: { schedule_enabled: true, schedule_time: '04:30' } });
  const logs = [];
  const bm = new BackupManager(
    settings,
    { add: (level, source, message) => logs.push({ level, source, message }) },
    {
      SCRIPTS_DIR: scripts,
      BACKUP_DIR: backups,
      PRE_RESTORE_BACKUP_DIR: path.join(backups, 'pre-restore'),
    }
  );
  try {
    bm.start();
    await bm.createBackup('manual');
    const progress = logs.filter((l) => /Scheduled:|Created js-automations-backup/.test(l.message));
    assert.equal(progress.length, 2, JSON.stringify(logs));
    for (const l of progress) {
      assert.equal(l.level, 'debug');
      assert.equal(l.source, 'System');
    }
  } finally {
    bm.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
