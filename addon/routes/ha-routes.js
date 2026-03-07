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

    return router;
};
