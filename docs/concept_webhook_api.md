# Concept: Webhook API (`ha.onWebhook`)

## Motivation

Scripts running in JSA can react to Home Assistant events and schedules — but they can't receive data from the outside world. A webhook API lets external services (GitHub, Ko-fi, IFTTT, custom scripts, …) push data directly into a running script and get a real response back.

---

## Comparison: HA Native Webhooks vs. JSA `ha.onWebhook()`

HA already has a built-in webhook mechanism for automations. Understanding the difference is important for choosing the right tool.

### HA Native Webhook (Automation Trigger)

In HA, you create an automation with trigger type **Webhook**. HA assigns a webhook ID — the URL is:

```
https://<your-ha>/api/webhook/<webhook-id>
```

The webhook ID itself acts as the secret (it is a long random string embedded in the URL).

**What works well:**
- No extra port needed — goes through HA's own HTTPS server
- Works through Nabu Casa / HA Cloud tunnel out of the box
- HTTPS automatically if HA has SSL configured
- Simple to set up via the UI

**What does not work:**
- **No custom response** — HA always returns `200 OK` with an empty body immediately. The automation runs asynchronously *after* the response is sent. The caller cannot receive any data back.
- **No bidi** — fire-and-forget only
- **No JavaScript** — actions are limited to HA automation YAML
- **No access to the full request** — headers and query parameters are not easily accessible in automations

### JSA `ha.onWebhook()`

```js
ha.onWebhook('github-push', async (req, res) => {
    const { ref } = req.body;
    await ha.notify('mobile_app_phone', `Push: ${ref}`);
    res.json({ received: true, branch: ref }); // ← caller gets this back
});
```

**What works well:**
- **Full bidi** — custom HTTP response with any body, status code, and headers
- **Full JavaScript** — complete access to the `ha.*` API inside the handler
- **Full request access** — body, headers, query params all available
- **Token managed by JSA** — auto-generated, never in code, manageable from the UI panel
- Suitable for services that require a specific response (GitHub, Stripe, etc.)

**What requires extra setup:**
- Dedicated port must be opened in router/firewall
- Extra configuration needed behind a reverse proxy (see below)
- Does **not** work through Nabu Casa tunnel without additional port forwarding

### Decision guide

| Need | Use |
|---|---|
| Simple trigger → HA action, no response needed | HA Native Webhook |
| Custom response body / status code | JSA `ha.onWebhook()` |
| Complex logic, access to `ha.*` API | JSA `ha.onWebhook()` |
| Nabu Casa / HA Cloud, no port forwarding | HA Native Webhook |
| Services expecting a real response (GitHub, Stripe) | JSA `ha.onWebhook()` |

---

## Architecture

### Why not Ingress?

HA Ingress proxies the addon UI through the Supervisor and requires an active HA session. External services have no such session — all requests through Ingress would be rejected. Webhooks need a dedicated port that is publicly reachable without HA authentication.

### Two-port model

```
Port 8099 (Ingress)  →  Addon UI          (authenticated, via HA Supervisor proxy)
Port 3001 (direct)   →  Webhook receiver  (own auth via auto-managed token per webhook)
```

The webhook port is configurable and optional — the server only starts when at least one script has registered a webhook handler, and shuts down when no webhooks remain active.

---

## Request / Response Flow (bidirectional)

```
External caller
  → POST http://<ha-ip>:<webhook_port>/webhook/<id>
    X-Webhook-Secret: <token>            ← managed by JSA, shown in panel
  → WebhookManager (Express server in addon process)
      → token verified against persisted registry
      → 401 if invalid (before handler is called)
  → IPC message to Worker (includes correlation ID + request data)
  → Handler runs in user script
  → res.json({...}) / res.send() / res.status(404).json(...)
  → IPC reply back to WebhookManager
  → HTTP response returned to caller
```

The real Express `res` object lives in the main process and is held in a `Map<correlationId, res>`. The worker receives a plain serializable request object and sends back a serializable response object. If the worker does not respond within 10 seconds, the server returns `504 Gateway Timeout`.

---

## Token Management

JSA automatically generates and manages a secret token per webhook ID:

- Generated once on first registration, persisted in `.storage/webhooks.json`
- Stable across script reloads and addon restarts
- Never appears in script code
- Rotatable from the Webhook Panel (with warning: external services must be updated)

Verification happens automatically via the `X-Webhook-Secret` request header — no code required in the handler.

---

## Security Measures

