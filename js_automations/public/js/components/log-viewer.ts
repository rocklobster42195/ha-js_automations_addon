import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface LogEntry {
  ts?: number;
  level?: string;
  source?: string;
  message: string;
  /** Present only for .blocks scripts — see blockly-compiler.js's scrub_() instrumentation. */
  blockId?: string;
  scriptId?: string;
}

/** Caps in-memory retention for getEntriesForSource() (mobile per-script inline
 * log, RFC §7) — this is a live stream, not meant to grow unbounded. */
const MAX_RETAINED_ENTRIES = 1000;

/**
 * Log console (left pane of the split log/dev-tools panel — index.html still
 * owns the surrounding .log-panes/.log-pane-resizer/.log-pane-right, which
 * belong to not-yet-migrated components).
 *
 * Entries are appended imperatively into the console div rather than driven
 * through a reactive @state array — this is a live, potentially high-volume
 * append-only stream, and re-diffing the whole list on every single line
 * would get expensive fast. Only the chrome (filter dropdown, buttons) is
 * fully reactive.
 *
 * Exposes window.initLogs / window.appendLog as before — socket-client.js,
 * app.js, card-preview.js, and repl.js call these directly and haven't been
 * migrated yet.
 */
@customElement('log-viewer')
export class LogViewer extends LitElement {
  static styles = css`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .log-header {
      padding: 8px 15px;
      background: #0a0a0a;
      border-bottom: 1px solid #111;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      color: #666;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }

    .log-header-left,
    .log-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .log-header-left {
      gap: 20px;
    }

    label {
      font-size: 0.8rem;
      opacity: 0.7;
    }

    select {
      background-color: #333;
      border: 1px solid #555;
      color: #fff;
      border-radius: 3px;
      outline: none;
      padding: 2px 5px;
      font-size: 0.8rem;
    }

    select option {
      background: #222;
      color: #aaa;
    }

    button {
      color: var(--text-muted, #666);
      width: 32px;
      height: 32px;
      border-radius: 4px;
      background: none;
      border: none;
      cursor: pointer;
    }

    button:hover {
      color: var(--text-primary, #fff);
      background: #222;
    }

    button i {
      font-size: 1.4rem;
    }

    .console {
      flex: 1;
      padding: 12px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85rem;
      color: #999;
      line-height: 1.5;
    }
  `;

  @property({ type: Boolean, attribute: 'expert-mode', reflect: true }) expertMode = false;
  @state() private _sources: string[] = ['System'];
  @state() private _filter = 'ALL';
  private _entries: LogEntry[] = [];

  private _todayFmt?: Intl.DateTimeFormat;
  private _weekdayFmt?: Intl.DateTimeFormat;
  private _olderFmt?: Intl.DateTimeFormat;
  private _fullFmt?: Intl.DateTimeFormat;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  private get _consoleEl(): HTMLElement | null {
    return (this.renderRoot as ShadowRoot).querySelector('#console-output');
  }

