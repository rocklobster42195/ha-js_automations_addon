// core/snippet-sandbox.ts
// Network guard of the run_snippet worker (worker-wrapper.ts, option `restricted`). A snippet may reach other
// devices, but not the add-on itself: the JSA HTTP API has no authentication, so a snippet that could call
// http://127.0.0.1:<port>/api/... would bypass every other restriction (store, services, scripts).
// Best effort, like the module block: it covers IP literals, "localhost", names that resolve to an own address and
// local (unix) sockets; it is not a hard security boundary.
import * as net from 'net';
import * as os from 'os';
import * as dns from 'dns';

/** Every address of this machine (all interfaces). */
export function ownAddresses(): Set<string> {
  const own = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) own.add(entry.address.toLowerCase());
  }
  return own;
}

export function isOwnAddress(address: string, own: Set<string>): boolean {
  const a = address
    .toLowerCase()
    .replace(/^::ffff:/, '')
    .replace(/%.*$/, '');
  return a === '::1' || a === '::' || a === '0.0.0.0' || a.startsWith('127.') || own.has(a);
}

export function isLocalHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost');
}

const refusal = (what: string): Error =>
  new Error(`PermissionDeniedError: connections to the add-on itself (${what}) are not available in run_snippet.`);

/** Wraps net.Socket.prototype.connect (used by http, https, fetch, tls, http2) with the checks above. */
export function installConnectGuard(own: Set<string> = ownAddresses()): void {
  const original = net.Socket.prototype.connect;

  const refuse = (socket: net.Socket, what: string): net.Socket => {
    process.nextTick(() => socket.destroy(refusal(what)));
    return socket;
  };

  (net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) {
    let options: any;
    if (Array.isArray(args[0])) {
      options = args[0][0];
    } else if (args[0] && typeof args[0] === 'object') {
      options = args[0];
    } else if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) {
      // connect(port[, host][, callback])
      const callback = [args[1], args[2]].find((x) => typeof x === 'function');
      options = { port: Number(args[0]), host: typeof args[1] === 'string' ? args[1] : undefined };
      args = callback ? [options, callback] : [options];
    } else {
      return refuse(this, 'a local socket');
    }
    if (options?.path) return refuse(this, 'a local socket');

    const host: string = (options && options.host) || 'localhost';
    if (net.isIP(host)) {
      if (isOwnAddress(host, own)) return refuse(this, host);
    } else {
      if (isLocalHostName(host)) return refuse(this, host);
      // A name that resolves to an own address is refused as well.
      const lookup = options.lookup ?? dns.lookup;
      options.lookup = (name: string, opts: any, cb: (...r: any[]) => void) =>
        lookup(name, opts, (err: Error | null, address: any, family: any) => {
          if (!err) {
            const list: string[] = Array.isArray(address) ? address.map((x: any) => x.address) : [address];
            if (list.some((a) => a && isOwnAddress(a, own))) return cb(refusal(name));
          }
          cb(err, address, family);
        });
    }
    return original.apply(this, args as any);
  };
}
