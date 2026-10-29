const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  RequestGuard,
  ipMatchesAllowlistEntry,
  ipAllowed,
  tokensMatch,
} = require('../js_automations/core/request-guard.js');

function makeGuard(t, overrides = {}) {
  const lockouts = [];
  const guard = new RequestGuard({
    rateLimitMax: 3,
    rateLimitWindowMs: 60000,
    authBackoffThreshold: 2,
    authBackoffWindowMs: 60000,
    authBackoffLockoutMs: 60000,
    sweepIntervalMs: 3600000,
    onLockout: (info) => lockouts.push(info),
    ...overrides,
  });
  t.after(() => guard.dispose());
  return { guard, lockouts };
}

test('allowlist: exact IPv4, ::ffff: mapping, IPv4 CIDR, exact IPv6, no IPv6 CIDR', () => {
  assert.equal(ipMatchesAllowlistEntry('1.2.3.4', '1.2.3.4'), true);
  assert.equal(ipMatchesAllowlistEntry('::ffff:1.2.3.4', '1.2.3.4'), true);
  assert.equal(ipMatchesAllowlistEntry('192.30.253.7', '192.30.252.0/22'), true);
  assert.equal(ipMatchesAllowlistEntry('192.30.256.7', '192.30.252.0/22'), false);
  assert.equal(ipMatchesAllowlistEntry('192.31.0.1', '192.30.252.0/22'), false);
  assert.equal(ipMatchesAllowlistEntry('8.8.8.8', '0.0.0.0/0'), true);
  assert.equal(ipMatchesAllowlistEntry('::1', '::1'), true);
  assert.equal(ipMatchesAllowlistEntry('2001:db8::1', '2001:db8::/32'), false);
  assert.equal(ipAllowed('10.1.2.3', ['192.168.0.0/16', '10.0.0.0/8']), true);
  assert.equal(ipAllowed('11.1.2.3', ['192.168.0.0/16', '10.0.0.0/8']), false);
});

test('tokensMatch: equal, different, different length, missing', () => {
  assert.equal(tokensMatch('abc123', 'abc123'), true);
  assert.equal(tokensMatch('abc124', 'abc123'), false);
  assert.equal(tokensMatch('abc', 'abc123'), false);
  assert.equal(tokensMatch(undefined, 'abc123'), false);
  assert.equal(tokensMatch('abc123', null), false);
});

test('rate limit is per IP and per scope, and resets after the window', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { guard } = makeGuard(t);
  for (let i = 0; i < 3; i++) assert.equal(guard.checkRateLimit('1.1.1.1', 'a'), true);
  assert.equal(guard.checkRateLimit('1.1.1.1', 'a'), false);
  assert.equal(guard.checkRateLimit('2.2.2.2', 'a'), true, 'other IP unaffected');
  assert.equal(guard.checkRateLimit('1.1.1.1', 'b'), true, 'other scope unaffected');
  t.mock.timers.tick(60001);
  assert.equal(guard.checkRateLimit('1.1.1.1', 'a'), true, 'window elapsed');
});

test('auth backoff: locks after threshold, fires onLockout once, clears on success, expires', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { guard, lockouts } = makeGuard(t);
  guard.recordAuthFailure('1.1.1.1', 'a');
  assert.equal(guard.isAuthLocked('1.1.1.1', 'a'), false);
  guard.recordAuthFailure('1.1.1.1', 'a');
  assert.equal(guard.isAuthLocked('1.1.1.1', 'a'), true);
  assert.deepEqual(lockouts, [{ ip: '1.1.1.1', scope: 'a', failures: 2, lockoutMs: 60000 }]);
  assert.equal(guard.isAuthLocked('1.1.1.1', 'b'), false, 'scope-bound');
  assert.equal(guard.isAuthLocked('2.2.2.2', 'a'), false, 'IP-bound');

  t.mock.timers.tick(60001);
  assert.equal(guard.isAuthLocked('1.1.1.1', 'a'), false, 'lockout expired');

  guard.recordAuthFailure('3.3.3.3', 'a');
  guard.clearAuthFailures('3.3.3.3', 'a');
  guard.recordAuthFailure('3.3.3.3', 'a');
  assert.equal(guard.isAuthLocked('3.3.3.3', 'a'), false, 'a success resets the counter');
});

test('sweep drops expired entries only', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { guard } = makeGuard(t);
  guard.checkRateLimit('1.1.1.1', 'a');
  t.mock.timers.tick(60001);
  guard.checkRateLimit('2.2.2.2', 'a');
  guard.sweep();
  assert.equal(guard._rateLimits.has('1.1.1.1:a'), false);
  assert.equal(guard._rateLimits.has('2.2.2.2:a'), true);
});
