import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface McpActivityEntry {
  id: number;
  ts: number;
  tool: string;
  target: string | null;
  ip: string;
  ok: boolean;
  error: string | null;
  detail?: string | null;
  durationMs: number;
}

const MAX_VISIBLE = 200;
const COPIED_FLASH_MS = 1500;

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
  firstSeen?: number;
  lastSeen?: number;
}

/** "2026-10-28 21:27" — locale independent, so a copied note reads the same everywhere. */
const stamp = (ts: number, seconds = false): string =>
  new Date(ts)
    .toISOString()
    .slice(0, seconds ? 19 : 16)
    .replace('T', ' ');

/**
 * MCP dev-tools tab: the assistant's notes about JSA and a live log of the tool calls AI clients make
 * over MCP. Long texts (a note's detail, a failed call's error) are shown as a one-line preview and
 * expand on click; both can be copied, formatted so they can be pasted into a GitHub issue or a chat.
 * Panel content only — the MCP tab button and the .dev-tab-panel/.hidden toggling stay owned by
 * layout.js's generic tab switcher (this element IS the panel, id="dev-tab-mcp"). Setup (token,
 * endpoint) lives in Settings → MCP Server.
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
    .icon-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 0 3px;
      font-size: 0.95rem;
      line-height: 1;
    }
    .icon-btn:hover {
      color: #ddd;
    }
    .icon-btn.danger:hover {
      color: #e57373;
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
    .state {
      display: inline-block;
      min-width: 2.4em;
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
    button.state {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font: inherit;
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
    /* Keeps notes without a detail aligned with those that have a chevron. */
    .chev-space {
      flex-shrink: 0;
      width: calc(0.95rem + 6px);
    }
    .fb-head.expandable {
      cursor: pointer;
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
    /* One-line preview until expanded. */
    .fb-detail {
      color: #777;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding-left: 2px;
      margin-top: 2px;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }
    .fb-detail.open {
      display: block;
      overflow: visible;
    }
    .error {
      flex-basis: 100%;
      color: #c0827f;
      padding-left: 2.4em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .error.info {
      color: #8fa3ad;
    }
    .error.open {
      white-space: pre-wrap;
      overflow: visible;
      overflow-wrap: anywhere;
    }
  `;

  @state() private _enabled: boolean | null = null;
  @state() private _activity: McpActivityEntry[] = [];
  @state() private _notes: FeedbackNote[] = [];
  /** Keys ("fb:<id>" / "act:<id>") of the expanded items. */
  @state() private _open: Set<string> = new Set();
  /** Key of the item whose copy button was just used (shows a check mark for a moment). */
  @state() private _copied = '';

  private _copiedTimer?: ReturnType<typeof setTimeout>;

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

  private _toggle(key: string): void {
    const next = new Set(this._open);
    if (!next.delete(key)) next.add(key);
    this._open = next;
  }

  private async _copy(key: string, text: string): Promise<void> {
    await navigator.clipboard?.writeText(text);
    this._copied = key;
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => (this._copied = ''), COPIED_FLASH_MS);
  }

  /** Issue-ready text of a note (English on purpose: GitHub issues are written in English). */
  private _noteText(n: FeedbackNote): string {
    const kind = KIND_FALLBACK[n.kind] ?? n.kind;
    const lines = [`[${kind}] ${n.title}`];
    const meta = [`Seen ${n.count}×`];
    if (n.firstSeen) meta.push(`first ${stamp(n.firstSeen)}`);
    if (n.lastSeen) meta.push(`last ${stamp(n.lastSeen)}`);
    if (n.severity === 'hard_error') meta.push('hard error');
    lines.push(meta.join(' · '));
    if (n.detail) lines.push('', n.detail);
    return lines.join('\n');
  }

  private _entryText(e: McpActivityEntry): string {
    const lines = [
      `${e.tool}${e.target ? ` — ${e.target}` : ''} ${e.ok ? 'succeeded' : 'failed'}`,
      `${stamp(e.ts, true)} UTC · ${e.ip} · ${e.durationMs} ms`,
    ];
    if (e.detail) lines.push('', e.detail);
    if (e.error) lines.push('', e.error);
    return lines.join('\n');
  }

  private _iconBtn(key: string, title: string, onClick: () => void, icon: string, extra = '') {
    return html`<button
      class="icon-btn ${extra}"
      title=${title}
      @click=${(ev: Event) => {
        ev.stopPropagation();
        onClick();
      }}
    >
      <i class="mdi ${this._copied === key ? 'mdi-check' : icon}"></i>
    </button>`;
  }

  private _renderNote(n: FeedbackNote) {
    const hard = n.severity === 'hard_error';
    const kind = this._t(`devtools.mcp_feedback_kind_${n.kind}`, KIND_FALLBACK[n.kind] ?? n.kind);
    const key = `fb:${n.id}`;
    const open = this._open.has(key);
    return html`<div class="fb">
      <div class="fb-head ${n.detail ? 'expandable' : ''}" @click=${() => n.detail && this._toggle(key)}>
        ${
          n.detail
            ? html`<button
                class="icon-btn"
                title=${this._t('devtools.mcp_details', 'Show or hide details')}
                aria-expanded=${open ? 'true' : 'false'}
                @click=${(ev: Event) => {
                  ev.stopPropagation();
                  this._toggle(key);
                }}
              >
                <i class="mdi ${open ? 'mdi-chevron-down' : 'mdi-chevron-right'}"></i>
              </button>`
            : html`<span class="chev-space"></span>`
        }
        <span class="fb-badge ${hard ? 'hard' : ''}"
          >${hard ? this._t('devtools.mcp_feedback_hard_error', 'hard error') : kind}</span
        >
        <span class="fb-title">${n.title}</span>
        <span class="fb-count">${n.count}×</span>
        ${this._iconBtn(
          `${key}:copy`,
          this._t('devtools.mcp_copy', 'Copy'),
          () => void this._copy(`${key}:copy`, this._noteText(n)),
          'mdi-content-copy',
          'fb-copy'
        )}
        <button
          class="icon-btn danger fb-del"
          title=${this._t('devtools.mcp_feedback_delete', 'Delete note')}
          @click=${(ev: Event) => {
            ev.stopPropagation();
            void this._deleteNote(n.id);
          }}
        >
          <i class="mdi mdi-close"></i>
        </button>
      </div>
      ${n.detail ? html`<div class="fb-detail ${open ? 'open' : ''}">${n.detail}</div>` : ''}
    </div>`;
  }

  private _renderEntry(e: McpActivityEntry) {
    const time = new Date(e.ts).toLocaleTimeString([], { hour12: false });
    const key = `act:${e.id}`;
    const open = this._open.has(key);
    const body = [e.detail, e.error].filter(Boolean).join('\n\n');
    return html`<div class="row">
      ${
        body
          ? html`<button
              class="state ${e.ok ? 'ok' : 'fail'}"
              title=${this._t('devtools.mcp_details', 'Show or hide details')}
              aria-expanded=${open ? 'true' : 'false'}
              @click=${() => this._toggle(key)}
            >
              <i class="mdi ${open ? 'mdi-chevron-down' : 'mdi-chevron-right'}"></i>${e.ok ? '✓' : '✗'}
            </button>`
          : html`<span class="state ${e.ok ? 'ok' : 'fail'}">${e.ok ? '✓' : '✗'}</span>`
      }
      <span class="time">${time}</span>
      <span class="tool">${e.tool}</span>
      <span class="target">${e.target ?? ''}</span>
      <span class="meta">${e.ip} · ${e.durationMs} ms</span>
      ${body ? this._iconBtn(`${key}:copy`, this._t('devtools.mcp_copy', 'Copy'), () => void this._copy(`${key}:copy`, this._entryText(e)), 'mdi-content-copy') : ''}
      ${body ? html`<span class="error ${e.ok ? 'info' : ''} ${open ? 'open' : ''}">${body}</span>` : ''}
    </div>`;
  }

  render() {
    if (this._enabled === false) {
      return html`<div class="hint">
        ${this._t('devtools.mcp_disabled', 'The MCP server is switched off. Enable it in Settings → MCP Server.')}
      </div>`;
    }
    return html`${mdiStylesheetLink}
      <div class="list">
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
