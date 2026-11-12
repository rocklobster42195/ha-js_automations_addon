import * as express from 'express';
import type McpManager from '../core/mcp-manager';
import type { McpActivityLog } from '../core/mcp-activity-log';
import { buildMcpb, isBetaVersion } from '../core/mcpb-builder';
import type { McpFeedbackStore } from '../core/mcp-feedback-store';
import { summarize, type McpProposalStore, type Proposal } from '../core/mcp-proposals';

interface McpRouteBuildInfo {
  /** Add-on version, becomes the extension version. */
  version: string;
  /** Absolute path of mcpb/bridge.js. */
  bridgePath: string;
  /** Absolute path of the add-on icon (optional file). */
  iconPath: string;
}

/** Only plain http(s) endpoints without credentials are accepted for the extension's prefilled URL. */
function validEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface McpFeedbackAccess {
  store: McpFeedbackStore;
  isMaintainerMode: () => boolean;
}

interface McpProposalAccess {
  store: McpProposalStore;
  apply: (id: number) => Promise<{ ok: boolean; message: string }>;
  before: (p: Proposal) => string;
  /** Stale flag and change summary of an open proposal. */
  info: (p: Proposal) => { stale: boolean; change: string };
}

export = (
  mcpManager: McpManager,
  activity: McpActivityLog,
  build: McpRouteBuildInfo,
  feedback: McpFeedbackAccess,
  proposals: McpProposalAccess
) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(mcpManager.getStatus());
  });

  router.get('/activity', (req, res) => {
    res.json(activity.list());
  });

  // Proposals of the access level "propose": the user reviews the diff and applies or rejects (see mcp-proposals.ts).
  router.get('/proposals', (req, res) => {
    res.json(
      proposals.store.list().map((p) => ({ ...summarize(p), ...(p.status === 'open' ? proposals.info(p) : {}) }))
    );
  });

  // Forgets the closed proposals (applied, rejected, stale, expired) of the list.
  router.delete('/proposals/closed', (req, res) => {
    res.json({ removed: proposals.store.clearClosed() });
  });

  router.get('/proposals/:id', (req, res) => {
    const p = proposals.store.get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Unknown proposal' });
    res.json({ ...summarize(p), before: proposals.before(p), after: p.content });
  });

  router.post('/proposals/:id/apply', async (req, res) => {
    const id = Number(req.params.id);
    if (!proposals.store.get(id)) return res.status(404).json({ error: 'Unknown proposal' });
    try {
      const result = await proposals.apply(id);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: (e as Error).message });
    }
  });

  router.post('/proposals/:id/reject', (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const closed = proposals.store.close(Number(req.params.id), 'rejected', reason || null);
    if (!closed) return res.status(404).json({ error: 'Unknown or already closed proposal' });
    res.json({ ok: true });
  });

  router.get('/feedback', (req, res) => {
    res.json({ maintainerMode: feedback.isMaintainerMode(), notes: feedback.store.list() });
  });

  router.delete('/feedback/:id', (req, res) => {
    if (!feedback.store.remove(req.params.id)) return res.status(404).json({ error: 'Unknown note' });
    res.json({ ok: true });
  });

  router.get('/token', (req, res) => {
    res.json({ token: mcpManager.revealToken() });
  });

  router.post('/rotate', (req, res) => {
    res.json({ token: mcpManager.rotateToken() });
  });

  // One-click install for Claude Desktop. The endpoint comes from the client (it knows which host the
  // browser reaches the add-on under); the token is embedded, so the file must not be shared.
  router.get('/mcpb', async (req, res) => {
    const url = validEndpoint(req.query.url);
    if (!url) return res.status(400).json({ error: 'A valid http(s) "url" query parameter is required.' });
    try {
      const zip = await buildMcpb({
        version: build.version,
        url,
        token: mcpManager.revealToken(),
        bridgePath: build.bridgePath,
        iconPath: build.iconPath,
      });
      const filename = isBetaVersion(build.version) ? 'js-automations-beta.mcpb' : 'js-automations.mcpb';
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      });
      res.send(zip);
    } catch (e) {
      res.status(500).json({ error: `Could not build the extension: ${(e as Error).message}` });
    }
  });

  return router;
};
