// routes/restore-route.ts
import * as express from 'express';
import multer from 'multer';
import RestoreManager from '../core/restore-manager';
import BackupManager from '../core/backup-manager';

const upload = multer({
  storage: multer.memoryStorage(),
  // Disaster-recovery uploads only, not a hot path — generous but bounded so a huge/corrupt
  // upload can't balloon this addon's own memory (the existing script-upload route has no
  // limit at all; this one deliberately doesn't inherit that gap).
  limits: { fileSize: 500 * 1024 * 1024 },
});

export = (restoreManager: RestoreManager, backupManager: BackupManager) => {
  const router = express.Router();

  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const result = await restoreManager.unpackToTemp(req.file.buffer);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/:restoreId/diff', (req, res) => {
    const diff = restoreManager.getPendingDiff(req.params.restoreId);
    if (!diff) return res.status(404).json({ error: 'Unknown or expired restore session' });
    res.json(diff);
  });

  router.post('/:restoreId/apply', async (req, res) => {
    const { selectedPaths } = req.body || {};
    if (!Array.isArray(selectedPaths)) return res.status(400).json({ error: 'Missing selectedPaths' });
    try {
      const result = await restoreManager.runFullRestore(req.params.restoreId, selectedPaths);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.delete('/:restoreId', (req, res) => {
    restoreManager.discardPending(req.params.restoreId);
    res.json({ success: true });
  });

  router.get('/pre-restore-snapshots', (req, res) => {
    res.json(backupManager.listPreRestoreSnapshots());
  });

  return router;
};
