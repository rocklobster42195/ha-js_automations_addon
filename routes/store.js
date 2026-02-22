const express = require('express');

module.exports = (storeManager) => {
    const router = express.Router();

    router.get('/', (req, res) => {
        res.json(storeManager.getAll());
    });

    router.post('/', (req, res) => {
        const { key, value } = req.body;
        storeManager.set(key, value, 'User-Edit');
        res.json({ ok: true });
    });

    router.delete('/', (req, res) => {
        storeManager.clear();
        res.json({ ok: true });
    });

    router.delete('/:key', (req, res) => {
        storeManager.delete(req.params.key);
        res.json({ ok: true });
    });

    return router;
};