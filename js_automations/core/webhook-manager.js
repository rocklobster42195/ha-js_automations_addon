// core/webhook-manager.js
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Fixed, not user-configurable: the container only publishes this port to the
// host (see config.yaml `ports:`), so letting the internal listener move to a
// different port would silently break external reachability.
const WEBHOOK_PORT = 3001;

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 60; // requests per IP per webhook id per window
const REQUEST_TIMEOUT_MS = 10000;
const BODY_LIMIT = '100kb';

const AUTH_BACKOFF_THRESHOLD = 5;   // failed token attempts before lockout
const AUTH_BACKOFF_WINDOW_MS = 10 * 60 * 1000;   // window in which failures accumulate
const AUTH_BACKOFF_LOCKOUT_MS = 10 * 60 * 1000;   // lockout duration once tripped

const MAP_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // periodic cleanup of expired rate-limit/backoff entries

/**
 * Checks whether `ip` matches an allowlist entry — either an exact address or an
 * IPv4 CIDR range (e.g. '192.30.252.0/22'). IPv6 CIDR ranges are not supported
 * (correct IPv6 prefix math needs full address expansion); only exact IPv6
 * addresses match. IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are normalized
 * to plain IPv4 before comparison.
 */
function ipMatchesAllowlistEntry(ip, entry) {
    const normalized = (typeof ip === 'string' && ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)))
        ? ip.slice(7)
        : ip;

    if (entry.includes('/')) {
        const [range, bitsStr] = entry.split('/');
        if (!net.isIPv4(range) || !net.isIPv4(normalized)) return false;
        const bits = parseInt(bitsStr, 10);
        const toInt = (addr) => addr.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
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
    constructor(settingsManager, logManager, storageDir) {
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

    _sweepExpiredEntries() {
        const now = Date.now();
        for (const [key, rl] of this._rateLimits.entries()) {
            if (rl.resetAt <= now) this._rateLimits.delete(key);
        }
        for (const [key, af] of this._authFailures.entries()) {
            if (af.windowResetAt <= now && af.lockedUntil <= now) this._authFailures.delete(key);
        }
    }

    _loadRegistry() {
        try {
            if (fs.existsSync(this.storageFile)) {
                const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
                for (const [id, entry] of Object.entries(data)) {
                    // owner falls back to the legacy `scriptFilename` field for entries
                    // persisted before this owner/active split existed.
                    const owner = entry.owner ?? entry.scriptFilename ?? null;
                    this.registry.set(id, { ...entry, owner, active: false, lastCall: null });
                }
            }
        } catch (e) {
            this.logManager.add('error', 'System', `[Webhook] Failed to load webhooks.json: ${e.message}`);
        }
    }

    _saveRegistry() {
        try {
            const out = {};
            for (const [id, entry] of this.registry.entries()) {
                out[id] = { token: entry.token, method: entry.method, noAuth: entry.noAuth, allowlist: entry.allowlist || null, owner: entry.owner, created: entry.created, rotated: entry.rotated };
            }
            fs.writeFileSync(this.storageFile, JSON.stringify(out, null, 2));
        } catch (e) {
            this.logManager.add('error', 'System', `[Webhook] Failed to save webhooks.json: ${e.message}`);
        }
    }

    _getSettings() {
        return this.settingsManager.getSettings()?.webhook || {};
    }

    /**
     * Registers a webhook endpoint for a running script (called when ha.onWebhook() executes).
     * Generates a token on first registration; reuses the persisted token across reloads/restarts.
     * Throws if the ID is already owned by a *different, currently running* script — this stops
     * one script from silently hijacking another script's endpoint/token.
     */
    register(id, { method = 'POST', noAuth = false, allowlist, scriptFilename }) {
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

        this._saveRegistry();
        this._ensureServer();
        this.logManager.add('debug', 'System', `[Webhook] Registered "${id}" (${upperMethod}${noAuth ? ', no auth' : ''}) for ${scriptFilename}`);
        this.emit('registry_changed');
    }

    /**
     * Marks all webhooks owned by a script as inactive (script stopped/reloaded/crashed).
     * The `owner` and token stay intact (and persisted) so re-registering the same ID
     * (e.g. on script reload, or after an addon restart) keeps the same token; requests
     * arriving while inactive get a 503.
     */
    unregisterAllForScript(scriptFilename) {
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
    purgeAllForScript(scriptFilename) {
        let changed = false;
        for (const [id, entry] of this.registry.entries()) {
            if (entry.owner === scriptFilename) {
                this.registry.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this._saveRegistry();
            this._maybeShutdownServer();
            this.emit('registry_changed');
        }
    }

    _ensureServer() {
        if (this.server) return;

        const settings = this._getSettings();
        this.port = WEBHOOK_PORT;
        this.app = express();
        this.app.set('trust proxy', !!settings.trust_proxy);
        this.app.all('/webhook/:id', express.raw({ type: '*/*', limit: BODY_LIMIT }), (req, res) => this._handleRequest(req, res));

        this.server = http.createServer(this.app);
        this.server.on('error', (e) => {
            this.logManager.add('error', 'System', `[Webhook] Server error: ${e.message}`);
        });
        this.server.listen(this.port, '0.0.0.0', () => {
            this.logManager.add('debug', 'System', `[Webhook] Server listening on port ${this.port}`);
        });
    }

    _maybeShutdownServer() {
        const anyActive = [...this.registry.values()].some(e => e.active);
        if (!anyActive && this.server) {
            this.server.close();
            this.server = null;
            this.app = null;
            this.logManager.add('debug', 'System', '[Webhook] No active webhooks — server stopped.');
        }
    }

    _handleSettingsUpdate(webhookSettings) {
        if (this.app) this.app.set('trust proxy', !!webhookSettings.trust_proxy);

        // Tell any open Webhook Panel to refresh its external URL — without this it only
        // ever reflects whatever was current when the page first loaded.
        this.emit('config_changed', { port: WEBHOOK_PORT, externalUrl: webhookSettings.external_url || '' });
    }

    /**
     * Constant-time token comparison to avoid leaking the token via timing differences.
     */
    _tokensMatch(provided, expected) {
        if (!expected) return false;
        const a = Buffer.from(String(provided || ''));
        const b = Buffer.from(String(expected));
        if (a.length !== b.length) {
            crypto.timingSafeEqual(b, b); // keep timing roughly consistent
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    }

    _checkRateLimit(ip, id) {
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
    _isAuthLocked(ip, id) {
        const entry = this._authFailures.get(`${ip}:${id}`);
        return !!(entry && entry.lockedUntil > Date.now());
    }

    /**
     * Records a failed token verification attempt. Trips a lockout once the
     * threshold is reached within the accumulation window.
     */
    _recordAuthFailure(ip, id) {
        const key = `${ip}:${id}`;
        const now = Date.now();
        let entry = this._authFailures.get(key);
        if (!entry || entry.windowResetAt <= now) {
            entry = { count: 0, windowResetAt: now + AUTH_BACKOFF_WINDOW_MS, lockedUntil: 0 };
        }
        entry.count++;
        if (entry.count >= AUTH_BACKOFF_THRESHOLD) {
            entry.lockedUntil = now + AUTH_BACKOFF_LOCKOUT_MS;
            this.logManager.add('warn', 'System', `[Webhook] "${id}": ${entry.count} failed token attempts from ${ip} — locked out for ${AUTH_BACKOFF_LOCKOUT_MS / 60000} min`);
        }
        this._authFailures.set(key, entry);
    }

    /** Resets the failure counter after a successful, legitimate call. */
    _clearAuthFailures(ip, id) {
        this._authFailures.delete(`${ip}:${id}`);
    }

    _handleRequest(req, res) {
        const id = req.params.id;
        const entry = this.registry.get(id);

        if (!entry) return res.status(404).json({ error: 'Unknown webhook id' });
        if (!entry.active) return res.status(503).json({ error: 'Script not running' });
        if (req.method !== entry.method) return res.status(405).json({ error: `Method not allowed, expected ${entry.method}` });
        if (!this._checkRateLimit(req.ip, id)) return res.status(429).json({ error: 'Too many requests' });

        if (entry.allowlist && !entry.allowlist.some(e => ipMatchesAllowlistEntry(req.ip, e))) {
            this.logManager.add('warn', 'System', `[Webhook] "${id}": rejected request from ${req.ip} — not in allowlist`);
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!entry.noAuth) {
            if (this._isAuthLocked(req.ip, id)) {
                return res.status(429).json({ error: 'Too many failed attempts — temporarily blocked' });
            }
            const provided = req.get('X-Webhook-Secret');
            if (!this._tokensMatch(provided, entry.token)) {
                this._recordAuthFailure(req.ip, id);
                this.logManager.add('warn', 'System', `[Webhook] "${id}": rejected request with invalid/missing token from ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized' });
            }
            this._clearAuthFailures(req.ip, id);
        }

        let body;
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        if (rawBody) {
            try { body = JSON.parse(rawBody); } catch { body = rawBody; }
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
    resolveResponse(correlationId, response) {
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
    rejectRequest(correlationId, reason) {
        const pending = this.pendingRequests.get(correlationId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(correlationId);
        pending.res.status(503).json({ error: reason || 'Script not running' });
        this._recordCall(pending.id, 503);
    }

    _recordCall(id, status) {
        const entry = this.registry.get(id);
        if (!entry) return;
        entry.lastCall = { ts: Date.now(), status };
        this.emit('call_logged', { id, ts: entry.lastCall.ts, status });
    }

    /**
     * Returns a UI-safe listing of all registered webhooks (no tokens).
     */
    listWebhooks() {
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

    getPort() {
        return WEBHOOK_PORT;
    }

    getExternalUrl() {
        return this._getSettings().external_url || '';
    }

    revealToken(id) {
        const e = this.registry.get(id);
        if (!e) throw new Error('Unknown webhook id');
        return e.token;
    }

    rotateToken(id) {
        const e = this.registry.get(id);
        if (!e) throw new Error('Unknown webhook id');
        if (e.noAuth) throw new Error('Cannot rotate a token for a no-auth webhook');
        e.token = crypto.randomBytes(24).toString('hex');
        e.rotated = new Date().toISOString();
        this._saveRegistry();
        this.emit('registry_changed');
        return e.token;
    }

    /**
     * Permanently deletes a webhook registration (e.g. an orphaned entry left over
     * from a script deleted before this cleanup path existed). Refuses to delete an
     * active registration — stop the owning script first to avoid confusion about
     * which token is still valid.
     */
    deleteWebhook(id) {
        const e = this.registry.get(id);
        if (!e) throw new Error('Unknown webhook id');
        if (e.active) throw new Error('Cannot delete an active webhook — stop the owning script first.');
        this.registry.delete(id);
        this._saveRegistry();
        this._maybeShutdownServer();
        this.emit('registry_changed');
    }
}

module.exports = WebhookManager;
