import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaScript, JsaLogEntry, JsaWatchTile } from './global';

const MAX_INLINE_LOG_LINES = 50;

/**
 * One row in the sidebar script list. Pure presentation + event source —
 * all actual API calls live in `<app-sidebar>`; this element just bubbles
 * `jsa-*` CustomEvents up (composed so they cross out of `<script-group>`'s
 * shadow root too).
 */
@customElement('script-row')
export class ScriptRow extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .script-row {
      padding: 8px 15px;
      border-bottom: 1px solid #1a1a1a;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 15px;
      width: 100%;
      box-sizing: border-box;
    }
    .script-row:hover {
      background: #1c1c1c;
    }
    .script-row.active {
      background: #222;
      border-left: 3px solid var(--accent);
      padding-left: 12px;
    }

    .script-icon {
      font-size: 24px;
      color: #555;
      min-width: 24px;
      text-align: center;
    }
    .status-running {
      color: var(--accent);
    }
    .status-error {
      color: var(--danger);
    }

    .script-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .script-name {
      font-size: 0.95rem;
      font-weight: 500;
      color: #eee;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 2px;
    }

    .lang-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      text-transform: uppercase;
      margin-right: 6px;
      vertical-align: middle;
    }
    .lang-badge-js {
      background-color: #f7df1e;
      color: #000;
    }
    .lang-badge-ts {
      background-color: #3178c6;
      color: #fff;
    }
    .lang-badge-blocks {
      background-color: #4caf50;
      color: #fff;
    }
    .card-badge-icon {
      font-size: 0.9rem;
      vertical-align: middle;
      margin-right: 4px;
      cursor: default;
    }
    .card-badge-icon-dev {
      color: #f0a500;
    }
    .card-badge-icon-pending {
      color: #555;
    }
    .card-badge-icon-installed {
      color: #888;
      opacity: 0.7;
    }

    .conflict-badge {
      color: var(--warning, #f0a500);
      font-size: 0.9rem;
      margin-right: 4px;
    }

    .script-lower-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .script-badges {
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      flex-shrink: 1;
    }

    .cap-badge {
      font-size: 0.85rem;
      vertical-align: middle;
      cursor: default;
      color: var(--text-secondary, #777);
    }
    .cap-badge-warn {
      color: #f0a500;
    }
    .cap-badge-warn-exec {
      color: #e53935;
    }
    .cap-badge-unused {
      color: var(--text-secondary, #777);
      opacity: 0.35;
    }

    .needs-mqtt .script-icon {
      position: relative;
    }
    .needs-mqtt .script-icon::after {
      content: '';
      position: absolute;
      top: -2px;
      right: -2px;
      width: 8px;
      height: 8px;
      background-color: #ffb86c;
      border-radius: 50%;
      border: 1px solid var(--surface-1);
    }

    .row-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
      align-items: center;
    }
    .btn-row {
      width: 28px;
      height: 28px;
      color: var(--text-secondary);
      border-radius: 4px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .btn-row:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .btn-row i {
      font-size: 1.2rem;
    }
    .btn-row:hover:not(:disabled) {
      color: #fff;
      background: #333;
    }
    .lib-note {
      font-size: 0.75rem;
      color: #666;
      font-style: italic;
      margin-right: 10px;
    }

    .script-details {
      padding: 4px 15px 12px 15px;
      background: #161616;
      border-bottom: 1px solid #1a1a1a;
      font-size: 0.82rem;
      color: var(--text-secondary);
    }
    .script-details-line {
      padding: 2px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .script-details-line.section-break {
      margin-top: 8px;
    }

    .script-details-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #262626;
      font-size: 0.7rem;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted, #666);
    }
    .script-details-section-clear {
      cursor: pointer;
      color: var(--text-muted, #666);
    }
    .script-details-section-clear:hover {
      color: var(--text-primary);
    }
    .script-details-watch {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .script-details-watch-tile {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 0.8rem;
    }
    .script-details-watch-label {
      color: var(--text-secondary, #999);
    }
    .script-details-watch-value {
      font-family: monospace;
      font-weight: 600;
      color: var(--text-primary);
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .script-details-watch-value.bool-true {
      color: #4caf50;
    }
    .script-details-watch-value.bool-false {
      color: #ef5350;
    }
    .script-details-log {
      max-height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.78rem;
      line-height: 1.4;
      margin-top: 4px;
    }
    .script-details-log-line {
      display: flex;
      gap: 6px;
      padding: 2px 0;
      /* Normal (not pre-wrap) on purpose — matches <log-viewer>'s own console:
         some scripts log multi-line messages, and pre-wrap would render their
         embedded newlines as literal line breaks, blowing up each entry into
         several gappy lines. Collapsing them to spaces keeps one line per entry. */
    }
    .script-details-log-time {
      color: #666;
      flex-shrink: 0;
    }
    .script-details-log-message {
      word-break: break-word;
    }
    .script-details-log-empty {
      color: var(--text-muted, #666);
      font-style: italic;
    }
  `;

  @property({ type: Object }) script!: JsaScript;
  @property({ type: Boolean }) isLib = false;
  @property({ type: Boolean }) mqttConnected = true;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: Boolean, reflect: true }) mobile = false;
  @state() private _detailsOpen = false;
  @state() private _logSnapshot: JsaLogEntry[] | null = null;
  @state() private _logClearedAt = 0;
  @state() private _watchSnapshot: JsaWatchTile[] = [];

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('jsa-log-appended', this._onLogAppended);
    window.addEventListener('jsa-watch-updated', this._onWatchChanged);
    window.addEventListener('jsa-watch-cleared', this._onWatchChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('jsa-log-appended', this._onLogAppended);
    window.removeEventListener('jsa-watch-updated', this._onWatchChanged);
    window.removeEventListener('jsa-watch-cleared', this._onWatchChanged);
  }

  /** Keeps the open inline log panel (mobile RFC §7) live instead of the point-in-time
   * snapshot _onRowClick() takes — only reacts while this row's own panel is expanded. */
  private _onLogAppended = (e: Event): void => {
    if (!this._detailsOpen) return;
    const entry = (e as CustomEvent<JsaLogEntry>).detail;
    if ((entry.source || 'System') !== this.script.name) return;
    this._logSnapshot = [...(this._logSnapshot ?? []), entry].slice(-MAX_INLINE_LOG_LINES);
  };

  /** Same live-refresh as the log, for the Watch section — a script with no ha.watch() tiles
   * yet (e.g. still stopped) when the row was opened otherwise stays empty until reopened. */
  private _onWatchChanged = (e: Event): void => {
    if (!this._detailsOpen) return;
    const { filename } = (e as CustomEvent<{ filename: string }>).detail;
    if (filename !== this.script.filename) return;
    this._watchSnapshot = window.watchPanel?.getTilesForFilename(this.script.filename) ?? [];
  };

  private _dispatch(name: string): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { filename: this.script.filename }, bubbles: true, composed: true })
    );
  }

  private _open(): void {
    this.dispatchEvent(
      new CustomEvent('jsa-open-script', {
        detail: { filename: this.script.filename, icon: this.script.icon },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** On mobile the editor is out of scope (RFC §7) — tapping a row expands the
   * same info the desktop hover tooltip shows (plus a filtered log snapshot)
   * instead of opening the editor. */
  private _onRowClick(): void {
    if (this.mobile) {
      this._detailsOpen = !this._detailsOpen;
      if (this._detailsOpen) {
        // Log entries are keyed by the script's display name (worker-manager.js's
        // 'log' emit uses scriptMeta.name), not its filename.
        this._logSnapshot = window.logViewer?.getEntriesForSource(this.script.name) ?? [];
        this._logClearedAt = 0;
        // Watch tiles, unlike log entries, ARE keyed by filename.
        this._watchSnapshot = window.watchPanel?.getTilesForFilename(this.script.filename) ?? [];
      }
    } else {
      this._open();
    }
  }

  /** View-only clear, scoped to this row's own snapshot — does not touch
   * <log-viewer>'s shared history or the server log. */
  private _clearInlineLog(e: Event): void {
    e.stopPropagation();
    this._logClearedAt = Date.now();
  }

  private _icon(): string {
    const s = this.script;
    let icon = s.icon ? s.icon.split(':').pop()! : 'script-text';
    if (window.mdiIcons && window.mdiIcons.length > 0 && !window.mdiIcons.includes(icon)) {
      icon = 'script-text';
    }
    return icon;
  }

  private _statusClass(): string {
    const s = this.script;
    return s.running ? 'status-running' : s.status === 'error' ? 'status-error' : 'status-stopped';
  }

  /** Shared field list behind both the desktop hover tooltip (_tooltip(), joined
   * with literal newlines) and the mobile tap-to-expand inline block (_renderDetails()) —
   * kept as one source so the two never drift apart. */
  private _detailFields(): { text: string; sectionBreak?: boolean }[] {
    const s = this.script;
    const lang = s.filename.endsWith('.ts') ? 'TypeScript' : s.filename.endsWith('.blocks') ? 'Blockly' : 'JavaScript';
    const fields: { text: string; sectionBreak?: boolean }[] = [
      { text: `File: ${s.filename} (${lang})` },
      { text: `State: ${s.running ? 'Running' : 'Stopped'}` },
    ];
    if (s.ram_usage) fields.push({ text: `RAM: ~${s.ram_usage.toFixed(1)} MB` });
    if (s.last_started) fields.push({ text: `Started: ${new Date(s.last_started).toLocaleString()}` });
    if (s.capabilities) {
      const { detected, undeclared } = s.capabilities;
      if (detected && detected.length > 0) {
        fields.push({ text: `Capabilities: ${detected.join(', ')}`, sectionBreak: true });
        if (undeclared && undeclared.length > 0) {
          fields.push({ text: `Undeclared: ${undeclared.join(', ')} (add @permission)` });
        }
      }
    }
    if (s.description) fields.push({ text: s.description, sectionBreak: true });
    return fields;
  }

  private _tooltip(): string {
    return this._detailFields()
      .map((f) => (f.sectionBreak ? `\n${f.text}` : f.text))
      .join('\n');
  }

  private _logLineColor(entry: JsaLogEntry): string {
    if (entry.level === 'error' || entry.message?.includes('❌')) return '#ff5555';
    if (entry.level === 'warn') return '#ffb86c';
    if (entry.level === 'debug') return '#6272a4';
    return '#ccc';
  }

  private _renderInlineLog() {
    const entries = (this._logSnapshot ?? []).filter((e) => (e.ts ?? 0) >= this._logClearedAt);
    const visible = entries.slice(-MAX_INLINE_LOG_LINES);

    return html`
      <div class="script-details-section-header">
        <span>${this._t('script_details_log_label', 'Log')}</span>
        <i
          class="mdi mdi-close script-details-section-clear"
          title=${this._t('log_clear_view_title', 'Clear View')}
          @click=${(e: Event) => this._clearInlineLog(e)}
        ></i>
      </div>
      <div class="script-details-log">
        ${
          visible.length === 0
            ? html`<div class="script-details-log-empty">
                ${this._t('script_details_log_empty', 'No log entries yet.')}
              </div>`
            : visible.map(
                (entry) => html`
                  <div class="script-details-log-line">
                    <span class="script-details-log-time"
                      >[${new Date(entry.ts ?? Date.now()).toLocaleTimeString()}]</span
                    >
                    <span class="script-details-log-message" style="color:${this._logLineColor(entry)}"
                      >${entry.message}</span
                    >
                  </div>
                `
              )
        }
      </div>
    `;
  }

  private _isHaStateValue(v: unknown): v is { entity_id: string; state: string } {
    const o = v as Record<string, unknown> | null;
    return !!o && typeof o === 'object' && typeof o.entity_id === 'string' && 'state' in o;
  }

  private _formatWatchValue(v: unknown): string {
    if (v === undefined || v === null) return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (this._isHaStateValue(v)) return v.state;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  private _watchValueClass(v: unknown): string {
    if (typeof v === 'boolean') return v ? 'bool-true' : 'bool-false';
    if (this._isHaStateValue(v)) {
      if (v.state === 'on' || v.state === 'above_horizon' || v.state === 'home' || v.state === 'locked')
        return 'bool-true';
      if (v.state === 'off' || v.state === 'below_horizon' || v.state === 'not_home' || v.state === 'unlocked')
        return 'bool-false';
    }
    return '';
  }

  private _renderInlineWatch() {
    if (this._watchSnapshot.length === 0) return nothing;
    return html`
      <div class="script-details-section-header">
        <span>${this._t('script_details_watch_label', 'Watch')}</span>
      </div>
      <div class="script-details-watch">
        ${this._watchSnapshot.map(
          (tile) => html`
            <div class="script-details-watch-tile">
              <span class="script-details-watch-label">${tile.label}</span>
              <span class="script-details-watch-value ${this._watchValueClass(tile.value)}"
                >${this._formatWatchValue(tile.value)}</span
              >
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderDetails() {
    return html`
      <div class="script-details">
        ${this._detailFields().map(
          (f) => html`<div class="script-details-line ${f.sectionBreak ? 'section-break' : ''}">${f.text}</div>`
        )}
        ${this._renderInlineWatch()} ${this._renderInlineLog()}
      </div>
    `;
  }

  private _renderCapBadges() {
    const caps = this.script.capabilities;
    if (!caps) return nothing;
    const { detected, declared, undeclared } = caps;
    const all = new Set([...detected, ...declared]);
    if (all.size === 0) return nothing;
    const hasFsWrite = all.has('fs:write');

    const BADGES = [
      { token: 'network', icon: 'mdi-web', tipKey: 'cap_tip_network', warnKey: 'cap_tip_network_warn' },
      {
        token: 'fs:write',
        icon: 'mdi-file-edit-outline',
        tipKey: 'cap_tip_fs_write',
        warnKey: 'cap_tip_fs_write_warn',
      },
      { token: 'fs:read', icon: 'mdi-file-eye-outline', tipKey: 'cap_tip_fs_read', warnKey: 'cap_tip_fs_read_warn' },
      { token: 'exec', icon: 'mdi-console', tipKey: 'cap_tip_exec', warnKey: 'cap_tip_exec_warn' },
      { token: 'webhook', icon: 'mdi-webhook', tipKey: 'cap_tip_webhook', warnKey: 'cap_tip_webhook_warn' },
    ];

    return BADGES.map(({ token, icon, tipKey, warnKey }) => {
      if (!all.has(token)) return nothing;
      if (token === 'fs:read' && hasFsWrite) return nothing;

      const isDetected = detected.includes(token);
      const isUndeclared = undeclared.includes(token);
      const isUnused = declared.includes(token) && !isDetected;

      let cls = 'cap-badge';
      let tip: string;
      if (isUndeclared) {
        cls += token === 'exec' ? ' cap-badge-warn-exec' : ' cap-badge-warn';
        tip = this._t(warnKey);
      } else if (isUnused) {
        cls += ' cap-badge-unused';
        tip = this._t('cap_tip_unused');
      } else {
        tip = this._t(tipKey);
      }
      return html`<i class="mdi ${icon} ${cls}" title=${tip}></i>`;
    });
  }

  private _renderCardBadge() {
    const s = this.script;
    if (s.card === 'dev') {
      return html`<i
        class="mdi mdi-card-text-outline card-badge-icon card-badge-icon-dev"
        title="Card: dev mode — preview only, not installed in Lovelace"
      ></i>`;
    }
    if (s.card) {
      return s.cardInstalled
        ? html`<i
            class="mdi mdi-card-text-outline card-badge-icon card-badge-icon-installed"
            title="Card: installed in Lovelace"
          ></i>`
        : html`<i
            class="mdi mdi-card-text-outline card-badge-icon card-badge-icon-pending"
            title="Card: embedded block present, not yet installed"
          ></i>`;
    }
    return nothing;
  }

  private _renderConflictBadge() {
    const conflicts = this.script.entity_conflicts;
    if (!conflicts || conflicts.length === 0) return nothing;
    const tip = conflicts.map((c) => `${c.expected} → ${c.actual}`).join('\n');
    return html`<i class="mdi mdi-alert-outline conflict-badge" title=${tip}></i>`;
  }

  render() {
    const s = this.script;
    const usesMqtt = !!s.expose || !!s.capabilities?.detected?.includes('mqtt');
    const needsMqtt = usesMqtt && !this.mqttConnected;
    const toggleIcon = s.running ? 'mdi-stop' : 'mdi-play';
    const langBadge = window.getLanguageBadge ? window.getLanguageBadge(s.filename) : '';

    return html`
      ${mdiStylesheetLink}
      <div
        class="script-row ${needsMqtt ? 'needs-mqtt' : ''} ${this.active ? 'active' : ''}"
        title=${this._tooltip()}
        @click=${() => this._onRowClick()}
      >
        <div class="script-icon"><i class="mdi mdi-${this._icon()} ${this._statusClass()}"></i></div>
        <div class="script-info">
          <div class="script-name">${this._renderConflictBadge()}${s.name}</div>
          <div class="script-lower-row">
            <span class="script-badges">
              ${unsafeHTML(langBadge)}${this._renderCardBadge()}${this._renderCapBadges()}
            </span>
            <div class="row-actions">
              ${
                this.isLib
                  ? html`
                      <span class="lib-note">${this._t('status_passive_library')}</span>
                      <button
                        class="btn-row"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._dispatch('jsa-delete-script');
                        }}
                        title=${this._t('script_action_delete_title')}
                      >
                        <i class="mdi mdi-delete-outline"></i>
                      </button>
                    `
                  : html`
                      ${
                        s.status === 'error'
                          ? html`<button
                              class="btn-row"
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                this._dispatch('jsa-dismiss-error');
                              }}
                              title=${this._t('script_action_dismiss_title')}
                            >
                              <i class="mdi mdi-check"></i>
                            </button>`
                          : html`<button
                              class="btn-row"
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                this._dispatch('jsa-toggle-script');
                              }}
                              title=${this._t('script_action_toggle_title')}
                            >
                              <i class="mdi ${toggleIcon}"></i>
                            </button>`
                      }
                      <button
                        class="btn-row"
                        ?disabled=${!s.running}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._dispatch('jsa-restart-script');
                        }}
                        title=${this._t('script_action_restart_title')}
                      >
                        <i class="mdi mdi-restart"></i>
                      </button>
                      <button
                        class="btn-row"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._dispatch('jsa-delete-script');
                        }}
                        title=${this._t('script_action_delete_title')}
                      >
                        <i class="mdi mdi-delete-outline"></i>
                      </button>
                    `
              }
            </div>
          </div>
        </div>
      </div>
      ${this.mobile && this._detailsOpen ? this._renderDetails() : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'script-row': ScriptRow;
  }
}
