const express = require('express');
const https = require('https');
const archiver = require('archiver');
const packageJson = require('../../package.json');

module.exports = (connector, logManager, getSystemOptions, integrationManager, SCRIPTS_DIR, systemService, getCombinedStatus) => {
    const router = express.Router();

    router.get('/options', (req, res) => {
        res.json(getSystemOptions());
    });

    router.get('/status', (req, res) => {
        res.json({ version: packageJson.version });
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

    // Integration Manager Routes
    router.get('/system/integration', async (req, res) => {
        try {
            const status = await getCombinedStatus();
            res.json(status);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/system/integration/install', async (req, res) => {
        try {
            await integrationManager.install();
            const status = await getCombinedStatus();
            res.json(status);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Backup Route (ZIP Download)
    router.get('/system/backup', (req, res) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        
        const filename = `js-automations-backup-${yyyy}${mm}${dd}-${hh}${min}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        
        archive.pipe(res);
        
        // Skript-Ordner rekursiv hinzufügen, aber node_modules und git ignorieren
        archive.glob('**/*', {
            cwd: SCRIPTS_DIR,
            ignore: ['**/node_modules/**', '**/.git/**']
        });

        archive.finalize();
    });

    router.post('/system/safe-mode/resolve', (req, res) => {
        const success = systemService.resolveSafeMode();
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to resolve safe mode.' });
        }
    });

    return router;
};