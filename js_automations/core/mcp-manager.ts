// core/mcp-manager.ts
import express, { NextFunction, Request, Response } from 'express';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { RequestGuard, ipAllowed, tokensMatch } from './request-guard';

// Fixed, not user-configurable: the container only publishes ports declared in
// config.yaml `ports:` (same reason as WEBHOOK_PORT in webhook-manager.ts).
const MCP_PORT = 3002;
const MCP_PATH = '/mcp';
const BODY_LIMIT = '2mb'; // script sources can be large
const TOKEN_PREFIX = 'jsamcp_';

interface McpSettings {
  enabled?: boolean;
  external_url?: string;
  trust_proxy?: boolean;
  allowlist?: string;
}

interface SettingsManagerLike {
  on(event: 'settings_updated', listener: (settings: { mcp?: McpSettings }) => void): void;
  getSettings(): { mcp?: McpSettings } | undefined;
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

interface TokenFile {
  token: string;
  created: string;
  rotated: string | null;
}

interface McpStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  path: string;
  externalUrl: string;
  allowlist: string[];
  created: string;
  rotated: string | null;
}

type McpRequestHandler = (req: Request, res: Response) => void | Promise<void>;

/**
 * McpManager runs a dedicated Express server for the MCP endpoint (Streamable HTTP)
 * so external AI clients can read and control scripts. It is deliberately separate
 * from the webhook server: that surface is meant to be public, this one grants
 * script access and must be exposable on its own. See docs/internal/ai_concept.md.
 */
class McpManager extends EventEmitter {
  settingsManager: SettingsManagerLike;
  logManager: LogManagerLike;
  storageFile: string;
  app: express.Express | null = null;
  server: http.Server | null = null;
  private _tokenData: TokenFile;
  private _guard: RequestGuard;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _handler: McpRequestHandler = (_req, res) => {
    res.status(501).json({ error: 'MCP protocol handler not installed' });
  };

  constructor(settingsManager: SettingsManagerLike, logManager: LogManagerLike, storageDir: string) {
    super();
    this.settingsManager = settingsManager;
    this.logManager = logManager;
    this.storageFile = path.join(storageDir, 'mcp.json');
    this._tokenData = this._loadOrCreateToken();

    // Tool-call loops from an AI client are bursty, so the rate limit is generous;
    // the backoff on bad tokens is the same as for webhooks.
    this._guard = new RequestGuard({
      rateLimitMax: 300,
      rateLimitWindowMs: 60000,
      authBackoffThreshold: 5,
      authBackoffWindowMs: 10 * 60 * 1000,
      authBackoffLockoutMs: 10 * 60 * 1000,
      sweepIntervalMs: 5 * 60 * 1000,
      onLockout: ({ ip, failures, lockoutMs }) =>
        this.logManager.add(
          'warn',
          'System',
          `[MCP] ${failures} failed token attempts from ${ip} — locked out for ${lockoutMs / 60000} min`
        ),
    });

    this.settingsManager.on('settings_updated', () => {
      this._sync();
      this.emit('config_changed', this.getStatus());
    });
  }

  /** Starts the server if MCP is enabled in the settings. Called once by the kernel. */
  init(): void {
    this._sync();
  }

  /** Installs the MCP protocol handler (called for every authenticated request on /mcp). */
  setHandler(handler: McpRequestHandler): void {
    this._handler = handler;
  }

  stop(): void {
    this._stopServer();
    this._guard.dispose();
  }

  private _settings(): McpSettings {
    return this.settingsManager.getSettings()?.mcp || {};
  }

