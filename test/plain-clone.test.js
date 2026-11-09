const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toPlain } = require('../js_automations/core/plain-clone.js');

// A stand-in for the deep Proxy ha.persistent() returns: structuredClone rejects it. Like the real one it caches
// its proxies (stable identity) and only wraps arrays and plain objects.
const deepProxy = (target, cache = new WeakMap()) => {
  if (cache.has(target)) return cache.get(target);
  const proxy = new Proxy(target, {
    get: (t, k) => {
      const v = t[k];
      const wrap = v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);
      return wrap ? deepProxy(v, cache) : v;
    },
  });
  cache.set(target, proxy);
  return proxy;
};

test('a proxied array and object become plain, structured-clonable data', () => {
  const proxied = deepProxy({ list: [{ name: 'a', amount: 5 }], n: 1 });
  assert.throws(() => structuredClone(proxied), /could not be cloned/);
  const plain = toPlain(proxied);
  assert.deepEqual(plain, { list: [{ name: 'a', amount: 5 }], n: 1 });
  assert.doesNotThrow(() => structuredClone(plain));
  assert.ok(Array.isArray(plain.list));
});

test('Dates, undefined, NaN, Map and Set survive (no JSON round trip)', () => {
  const when = new Date('2026-11-09T10:00:00Z');
  const plain = toPlain(deepProxy({ when, u: undefined, nan: NaN, m: new Map([['k', 1]]), s: new Set([1, 2]) }));
  assert.ok(plain.when instanceof Date && plain.when.getTime() === when.getTime());
  assert.ok('u' in plain && plain.u === undefined);
  assert.ok(Number.isNaN(plain.nan));
  assert.equal(plain.m.get('k'), 1);
  assert.ok(plain.s.has(2));
});

test('circular references are kept as circular, functions are dropped', () => {
  const a = { name: 'a', fn: () => 1 };
  a.self = a;
  const plain = toPlain(deepProxy(a));
  assert.equal(plain.self, plain);
  assert.ok(!('fn' in plain));
  assert.doesNotThrow(() => structuredClone(plain));
});

test('primitives and null pass through; the input is not mutated', () => {
  assert.equal(toPlain(5), 5);
  assert.equal(toPlain(null), null);
  assert.equal(toPlain('x'), 'x');
  const src = { a: [1, 2] };
  const out = toPlain(src);
  out.a.push(3);
  assert.deepEqual(src.a, [1, 2]);
});

test('Errors keep message and stack, shared Dates stay shared, an own __proto__ key stays a data key', () => {
  const err = new Error('boom');
  const plainErr = toPlain({ e: err }).e;
  assert.ok(plainErr instanceof Error);
  assert.equal(plainErr.message, 'boom');
  assert.equal(plainErr.stack, err.stack);

  const proxiedErr = toPlain(deepProxy({ e: err })).e; // a Proxy over an Error is rejected by structuredClone
  assert.equal(proxiedErr.message, 'boom');

  const when = new Date(0);
  const shared = toPlain({ a: when, b: when });
  assert.equal(shared.a, shared.b);

  const parsed = JSON.parse('{"__proto__": {"x": 1}, "y": 2}');
  const plain = toPlain(parsed);
  assert.equal(Object.getPrototypeOf(plain), Object.prototype);
  assert.deepEqual(Object.keys(plain), ['__proto__', 'y']);
});
