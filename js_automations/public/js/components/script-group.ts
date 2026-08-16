import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';
import './script-row';
import type { JsaScript } from './global';

/**
 * HA label colors arrive as theme-color slugs (e.g. "light-green"), not CSS
 * values — HA's own frontend resolves them via a hardcoded palette
 * (home-assistant/frontend src/resources/theme/color/color.globals.ts).
 * Hyphenated slugs aren't valid CSS color literals, so they must be mapped
 * here too; unmapped values (hex codes, plain CSS names) pass through as-is.
 */
const HA_THEME_COLORS: Record<string, string> = {
  primary: '#03a9f4',
  accent: '#ff9800',
  red: '#f44336',
  pink: '#e91e63',
  purple: '#926bc7',
  'deep-purple': '#6e41ab',
  indigo: '#3f51b5',
  blue: '#2196f3',
  'light-blue': '#03a9f4',
  cyan: '#00bcd4',
  teal: '#009688',
  green: '#4caf50',
  'light-green': '#8bc34a',
  lime: '#cddc39',
  yellow: '#ffeb3b',
  amber: '#ffc107',
  orange: '#ff9800',
  'deep-orange': '#ff6f22',
  brown: '#795548',
  'light-grey': '#bdbdbd',
  grey: '#9e9e9e',
  'dark-grey': '#606060',
  'blue-grey': '#607d8b',
  black: '#000000',
  white: '#ffffff',
};

function resolveHaColor(color: string): string {
  return HA_THEME_COLORS[color] ?? color;
}

/**
 * One collapsible section in the sidebar script list (a label, "no group",
 * or the passive Libraries section). Resolves its own header name/icon
 * (including HA label color/icon overrides) — `<app-sidebar>` only does
 * grouping/sorting/filtering, not label presentation.
 */
@customElement('script-group')
export class ScriptGroup extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .section-header {
      padding: 8px 15px;
      background: #1a1a1a;
      color: #ddd;
      font-size: 0.7rem;
      font-weight: bold;
      text-transform: uppercase;
      border-bottom: 1px solid #222;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      transition:
        background 0.2s,
        opacity 0.2s;
    }
    .section-header:hover {
      color: #fff;
      background: #252525;
    }
    .section-header.collapsed {
      opacity: 0.7;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-left i {
      font-size: 1rem;
    }
    .chevron {
      font-size: 0.8rem;
      opacity: 0.5;
    }
    .group-content {
      display: block;
    }
    .group-content.collapsed {
      display: none;
    }
  `;

  @property({ type: String, attribute: 'group-key' }) groupKey = '';
  @property({ type: String, attribute: 'display-name' }) displayName = '';
  @property({ type: Boolean, attribute: 'is-lib' }) isLib = false;
  @property({ type: Boolean, attribute: 'is-none' }) isNone = false;
  @property({ type: Array }) scripts: JsaScript[] = [];
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean, attribute: 'mqtt-connected' }) mqttConnected = true;
  @property({ type: Boolean, attribute: 'search-active' }) searchActive = false;
  @property({ type: String, attribute: 'active-filename' }) activeFilename: string | null = null;
  @property({ type: Boolean, reflect: true }) mobile = false;

  private _t(key: string, fallback?: string): string {
    return window.i18next?.t(key, { defaultValue: fallback }) ?? fallback ?? key;
  }

  private _onHeaderClick(): void {
    if (this.searchActive) return;
    this.dispatchEvent(
      new CustomEvent('jsa-toggle-group', { detail: { key: this.groupKey }, bubbles: true, composed: true })
    );
  }

  private _headerInfo(): { name: string; icon: string; style: string } {
    if (this.isNone) {
      return { name: this._t('group_none'), icon: 'mdi-folder-open-outline', style: '' };
    }
    if (this.isLib) {
      return { name: this._t('group_global_libraries'), icon: 'mdi-bookshelf', style: '' };
    }

    let name = this.displayName || this.groupKey;
    let icon = 'mdi-label-outline';
    let style = '';

    const haLabel = window.haData?.labels?.find((l) => l.name.toLowerCase() === this.groupKey);
    if (haLabel) {
      name = haLabel.name;
      if (haLabel.icon) icon = haLabel.icon.replace(':', '-');
      if (haLabel.color) style = `color: ${resolveHaColor(haLabel.color)};`;
    }
    return { name, icon, style };
  }

  render() {
    const { name, icon, style } = this._headerInfo();

    return html`
      ${mdiStylesheetLink}
      <div class="section-header ${this.collapsed ? 'collapsed' : ''}" @click=${() => this._onHeaderClick()}>
        <div class="header-left">
          <i class="mdi ${icon}" style=${style}></i>
          <span>${name}</span>
        </div>
        <i class="mdi mdi-chevron-${this.collapsed ? 'down' : 'up'} chevron"></i>
      </div>
      <div class="group-content ${this.collapsed ? 'collapsed' : ''}">
        ${repeat(
          this.scripts,
          (s) => s.filename,
          (s) => html`
            <script-row
              .script=${s}
              .isLib=${this.isLib}
              .mqttConnected=${this.mqttConnected}
              .active=${s.filename === this.activeFilename}
              ?mobile=${this.mobile}
            ></script-row>
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'script-group': ScriptGroup;
  }
}
