// routes/backup-route.ts
import * as express from 'express';
import BackupManager from '../core/backup-manager';

export = (backupManager: BackupManager) => {
  const router = express.Router();

  router.post('/run', async (req, res) => {
    try {
      const result = await backupManager.createBackup('manual');
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get('/list', (req, res) => {
    res.json(backupManager.listBackups());
  });

  router.post('/webdav/test', async (req, res) => {
    const { url, username, password } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'Missing url' });
    const result = await BackupManager.testWebDavConnection({ url, username, password });
    res.json(result);
  });

  router.delete('/:filename', (req, res) => {
    const ok = backupManager.deleteBackup(req.params.filename);
    if (!ok) return res.status(404).json({ success: false, error: 'Backup not found' });
    res.json({ success: true });
  });

  return router;
};
