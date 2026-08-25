// core/webhook-manager.ts
import express, { Request, Response } from 'express';
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Fixed, not user-configurable: the container only publishes this port to the
// host (see config.yaml `ports:`), so letting the internal listener move to a
// different port would silently break external reachability.
const WEBHOOK_PORT = 3001;

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 60; // requests per IP per webhook id per window
const REQUEST_TIMEOUT_MS = 10000;
const BODY_LIMIT = '100kb';

const AUTH_BACKOFF_THRESHOLD = 5; // failed token attempts before lockout
const AUTH_BACKOFF_WINDOW_MS = 10 * 60 * 1000; // window in which failures accumulate
const AUTH_BACKOFF_LOCKOUT_MS = 10 * 60 * 1000; // lockout duration once tripped

const MAP_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // periodic cleanup of expired rate-limit/backoff entries

interface LastCall {
  ts: number;
  status: number;
}

interface WebhookEntry {
  token: string | null;
  method: string;
  noAuth: boolean;
  allowlist: string[] | null;
  owner: string | null;
  active: boolean;
  created: string;
  rotated: string | null;
  lastCall: LastCall | null;
}

interface RegisterOptions {
  method?: string;
  noAuth?: boolean;
  allowlist?: string[];
  scriptFilename: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface AuthFailureEntry {
  count: number;
  windowResetAt: number;
  lockedUntil: number;
}

interface PendingRequest {
  res: Response;
  timer: ReturnType<typeof setTimeout>;
  id: string;
}

interface WebhookResponse {
  status?: number;
  error?: string;
  isJson?: boolean;
  body?: unknown;
}

interface WebhookListing {
  id: string;
  method: string;
  noAuth: boolean;
  scriptFilename: string | null;
  active: boolean;
  created: string;
  rotated: string | null;
  lastCall: LastCall | null;
  hasToken: boolean;
  allowlist: string[] | null;
}

interface SettingsManagerLike {
  on(
    event: 'settings_updated',
    listener: (settings: { webhook?: { trust_proxy?: boolean; external_url?: string } }) => void
  ): void;
  getSettings(): { webhook?: { trust_proxy?: boolean; external_url?: string } } | undefined;
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

/**
 * Checks whether `ip` matches an allowlist entry — either an exact address or an
 * IPv4 CIDR range (e.g. '192.30.252.0/22'). IPv6 CIDR ranges are not supported
 * (correct IPv6 prefix math needs full address expansion); only exact IPv6
 * addresses match. IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are normalized
 * to plain IPv4 before comparison.
 */
function ipMatchesAllowlistEntry(ip: string, entry: string): boolean {
  const normalized = typeof ip === 'string' && ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;

  if (entry.includes('/')) {
    const [range, bitsStr] = entry.split('/');
    if (!net.isIPv4(range) || !net.isIPv4(normalized)) return false;
    const bits = parseInt(bitsStr, 10);
    const toInt = (addr: string): number => addr.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
    const mask = bits <= 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toInt(normalized) & mask) === (toInt(range) & mask);
  }
  return normalized === entry || ip === entry;
}

/**
 * WebhookManager runs a dedicated Express server that lets user scripts receive
 * HTTP webhooks from external services (ha.onWebhook()) with a real bidirectional
 * response. See docs/concept_webhook_api.md for the full design.
 */
class WebhookManager extends EventEmitter {
  settingsManager: SettingsManagerLike;
  logManager: LogManagerLike;
  storageFile: string;
  registry: Map<string, WebhookEntry>;
  pendingRequests: Map<string, PendingRequest>;
  private _rateLimits: Map<string, RateLimitEntry>;
  private _authFailures: Map<string, AuthFailureEntry>;
  private _correlationCounter: number;
  app: express.Express | null;
  server: http.Server | null;
  port: number | null;
  private _sweepTimer: ReturnType<typeof setInterval>;

