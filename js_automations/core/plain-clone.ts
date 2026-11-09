// core/plain-clone.ts
// Deep copy into plain, structured-clonable data. ha.persistent() hands out Proxies, and a Proxy cannot be
// posted to the main process ("DataCloneError: [object Array] could not be cloned"), so everything a script
// passes to ha.update / ha.register / ha.call / ha.fire / ha.mqtt.publish / ha.store.set is unwrapped first.
// Reads through the Proxy (no JSON round trip), so Dates, undefined, NaN and circular references survive.

function clone(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null) return value;
  const type = typeof value;
  if (type === 'function' || type === 'symbol') return undefined; // cannot be cloned; dropped
  if (type !== 'object') return value;

  const obj = value as object;
  if (seen.has(obj)) return seen.get(obj);

  if (obj instanceof Date) {
    const out = new Date(obj.getTime());
    seen.set(obj, out);
    return out;
  }
  // Errors, typed arrays and the like: structuredClone keeps them intact (message, stack, bytes) — but only
  // for real objects; a Proxy over one is rejected and falls through to the generic copy below.
  if (obj instanceof Error || obj instanceof RegExp || ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    try {
      const out = structuredClone(obj);
      seen.set(obj, out);
      return out;
    } catch {
      if (!(obj instanceof Error)) return undefined;
    }
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    seen.set(obj, out);
    for (let i = 0; i < obj.length; i++) out[i] = clone(obj[i], seen);
    return out;
  }
  if (obj instanceof Map) {
    const out = new Map<unknown, unknown>();
    seen.set(obj, out);
    for (const [k, v] of obj) out.set(clone(k, seen), clone(v, seen));
    return out;
  }
  if (obj instanceof Set) {
    const out = new Set<unknown>();
    seen.set(obj, out);
    for (const v of obj) out.add(clone(v, seen));
    return out;
  }

  const out: Record<string, unknown> = {};
  seen.set(obj, out);
  for (const key of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'function') continue;
    // defineProperty, not assignment: an own "__proto__" key (parsed JSON) must stay a data property
    Object.defineProperty(out, key, { value: clone(v, seen), enumerable: true, writable: true, configurable: true });
  }
  // A proxied Error keeps what makes it useful
  if (obj instanceof Error) {
    for (const key of ['name', 'message', 'stack'] as const) {
      const v = (obj as unknown as Record<string, unknown>)[key];
      if (typeof v === 'string')
        Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
    }
  }
  return out;
}

export function toPlain<T>(value: T): T {
  return clone(value, new WeakMap()) as T;
}
