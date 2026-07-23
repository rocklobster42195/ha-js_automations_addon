/**
 * Developer Tools — Webhook Panel
 * Shows all registered ha.onWebhook() endpoints with URL, token management, and last-call status.
 */

let _whPort = 3001;
let _whExternalUrl = '';
let _whWebhooks = [];
let _whRevealedTokens = new Map(); // id -> token (only kept in memory while revealed)

function initWebhookPanel() {
    const panel = document.getElementById('dev-tab-webhooks');
    if (!panel) return;

    panel.innerHTML = `<div id="wh-list" class="wh-list"></div>`;

    _whLoad();

    window.socket?.on('webhook_registry_changed', (webhooks) => {
        _whWebhooks = webhooks;
        _whRender();
    });
    // 'webhook_registry_changed' is only broadcast at the moment a script (re-)registers.
    // If that happens while this client's socket is still reconnecting after an addon
    // restart, the broadcast is missed and the panel is stuck showing pre-restart state
    // until a full page reload. Re-fetch on every (re)connect as a fallback.
    window.socket?.on('connect', () => {
        _whLoad();
    });
    window.socket?.on('webhook_call_logged', ({ id, ts, status }) => {
        const entry = _whWebhooks.find(w => w.id === id);
        if (entry) {
            entry.lastCall = { ts, status };
            _whRender();
        }
    });
    window.socket?.on('webhook_config_changed', ({ port, externalUrl }) => {
        _whPort = port;
        _whExternalUrl = externalUrl;
        _whRender();
    });
}

async function _whLoad() {
    try {
        const res = await apiFetch('api/webhooks');
        const data = await res.json();
        _whPort = data.port;
        _whExternalUrl = data.externalUrl;
        _whWebhooks = data.webhooks;
        _whRender();
    } catch (e) {
        console.error('Failed to load webhooks:', e);
    }
}

function _t(key, def) {
    return (typeof i18next !== 'undefined') ? i18next.t(key, { defaultValue: def }) : def;
}

function _whUrlFor(id) {
    return _whExternalUrl ? `${_whExternalUrl}/webhook/${id}` : `:${_whPort}/webhook/${id}`;
}

function _whRender() {
    const list = document.getElementById('wh-list');
    if (!list) return;

    if (_whWebhooks.length === 0) {
        list.innerHTML = `<div class="wh-hint">${_t('devtools.webhook_no_webhooks', 'No webhooks registered. Call ha.onWebhook() in a script to see it here.')}</div>`;
        return;
    }

    list.innerHTML = _whWebhooks.map(w => _whRenderEntry(w)).join('');
}