  connectedCallback() {
    super.connectedCallback();
    window.initLogs = this.initLogs;
    window.appendLog = this.appendLog;
    window.logViewer = this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.initLogs === this.initLogs) delete window.initLogs;
    if (window.appendLog === this.appendLog) delete window.appendLog;
    if (window.logViewer === this) delete window.logViewer;
  }

  /** Mobile per-script inline log (RFC §7) — a read-only snapshot, not a live
   * subscription, so callers re-call this each time they want fresh entries. */
  getEntriesForSource(source: string): LogEntry[] {
    return this._entries.filter((e) => (e.source || 'System') === source);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('_filter')) this._applyFilter();
  }

  initLogs = async (): Promise<void> => {
    try {
      const res = await window.apiFetch!('api/logs');
      if (!res.ok) return;
      const history: LogEntry[] = await res.json();

      const consoleEl = this._consoleEl;
      if (consoleEl) consoleEl.innerHTML = '';
      this._sources = ['System'];
      this._entries = [];

      history.forEach((entry) => this.appendLog(entry, false));
      this._scrollToBottom();
    } catch (e) {
      console.error('Log load failed', e);
    }
  };

  clearLogView = (): void => {
    const consoleEl = this._consoleEl;
    if (consoleEl) consoleEl.innerHTML = '';
    this._entries = [];
  };

  clearServerLogs = async (): Promise<void> => {
    if (
      !(await window.confirmDialog!.confirm(
        this._t('confirm_clear_logs', 'Do you really want to delete the entire server log?')
      ))
    )
      return;
    await window.apiFetch!('api/logs', { method: 'DELETE' });
    this.clearLogView();
    this._sources = ['System'];
  };

  appendLog = (entry: LogEntry | string, autoScroll = true): void => {
    const e: LogEntry =
      typeof entry === 'string' ? { ts: Date.now(), level: 'info', source: 'System', message: entry } : entry;

    const source = e.source || 'System';
    if (!this._sources.includes(source)) {
      this._sources = [...this._sources, source];
    }

    this._entries.push(e);
    if (this._entries.length > MAX_RETAINED_ENTRIES)
      this._entries.splice(0, this._entries.length - MAX_RETAINED_ENTRIES);

    // Block-level error visualization (docs/blockly_concept.md M5, should-have) — only if the
    // .blocks script that threw is the currently active tab; a background script's error
    // wouldn't have anywhere sensible to highlight anyway (its canvas isn't the one on screen).
    if (e.blockId && e.scriptId && typeof window.highlightBlocklyError === 'function') {
      window.highlightBlocklyError(e.scriptId, e.blockId, e.message);
    }

    const consoleEl = this._consoleEl;
    if (!consoleEl) return;

    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.source = source;

    let color = '#ddd';
    if (e.level === 'error' || e.message?.includes('❌')) color = '#ff5555';
    else if (e.level === 'warn') color = '#ffb86c';
    else if (e.level === 'debug') color = '#6272a4';
    else if (source === 'System') color = '#8be9fd';
    else if (source === 'NPM') color = '#ff79c6';

    const ts = e.ts || Date.now();
    const timeStr = this._formatTimestamp(ts);
    const fullTimeStr = this._fullFmt!.format(new Date(ts));

    div.innerHTML =
      `<span class="log-time" title="${fullTimeStr}" style="color:#666; margin-right:8px;">[${timeStr}]</span>` +
      `<span style="color:#bd93f9; font-weight:bold; margin-right:8px;">[${source}]</span>` +
      `<span style="color:${color}">${e.message}</span>`;

    if (this._filter !== 'ALL' && source !== this._filter) {
      div.style.display = 'none';
    }

    consoleEl.appendChild(div);
    if (autoScroll) this._scrollToBottom();
  };

  private _applyFilter(): void {
    const consoleEl = this._consoleEl;
    if (!consoleEl) return;
    Array.from(consoleEl.children).forEach((el) => {
      const line = el as HTMLElement;
      line.style.display = this._filter === 'ALL' || line.dataset.source === this._filter ? 'block' : 'none';
    });
    this._scrollToBottom();
  }

  private _scrollToBottom(): void {
    const consoleEl = this._consoleEl;
    if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  /**
   * Formats a timestamp based on its age: today → HH:mm:ss, within 7 days →
   * "Mon 14:20", older → "Oct 20, 14:20".
   */
  private _formatTimestamp(ts: number): string {
    const locale = window.i18next?.language ?? navigator.language;

    if (!this._fullFmt || this._fullFmt.resolvedOptions().locale !== locale) {
      this._todayFmt = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      this._weekdayFmt = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      this._olderFmt = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      this._fullFmt = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    const date = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

    if (ts >= startOfToday) return this._todayFmt!.format(date);
    if (ts >= sevenDaysAgo) return this._weekdayFmt!.format(date);
    return this._olderFmt!.format(date);
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="log-header">
        <div class="log-header-left">
          <span>${this._t('log_header', 'LOGS')}</span>
          <div class="log-header-right">
            <label for="logFilter">${this._t('log_filter_label', 'Filter:')}</label>
            <select
              id="logFilter"
              .value=${this._filter}
              @change=${(e: Event) => (this._filter = (e.target as HTMLSelectElement).value)}
            >
              <option value="ALL">${this._t('log_filter_all', 'All Sources')}</option>
              ${this._sources.map((s) => html`<option value=${s}>${s}</option>`)}
            </select>
          </div>
        </div>
        <div class="log-header-right">
          <button title=${this._t('log_clear_view_title', 'Clear View')} @click=${this.clearLogView}>
            <i class="mdi mdi-trash-can-outline"></i>
          </button>
          ${
            this.expertMode
              ? html`
                  <button
                    title=${this._t('log_clear_server_title', 'Delete Server Log')}
                    @click=${this.clearServerLogs}
                  >
                    <i class="mdi mdi-delete-forever"></i>
                  </button>
                `
              : ''
          }
        </div>
      </div>
      <div id="console-output" class="console"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-viewer': LogViewer;
  }
}
