// routes/ha-routes.js
const express = require('express');

/**
 * Creates a router for Home Assistant related API endpoints.
 * @param {import('../core/ha-connection')} haConnector The Home Assistant connector instance.
 * @returns {express.Router} The configured router.
 */
module.exports = (haConnector) => {
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
            res.status(500).json({ error: e.message });
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
            res.status(500).json({ error: e.message });
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
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
