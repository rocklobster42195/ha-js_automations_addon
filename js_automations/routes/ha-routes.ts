// routes/ha-routes.ts
import * as express from 'express';
import type HAConnector from '../core/ha-connection';

/**
 * Creates a router for Home Assistant related API endpoints.
 */
export = (haConnector: HAConnector) => {
  const router = express.Router();

  /**
   * @route GET /api/ha/services
   * @group Home Assistant - HA Data
   * @returns {object} 200 - An object containing all available HA services.
   * @returns {Error}  500 - Internal Server Error
   */
  router.get('/services', async (req, res) => {
    try {
      res.json(await haConnector.getServices());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /**
   * @route GET /api/ha/states
   * @group Home Assistant - HA Data
   * @returns {object} 200 - An object containing all available HA entity states.
   * @returns {Error}  500 - Internal Server Error
   */
  router.get('/states', (req, res) => {
    try {
      // Note: getStates is currently synchronous in the connector
      res.json(haConnector.getStates());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /**
   * @route GET /api/ha/icons
   * @group Home Assistant - HA Data
   * @returns {object} 200 - HA's entity_component icon translations (domain -> device_class -> {default, state, range}).
   * @returns {Error}  500 - Internal Server Error
   */
  router.get('/icons', async (req, res) => {
    try {
      res.json(await haConnector.getIcons());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /**
   * @route POST /api/ha/call-service
   * @group Home Assistant - HA Actions
   * @param {string} domain - HA service domain (e.g. 'switch', 'button')
   * @param {string} service - Service name (e.g. 'turn_on', 'press')
   * @param {string} entity_id - Target entity ID
   * @param {object} [service_data] - Additional service data
   */
  router.post('/call-service', async (req, res) => {
    const { domain, service, entity_id, service_data = {} } = req.body;
    if (!domain || !service) {
      return res.status(400).json({ error: 'domain and service are required' });
    }
    try {
      await haConnector.callService(domain, service, { entity_id, ...service_data });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
};