The webhook server is reachable from the public internet (that's the point), so it needs its own hardening independent of HA's auth.

### Required (v1)

| Measure | Why |
|---|---|
| Constant-time token comparison (`crypto.timingSafeEqual`, not `===`) | Prevents timing attacks that could leak the token byte-by-byte |
| Rate limiting per webhook ID / IP | Blocks token brute-forcing and basic request-flood DoS |
| Body size limit on `express.json()` (e.g. `100kb`) | Prevents memory-exhaustion DoS via oversized payloads |
| `webhook_trust_proxy` is an explicit opt-in setting, **not** automatic | If the addon is directly port-forwarded (no reverse proxy in front), trusting `X-Forwarded-For` by default lets any caller spoof their IP and defeat IP-based checks. Must default to `false`. |
| Reject registering a webhook ID already owned by another script | Prevents one script from silently hijacking another script's endpoint/token |
| Generic `500` body to the caller on internal errors | Stack traces / internals must never leak externally — details go to the script log only |
| `noAuth: true` webhooks show a clear "public / unprotected" badge in the panel | Anyone with the URL can call them with zero verification — must be obvious, not just documented |
| 10-second handler timeout (already specified above) | Also protects against slow-loris-style resource exhaustion, not just correctness |

### Optional / later

- IP allowlist per webhook (GitHub, Stripe, etc. publish static IP ranges) as a second layer beyond the token
- HMAC signature verification helper (`ha.verifyWebhookSignature()`) for providers that sign payloads (GitHub `X-Hub-Signature-256`, Stripe) instead of relying purely on a static header token
- Backoff/temporary block after repeated auth failures from the same IP
- Explicit documentation that the webhook server does **not** terminate TLS itself — exposing it directly to the internet without a reverse proxy means traffic (including the token) travels unencrypted over HTTP

---

## Script API

### Standard (JSA-managed token, auto-verified)

```js
// @permission webhook

ha.onWebhook('github-push', async (req, res) => {
    // Token already verified — handler only called if valid
    const { ref, repository } = req.body;
    await ha.notify('mobile_app_phone', `Push to ${ref} in ${repository.name}`);
    res.json({ received: true });
});
```

### Public / no auth (`noAuth: true`)

For services that embed their own token in the request body (e.g. Ko-fi) and where the JSA header check is not applicable:

```js
// @permission webhook

ha.onWebhook('ko-fi', { noAuth: true }, async (req, res) => {
    const data = JSON.parse(req.body.data);

    // Verify Ko-fi's own token manually
    if (data.verification_token !== 'your-ko-fi-token') {
        return res.status(401).json({ error: 'unauthorized' });
    }

    if (data.type === 'Donation') {
        await ha.notify('mobile_app_phone',
            `☕ ${data.from_name} donated €${data.amount}!`);
    }

    res.json({ status: 'ok' });
});
```

### GET webhooks

Some services (or simple status/polling checks) use `GET` instead of `POST`. The method is fixed per webhook ID — one ID always maps to exactly one method:

```js
// @permission webhook

ha.onWebhook('status', { method: 'GET' }, async (req, res) => {
    const { token } = req.query;
    if (token !== 'expected-token') return res.status(401).json({ error: 'unauthorized' });
    res.json({ ok: true, uptime: process.uptime() });
});
```

### Signature

```ts
ha.onWebhook(id: string, handler: WebhookHandler): void
ha.onWebhook(id: string, options: WebhookOptions, handler: WebhookHandler): void

interface WebhookOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'   // default: 'POST'
    noAuth?: boolean                                        // skip automatic token verification (default: false)
}

type WebhookHandler = (req: WebhookRequest, res: WebhookResponse) => void | Promise<void>
```

Deliberately **not** supported: multiple methods per ID, custom/arbitrary paths, or static file serving. Each webhook is one fixed endpoint (`/webhook/<id>`) with one method — JSA is an automation scripting environment, not a general web-app hosting platform. This boundary was discussed and confirmed; widening it is out of scope unless revisited explicitly.

### `req` object

| Field | Type | Description |
|---|---|---|
| `method` | `string` | HTTP method (`POST`, `GET`, …) |
| `headers` | `Record<string, string>` | Request headers |
| `body` | `any` | Parsed JSON body, or raw string |
| `query` | `Record<string, string>` | URL query parameters |
| `ip` | `string` | Caller IP (real IP if behind a trusted proxy) |

### `res` object

| Method | Description |
|---|---|
| `res.json(data)` | Send JSON response (200) |
| `res.send(text)` | Send plain text response (200) |
| `res.status(code)` | Set status code, chainable: `res.status(404).json({...})` |

---

## Webhook Panel (UI)

A dedicated panel in the addon UI (alongside Event Inspector / MQTT Monitor) showing all active webhooks:

```
┌────────────────────────────────────────────────────────┐
│ WEBHOOKS                                               │
├────────────────────────────────────────────────────────┤
│ github-push                             [script.js]    │
│ URL:    :3001/webhook/github-push       [📋 Copy]      │
│ Token:  ••••••••••••••••••••           [👁] [📋] [↺]  │
│ Last:   2 min ago  200 OK                              │
├────────────────────────────────────────────────────────┤
│ ko-fi                    [no auth]      [script.js]    │
│ URL:    :3001/webhook/ko-fi             [📋 Copy]      │
│ Last:   never                                          │
└────────────────────────────────────────────────────────┘
```

- **👁** — reveal token
- **📋** — copy to clipboard (without revealing)
- **↺** — regenerate token (with warning: external services must be updated)
- If `webhook_external_url` is configured, the Copy button yields the full external URL. Otherwise only port + path is shown and the user substitutes their own hostname.

### Script-start log entry

When `ha.onWebhook()` is called, a line is written to the script log:

```
🔗 Webhook "github-push" active → :<port>/webhook/github-push
```

---

## Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `webhook_port` | number | `3001` | Port the webhook server listens on. Only active when at least one webhook is registered. |
| `webhook_external_url` | string | _(empty)_ | Base URL shown in the panel for copy (e.g. `https://myha.example.com`). Optional — only needed when behind a reverse proxy. |
| `webhook_trust_proxy` | boolean | `false` | Trust `X-Forwarded-For` for `req.ip`. Only enable when a trusted reverse proxy actually sits in front of the webhook port — otherwise callers can spoof their IP. |

---

## Reverse Proxy Setup

Many HA installations run behind a reverse proxy (nginx, Traefik, Caddy, Cloudflare Tunnel, etc.). Several things must be considered.

### What needs to be configured

**1. Forward the webhook port**

The proxy must forward an external path or port to the addon's internal webhook port (default `3001`). Example for nginx:

```nginx
location /webhook/ {
    proxy_pass http://<ha-ip>:3001/webhook/;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Webhook-Secret $http_x_webhook_secret;
}
```

**2. `X-Webhook-Secret` header must pass through**

Some proxies (especially Cloudflare with certain WAF rules) strip non-standard headers. Verify that `X-Webhook-Secret` is forwarded unchanged. If the header is stripped, all authenticated webhooks will return `401`.

**3. Set `webhook_external_url` in JSA settings**

So the panel shows the correct URL to copy:

```
webhook_external_url: https://myha.example.com
```

The Copy button in the panel will then yield `https://myha.example.com/webhook/github-push`.

**4. Proxy timeout must exceed the handler timeout**

The JSA handler has a 10-second timeout (returns `504` if exceeded). The proxy's own timeout should be set higher (e.g. `proxy_read_timeout 30s` in nginx) to avoid the proxy closing the connection before JSA can respond.

### Real IP behind a proxy

Without configuration, `req.ip` in the handler contains the proxy's IP, not the caller's. Set `webhook_trust_proxy: true` in JSA settings to make Express read `X-Forwarded-For` instead — so `req.ip` reflects the real caller IP as long as the proxy sets this header.

This must stay an **explicit opt-in**, not automatic: if the addon port is directly reachable (port-forwarded without a reverse proxy in front), an external caller could set their own `X-Forwarded-For` header and spoof any IP they like, defeating IP-based checks. Only enable it when a trusted proxy actually sits in front of the webhook port.

### Nabu Casa / HA Cloud

The HA Cloud tunnel only forwards traffic to HA's own frontend (ports 80/443 to the HA HTTP server). A custom addon port like `3001` is **not** reachable through Nabu Casa. Users on Nabu Casa who need external webhooks must set up independent port forwarding outside of HA Cloud, or use HA's native webhook automation trigger instead.

---

## Capability & Permissions

A new `@permission webhook` entry in the script header system:

```js
// @name My Script
// @description Receives Ko-fi donation webhooks
// @permission webhook
```

- The capability analyzer detects `ha.onWebhook` calls and flags the permission as required if missing.
- Without the permission declared, the call is blocked when capability enforcement is enabled.
- `@permission webhook` implies network access is needed — no separate `@permission network` required for the webhook handler itself.

---

## Webhook Server Lifecycle

Each registry entry has two separate identity fields, which must not be conflated:
- **`owner`** — the filename that registered the webhook. **Persisted**, survives addon restarts, never cleared. This is the only handle used to attribute an entry to a script for deletion/purge.
- **`active`** — **runtime-only, never persisted.** True only while that script's worker is currently running and has (re-)registered the webhook this session. Always resets to `false` on every addon boot, before any script has had a chance to re-register.

This split exists because an earlier version conflated the two into a single `scriptFilename` field that was reset to `null` on every load — which meant deleting a script could never find its own (by-then-inactive) webhooks to purge, since the match against the (already-null) owner always failed.

| Event | Action |
|---|---|
| First `ha.onWebhook()` registered | Webhook server starts on configured port; `owner` set, `active` set to `true` |
| Worker exits (reload / stopped / crashed) | Its webhooks are marked **inactive** (`active: false`, requests get `503`) — `owner` and the token stay persisted so a later reload/restart (or a full addon restart) reclaims the same token |
| Script **file deleted** via `DELETE /api/scripts/:filename` | Its webhooks are **permanently purged** (token included) — triggered directly by the delete route itself (`workerManager.purgeWebhooksForScript()`), matched by `owner`, not by `active` state. This works regardless of whether the script had a running worker at the time (stopScript() is a no-op without one, so purging can never depend on the worker's exit event) |
| No `active` webhooks remain (inactive/persisted entries don't keep it running) | Webhook server shuts down |
| User deletes an inactive webhook from the panel | Permanently purged. Refused for an active webhook — stop the script first |

---

## Token Persistence

Tokens are stored in `.storage/webhooks.json`. `active` is intentionally **not** part of this file — it is always recomputed at runtime and would be meaningless read back from disk (see the owner/active split above):

```json
{
  "github-push": {
    "token": "a3f9...c1d2",
    "method": "POST",
    "owner": "my_script.js",
    "created": "2026-06-30T10:00:00Z",
    "rotated": null
  },
  "ko-fi": {
    "token": null,
    "method": "POST",
    "owner": "kofi_integration.ts",
    "noAuth": true
  }
}
```

Token is regenerated only on explicit user action (↺ in panel), not on script reload.

---

## Components to Build

| Component | Change |
|---|---|
| `core/webhook-manager.js` | New — Express server, webhook registry, token persistence, IPC bridge, rate limiting (`express-rate-limit`), constant-time token check |
| `core/worker-wrapper.js` | Add `ha.onWebhook()` API + IPC protocol for bidi |
| `core/worker-manager.js` | Route IPC webhook messages, manage correlation IDs |
| `core/kernel.js` | Instantiate and wire up `WebhookManager` |
| `core/settings-schema.js` | Add `webhook_port`, `webhook_external_url`, `webhook_trust_proxy` fields |
| `core/capability-analyzer.js` | Add `webhook` permission detection |
| `ha-api.d.ts` | Add types for `ha.onWebhook`, `WebhookOptions`, `WebhookRequest`, `WebhookResponse` |
| `locales/*/translation.json` | Settings labels + panel UI strings |
| `public/js/webhook-panel.js` | New — UI panel with token management |

---

## Documentation Plan

The following texts are ready to copy into README.md and API_REFERENCE.md once the feature is implemented.

### README.md — Key Features bullet

Add after the `ha.mqtt` bullet:

```
- **Webhook Receiver (`ha.onWebhook`)** — Let external services push data into your scripts and get a real response back. Unlike HA's built-in webhook automations (which are fire-and-forget), JSA webhooks are fully bidirectional: your handler receives the complete request and returns any HTTP response — body, status code, headers. Tokens are auto-generated and managed by JSA, never in script code. A dedicated Webhook Panel shows all active endpoints with copy-ready URLs and token management (reveal / rotate). Requires a dedicated port; does not work through Nabu Casa tunnel. Use HA native webhooks for simple triggers; use `ha.onWebhook()` when you need a real response.
```

### README.md — Decision guide (add as new subsection under a relevant section or before Installation)

```markdown
### When to use `ha.onWebhook()` vs. HA native webhooks

| Need | Use |
|---|---|
| Simple trigger → HA action, no response needed | HA Automation Webhook |
| Custom response body / status code | `ha.onWebhook()` |
| Complex logic, access to the full `ha.*` API | `ha.onWebhook()` |
| Nabu Casa / HA Cloud, no port forwarding | HA Automation Webhook |
| Services that require a real response (GitHub, Stripe, Ko-fi) | `ha.onWebhook()` |
```

### API_REFERENCE.md — New section (add after `## MQTT API`)

````markdown
## Webhook API (`ha.onWebhook`)

`ha.onWebhook` turns your script into a webhook receiver — external services can POST data to a dedicated URL and get a real HTTP response back. Unlike HA's built-in webhook automations (which always return an empty `200 OK` immediately), JSA webhooks are fully bidirectional.

> **When to use this vs. HA native webhooks:**
> If you only need a trigger with no response (e.g. "run this automation when GitHub pushes"), use HA's built-in webhook automation trigger — no extra port needed, works through Nabu Casa. Use `ha.onWebhook()` when you need to return a real response body or status code (GitHub expects `200`, Stripe expects specific JSON, Ko-fi expects a confirmation).

> **Requires:** `webhook_port` set in Settings → General. The port must be reachable from the internet (router port forwarding or reverse proxy). Does **not** work through Nabu Casa tunnel.

### `ha.onWebhook(id, handler)` / `ha.onWebhook(id, options, handler)`

Registers a webhook endpoint at `:<webhook_port>/webhook/<id>`. Default method is `POST`; set `options.method` for `GET`/`PUT`/`DELETE`/`PATCH`. One ID always maps to exactly one method.

**Standard — JSA-managed token, auto-verified:**

```js
// @permission webhook

ha.onWebhook('github-push', async (req, res) => {
    // Token is verified automatically via X-Webhook-Secret header
    const { ref, repository } = req.body;
    await ha.notify('mobile_app_phone', `Push to ${ref} in ${repository.name}`);
    res.json({ received: true });
});
```

**Without automatic verification (`noAuth: true`):**

For services that embed their own token in the body (e.g. Ko-fi sends `data.verification_token`):

```js
// @permission webhook

ha.onWebhook('ko-fi', { noAuth: true }, async (req, res) => {
    const data = JSON.parse(req.body.data);
    if (data.verification_token !== 'your-ko-fi-token') {
        return res.status(401).json({ error: 'unauthorized' });
    }
    if (data.type === 'Donation') {
        await ha.notify('mobile_app_phone', `☕ ${data.from_name} donated €${data.amount}!`);
    }
    res.json({ status: 'ok' });
});
```

**GET webhook (e.g. status/polling check):**

```js
// @permission webhook

ha.onWebhook('status', { method: 'GET' }, async (req, res) => {
    const { token } = req.query;
    if (token !== 'expected-token') return res.status(401).json({ error: 'unauthorized' });
    res.json({ ok: true, uptime: process.uptime() });
});
```

**`req` object**

| Field | Type | Description |
|---|---|---|
| `method` | `string` | HTTP method (`POST`, `GET`, …) |
| `headers` | `Record<string, string>` | Request headers |
| `body` | `any` | Parsed JSON body, or raw string (empty for `GET`) |
| `query` | `Record<string, string>` | URL query parameters |
| `ip` | `string` | Caller IP (real IP only if `webhook_trust_proxy` is enabled behind a trusted reverse proxy) |

**`res` object**

| Method | Description |
|---|---|
| `res.json(data)` | Send JSON response (200) |
| `res.send(text)` | Send plain text response (200) |
| `res.status(code)` | Set status code, chainable: `res.status(404).json({...})` |

Handler timeout: **10 seconds** — if the handler does not respond in time, the caller receives `504 Gateway Timeout`.

### Security

- Requests are rate-limited per webhook ID/IP; excessive requests receive `429`.
- Token verification uses a constant-time comparison — timing cannot be used to guess the token.
- `noAuth: true` webhooks are **fully public** — anyone with the URL can call them with no verification at all. Only use this when the service itself embeds a verifiable token in the payload (as shown above for Ko-fi), and check it yourself in the handler.
- `req.ip` only reflects the real caller IP if `webhook_trust_proxy` is enabled *and* a trusted reverse proxy actually sits in front of the webhook port. Never enable it for a directly port-forwarded setup — callers could spoof their IP via `X-Forwarded-For`.

### Token management

JSA auto-generates a secret token per webhook ID on first use. Tokens are:
- Persisted in `.storage/webhooks.json` — stable across reloads and restarts
- Never written into script code
- Shown in the **Webhook Panel** (masked, with reveal / copy / rotate buttons)
- Verified automatically via the `X-Webhook-Secret` request header

### Reverse proxy setup

If HA runs behind nginx, Traefik, Caddy, or Cloudflare:
- Forward your proxy to the addon's `webhook_port` (default `3001`)
- Ensure `X-Webhook-Secret` is not stripped by the proxy/WAF
- Set `webhook_external_url` in Settings so the panel shows the correct copy URL
- Set proxy timeout above 10s (`proxy_read_timeout 30s` in nginx)
- Nabu Casa tunnel does **not** forward custom addon ports — use port forwarding instead
````
