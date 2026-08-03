import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface Webhook {
  id: string;
  method: string;
  active: boolean;
  noAuth?: boolean;
  allowlist?: string[];
  hasToken?: boolean;
  scriptFilename?: string;
  lastCall?: { ts: number; status: string | number };
}

/**
 * WEBHOOKS dev-tools tab: all registered ha.onWebhook() endpoints, with URL,
 * token management, and last-call status. Panel content only — the WEBHOOKS
 * tab button itself and the .dev-tab-panel/.hidden toggling stay owned by
 * layout.js's generic tab switcher (this element IS the panel, id="dev-tab-webhooks").
 */
@customElement('webhook-panel')
export class WebhookPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 0;
      overflow: hidden;
    }

    .wh-list {
      height: 100%;
      overflow-y: auto;
      padding: 6px 8px;
      font-family: monospace;
      font-size: 0.78rem;
      box-sizing: border-box;
    }

    .wh-hint {
      padding: 16px 12px;
      color: #777;
      font-family: inherit;
      font-size: 0.8rem;
    }

    .wh-entry {
      border: 1px solid #222;
      border-radius: 4px;
      padding: 6px 8px;
      margin-bottom: 8px;
    }

    .wh-row-line {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      overflow: hidden;
    }

    .wh-row-header {
      margin-bottom: 2px;
    }

    .wh-id {
      color: #4fc3f7;
      font-weight: 700;
    }

    .wh-script {
      margin-left: auto;
      color: #777;
      font-size: 0.72rem;
    }

    .wh-label {
      color: #777;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .wh-url,
    .wh-token {
      color: #ccc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .wh-badge {
      flex-shrink: 0;
      font-size: 0.68rem;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
    }

    .wh-badge-active {
      background: #0d2233;
      color: #4fc3f7;
    }

    .wh-badge-inactive {
      background: #2a2a2a;
      color: #888;
    }

    .wh-badge-public {
      background: #2a2000;
      color: #ffa726;
    }

    .wh-badge-allowlist {
      background: #0a2a0a;
      color: #66bb6a;
      cursor: help;
    }

    .wh-icon-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 0.9rem;
      line-height: 1;
    }

    .wh-icon-btn:hover {
      color: #ccc;
      background: #222;
    }

    .wh-icon-btn-danger:hover {
      color: #e57373;
      background: #1a0a0a;
    }

    .wh-row-last {
      color: #777;
    }
  `;

  @state() private _port = 3001;
  @state() private _externalUrl = '';
  @state() private _webhooks: Webhook[] = [];
  @state() private _revealedTokens: Map<string, string> = new Map();

  private _t(key: string, fallback: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, options) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._waitForSocket();
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    window.socket.on('webhook_registry_changed', (webhooks: Webhook[]) => {
      this._webhooks = webhooks;
    });
    // 'webhook_registry_changed' is only broadcast at the moment a script
    // (re-)registers. If that happens while this client's socket is still
    // reconnecting after an addon restart, the broadcast is missed and the
    // panel is stuck showing pre-restart state until a full page reload.
    // Re-fetch on every (re)connect as a fallback.
    window.socket.on('connect', () => this._load());
    window.socket.on('webhook_call_logged', ({ id, ts, status }: { id: string; ts: number; status: string }) => {
      const entry = this._webhooks.find((w) => w.id === id);
      if (entry) {
        entry.lastCall = { ts, status };
        this._webhooks = [...this._webhooks];
      }
    });
    window.socket.on('webhook_config_changed', ({ port, externalUrl }: { port: number; externalUrl: string }) => {
      this._port = port;
      this._externalUrl = externalUrl;
    });
  };

  private async _load(): Promise<void> {
    try {
      const res = await window.apiFetch!('api/webhooks');
      const data = await res.json();
      this._port = data.port;
      this._externalUrl = data.externalUrl;
      this._webhooks = data.webhooks;
    } catch (e) {
      console.error('Failed to load webhooks:', e);
    }
  }

  private _urlFor(id: string): string {
    return this._externalUrl ? `${this._externalUrl}/webhook/${id}` : `:${this._port}/webhook/${id}`;
  }

  private _reveal = async (id: string): Promise<void> => {
    try {
      const res = await window.apiFetch!(`api/webhooks/${encodeURIComponent(id)}/token`);
      const data = await res.json();
      if (data.token) {
        this._revealedTokens = new Map(this._revealedTokens).set(id, data.token);
      }
    } catch (e) {
      console.error('Failed to reveal token:', e);
    }
  };

  private _copyToken = async (id: string): Promise<void> => {
    let token = this._revealedTokens.get(id);
    if (!token) {
      try {
        const res = await window.apiFetch!(`api/webhooks/${encodeURIComponent(id)}/token`);
        token = (await res.json()).token;
      } catch (e) {
        return;
      }
    }
    if (token) navigator.clipboard?.writeText(token);
  };

  private _copyUrl = (id: string): void => {
    navigator.clipboard?.writeText(this._urlFor(id));
  };

  private _rotate = async (id: string): Promise<void> => {
    const confirmMsg = this._t(
      'devtools.webhook_rotate_confirm',
      'Rotate the token for "{{id}}"? External services using the old token must be updated.',
      { id }
    ).replace('{{id}}', id);
    if (!confirm(confirmMsg)) return;
    try {
      const res = await window.apiFetch!(`api/webhooks/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
      const data = await res.json();
      if (data.token) {
        this._revealedTokens = new Map(this._revealedTokens).set(id, data.token);
      }
    } catch (e) {
      console.error('Failed to rotate token:', e);
    }
  };

  private _delete = async (id: string): Promise<void> => {
    const confirmMsg = this._t(
      'devtools.webhook_delete_confirm',
      'Permanently delete the webhook "{{id}}"? This cannot be undone.',
      { id }
    ).replace('{{id}}', id);
    if (!confirm(confirmMsg)) return;
    try {
      const res = await window.apiFetch!(`api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete webhook.');
        return;
      }
      const next = new Map(this._revealedTokens);
      next.delete(id);
      this._revealedTokens = next;
    } catch (e) {
      console.error('Failed to delete webhook:', e);
    }
  };

  private _renderEntry(w: Webhook) {
    const lastCallText = w.lastCall
      ? `${new Date(w.lastCall.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} — ${w.lastCall.status}`
      : this._t('devtools.webhook_never', 'never');

    const revealed = this._revealedTokens.get(w.id);

    return html`
      <div class="wh-entry">
        <div class="wh-row-line wh-row-header">
          <span class="wh-id">${w.id}</span>
          ${
            w.active
              ? html`<span class="wh-badge wh-badge-active">${w.method}</span>`
              : html`<span class="wh-badge wh-badge-inactive"
                  >${this._t('devtools.webhook_inactive', 'inactive')}</span
                >`
          }
          ${w.noAuth ? html`<span class="wh-badge wh-badge-public">${this._t('devtools.webhook_public', 'public / unprotected')}</span>` : ''}
          ${
            w.allowlist && w.allowlist.length
              ? html`<span class="wh-badge wh-badge-allowlist" title=${w.allowlist.join(', ')}
                  >${this._t('devtools.webhook_ip_filtered', 'IP-filtered')}</span
                >`
              : ''
          }
          <span class="wh-script">${w.scriptFilename || '—'}</span>
          ${
            !w.active
              ? html`<button
                  class="wh-icon-btn wh-icon-btn-danger"
                  title=${this._t('devtools.webhook_delete', 'Delete')}
                  @click=${() => this._delete(w.id)}
                >
                  <i class="mdi mdi-trash-can-outline"></i>
                </button>`
              : ''
          }
        </div>
        <div class="wh-row-line">
          <span class="wh-label">${this._t('devtools.webhook_url', 'URL')}:</span>
          <span class="wh-url">${this._urlFor(w.id)}</span>
          <button
            class="wh-icon-btn"
            title=${this._t('devtools.webhook_copy', 'Copy')}
            @click=${() => this._copyUrl(w.id)}
          >
            <i class="mdi mdi-content-copy"></i>
          </button>
        </div>
        ${
          w.hasToken
            ? html`
                <div class="wh-row-line">
                  <span class="wh-label">${this._t('devtools.webhook_token', 'Token')}:</span>
                  <span class="wh-token">${revealed ?? '••••••••••••••••••••'}</span>
                  <button
                    class="wh-icon-btn"
                    title=${this._t('devtools.webhook_reveal', 'Reveal')}
                    @click=${() => this._reveal(w.id)}
                  >
                    <i class="mdi mdi-eye"></i>
                  </button>
                  <button
                    class="wh-icon-btn"
                    title=${this._t('devtools.webhook_copy', 'Copy')}
                    @click=${() => this._copyToken(w.id)}
                  >
                    <i class="mdi mdi-content-copy"></i>
                  </button>
                  <button
                    class="wh-icon-btn"
                    title=${this._t('devtools.webhook_rotate', 'Rotate')}
                    @click=${() => this._rotate(w.id)}
                  >
                    <i class="mdi mdi-refresh"></i>
                  </button>
                </div>
              `
            : ''
        }
        <div class="wh-row-line wh-row-last">
          <span class="wh-label">${this._t('devtools.webhook_last', 'Last')}:</span>
          <span>${lastCallText}</span>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="wh-list">
        ${
          this._webhooks.length === 0
            ? html`<div class="wh-hint">
                ${this._t('devtools.webhook_no_webhooks', 'No webhooks registered. Call ha.onWebhook() in a script to see it here.')}
              </div>`
            : this._webhooks.map((w) => this._renderEntry(w))
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'webhook-panel': WebhookPanel;
  }
}
