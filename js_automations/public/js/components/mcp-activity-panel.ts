import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface McpActivityEntry {
  id: number;
  ts: number;
  tool: string;
  target: string | null;
  ip: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
}

const MAX_VISIBLE = 200;

// English fallbacks for the kind badge until the translations are loaded.
const KIND_FALLBACK: Record<string, string> = {
  bug: 'bug',
  api: 'API',
  feature: 'feature',
  docs: 'docs',
  other: 'other',
};

interface FeedbackNote {
  id: string;
  kind: 'bug' | 'api' | 'feature' | 'docs' | 'other';
  severity: 'normal' | 'hard_error';
  title: string;
  detail: string;
  count: number;
}

/**
 * MCP dev-tools tab: live log of the tool calls AI clients make over MCP. Panel content only — the
 * MCP tab button and the .dev-tab-panel/.hidden toggling stay owned by layout.js's generic tab
 * switcher (this element IS the panel, id="dev-tab-mcp"). Setup (token, endpoint) lives in
 * Settings → MCP Server.
 */
@customElement('mcp-activity-panel')
export class McpActivityPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 0;
      overflow: hidden;
    }
    .list {
      height: 100%;
      overflow-y: auto;
      padding: 6px 8px;
      font-family: monospace;
      font-size: 0.78rem;
      box-sizing: border-box;
    }
    .hint {
      padding: 16px 12px;
      color: #777;
      font-family: inherit;
      font-size: 0.8rem;
    }
    /* Wraps instead of overflowing: in a narrow pane target and meta drop to a second line. */
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 8px;
      padding: 2px 0;
      border-bottom: 1px solid #1c1c1c;
    }
    .time {
      color: #777;
    }
    .tool {
      color: #4fc3f7;
    }
    .target {
      color: #aaa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1 1 120px;
      min-width: 0;
    }
    .meta {
      margin-left: auto;
      white-space: nowrap;
      color: #666;
    }
    .ok {
      color: #66bb6a;
    }
    .fail {
      color: #e57373;
    }
    .section-title {
      margin: 8px 0 4px;
      color: #aaa;
      font:
        700 0.72rem system-ui,
        sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .section-title.divider {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #333;
    }
    .fb {
      padding: 4px 0;
      border-bottom: 1px solid #1c1c1c;
    }
    .fb-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .fb-title {
      flex: 1;
      min-width: 0;
      color: #ccc;
      overflow-wrap: anywhere;
    }
    .fb-badge {
      flex-shrink: 0;
      font-size: 0.66rem;
      font-weight: 700;
      padding: 0 6px;
      border-radius: 3px;
      background: #1f2a33;
      color: #4fc3f7;
    }
    .fb-badge.hard {
      background: #2a0f0f;
      color: #e57373;
    }
    .fb-count {
      flex-shrink: 0;
      color: #888;
    }
    .fb-del {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 0 2px;
      font-size: 0.9rem;
    }
    .fb-del:hover {
      color: #e57373;
    }
    .fb-detail {
      color: #777;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding-left: 2px;
      margin-top: 2px;
    }
    .error {
      flex-basis: 100%;
      color: #c0827f;
      padding-left: 1.4em;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  @state() private _enabled: boolean | null = null;
  @state() private _activity: McpActivityEntry[] = [];
  @state() private _notes: FeedbackNote[] = [];

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key, { defaultValue: fallback }) ?? fallback;
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
    window.socket.on('mcp_activity', (entry: McpActivityEntry) => {
      this._activity = [entry, ...this._activity].slice(0, MAX_VISIBLE);
    });
    window.socket.on('mcp_feedback_changed', () => void this._loadFeedback());
    window.socket.on('mcp_status_changed', (status: { enabled: boolean }) => {
      this._enabled = status.enabled;
    });
    // Missed events while the socket was down: re-sync on every (re)connect.
    window.socket.on('connect', () => void this._load());
  };

  private async _load(): Promise<void> {
    try {
      const [status, activity] = await Promise.all([
        window.apiFetch!('api/mcp').then((r) => r.json()),
        window.apiFetch!('api/mcp/activity').then((r) => r.json()),
      ]);
      this._enabled = !!status.enabled;
      this._activity = (activity as McpActivityEntry[]).slice(0, MAX_VISIBLE);
    } catch (e) {
      console.error('Failed to load MCP activity:', e);
    }
    await this._loadFeedback();
  }

  private async _loadFeedback(): Promise<void> {
    try {
      const data = await window.apiFetch!('api/mcp/feedback').then((r) => r.json());
      this._notes = (data.notes ?? []) as FeedbackNote[];
    } catch (e) {
      console.error('Failed to load MCP feedback:', e);
    }
  }

  private _deleteNote = async (id: string): Promise<void> => {
    await window.apiFetch!(`api/mcp/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this._notes = this._notes.filter((n) => n.id !== id);
  };

  private _renderNote(n: FeedbackNote) {
    const hard = n.severity === 'hard_error';
    const kind = this._t(`devtools.mcp_feedback_kind_${n.kind}`, KIND_FALLBACK[n.kind] ?? n.kind);
    return html`<div class="fb">
      <div class="fb-head">
        <span class="fb-badge ${hard ? 'hard' : ''}"
          >${hard ? this._t('devtools.mcp_feedback_hard_error', 'hard error') : kind}</span
        >
        <span class="fb-title">${n.title}</span>
        <span class="fb-count">${n.count}×</span>
        <button
          class="fb-del"
          title=${this._t('devtools.mcp_feedback_delete', 'Delete note')}
          @click=${() => this._deleteNote(n.id)}
        >
          ✕
        </button>
      </div>
      ${n.detail ? html`<div class="fb-detail">${n.detail}</div>` : ''}
    </div>`;
  }

  private _renderEntry(e: McpActivityEntry) {
    const time = new Date(e.ts).toLocaleTimeString([], { hour12: false });
    return html`<div class="row">
      <span class=${e.ok ? 'ok' : 'fail'}>${e.ok ? '✓' : '✗'}</span>
      <span class="time">${time}</span>
      <span class="tool">${e.tool}</span>
      <span class="target">${e.target ?? ''}</span>
      <span class="meta">${e.ip} · ${e.durationMs} ms</span>
      ${e.error ? html`<span class="error">${e.error}</span>` : ''}
    </div>`;
  }

  render() {
    if (this._enabled === false) {
      return html`<div class="hint">
        ${this._t('devtools.mcp_disabled', 'The MCP server is switched off. Enable it in Settings → MCP Server.')}
      </div>`;
    }
    return html`<div class="list">
      ${
        this._notes.length
          ? html`<div class="section-title">
                ${this._t('devtools.mcp_feedback_title', 'JSA feedback from the assistant')} (${this._notes.length})
              </div>
              ${this._notes.map((n) => this._renderNote(n))}
              <div class="section-title divider">
                ${this._t('devtools.mcp_calls_title', 'Tool calls')} (${this._activity.length})
              </div>`
          : ''
      }
      ${
        this._activity.length
          ? this._activity.map((e) => this._renderEntry(e))
          : html`<div class="hint">
              ${this._t('devtools.mcp_empty', 'No tool calls yet. They appear here as soon as an AI client uses the server.')}
            </div>`
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mcp-activity-panel': McpActivityPanel;
  }
}
