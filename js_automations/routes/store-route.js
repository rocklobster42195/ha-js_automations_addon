const express = require('express');
const router = express.Router();

module.exports = (storeManager, workerManager) => {

    // GET: Alle Werte laden
    router.get('/', (req, res) => {
        res.json(storeManager.getAll());
    });

    // GET: Keys mit ungespeicherten ha.persistent()-Änderungen (dirty)
    router.get('/dirty', (req, res) => {
        const allDirty = new Set();
        for (const dirtyMap of workerManager.dirtyStore.values()) {
            for (const key of dirtyMap.keys()) allDirty.add(key);
        }
        res.json([...allDirty]);
    });

    // POST: Wert setzen (mit isSecret Support)
    router.post('/', (req, res) => {
        const { key, value, isSecret } = req.body;
        if (!key) return res.status(400).json({ error: "Key is required" });
        
        // 'User' als Owner, da es über die API/UI kommt
        storeManager.set(key, value, 'User', isSecret === true);
        res.json({ success: true });
    });

    // DELETE: Wert löschen
    router.delete('/:key', (req, res) => {
        const deleted = storeManager.delete(req.params.key);
        if (deleted) res.json({ success: true });
        else res.status(404).json({ error: "Key not found" });
    });

    // DELETE ALL: Store leeren
    router.delete('/', (req, res) => {
        storeManager.clear();
        res.json({ success: true });
    });

    return router;
};