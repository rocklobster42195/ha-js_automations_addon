import * as express from 'express';
const router = express.Router();
import settingsManager from '../core/settings-manager';
import { SECRET_MASK, SECRET_CLEAR } from '../core/secret-sentinels';

type SettingsData = Record<string, Record<string, unknown>>;

/**
 * Replaces every `mode: 'password'` field with SECRET_MASK (when a value is stored) or an
 * empty string (when unset) so the raw secret never reaches the browser. Operates on a
 * deep copy — settingsManager's own object keeps the real values for backend consumers.
 */
function maskSecrets(settings: SettingsData): SettingsData {
  const safe: SettingsData = JSON.parse(JSON.stringify(settings));
  for (const [section, key] of settingsManager.getSecretPaths()) {
    const bucket = safe[section];
    if (!bucket) continue;
    bucket[key] = bucket[key] ? SECRET_MASK : '';
  }
  return safe;
}

/**
 * On save, a secret field left blank or still showing the mask means "don't touch it" —
 * drop it from the partial update. SECRET_CLEAR is the one explicit way to wipe a stored
 * secret and maps to an empty string.
 */
function applySecretIntent(body: SettingsData): SettingsData {
  if (!body || typeof body !== 'object') return body;
  for (const [section, key] of settingsManager.getSecretPaths()) {
    const bucket = body[section];
    if (!bucket || !(key in bucket)) continue;
    const value = bucket[key];
    if (value === SECRET_CLEAR) {
      bucket[key] = '';
    } else if (value === SECRET_MASK || value === '' || value == null) {
      delete bucket[key];
    }
  }
  return body;
}

/**
 * GET /api/settings
 * Returns the current settings, with secret fields masked.
 */
router.get('/', (req, res) => {
  try {
    res.json(maskSecrets(settingsManager.getSettings() as SettingsData));
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
 * GET /api/settings/:section/:key/reveal
 * Returns the raw value of a single secret field, for the deliberate "show" action in the
 * settings UI. Only fields flagged `mode: 'password'` in the schema are revealable.
 */
router.get('/:section/:key/reveal', (req, res) => {
  const { section, key } = req.params;
  const revealable = settingsManager.getSecretPaths().some(([s, k]) => s === section && k === key);
  if (!revealable) return res.status(404).json({ error: 'Not a revealable field' });
  const bucket = (settingsManager.getSettings() as SettingsData)[section];
  res.json({ value: (bucket && (bucket[key] as string)) || '' });
});

/**
 * POST /api/settings
 * Saves changes to the settings (partial update).
 */
router.post('/', (req, res) => {
  try {
    const updatedSettings = settingsManager.updateSettings(applySecretIntent(req.body));
    res.json(maskSecrets(updatedSettings as SettingsData));
  } catch (error) {
    console.error('API Error (POST /settings):', error);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

export = router;
