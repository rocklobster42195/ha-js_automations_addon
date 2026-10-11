import * as express from 'express';
const router = express.Router();
import type StoreManager from '../core/store-manager';
// worker-manager.ts exports a singleton instance (export = new WorkerManager()), not the class
// itself, so the type has to be derived from the module's export value.
type WorkerManagerInstance = typeof import('../core/worker-manager');

export = (storeManager: StoreManager, workerManager: WorkerManagerInstance) => {
  // GET: load all entries. Values of secrets are withheld (see GET /:key/reveal).
  router.get('/', (req, res) => {
    res.json(storeManager.getAllPublic());
  });

  // GET: keys with unsaved ha.persistent() changes (dirty)
  router.get('/dirty', (req, res) => {
    const allDirty = new Set<string>();
    for (const dirtyMap of workerManager.dirtyStore.values()) {
      for (const key of dirtyMap.keys()) allDirty.add(key);
    }
    res.json([...allDirty]);
  });

  // GET: plaintext of a single entry. Only called on an explicit "reveal" in the UI.
  router.get('/:key/reveal', (req, res) => {
    const result = storeManager.reveal(req.params.key);
    res.set('Cache-Control', 'no-store');
    if (!result.found) return res.status(404).json({ error: 'Key not found' });
    if (result.locked) {
      return res.status(409).json({ error: 'Secret is locked: it was encrypted with a key that is not available.' });
    }
    res.json({ value: result.value });
  });

  // POST: set a value (with isSecret / sharedWith support)
  router.post('/', (req, res) => {
    const { key, value, isSecret, sharedWith } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    try {
      // 'User' as owner, since it comes from the API/UI. No scriptId: the UI is an administrative
      // caller and may edit and share any entry.
      storeManager.set(key, value, 'User', isSecret === true, { sharedWith });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    res.json({ success: true });
  });

  // DELETE: remove a value
  router.delete('/:key', (req, res) => {
    const deleted = storeManager.delete(req.params.key);
    if (deleted) res.json({ success: true });
    else res.status(404).json({ error: 'Key not found' });
  });

  // DELETE ALL: clear the store
  router.delete('/', (req, res) => {
    storeManager.clear();
    res.json({ success: true });
  });

  return router;
};
