import * as express from 'express';
import type WebhookManager from '../core/webhook-manager';

export = (webhookManager: WebhookManager) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      port: webhookManager.getPort(),
      externalUrl: webhookManager.getExternalUrl(),
      webhooks: webhookManager.listWebhooks(),
    });
  });

  router.get('/:id/token', (req, res) => {
    try {
      const token = webhookManager.revealToken(req.params.id);
      res.json({ token });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  router.post('/:id/rotate', (req, res) => {
    try {
      const token = webhookManager.rotateToken(req.params.id);
      res.json({ token });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      webhookManager.deleteWebhook(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
};