function _whRenderEntry(w) {
    const lastCallText = w.lastCall
        ? `${new Date(w.lastCall.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} — ${w.lastCall.status}`
        : _t('devtools.webhook_never', 'never');

    const activeBadge = w.active
        ? `<span class="wh-badge wh-badge-active">${w.method}</span>`
        : `<span class="wh-badge wh-badge-inactive">${_t('devtools.webhook_inactive', 'inactive')}</span>`;

    const noAuthBadge = w.noAuth
        ? `<span class="wh-badge wh-badge-public">${_t('devtools.webhook_public', 'public / unprotected')}</span>`
        : '';

    const allowlistBadge = (w.allowlist && w.allowlist.length)
        ? `<span class="wh-badge wh-badge-allowlist" title="${_whEsc(w.allowlist.join(', '))}">${_t('devtools.webhook_ip_filtered', 'IP-filtered')}</span>`
        : '';

    const tokenRow = w.hasToken ? `
        <div class="wh-row-line">
            <span class="wh-label">${_t('devtools.webhook_token', 'Token')}:</span>
            <span class="wh-token" id="wh-token-${_whEsc(w.id)}">••••••••••••••••••••</span>
            <button class="wh-icon-btn" onclick="whRevealToken('${_whEsc(w.id)}')" title="${_t('devtools.webhook_reveal', 'Reveal')}"><i class="mdi mdi-eye"></i></button>
            <button class="wh-icon-btn" onclick="whCopyToken('${_whEsc(w.id)}')" title="${_t('devtools.webhook_copy', 'Copy')}"><i class="mdi mdi-content-copy"></i></button>
            <button class="wh-icon-btn" onclick="whRotateToken('${_whEsc(w.id)}')" title="${_t('devtools.webhook_rotate', 'Rotate')}"><i class="mdi mdi-refresh"></i></button>
        </div>` : '';

    // Delete is only offered for inactive entries — an active one belongs to a running
    // script and should be stopped first to avoid deleting a token still in use.
    const deleteBtn = !w.active
        ? `<button class="wh-icon-btn wh-icon-btn-danger" onclick="whDelete('${_whEsc(w.id)}')" title="${_t('devtools.webhook_delete', 'Delete')}"><i class="mdi mdi-trash-can-outline"></i></button>`
        : '';

    return `
        <div class="wh-entry">
            <div class="wh-row-line wh-row-header">
                <span class="wh-id">${_whEsc(w.id)}</span>
                ${activeBadge}
                ${noAuthBadge}
                ${allowlistBadge}
                <span class="wh-script">${_whEsc(w.scriptFilename || '—')}</span>
                ${deleteBtn}
            </div>
            <div class="wh-row-line">
                <span class="wh-label">${_t('devtools.webhook_url', 'URL')}:</span>
                <span class="wh-url">${_whEsc(_whUrlFor(w.id))}</span>
                <button class="wh-icon-btn" onclick="whCopyUrl('${_whEsc(w.id)}')" title="${_t('devtools.webhook_copy', 'Copy')}"><i class="mdi mdi-content-copy"></i></button>
            </div>
            ${tokenRow}
            <div class="wh-row-line wh-row-last">
                <span class="wh-label">${_t('devtools.webhook_last', 'Last')}:</span>
                <span>${lastCallText}</span>
            </div>
        </div>
    `;
}

async function whRevealToken(id) {
    try {
        const res = await apiFetch(`api/webhooks/${encodeURIComponent(id)}/token`);
        const data = await res.json();
        if (data.token) {
            _whRevealedTokens.set(id, data.token);
            const el = document.getElementById(`wh-token-${id}`);
            if (el) el.textContent = data.token;
        }
    } catch (e) {
        console.error('Failed to reveal token:', e);
    }
}

async function whCopyToken(id) {
    let token = _whRevealedTokens.get(id);
    if (!token) {
        try {
            const res = await apiFetch(`api/webhooks/${encodeURIComponent(id)}/token`);
            token = (await res.json()).token;
        } catch (e) { return; }
    }
    if (token) navigator.clipboard?.writeText(token);
}

function whCopyUrl(id) {
    navigator.clipboard?.writeText(_whUrlFor(id));
}

async function whRotateToken(id) {
    const confirmMsg = _t('devtools.webhook_rotate_confirm', 'Rotate the token for "{{id}}"? External services using the old token must be updated.').replace('{{id}}', id);
    if (!confirm(confirmMsg)) return;
    try {
        const res = await apiFetch(`api/webhooks/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
        const data = await res.json();
        if (data.token) {
            _whRevealedTokens.set(id, data.token);
            const el = document.getElementById(`wh-token-${id}`);
            if (el) el.textContent = data.token;
        }
    } catch (e) {
        console.error('Failed to rotate token:', e);
    }
}

async function whDelete(id) {
    const confirmMsg = _t('devtools.webhook_delete_confirm', 'Permanently delete the webhook "{{id}}"? This cannot be undone.').replace('{{id}}', id);
    if (!confirm(confirmMsg)) return;
    try {
        const res = await apiFetch(`api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to delete webhook.');
            return;
        }
        _whRevealedTokens.delete(id);
    } catch (e) {
        console.error('Failed to delete webhook:', e);
    }
}

function _whEsc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.initWebhookPanel = initWebhookPanel;
window.whRevealToken = whRevealToken;
window.whCopyToken = whCopyToken;
window.whCopyUrl = whCopyUrl;
window.whRotateToken = whRotateToken;
window.whDelete = whDelete;
