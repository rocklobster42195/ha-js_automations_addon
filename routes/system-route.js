const express = require('express');
const https = require('https');

module.exports = (connector, logManager, getSystemOptions) => {
    const router = express.Router();

    router.get('/options', (req, res) => {
        res.json(getSystemOptions());
    });

    router.get('/ha/metadata', async (req, res) => res.json(await connector.getHAMetadata()));

    router.get('/npm/check/:package', (req, res) => {
        const pkg = req.params.package;
        const url = `https://registry.npmjs.org/${pkg}`;

        https.get(url, (resp) => {
            if (resp.statusCode === 200) res.json({ ok: true });
            else if (resp.statusCode === 404) res.json({ ok: false, error: 'Package not found' });
            else res.json({ ok: false, error: `NPM Registry Status ${resp.statusCode}` });
        }).on("error", (err) => {
            res.json({ ok: false, error: `Network Error: ${err.message}` });
        });
    });

    router.get('/logs', (req, res) => {
        res.json(logManager.getHistory());
    });

    router.delete('/logs', (req, res) => {
        logManager.clear();
        res.json({ ok: true });
    });

    return router;
};