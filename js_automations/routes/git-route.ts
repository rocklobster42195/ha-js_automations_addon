// routes/git-route.ts
import * as express from 'express';
import GitManager from '../core/git-manager';

export = (gitManager: GitManager) => {
  const router = express.Router();

  router.post('/commit', async (req, res) => {
    const { message, includeDeletions } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Missing message' });
    try {
      const result = await gitManager.commit(message, { includeDeletions: !!includeDeletions });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get('/log', async (req, res) => {
    try {
      const file = typeof req.query.file === 'string' ? req.query.file : undefined;
      res.json(await gitManager.log(file));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get('/diff', async (req, res) => {
    const { hash1, hash2, file } = req.query;
    if (typeof hash1 !== 'string' || typeof hash2 !== 'string' || typeof file !== 'string') {
      return res.status(400).json({ error: 'Missing hash1/hash2/file' });
    }
    try {
      res.json(await gitManager.diff(hash1, hash2, file));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get('/show', async (req, res) => {
    const { hash, file } = req.query;
    if (typeof hash !== 'string' || typeof file !== 'string') {
      return res.status(400).json({ error: 'Missing hash/file' });
    }
    try {
      res.json({ content: await gitManager.showFileAtCommit(hash, file) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/restore-to-commit', async (req, res) => {
    const { hash, file } = req.body || {};
    if (!hash || !file) return res.status(400).json({ error: 'Missing hash/file' });
    try {
      await gitManager.restoreFileToCommit(hash, file);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post('/revert', async (req, res) => {
    const { hash } = req.body || {};
    if (!hash) return res.status(400).json({ error: 'Missing hash' });
    try {
      await gitManager.revertCommit(hash);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get('/deleted-scripts', async (req, res) => {
    try {
      res.json(await gitManager.listDeletedScripts());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/restore-deleted', async (req, res) => {
    const { path: filePath } = req.body || {};
    if (!filePath) return res.status(400).json({ error: 'Missing path' });
    try {
      await gitManager.restoreDeletedScript(filePath);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get('/status', async (req, res) => {
    try {
      res.json(await gitManager.getStatus());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/push', async (req, res) => {
    const result = await gitManager.push();
    res.json(result);
  });

  router.post('/test', async (req, res) => {
    const { url, token } = req.body || {};
    const result = await GitManager.testGitHubConnection(url, token);
    res.json(result);
  });

  return router;
};
