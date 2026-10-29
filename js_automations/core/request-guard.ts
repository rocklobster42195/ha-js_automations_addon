// core/request-guard.ts
// Shared request-hardening primitives for JSA's externally reachable HTTP servers
// (webhook receiver, MCP server): per-IP rate limiting, failed-auth backoff,
// IP allowlist matching and constant-time token comparison. Framework-free on purpose.
import * as crypto from 'crypto';
import * as net from 'net';

export interface RequestGuardOptions {
  /** Requests allowed per IP per scope within `rateLimitWindowMs`. */
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** Failed auth attempts within `authBackoffWindowMs` that trip the lockout. */
  authBackoffThreshold: number;
  authBackoffWindowMs: number;
  authBackoffLockoutMs: number;
  /** How often expired entries are dropped from the in-memory maps. */
  sweepIntervalMs: number;
  /** Called once when an IP trips the lockout for a scope. */
  onLockout?: (info: { ip: string; scope: string; failures: number; lockoutMs: number }) => void;
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

/**
 * Checks whether `ip` matches an allowlist entry — either an exact address or an
 * IPv4 CIDR range (e.g. '192.30.252.0/22'). IPv6 CIDR ranges are not supported
 * (correct IPv6 prefix math needs full address expansion); only exact IPv6
 * addresses match. IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are normalized
 * to plain IPv4 before comparison.
 */
export function ipMatchesAllowlistEntry(ip: string, entry: string): boolean {
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

/** True if `ip` matches at least one entry of a non-empty allowlist. */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => ipMatchesAllowlistEntry(ip, entry));
}

/** Constant-time token comparison to avoid leaking the token via timing differences. */
export function tokensMatch(provided: string | undefined, expected: string | null): boolean {
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b); // keep timing roughly consistent
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Per-IP rate limiting and failed-auth backoff, keyed by `${ip}:${scope}`
 * (scope = webhook id for the webhook server, a fixed name for MCP).
 */
export class RequestGuard {
  private readonly _opts: RequestGuardOptions;
  private readonly _rateLimits = new Map<string, RateLimitEntry>();
  private readonly _authFailures = new Map<string, AuthFailureEntry>();
  private readonly _sweepTimer: ReturnType<typeof setInterval>;

  constructor(options: RequestGuardOptions) {
    this._opts = options;
    // Periodically drop expired entries so the maps don't grow unbounded for as
    // long as the addon runs.
    this._sweepTimer = setInterval(() => this.sweep(), options.sweepIntervalMs);
    this._sweepTimer.unref?.();
  }

  /** Counts this request; returns false once the IP exceeded the limit for the scope. */
  checkRateLimit(ip: string, scope: string): boolean {
    const key = `${ip}:${scope}`;
    const now = Date.now();
    let rl = this._rateLimits.get(key);
    if (!rl || rl.resetAt <= now) {
      rl = { count: 0, resetAt: now + this._opts.rateLimitWindowMs };
      this._rateLimits.set(key, rl);
    }
    rl.count++;
    return rl.count <= this._opts.rateLimitMax;
  }

  /** True while `ip` is locked out of `scope` after too many failed auth attempts. */
  isAuthLocked(ip: string, scope: string): boolean {
    const entry = this._authFailures.get(`${ip}:${scope}`);
    return !!(entry && entry.lockedUntil > Date.now());
  }

  /** Records a failed auth attempt; trips the lockout once the threshold is reached. */
  recordAuthFailure(ip: string, scope: string): void {
    const key = `${ip}:${scope}`;
    const now = Date.now();
    let entry = this._authFailures.get(key);
    if (!entry || entry.windowResetAt <= now) {
      entry = { count: 0, windowResetAt: now + this._opts.authBackoffWindowMs, lockedUntil: 0 };
    }
    entry.count++;
    if (entry.count >= this._opts.authBackoffThreshold) {
      entry.lockedUntil = now + this._opts.authBackoffLockoutMs;
      this._opts.onLockout?.({
        ip,
        scope,
        failures: entry.count,
        lockoutMs: this._opts.authBackoffLockoutMs,
      });
    }
    this._authFailures.set(key, entry);
  }

  /** Resets the failure counter after a successful, legitimate call. */
  clearAuthFailures(ip: string, scope: string): void {
    this._authFailures.delete(`${ip}:${scope}`);
  }

  sweep(): void {
    const now = Date.now();
    for (const [key, rl] of this._rateLimits.entries()) {
      if (rl.resetAt <= now) this._rateLimits.delete(key);
    }
    for (const [key, af] of this._authFailures.entries()) {
      if (af.windowResetAt <= now && af.lockedUntil <= now) this._authFailures.delete(key);
    }
  }

  dispose(): void {
    clearInterval(this._sweepTimer);
  }
}
