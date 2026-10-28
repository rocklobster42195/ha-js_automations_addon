#!/usr/bin/env node
// stdio <-> Streamable HTTP bridge for the JS Automations MCP server.
//
// Claude Desktop starts local (stdio) MCP servers only. This tiny process is what the .mcpb bundle
// runs: it reads JSON-RPC messages from stdin, POSTs each one to the add-on's /mcp endpoint with
// the access token and writes the reply to stdout. The add-on answers statelessly with plain JSON,
// so no session handling is needed. No dependencies — Node 18+ (global fetch) is enough.
//
// Configuration (set by the .mcpb manifest from the values the user entered on install):
//   JSA_MCP_URL              endpoint, e.g. http://homeassistant.local:3002/mcp
//   JSA_MCP_TOKEN            access token from Settings → MCP Server
//   JSA_ALLOW_SELF_SIGNED    "true" to accept a self-signed HTTPS certificate

'use strict';

const readline = require('node:readline');

const REQUEST_TIMEOUT_MS = 120000;

const endpoint = process.env.JSA_MCP_URL;
const token = process.env.JSA_MCP_TOKEN;
const allowSelfSigned = ['true', '1', 'yes'].includes(String(process.env.JSA_ALLOW_SELF_SIGNED).toLowerCase());

if (!endpoint || !token) {
  process.stderr.write('JS Automations bridge: JSA_MCP_URL and JSA_MCP_TOKEN must be set.\n');
  process.exit(1);
}
if (allowSelfSigned) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const log = (text) => process.stderr.write(`JS Automations bridge: ${text}\n`);

/** Request ids in a message (a batch may hold several); notifications have none and expect no reply. */
function requestIds(message) {
  return (Array.isArray(message) ? message : [message])
    .filter((m) => m && typeof m === 'object' && m.method !== undefined && m.id !== undefined && m.id !== null)
    .map((m) => m.id);
}

/** Answers every request of a failed message with a JSON-RPC error so the client does not wait forever. */
function fail(ids, text) {
  if (!ids.length) return log(text);
  for (const id of ids) send({ jsonrpc: '2.0', id, error: { code: -32000, message: text } });
}

/** `data:` payloads of a text/event-stream body, one per event. */
function* sseEvents(body) {
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data) yield data;
  }
}

async function forward(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const ids = requestIds(message);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: line,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const cause = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
    return fail(ids, `Cannot reach the JS Automations MCP server at ${endpoint}: ${e.message}${cause}`);
  }

  const body = await res.text().catch(() => '');
  if (res.status === 202 || res.status === 204) return; // notification accepted
  if (!res.ok) {
    const hint = res.status === 401 ? ' — the access token is wrong or was rotated.' : '';
    return fail(ids, `JS Automations MCP server answered HTTP ${res.status}${hint} ${body.slice(0, 200)}`.trim());
  }

  const payloads = (res.headers.get('content-type') || '').includes('text/event-stream')
    ? [...sseEvents(body)]
    : [body];
  for (const payload of payloads) {
    if (!payload.trim()) continue;
    try {
      send(JSON.parse(payload)); // re-serialized: stdio framing is one message per line
    } catch {
      fail(ids, 'The JS Automations MCP server sent an invalid response.');
    }
  }
}

const inflight = new Set();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const job = forward(line).finally(() => inflight.delete(job));
  inflight.add(job);
});
rl.on('close', () => {
  // stdin closed: finish what is in flight, then exit.
  Promise.allSettled([...inflight]).then(() => process.exit(0));
});