  constructor(settingsManager: SettingsManagerLike, logManager: LogManagerLike, storageDir: string) {
    super();
    this.settingsManager = settingsManager;
    this.logManager = logManager;
    this.storageFile = path.join(storageDir, 'webhooks.json');

    // id -> { token, method, noAuth, owner, active, created, rotated, lastCall }
    // `owner` is the filename that registered this webhook — persisted permanently,
    // survives addon restarts, and is the only handle used to attribute an entry to
    // a script for deletion/purge purposes.
    // `active` is runtime-only (never persisted, always false right after a load):
    // true only while that script's worker is currently running and has (re-)registered.
    this.registry = new Map();

    // correlationId -> { res, timer, id }
    this.pendingRequests = new Map();

    // `${ip}:${id}` -> { count, resetAt }
    this._rateLimits = new Map();

    // `${ip}:${id}` -> { count, windowResetAt, lockedUntil } — tracks failed token
    // verification attempts, independent of the general rate limiter above.
    this._authFailures = new Map();

    this._correlationCounter = 0;

    this.app = null;
    this.server = null;
    this.port = null;

    this._loadRegistry();

    this.settingsManager.on('settings_updated', (settings) => {
      if (settings.webhook) this._handleSettingsUpdate(settings.webhook);
    });

    // Periodically drop expired entries from the per-IP maps so they don't grow
    // unbounded for as long as the addon runs.
    this._sweepTimer = setInterval(() => this._sweepExpiredEntries(), MAP_SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  private _sweepExpiredEntries(): void {
    const now = Date.now();
    for (const [key, rl] of this._rateLimits.entries()) {
      if (rl.resetAt <= now) this._rateLimits.delete(key);
    }
    for (const [key, af] of this._authFailures.entries()) {
      if (af.windowResetAt <= now && af.lockedUntil <= now) this._authFailures.delete(key);
    }
  }

  private _loadRegistry(): void {
    try {
      if (fs.existsSync(this.storageFile)) {
        const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
        for (const [id, entry] of Object.entries(data) as [string, Record<string, unknown>][]) {
          // owner falls back to the legacy `scriptFilename` field for entries
          // persisted before this owner/active split existed.
          const owner = (entry.owner ?? entry.scriptFilename ?? null) as string | null;
          this.registry.set(id, { ...entry, owner, active: false, lastCall: null } as WebhookEntry);
        }
      }
    } catch (e) {
      this.logManager.add('error', 'System', `[Webhook] Failed to load webhooks.json: ${(e as Error).message}`);
    }
  }

  private _readDiskState(): Record<string, Record<string, unknown>> {
    try {
      if (!fs.existsSync(this.storageFile)) return {};
      return JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
    } catch (e) {
      this.logManager.add('error', 'System', `[Webhook] Failed to read webhooks.json: ${(e as Error).message}`);
      return {};
    }
  }

  /**
   * Persists a single registry mutation by merging it onto the *current* on-disk
   * state, instead of overwriting the whole file from this process's in-memory
   * snapshot. Stable and beta addons deliberately share the same storage directory
   * (see beta-channel design), so a second JSA process can legitimately be writing
   * this same file — a blind overwrite would clobber whatever it just wrote. Also
   * absorbs any ids present on disk but unknown to this process, so this instance's
   * own registry doesn't silently diverge from what's actually persisted.
   */
  private _persistEntry(id: string, removed = false): void {
    const disk = this._readDiskState();
    let foreignEntry = false;
    for (const diskId of Object.keys(disk)) {
      if (diskId !== id && !this.registry.has(diskId)) foreignEntry = true;
    }

    if (removed) {
      delete disk[id];
    } else {
      const entry = this.registry.get(id);
      if (!entry) return;
      disk[id] = {
        token: entry.token,
        method: entry.method,
        noAuth: entry.noAuth,
        allowlist: entry.allowlist || null,
        owner: entry.owner,
        created: entry.created,
        rotated: entry.rotated,
      };
    }

    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(disk, null, 2));
    } catch (e) {
      this.logManager.add('error', 'System', `[Webhook] Failed to save webhooks.json: ${(e as Error).message}`);
    }

    for (const [diskId, diskEntry] of Object.entries(disk)) {
      if (diskId === id || this.registry.has(diskId)) continue;
      const owner = (diskEntry.owner ?? diskEntry.scriptFilename ?? null) as string | null;
      this.registry.set(diskId, { ...diskEntry, owner, active: false, lastCall: null } as WebhookEntry);
    }

    if (foreignEntry) {
      this.logManager.add(
        'warn',
        'System',
        `[Webhook] Found webhook registration(s) in webhooks.json written by another process ` +
          `(e.g. the sibling stable/beta addon sharing this storage directory) — merged instead of overwritten.`
      );
    }
  }

