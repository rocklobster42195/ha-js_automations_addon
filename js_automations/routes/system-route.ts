import * as express from 'express';
import * as https from 'https';
import * as fs from 'fs';
import * as packageJson from '../../package.json';
import type HAConnector from '../core/ha-connection';
import type LogManager from '../core/log-manager';
import type SystemService from '../services/system-service';
import MqttManager from '../core/mqtt-manager';
import BackupManager from '../core/backup-manager';
// worker-manager.ts exports a singleton instance (export = new WorkerManager()), not the class
// itself, so the type has to be derived from the module's export value.
type WorkerManagerInstance = typeof import('../core/worker-manager');

export = (
  connector: HAConnector,
  logManager: LogManager,
  getSystemOptions: () => { expert_mode: boolean },
  SCRIPTS_DIR: string,
  systemService: SystemService,
  getCombinedStatus: () => Promise<unknown>,
  mqttManager: MqttManager,
  workerManager: WorkerManagerInstance,
  backupManager: BackupManager
) => {
  const router = express.Router();

  router.get('/options', (req, res) => {
    res.json(getSystemOptions());
  });

  router.get('/status', (req, res) => {
    res.json({ version: packageJson.version });
  });

  router.get('/ha/metadata', async (req, res) => res.json(await connector.getHAMetadata()));

  router.get(/^\/npm\/check\/(.+)$/, (req, res) => {
    const pkg = req.params[0];
    const url = `https://registry.npmjs.org/${pkg}`;

    https
      .get(url, (resp) => {
        if (resp.statusCode === 200) res.json({ ok: true });
        else if (resp.statusCode === 404) res.json({ ok: false, error: 'Package not found' });
        else res.json({ ok: false, error: `NPM Registry Status ${resp.statusCode}` });
      })
      .on('error', (err) => {
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

  // MQTT Test Connection.
  router.post('/mqtt/test', async (req, res) => {
    try {
      const config = req.body; // Expects { host, port, username, password }
      const result = await MqttManager.testConnection(config); // Use static method
      res.json(result);
    } catch (error) {
      logManager.add('error', 'System', `MQTT Test Connection API Error: ${(error as Error).message}`);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // MQTT Discover Settings.
  router.get('/mqtt/discover', async (req, res) => {
    try {
      const settings = await mqttManager.discoverSettings();
      if (settings) {
        res.json({ success: true, ...settings });
      } else {
        res.json({ success: false });
      }
    } catch (error) {
      logManager.add('error', 'System', `MQTT Discover Settings API Error: ${(error as Error).message}`);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /**
   * Returns the combined system status (HA Connection + MQTT Broker).
   * Used by the frontend for initial status display and periodic polling.
   */
  router.get('/system/integration', async (req, res) => {
    try {
      const status = await getCombinedStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Backup Route (ZIP Download). Also persists the zip into BackupManager's local
  // history (applying retention + best-effort WebDAV upload) so a manual download
  // and a scheduled backup share one unified history list instead of two.
  router.get('/system/backup', async (req, res) => {
    try {
      const { path: filePath, filename } = await backupManager.createBackup('manual');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/debug/repl', async (req, res) => {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Missing code' });
    if (!workerManager) return res.status(503).json({ error: 'Worker manager not available' });
    try {
      const result = await workerManager.runRepl(code);
      res.json(result);
    } catch (e) {
      res.status(500).json({ logs: [], error: (e as Error).message });
    }
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
