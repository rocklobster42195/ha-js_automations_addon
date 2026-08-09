import * as express from 'express';
const router = express.Router();
import settingsManager from '../core/settings-manager';

/**
 * GET /api/settings
 * Returns the current settings.
 */
router.get('/', (req, res) => {
  try {
    const settings = settingsManager.getSettings();
    res.json(settings);
  } catch (error) {
    console.error('API Error (GET /settings):', error);
    res.status(500).json({ error: 'Could not load settings.' });
  }
});

/**
 * GET /api/settings/schema
 * Returns the schema for UI generation (schema-driven UI).
 */
router.get('/schema', (req, res) => {
  try {
    const schema = settingsManager.getSchema();
    res.json(schema);
  } catch (error) {
    console.error('API Error (GET /settings/schema):', error);
    res.status(500).json({ error: 'Could not load schema.' });
  }
});

/**
 * POST /api/settings
 * Saves changes to the settings (partial update).
 */
router.post('/', (req, res) => {
  try {
    const updatedSettings = settingsManager.updateSettings(req.body);
    res.json(updatedSettings);
  } catch (error) {
    console.error('API Error (POST /settings):', error);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

export = router;