  private _getSettings(): { trust_proxy?: boolean; external_url?: string } {
    return this.settingsManager.getSettings()?.webhook || {};
  }

  /**
   * Registers a webhook endpoint for a running script (called when ha.onWebhook() executes).
   * Generates a token on first registration; reuses the persisted token across reloads/restarts.
   * Throws if the ID is already owned by a *different, currently running* script — this stops
   * one script from silently hijacking another script's endpoint/token.
   */
  register(id: string, { method = 'POST', noAuth = false, allowlist, scriptFilename }: RegisterOptions): void {
    const existing = this.registry.get(id);
    if (existing && existing.active && existing.owner !== scriptFilename) {
      throw new Error(`Webhook id "${id}" is already registered by "${existing.owner}".`);
    }

    const upperMethod = String(method || 'POST').toUpperCase();
    let token = existing ? existing.token : null;
    if (!noAuth && !token) token = crypto.randomBytes(24).toString('hex');
    if (noAuth) token = null;

    this.registry.set(id, {
      token,
      method: upperMethod,
      noAuth: !!noAuth,
      allowlist: Array.isArray(allowlist) && allowlist.length ? allowlist : null,
      owner: scriptFilename,
      active: true,
      created: existing?.created || new Date().toISOString(),
      rotated: existing?.rotated || null,
      lastCall: existing?.lastCall || null,
    });

    this._persistEntry(id);
    this._ensureServer();
    this.logManager.add(
      'debug',
      'System',
      `[Webhook] Registered "${id}" (${upperMethod}${noAuth ? ', no auth' : ''}) for ${scriptFilename}`
    );
    this.emit('registry_changed');
  }

  /**
   * Marks all webhooks owned by a script as inactive (script stopped/reloaded/crashed).
   * The `owner` and token stay intact (and persisted) so re-registering the same ID
   * (e.g. on script reload, or after an addon restart) keeps the same token; requests
   * arriving while inactive get a 503.
   */
  unregisterAllForScript(scriptFilename: string): void {
    let changed = false;
    for (const entry of this.registry.values()) {
      if (entry.owner === scriptFilename && entry.active) {
        entry.active = false;
        changed = true;
      }
    }
    if (changed) {
      this._maybeShutdownServer();
      this.emit('registry_changed');
    }
  }

  /**
   * Permanently removes all webhook registrations owned by a script, including the
   * persisted token. Called when the script file itself is deleted (not just stopped).
   * Matches on the persisted `owner` field, not runtime `active` state — a script can
   * be deleted while its webhooks are already inactive (stopped earlier, or the addon
   * itself was restarted since), and this must still find and remove them.
   */
  purgeAllForScript(scriptFilename: string): void {
    const idsToRemove: string[] = [];
    for (const [id, entry] of this.registry.entries()) {
      if (entry.owner === scriptFilename) idsToRemove.push(id);
    }
    for (const id of idsToRemove) {
      this.registry.delete(id);
      this._persistEntry(id, true);
    }
    if (idsToRemove.length) {
      this._maybeShutdownServer();
      this.emit('registry_changed');
    }
  }

