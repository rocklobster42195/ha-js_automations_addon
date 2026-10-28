import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface McpStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  path: string;
  externalUrl: string;
  allowlist: string[];
  created: string;
  rotated: string | null;
}

const TOKEN_PLACEHOLDER = '••••••••••••••••••••';

/**
 * MCP setup panel, embedded in Settings → MCP Server (custom item type 'mcp-panel'). Shows whether
 * the server is running, the endpoint and access token and a ready Claude Desktop config snippet.
 * The log of tool calls lives in the dev-tools tab (mcp-activity-panel.ts).
 */
@customElement('mcp-panel')
export class McpPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .box {
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 10px 12px;
      margin: 4px 0 8px;
      font-size: 0.85rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      min-width: 0;
    }
    .label {
      color: #888;
      flex-shrink: 0;
      min-width: 70px;
    }
    .value {
      font-family: monospace;
      color: #ccc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .value.wrap {
      white-space: normal;
      word-break: break-all;
    }
    .badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 1px 8px;
      border-radius: 3px;
    }
    .badge-ok {
      background: #0a2a0a;
      color: #66bb6a;
    }
    .badge-wait {
      background: #2a2000;
      color: #ffa726;
    }
    .icon-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 1rem;
      line-height: 1;
    }
    .icon-btn:hover {
      color: #ddd;
      background: #222;
    }
    .install-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      background: var(--accent, #4fc3f7);
      color: #000;
      font-weight: 700;
      font-size: 0.85rem;
      text-decoration: none;
      border-radius: 6px;
      padding: 8px 16px;
    }
    .install-btn:hover {
      filter: brightness(1.1);
    }
    .snippet-btn {
      margin-top: 6px;
      background: none;
      border: 1px solid #444;
      color: #ccc;
      border-radius: 5px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 0.82rem;
    }
    .snippet-btn:hover {
      background: #222;
    }
    .hint {
      color: #888;
      font-size: 0.78rem;
      margin-top: 6px;
      line-height: 1.4;
    }
  `;

  @state() private _status: McpStatus | null = null;
  @state() private _token: string | null = null;
  @state() private _copied = '';

  private _copiedTimer?: ReturnType<typeof setTimeout>;

  private _t(key: string, fallback: string, options?: Record<string, unknown>): string {
    const translated = window.i18next?.t(key, { defaultValue: fallback, ...options });
    if (translated !== undefined) return translated;
    // i18next not loaded (yet): fill the {{placeholders}} of the fallback text ourselves.
    return fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? ''));
  }

  connectedCallback() {
    super.connectedCallback();
    void this._load();
    this._bindSocket();
  }

  private _bindSocket = (attempt = 0): void => {
    if (!window.socket) {
      if (attempt < 20) setTimeout(() => this._bindSocket(attempt + 1), 200);
      return;
    }
    window.socket.on('mcp_status_changed', (status: McpStatus) => {
      this._status = status;
    });
    // Missed events while the socket was down: re-sync on every (re)connect.
    window.socket.on('connect', () => void this._load());
  };

  private async _load(): Promise<void> {
    try {
      this._status = await window.apiFetch!('api/mcp').then((r) => r.json());
      this._token = null; // never keep a revealed token across a resync
    } catch (e) {
      console.error('Failed to load MCP status:', e);
    }
  }

  private get _endpoint(): string {
    const s = this._status;
    if (!s) return '';
    return s.externalUrl
      ? `${s.externalUrl.replace(/\/+$/, '')}${s.path}`
      : `http://${window.location.hostname}:${s.port}${s.path}`;
  }

  /** One-click install package for Claude Desktop, prefilled with the endpoint shown above. */
  private get _installHref(): string {
    return `${window.BASE_PATH ?? '/'}api/mcp/mcpb?url=${encodeURIComponent(this._endpoint)}`;
  }

  private async _fetchToken(): Promise<string | null> {
    try {
      const res = await window.apiFetch!('api/mcp/token');
      return (await res.json()).token ?? null;
    } catch {
      return null;
    }
  }

  private _reveal = async (): Promise<void> => {
    this._token = this._token ? null : await this._fetchToken();
  };

  private _flash(what: string): void {
    this._copied = what;
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => (this._copied = ''), 1500);
  }

  private _copy = async (what: string, text: string | null): Promise<void> => {
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    this._flash(what);
  };

  private _copyToken = async (): Promise<void> => this._copy('token', this._token ?? (await this._fetchToken()));

  /** Claude Desktop config for users who prefer editing claude_desktop_config.json (needs Node.js on their PC). */
  private _configSnippet(token: string): string {
    const url = this._endpoint;
    const args = ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'];
    if (url.startsWith('http://')) args.push('--allow-http');
    return JSON.stringify(
      { mcpServers: { 'js-automations': { command: 'npx', args, env: { AUTH_HEADER: `Bearer ${token}` } } } },
      null,
      2
    );
  }

  private _copySnippet = async (): Promise<void> => {
    const token = this._token ?? (await this._fetchToken());
    if (token) await this._copy('snippet', this._configSnippet(token));
  };

  private _rotate = async (): Promise<void> => {
    const ok = await window.confirmDialog?.confirm(
      this._t(
        'settings.mcp_panel.rotate_confirm',
        'Create a new access token? Every AI client using the old one stops working until you update it.'
      )
    );
    if (!ok) return;
    try {
      const res = await window.apiFetch!('api/mcp/rotate', { method: 'POST' });
      this._token = (await res.json()).token ?? null;
    } catch (e) {
      console.error('Failed to rotate MCP token:', e);
    }
  };

  private _copyBtn(what: string, title: string, onClick: () => void) {
    return html`<button class="icon-btn" title=${title} @click=${onClick}>
      <i class="mdi ${this._copied === what ? 'mdi-check' : 'mdi-content-copy'}"></i>
    </button>`;
  }

  render() {
    const s = this._status;
    if (!s) return nothing;
    return html`
      ${mdiStylesheetLink}
      <div class="box">
        <div class="row">
          <span class="label">${this._t('settings.mcp_panel.status', 'Status')}</span>
          ${
            s.running
              ? html`<span class="badge badge-ok"
                  >${this._t('settings.mcp_panel.running', 'running on port {{port}}', { port: s.port })}</span
                >`
              : html`<span class="badge badge-wait"
                  >${this._t(
                    'settings.mcp_panel.not_running',
                    'not running yet (starting, or port {{port}} is still in use by the other add-on)',
                    { port: s.port }
                  )}</span
                >`
          }
        </div>
        <div class="row">
          <span class="label">${this._t('settings.mcp_panel.endpoint', 'Endpoint')}</span>
          <span class="value wrap">${this._endpoint}</span>
          ${this._copyBtn('url', this._t('settings.mcp_panel.copy', 'Copy'), () => void this._copy('url', this._endpoint))}
        </div>
        <div class="row">
          <span class="label">${this._t('settings.mcp_panel.token', 'Access token')}</span>
          <span class="value">${this._token ?? TOKEN_PLACEHOLDER}</span>
          <button class="icon-btn" title=${this._t('settings.mcp_panel.reveal', 'Show / hide')} @click=${this._reveal}>
            <i class="mdi ${this._token ? 'mdi-eye-off' : 'mdi-eye'}"></i>
          </button>
          ${this._copyBtn('token', this._t('settings.mcp_panel.copy', 'Copy'), () => void this._copyToken())}
          <button
            class="icon-btn"
            title=${this._t('settings.mcp_panel.rotate', 'Create new token')}
            @click=${this._rotate}
          >
            <i class="mdi mdi-refresh"></i>
          </button>
        </div>
        <a class="install-btn" href=${this._installHref} download>
          <i class="mdi mdi-download"></i>
          ${this._t('settings.mcp_panel.install', 'Install for Claude Desktop')}
        </a>
        <div class="hint">
          ${this._t(
            'settings.mcp_panel.install_hint',
            'Downloads a .mcpb file — double-click it to set up Claude Desktop. The file contains your access token, do not share it. Claude Desktop must run on a computer that can reach the endpoint.'
          )}
        </div>
        <button class="snippet-btn" @click=${this._copySnippet}>
          <i class="mdi ${this._copied === 'snippet' ? 'mdi-check' : 'mdi-content-copy'}"></i>
          ${this._t('settings.mcp_panel.copy_config', 'Copy Claude Desktop config')}
        </button>
        <div class="hint">
          ${this._t(
            'settings.mcp_panel.config_hint',
            'Alternatively paste it into claude_desktop_config.json (Settings → Developer → Edit Config). Requires Node.js on the computer running Claude Desktop.'
          )}
        </div>
        <div class="hint">
          <i class="mdi mdi-shield-alert-outline"></i>
          ${this._t(
            'settings.mcp_panel.privacy',
            'Everything an AI client reads through these tools (scripts, logs, entity states) is sent to its provider. Secrets are filtered on a best-effort basis — do not rely on it for credentials.'
          )}
        </div>
        <div class="hint">
          <i class="mdi mdi-text-box-search-outline"></i>
          ${this._t(
            'settings.mcp_panel.activity_hint',
            'The tool calls AI clients make are listed in the dev-tools tab "MCP" (expert mode).'
          )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mcp-panel': McpPanel;
  }
}
