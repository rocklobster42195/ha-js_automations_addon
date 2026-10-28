import * as express from 'express';
import type McpManager from '../core/mcp-manager';
import type { McpActivityLog } from '../core/mcp-activity-log';

export = (mcpManager: McpManager, activity: McpActivityLog) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(mcpManager.getStatus());
  });

  router.get('/activity', (req, res) => {
    res.json(activity.list());
  });

  router.get('/token', (req, res) => {
    res.json({ token: mcpManager.revealToken() });
  });

  router.post('/rotate', (req, res) => {
    res.json({ token: mcpManager.rotateToken() });
  });

  return router;
};
