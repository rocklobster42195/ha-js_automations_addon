/**
 * @name Webhook API Test
 * @icon mdi:webhook
 * @description Tests ha.onWebhook() — the "On the Wire" webhook API. Registers a few
 * endpoints for manual testing with Postman/curl. Check the Webhook Panel (dev tools)
 * for the URL and the auto-generated token.
 * @label Example
 * @permission webhook
 * @loglevel debug
 */

// ---------------------------------------------------------------------------
// 1. Standard POST endpoint — token auto-verified via X-Webhook-Secret header.
//    Test: POST http://<host>:<webhook_port>/webhook/ping
//    Header: X-Webhook-Secret: <token from the Webhook Panel>
//    Body (JSON): { "hello": "world" }
// ---------------------------------------------------------------------------
ha.onWebhook('ping', async (req, res) => {
    ha.log(`[webhook_api_test] ping: method=${req.method} body=${JSON.stringify(req.body)} ip=${req.ip}`);
    res.json({ received: true, echo: req.body });
});

// ---------------------------------------------------------------------------
// 2. GET endpoint — no body, uses query params instead.
//    Header: X-Webhook-Secret: <token from the Webhook Panel>
//    Test: GET http://<host>:<webhook_port>/webhook/status?foo=bar
// ---------------------------------------------------------------------------
ha.onWebhook('status', { method: 'GET' }, async (req, res) => {
    ha.log(`[webhook_api_test] status: query=${JSON.stringify(req.query)}`);
    res.json({ ok: true, uptime: process.uptime(), query: req.query });
});

// ---------------------------------------------------------------------------
// 3. Public endpoint (noAuth: true) — no X-Webhook-Secret check, script verifies itself.
//    The externally-issued token is read from ha.store (flagged as Secret), never
//    hardcoded in the script — same pattern as examples/kofi_integration.ts.
//    Set it once via Store Explorer: key "open_webhook_config", value (Object)
//    { "verification_token": "test-secret" }, "Secret" checkbox on.
//    Test: POST http://<host>:<webhook_port>/webhook/open
//    Body (JSON): { "verification_token": "test-secret" }
// ---------------------------------------------------------------------------
const openConfig = ha.persistent('open_webhook_config', {});

ha.onWebhook('open', { noAuth: true }, async (req, res) => {
    if (!openConfig.verification_token) {
        return res.status(500).json({ error: 'not configured — set open_webhook_config in Store Explorer' });
    }
    if (req.body?.verification_token !== openConfig.verification_token) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// 4. Handler that throws — verifies the caller gets a generic 500 (no stack trace leaked).
//    Header: X-Webhook-Secret: <token from the Webhook Panel>
//    Test: POST http://<host>:<webhook_port>/webhook/boom
// ---------------------------------------------------------------------------
ha.onWebhook('boom', async (req, res) => {
    throw new Error('Deliberate test failure');
});

// ---------------------------------------------------------------------------
// 5. Handler that never responds — verifies the 10s timeout returns 504.
//    Test: POST http://<host>:<webhook_port>/webhook/timeout
// ---------------------------------------------------------------------------
ha.onWebhook('timeout', async (req, res) => {
    ha.log('[webhook_api_test] timeout: intentionally not responding...');
    await new Promise(() => {}); // never resolves — handler stays pending until the 10s timeout fires
});

// ---------------------------------------------------------------------------
// 6. IP allowlist — includes localhost so it's actually testable from Postman
//    on the same machine. A request from any other IP gets 403, even with the
//    correct token. Test with an invalid IP by calling through a different
//    network interface / from another machine to see the 403.
//    Header: X-Webhook-Secret: <token from the Webhook Panel>
//    Test: POST http://<host>:<webhook_port>/webhook/allowlisted
// ---------------------------------------------------------------------------
ha.onWebhook('allowlisted', { allowlist: ['127.0.0.1', '::1'] }, async (req, res) => {
    ha.log(`[webhook_api_test] allowlisted: call accepted from ${req.ip}`);
    res.json({ received: true });
});

// ---------------------------------------------------------------------------
// 7. HMAC signature verification — mimics GitHub's X-Hub-Signature-256 scheme.
//    The "secret" here is one you choose yourself (not JSA-managed), so noAuth
//    is used and the signature is checked manually against req.rawBody.
//    Test with curl (adjust SECRET to match hmacConfig.secret below):
//      BODY='{"hello":"world"}'
//      SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "test-hmac-secret" | sed 's/^.* //')"
//      curl -X POST http://<host>:<webhook_port>/webhook/signed \
//        -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" -d "$BODY"
// ---------------------------------------------------------------------------
const hmacConfig = ha.persistent('signed_webhook_config', { secret: 'test-hmac-secret' });

ha.onWebhook('signed', { noAuth: true }, async (req, res) => {
    const sig = req.headers['x-hub-signature-256'];
    if (!ha.verifyWebhookSignature(req.rawBody, sig, hmacConfig.secret)) {
        return res.status(401).json({ error: 'invalid signature' });
    }
    res.json({ received: true, echo: req.body });
});

ha.log('[webhook_api_test] Registered: ping (POST), status (GET), open (POST, noAuth), boom (POST, throws), timeout (POST, never responds), allowlisted (POST, IP-filtered), signed (POST, HMAC).');