  private _ensureServer(): void {
    if (this.server) return;

    const settings = this._getSettings();
    this.port = WEBHOOK_PORT;
    this.app = express();
    this.app.set('trust proxy', !!settings.trust_proxy);
    this.app.all('/webhook/:id', express.raw({ type: '*/*', limit: BODY_LIMIT }), (req, res) =>
      this._handleRequest(req, res)
    );

    this.server = http.createServer(this.app);
    this.server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        // Safety net: the sibling addon (stable ↔ beta) may still hold
        // port 3001 in a race the startup guard missed. Retry instead
        // of leaving webhooks silently dead for the rest of the run.
        this.logManager.add(
          'warn',
          'System',
          `[Webhook] Port ${this.port} is in use (sibling addon still running?) — retrying in 15s.`
        );
        setTimeout(() => {
          if (this.server) this.server.listen(this.port as number, '0.0.0.0');
        }, 15000);
        return;
      }
      this.logManager.add('error', 'System', `[Webhook] Server error: ${e.message}`);
    });
    this.server.listen(this.port, '0.0.0.0', () => {
      this.logManager.add('debug', 'System', `[Webhook] Server listening on port ${this.port}`);
    });
  }

  private _maybeShutdownServer(): void {
    const anyActive = [...this.registry.values()].some((e) => e.active);
    if (!anyActive && this.server) {
      this.server.close();
      this.server = null;
      this.app = null;
      this.logManager.add('debug', 'System', '[Webhook] No active webhooks — server stopped.');
    }
  }

  private _handleSettingsUpdate(webhookSettings: { trust_proxy?: boolean; external_url?: string }): void {
    if (this.app) this.app.set('trust proxy', !!webhookSettings.trust_proxy);

    // Tell any open Webhook Panel to refresh its external URL — without this it only
    // ever reflects whatever was current when the page first loaded.
    this.emit('config_changed', { port: WEBHOOK_PORT, externalUrl: webhookSettings.external_url || '' });
  }

  /**
   * Constant-time token comparison to avoid leaking the token via timing differences.
   */
  private _tokensMatch(provided: string | undefined, expected: string | null): boolean {
    if (!expected) return false;
    const a = Buffer.from(String(provided || ''));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) {
      crypto.timingSafeEqual(b, b); // keep timing roughly consistent
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  private _checkRateLimit(ip: string, id: string): boolean {
    const key = `${ip}:${id}`;
    const now = Date.now();
    let rl = this._rateLimits.get(key);
    if (!rl || rl.resetAt <= now) {
      rl = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      this._rateLimits.set(key, rl);
    }
    rl.count++;
    return rl.count <= RATE_LIMIT_MAX;
  }

  /**
   * Returns true if `ip` is currently locked out from authenticating against `id`
   * after too many failed token attempts.
   */
  private _isAuthLocked(ip: string, id: string): boolean {
    const entry = this._authFailures.get(`${ip}:${id}`);
    return !!(entry && entry.lockedUntil > Date.now());
  }

  /**
   * Records a failed token verification attempt. Trips a lockout once the
   * threshold is reached within the accumulation window.
   */
  private _recordAuthFailure(ip: string, id: string): void {
    const key = `${ip}:${id}`;
    const now = Date.now();
    let entry = this._authFailures.get(key);
    if (!entry || entry.windowResetAt <= now) {
      entry = { count: 0, windowResetAt: now + AUTH_BACKOFF_WINDOW_MS, lockedUntil: 0 };
    }
    entry.count++;
    if (entry.count >= AUTH_BACKOFF_THRESHOLD) {
      entry.lockedUntil = now + AUTH_BACKOFF_LOCKOUT_MS;
      this.logManager.add(
        'warn',
        'System',
        `[Webhook] "${id}": ${entry.count} failed token attempts from ${ip} — locked out for ${AUTH_BACKOFF_LOCKOUT_MS / 60000} min`
      );
    }
    this._authFailures.set(key, entry);
  }

  /** Resets the failure counter after a successful, legitimate call. */
  private _clearAuthFailures(ip: string, id: string): void {
    this._authFailures.delete(`${ip}:${id}`);
  }

  private _handleRequest(req: Request, res: Response): void {
    // Express types params as string | string[] to account for repeated-segment
    // routes; our fixed /webhook/:id pattern only ever produces a single string.
    const id = req.params.id as string;
    const entry = this.registry.get(id);

    if (!entry) {
      res.status(404).json({ error: 'Unknown webhook id' });
      return;
    }
    if (!entry.active) {
      res.status(503).json({ error: 'Script not running' });
      return;
    }
    if (req.method !== entry.method) {
      res.status(405).json({ error: `Method not allowed, expected ${entry.method}` });
      return;
    }
    if (!this._checkRateLimit(req.ip as string, id)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    if (entry.allowlist && !entry.allowlist.some((e) => ipMatchesAllowlistEntry(req.ip as string, e))) {
      this.logManager.add('warn', 'System', `[Webhook] "${id}": rejected request from ${req.ip} — not in allowlist`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (!entry.noAuth) {
      if (this._isAuthLocked(req.ip as string, id)) {
        res.status(429).json({ error: 'Too many failed attempts — temporarily blocked' });
        return;
      }
      const provided = req.get('X-Webhook-Secret');
      if (!this._tokensMatch(provided, entry.token)) {
        this._recordAuthFailure(req.ip as string, id);
        this.logManager.add(
          'warn',
          'System',
          `[Webhook] "${id}": rejected request with invalid/missing token from ${req.ip}`
        );
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      this._clearAuthFailures(req.ip as string, id);
    }

    let body: unknown;
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    } else {
      body = req.method === 'GET' ? undefined : null;
    }

    const correlationId = `wh_${++this._correlationCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      this.pendingRequests.delete(correlationId);
      res.status(504).json({ error: 'Handler timeout' });
      this._recordCall(id, 504);
    }, REQUEST_TIMEOUT_MS);

    this.pendingRequests.set(correlationId, { res, timer, id });

    this.emit('request', {
      id,
      scriptFilename: entry.owner,
      correlationId,
      req: {
        method: req.method,
        headers: req.headers,
        body,
        rawBody,
        query: req.query,
        ip: req.ip,
      },
    });
  }

  /**
   * Called by WorkerManager once the owning script's handler responds via
   * postMessage({ type: 'webhook_response', ... }).
   */
  resolveResponse(correlationId: string, response: WebhookResponse): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) return; // already timed out
    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);

    const { res, id } = pending;
    const status = response?.status || 200;

    if (response?.error) {
      this.logManager.add('error', 'System', `[Webhook] "${id}" handler error: ${response.error}`);
      res.status(500).json({ error: 'Internal handler error' });
      this._recordCall(id, 500);
      return;
    }

    if (response?.isJson) {
      res.status(status).json(response.body);
    } else if (response?.body !== undefined) {
      res.status(status).send(String(response.body));
    } else {
      res.status(status).end();
    }
    this._recordCall(id, status);
  }

  /**
   * Called by WorkerManager when the owning script isn't running (e.g. exited
   * between request arrival and dispatch).
   */
  rejectRequest(correlationId: string, reason?: string): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);
    pending.res.status(503).json({ error: reason || 'Script not running' });
    this._recordCall(pending.id, 503);
  }

  private _recordCall(id: string, status: number): void {
    const entry = this.registry.get(id);
    if (!entry) return;
    entry.lastCall = { ts: Date.now(), status };
    this.emit('call_logged', { id, ts: entry.lastCall.ts, status });
  }

  /**
   * Returns a UI-safe listing of all registered webhooks (no tokens).
   */
  listWebhooks(): WebhookListing[] {
    return [...this.registry.entries()].map(([id, e]) => ({
      id,
      method: e.method,
      noAuth: e.noAuth,
      scriptFilename: e.owner,
      active: !!e.active,
      created: e.created,
      rotated: e.rotated,
      lastCall: e.lastCall,
      hasToken: !!e.token,
      allowlist: e.allowlist || null,
    }));
  }

  getPort(): number {
    return WEBHOOK_PORT;
  }

  getExternalUrl(): string {
    return this._getSettings().external_url || '';
  }

  revealToken(id: string): string | null {
    const e = this.registry.get(id);
    if (!e) throw new Error('Unknown webhook id');
    return e.token;
  }

  rotateToken(id: string): string {
    const e = this.registry.get(id);
    if (!e) throw new Error('Unknown webhook id');
    if (e.noAuth) throw new Error('Cannot rotate a token for a no-auth webhook');
    e.token = crypto.randomBytes(24).toString('hex');
    e.rotated = new Date().toISOString();
    this._persistEntry(id);
    this.emit('registry_changed');
    return e.token;
  }

  /**
   * Permanently deletes a webhook registration (e.g. an orphaned entry left over
   * from a script deleted before this cleanup path existed). Refuses to delete an
   * active registration — stop the owning script first to avoid confusion about
   * which token is still valid.
   */
  deleteWebhook(id: string): void {
    const e = this.registry.get(id);
    if (!e) throw new Error('Unknown webhook id');
    if (e.active) throw new Error('Cannot delete an active webhook — stop the owning script first.');
    this.registry.delete(id);
    this._persistEntry(id, true);
    this._maybeShutdownServer();
    this.emit('registry_changed');
  }
}

export = WebhookManager;
