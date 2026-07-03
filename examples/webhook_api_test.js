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
//    Test: POST http://<host>:<webhook_port>/webhook/open
//    Body (JSON): { "verification_token": "test-secret" }
// ---------------------------------------------------------------------------
ha.onWebhook('open', { noAuth: true }, async (req, res) => {
    if (req.body?.verification_token !== 'test-secret') {
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

ha.log('[webhook_api_test] Registered: ping (POST), status (GET), open (POST, noAuth), boom (POST, throws), timeout (POST, never responds).');