  private _allowlist(): string[] {
    return (this._settings().allowlist || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private _newToken(): string {
    return TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
  }

  private _loadOrCreateToken(): TokenFile {
    try {
      if (fs.existsSync(this.storageFile)) {
        const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8')) as Partial<TokenFile>;
        if (typeof data.token === 'string' && data.token) {
          return {
            token: data.token,
            created: data.created || new Date().toISOString(),
            rotated: data.rotated || null,
          };
        }
      }
    } catch (e) {
      this.logManager.add(
        'error',
        'System',
        `[MCP] Could not read mcp.json, generating a new token: ${(e as Error).message}`
      );
    }
    const fresh: TokenFile = { token: this._newToken(), created: new Date().toISOString(), rotated: null };
    this._persist(fresh);
    return fresh;
  }

  private _persist(data: TokenFile): void {
    try {
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      this.logManager.add('error', 'System', `[MCP] Could not write mcp.json: ${(e as Error).message}`);
    }
  }

  /** Brings the server in line with the current settings (start, stop, trust proxy). */
  private _sync(): void {
    const settings = this._settings();
    if (settings.enabled && !this.server) this._startServer();
    else if (!settings.enabled && this.server) this._stopServer();
    if (this.app) this.app.set('trust proxy', !!settings.trust_proxy);
    this.emit('status_changed', this.getStatus());
  }

  private _startServer(): void {
    const app = express();
    app.set('trust proxy', !!this._settings().trust_proxy);
    app.disable('x-powered-by');
    app.all(
      MCP_PATH,
      (req, res, next) => this._authenticate(req, res, next),
      express.json({ limit: BODY_LIMIT }),
      (req, res) => {
        Promise.resolve(this._handler(req, res)).catch((e: Error) => {
          this.logManager.add('error', 'System', `[MCP] Handler error: ${e.message}`);
          if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
        });
      }
    );
    app.use((_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    this.app = app;

    const server = http.createServer(app);
    this.server = server;
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        // The sibling addon (stable ↔ beta) may still hold the port; retry instead of
        // leaving MCP silently dead for the rest of the run.
        this.logManager.add(
          'warn',
          'System',
          `[MCP] Port ${MCP_PORT} is in use (sibling addon still running?) — retrying in 15s.`
        );
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          if (this.server === server) server.listen(MCP_PORT, '0.0.0.0');
        }, 15000);
        return;
      }
      this.logManager.add('error', 'System', `[MCP] Server error: ${e.message}`);
    });
    server.listen(MCP_PORT, '0.0.0.0', () => {
      this.logManager.add('info', 'System', `[MCP] Server listening on port ${MCP_PORT}`);
      this.emit('status_changed', this.getStatus());
    });
  }

  private _stopServer(): void {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (!this.server) return;
    this.server.close();
    this.server.closeAllConnections();
    this.server = null;
    this.app = null;
    this.logManager.add('info', 'System', '[MCP] Server stopped.');
  }

  /** Rate limit → IP allowlist → failed-auth lockout → Bearer token. */
  private _authenticate(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip as string;

    if (!this._guard.checkRateLimit(ip, 'mcp')) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const allowlist = this._allowlist();
    if (allowlist.length && !ipAllowed(ip, allowlist)) {
      this.logManager.add('warn', 'System', `[MCP] Rejected request from ${ip} — not in allowlist`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (this._guard.isAuthLocked(ip, 'mcp')) {
      res.status(429).json({ error: 'Too many failed attempts — temporarily blocked' });
      return;
    }

    const match = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!tokensMatch(match?.[1], this._tokenData.token)) {
      this._guard.recordAuthFailure(ip, 'mcp');
      this.logManager.add('warn', 'System', `[MCP] Rejected request with invalid/missing token from ${ip}`);
      res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'Unauthorized' });
      return;
    }

    this._guard.clearAuthFailures(ip, 'mcp');
    next();
  }

  getPort(): number {
    return MCP_PORT;
  }

  getExternalUrl(): string {
    return this._settings().external_url || '';
  }

  getStatus(): McpStatus {
    return {
      enabled: !!this._settings().enabled,
      running: !!this.server?.listening,
      port: MCP_PORT,
      path: MCP_PATH,
      externalUrl: this.getExternalUrl(),
      allowlist: this._allowlist(),
      created: this._tokenData.created,
      rotated: this._tokenData.rotated,
    };
  }

  revealToken(): string {
    return this._tokenData.token;
  }

  /** Replaces the token; the old one stops working immediately. */
  rotateToken(): string {
    this._tokenData = { token: this._newToken(), created: this._tokenData.created, rotated: new Date().toISOString() };
    this._persist(this._tokenData);
    this.emit('status_changed', this.getStatus());
    return this._tokenData.token;
  }
}

export = McpManager;
