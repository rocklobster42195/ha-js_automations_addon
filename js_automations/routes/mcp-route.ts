import * as express from 'express';
import type McpManager from '../core/mcp-manager';

export = (mcpManager: McpManager) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(mcpManager.getStatus());
  });

  router.get('/token', (req, res) => {
    res.json({ token: mcpManager.revealToken() });
  });

  router.post('/rotate', (req, res) => {
    res.json({ token: mcpManager.rotateToken() });
  });

  return router;
};
