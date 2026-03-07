const express = require('express');
const router = express.Router();
const settingsManager = require('../core/settings-manager');

/**
 * GET /api/settings
 * Gibt die aktuellen Einstellungen zurück.
 */
router.get('/', (req, res) => {
    try {
        const settings = settingsManager.getSettings();
        res.json(settings);
    } catch (error) {
        console.error('API Error (GET /settings):', error);
        res.status(500).json({ error: 'Konnte Einstellungen nicht laden.' });
    }
});

/**
 * GET /api/settings/schema
 * Gibt das Schema für die UI-Generierung (Schema-Driven UI) zurück.
 */
router.get('/schema', (req, res) => {
    try {
        const schema = settingsManager.getSchema();
        res.json(schema);
    } catch (error) {
        console.error('API Error (GET /settings/schema):', error);
        res.status(500).json({ error: 'Konnte Schema nicht laden.' });
    }
});

/**
 * POST /api/settings
 * Speichert Änderungen an den Einstellungen (partielles Update).
 */
router.post('/', (req, res) => {
    try {
        const updatedSettings = settingsManager.updateSettings(req.body);
        res.json(updatedSettings);
    } catch (error) {
        console.error('API Error (POST /settings):', error);
        res.status(500).json({ error: 'Konnte Einstellungen nicht speichern.' });
    }
});

module.exports = router;