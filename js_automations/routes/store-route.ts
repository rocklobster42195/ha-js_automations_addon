import * as express from 'express';
const router = express.Router();
import type StoreManager from '../core/store-manager';
// worker-manager.ts exports a singleton instance (export = new WorkerManager()), not the class
// itself, so the type has to be derived from the module's export value.
type WorkerManagerInstance = typeof import('../core/worker-manager');

export = (storeManager: StoreManager, workerManager: WorkerManagerInstance) => {
  // GET: load all values
  router.get('/', (req, res) => {
    res.json(storeManager.getAll());
  });

  // GET: keys with unsaved ha.persistent() changes (dirty)
  router.get('/dirty', (req, res) => {
    const allDirty = new Set<string>();
    for (const dirtyMap of workerManager.dirtyStore.values()) {
      for (const key of dirtyMap.keys()) allDirty.add(key);
    }
    res.json([...allDirty]);
  });

  // POST: set a value (with isSecret support)
  router.post('/', (req, res) => {
    const { key, value, isSecret } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    // 'User' as owner, since it comes from the API/UI
    storeManager.set(key, value, 'User', isSecret === true);
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
