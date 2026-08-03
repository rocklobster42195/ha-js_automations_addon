import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaScript } from './global';

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
  `;

  @property({ type: Object }) script!: JsaScript;
  @property({ type: Boolean }) isLib = false;
  @property({ type: Boolean }) mqttConnected = true;
  @property({ type: Boolean, reflect: true }) active = false;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

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

  private _tooltip(): string {
    const s = this.script;
    const lang = s.filename.endsWith('.ts') ? 'TypeScript' : 'JavaScript';
    const lines = [`File: ${s.filename} (${lang})`];
    lines.push(`State: ${s.running ? 'Running' : 'Stopped'}`);
    if (s.ram_usage) lines.push(`RAM: ~${s.ram_usage.toFixed(1)} MB`);
    if (s.last_started) lines.push(`Started: ${new Date(s.last_started).toLocaleString()}`);
    if (s.capabilities) {
      const { detected, undeclared } = s.capabilities;
      if (detected && detected.length > 0) {
        lines.push(`\nCapabilities: ${detected.join(', ')}`);
        if (undeclared && undeclared.length > 0) {
          lines.push(`Undeclared: ${undeclared.join(', ')} (add @permission)`);
        }
      }
    }
    if (s.description) lines.push(`\n${s.description}`);
    return lines.join('\n');
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
        class="mdi mdi-view-dashboard-outline card-badge-icon card-badge-icon-dev"
        title="Card: dev mode — preview only, not installed in Lovelace"
      ></i>`;
    }
    if (s.card) {
      return s.cardInstalled
        ? html`<i
            class="mdi mdi-view-dashboard-outline card-badge-icon card-badge-icon-installed"
            title="Card: installed in Lovelace"
          ></i>`
        : html`<i
            class="mdi mdi-view-dashboard-outline card-badge-icon card-badge-icon-pending"
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
        @click=${() => this._open()}
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'script-row': ScriptRow;
  }
}
