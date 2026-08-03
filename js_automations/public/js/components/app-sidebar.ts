import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';
import './script-group';
import type { JsaScript } from './global';

const NO_GROUP = '___none___';
const LIB_GROUP = '___libraries___';
const COLLAPSED_STORAGE_KEY = 'js_collapsed_sections';

interface ScriptGroupData {
  key: string;
  displayName: string;
  isLib: boolean;
  isNone: boolean;
  scripts: JsaScript[];
  collapsed: boolean;
}

/**
 * The entire left sidebar: brand/header, action buttons, search box, and the
 * grouped/collapsible script list. `<status-bar>`/`<status-bar-header-actions>`
 * stay separate, already-migrated components nested inside.
 *
 * `window.allScripts` stays populated exactly as before — tab-manager.js,
 * editor-config.js, creation-wizard.js, and integration-banner.ts all read it
 * directly regardless of this component's internals.
 */
@customElement('app-sidebar')
export class AppSidebar extends LitElement {
  static styles = css`
    :host {
      width: 310px;
      min-width: 310px;
      background: var(--surface-1);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }

    .sidebar-header {
      padding: 10px 15px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1rem;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .nav-logo {
      font-size: 1.5rem;
      color: var(--accent);
      flex-shrink: 0;
    }
    :host([expert-mode]) .nav-logo {
      color: #2e7d32;
    }
    .version-tag {
      font-family: monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
      background: #222;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: none;
      letter-spacing: 0;
    }
    .version-tag:empty {
      display: none;
    }

    .header-actions {
      display: flex;
      gap: 2px;
      width: 100%;
    }
    .header-actions button {
      color: var(--text-secondary);
      font-size: 1.3rem;
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }
    .header-actions button:hover {
      color: #fff;
      background: #252525;
    }
    .header-actions button.hidden {
      display: none;
    }
    .header-actions button.has-notification {
      position: relative;
    }
    .header-actions button.has-notification::after {
      content: '';
      position: absolute;
      top: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      background-color: var(--warn, #f59e0b);
      border-radius: 50%;
      border: 1px solid var(--surface-1);
      pointer-events: none;
    }

    .search-box {
      padding: 10px 15px;
      border-bottom: 1px solid var(--border);
    }
    .search-container {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-input {
      width: 100%;
      background-color: #222;
      color: #fff;
      border: 1px solid #333;
      padding: 10px 30px 10px 10px;
      border-radius: 4px;
      outline: none;
      font-size: 0.9rem;
      box-sizing: border-box;
    }
    .search-input::placeholder {
      color: #aaa;
    }
    .search-input:focus {
      border-color: var(--accent);
    }
    .clear-search-btn {
      position: absolute;
      right: 5px;
      top: 50%;
      transform: translateY(-50%);
      color: #aaa;
      font-size: 1.1rem;
      width: 28px;
      height: 28px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }
    .clear-search-btn:hover {
      color: #fff;
      background: transparent;
    }

    .script-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .script-list-empty {
      text-align: center;
      padding: 20px;
      color: #555;
    }
  `;

  @state() private _scripts: JsaScript[] = [];
  @state() private _search = '';
  @state() private _collapsedKeys: Set<string> = new Set(this._loadCollapsedKeys());
  @state() private _activeFilename: string | null = null;
  @state() private _version = '';
  @state() private _isBeta = false;
  @state() private _updateAvailable = false;
  @state() private _mqttConnected = false;

  @property({ type: Boolean, attribute: 'expert-mode', reflect: true }) expertMode = false;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  private _loadCollapsedKeys(): string[] {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  connectedCallback() {
    super.connectedCallback();
    window.appSidebar = this;
    window.loadScripts = this._load;
    window.renderScripts = (scripts, updateGlobal = true) => this._applyScripts(scripts, updateGlobal);
    window.toggleScript = (f) => this._controlScript(f, 'toggle');
    window.restartScript = (f) => this._controlScript(f, 'restart');
    window.deleteScript = this._deleteScript;
    window.editScript = this._editScript;
    window.duplicateScript = this._duplicateScript;
    window.updateScriptStats = this._updateStats;
    window.loadVersion = this._loadVersion;

    this.addEventListener('jsa-open-script', this._onOpenScript as EventListener);
    this.addEventListener('jsa-toggle-script', this._onToggleScript as EventListener);
    this.addEventListener('jsa-restart-script', this._onRestartScript as EventListener);
    this.addEventListener('jsa-delete-script', this._onDeleteScript as EventListener);
    this.addEventListener('jsa-dismiss-error', this._onDismissError as EventListener);
    this.addEventListener('jsa-toggle-group', this._onToggleGroup as EventListener);

    this._loadVersion();
    this.refreshBadges();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.appSidebar === this) delete window.appSidebar;
    if (window.loadScripts === this._load) delete window.loadScripts;
    if (window.updateScriptStats === this._updateStats) delete window.updateScriptStats;
    if (window.editScript === this._editScript) delete window.editScript;
    if (window.duplicateScript === this._duplicateScript) delete window.duplicateScript;
    if (window.deleteScript === this._deleteScript) delete window.deleteScript;
    if (window.loadVersion === this._loadVersion) delete window.loadVersion;
  }

  /** Bridge for tab-manager.js: highlights the sidebar row of the open tab. */
  setActiveScript(filename: string | null): void {
    this._activeFilename = filename;
  }

  /**
   * Bridge for app.js's updateSystemNotifications(): refreshes the settings gear
   * icon's update-available dot and the per-row needs-mqtt warning dot. Both read
   * from plain globals (window.newVersionInfo / window.currentIntegrationStatus)
   * that don't trigger a re-render on their own, so this must be called explicitly
   * whenever either might have changed — same as the original's renderScripts()
   * only recomputing needsMqtt when it happened to be called for another reason.
   */
  refreshBadges(): void {
    this._updateAvailable = !!window.newVersionInfo?.update_available;
    // Unknown status (mqtt object not present yet) is treated as "not connected",
    // matching the original's conservative default (warn until proven otherwise).
    this._mqttConnected = !!window.currentIntegrationStatus?.mqtt?.connected;
  }

  private _load = async (): Promise<void> => {
    if (window.loadHAMetadata) {
      try {
        await window.loadHAMetadata();
      } catch (e) {
        console.debug('Metadata load error', e);
      }
    }
    const res = await window.apiFetch!('api/scripts');
    if (res.ok) this._applyScripts(await res.json(), true);
  };

  private _applyScripts(scripts: JsaScript[], updateGlobal = true): void {
    this._scripts = [...scripts];
    if (updateGlobal) window.allScripts = this._scripts;

    if (window.activeTabFilename && window.activeTabFilename !== 'System: Store') {
      const tab = window.openTabs?.find((t) => t.filename === window.activeTabFilename);
      if (tab) window.updateToolbarUI?.(window.activeTabFilename, tab.icon, tab.isDirty);
    }
    window.renderTabs?.();
  }

  private _updateStats = (statsMap: Record<string, { ram_usage: number }>): void => {
    // Only bother patching tooltip RAM info while expert mode is on — matches
    // the original's "no full re-render" optimization for this frequent event.
    if (!document.body.classList.contains('expert-mode')) return;
    let changed = false;
    const next = this._scripts.map((s) => {
      const data = statsMap[s.filename];
      if (!data) return s;
      changed = true;
      return { ...s, ram_usage: data.ram_usage };
    });
    if (changed) {
      this._scripts = next;
      window.allScripts = next;
    }
  };

  private async _controlScript(filename: string, action: 'toggle' | 'restart' | 'dismiss'): Promise<void> {
    await window.apiFetch!('api/scripts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, action }),
    });
  }

  private _editScript = async (filename: string): Promise<void> => {
    const script = this._scripts.find((s) => s.filename === filename);
    if (!script) return;
    await window.openCreationWizard?.('edit', script);
  };

  private _duplicateScript = async (filename: string): Promise<void> => {
    const script = this._scripts.find((s) => s.filename === filename);
    if (!script) return;

    let code = '';
    try {
      const res = await window.apiFetch!(`api/scripts/${filename}/content`);
      if (res.ok) {
        const data = await res.json();
        code = data.content.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
      }
    } catch (e) {
      console.error('Failed to fetch script content for duplication', e);
      return;
    }
    await window.openCreationWizard?.('duplicate', { ...script, code });
  };

  private _deleteScript = async (filename: string): Promise<void> => {
    const dependents = this._scripts.filter((s) => {
      if (!s.includes || !Array.isArray(s.includes)) return false;
      return s.includes.some((inc) => inc === filename || inc === filename.replace(/\.(js|ts)$/, ''));
    });

    if (dependents.length > 0) {
      const depNames = dependents.map((s) => s.name).join(', ');
      const msg = this._t('warn_library_in_use', undefined, { filename, count: dependents.length, scripts: depNames });
      if (!confirm(msg)) return;
    } else {
      const shouldConfirm =
        (window.currentSettings?.general as { confirm_delete?: boolean } | undefined)?.confirm_delete ?? true;
      if (shouldConfirm && !confirm(this._t('confirm_delete_script', undefined, { filename }))) return;
    }

    await window.apiFetch!(`api/scripts/${filename}`, { method: 'DELETE' });

    const t = window.openTabs?.find((t) => t.filename === filename);
    if (t) t.isDirty = false;
    window.closeTab?.(filename);

    await this._load();
    await window.loadLibraryDefinitions?.();
  };

  private _loadVersion = async (): Promise<void> => {
    try {
      const res = await window.apiFetch!('api/status');
      if (res.ok) {
        const data = await res.json();
        if (data.version) {
          const beta = data.version.match(/^(.+)-beta\.(\d+)$/);
          if (beta) {
            this._version = `v${beta[1]}-b${beta[2]}`;
            this._isBeta = true;
          } else {
            this._version = `v${data.version}`;
          }
        }
      }
    } catch (e) {
      console.debug('Version check failed', e);
    }
  };

  private _onOpenScript = (e: CustomEvent<{ filename: string; icon?: string }>): void => {
    window.openOrSwitchToTab?.(e.detail.filename, e.detail.icon);
  };
  private _onToggleScript = (e: CustomEvent<{ filename: string }>): void => {
    this._controlScript(e.detail.filename, 'toggle');
  };
  private _onRestartScript = (e: CustomEvent<{ filename: string }>): void => {
    this._controlScript(e.detail.filename, 'restart');
  };
  private _onDeleteScript = (e: CustomEvent<{ filename: string }>): void => {
    this._deleteScript(e.detail.filename);
  };
  private _onDismissError = (e: CustomEvent<{ filename: string }>): void => {
    this._controlScript(e.detail.filename, 'dismiss');
  };
  private _onToggleGroup = (e: CustomEvent<{ key: string }>): void => {
    const key = e.detail.key;
    const next = new Set(this._collapsedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._collapsedKeys = next;
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
  };

  private _onSearchInput(e: Event): void {
    this._search = (e.target as HTMLInputElement).value;
  }
  private _clearSearch(): void {
    this._search = '';
    const input = this.renderRoot.querySelector<HTMLInputElement>('.search-input');
    if (input) input.value = '';
  }

  private _visibleGroups(): { groups: ScriptGroupData[]; isSearchActive: boolean; isEmpty: boolean } {
    const filter = this._search.toLowerCase().trim();
    const isSearchActive = filter.length > 0;

    const filtered = isSearchActive
      ? this._scripts.filter(
          (s) =>
            s.name.toLowerCase().includes(filter) ||
            s.filename.toLowerCase().includes(filter) ||
            (s.description && s.description.toLowerCase().includes(filter)) ||
            (s.area && s.area.toLowerCase().includes(filter)) ||
            (s.label && s.label.toLowerCase().includes(filter))
        )
      : this._scripts;

    const groups = new Map<string, { displayName: string; scripts: JsaScript[]; isLib: boolean; isNone: boolean }>();

    filtered.forEach((script) => {
      const isLib = !!script.path && (script.path.includes('/libraries/') || script.path.includes('\\libraries\\'));
      const rawLabel = script.label && script.label.trim() !== '' ? script.label : NO_GROUP;
      const groupKey = isLib ? LIB_GROUP : rawLabel;
      const normalizedKey = groupKey === NO_GROUP || groupKey === LIB_GROUP ? groupKey : groupKey.toLowerCase();

      let entry = groups.get(normalizedKey);
      if (!entry) {
        entry = { displayName: groupKey, scripts: [], isLib: groupKey === LIB_GROUP, isNone: groupKey === NO_GROUP };
        groups.set(normalizedKey, entry);
      } else if (entry.displayName === normalizedKey && groupKey !== normalizedKey) {
        entry.displayName = groupKey;
      }
      entry.scripts.push(script);
    });

    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === LIB_GROUP) return 1;
      if (b === LIB_GROUP) return -1;
      if (a === NO_GROUP) return 1;
      if (b === NO_GROUP) return -1;
      return a.localeCompare(b);
    });

    const result = sortedKeys.map((key) => {
      const entry = groups.get(key)!;
      const scripts = [...entry.scripts].sort((a, b) => {
        const score = (s: JsaScript) => (s.status === 'error' ? 2 : s.running ? 1 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
      const collapsed = isSearchActive ? false : this._collapsedKeys.has(key);
      return { key, displayName: entry.displayName, isLib: entry.isLib, isNone: entry.isNone, scripts, collapsed };
    });

    return { groups: result, isSearchActive, isEmpty: filtered.length === 0 };
  }

  render() {
    const { groups, isSearchActive, isEmpty } = this._visibleGroups();

    return html`
      ${mdiStylesheetLink}
      <div class="sidebar-header">
        <div class="brand">
          <i class="mdi mdi-robot-happy-outline nav-logo"></i>
          <span>${this._isBeta ? 'JSA BETA' : this._t('header_title', 'JS AUTOMATIONS')}</span>
          <span class="version-tag">${this._version}</span>
        </div>
        <div class="header-actions">
          <button @click=${() => window.openCreationWizard?.()} title=${this._t('new_script_title', 'New Script')}>
            <i class="mdi mdi-plus"></i>
          </button>
          <button
            class=${this.expertMode ? '' : 'hidden'}
            @click=${() => window.openStoreTab?.()}
            title=${this._t('global_store_explorer_title', 'Global Store Explorer')}
          >
            <i class="mdi mdi-database-search"></i>
          </button>
          <button
            class=${this._updateAvailable ? 'has-notification' : ''}
            @click=${() => window.openSettingsTab?.()}
            title=${this._t('settings_button_title', 'Settings')}
          >
            <i class="mdi mdi-cog"></i>
          </button>
          <!-- Kept hidden on purpose: the reference docs UI still needs real work
               before shipping — see [[project_reference_docs_feature]] memory. -->
          <button class="hidden" @click=${() => window.openReferenceTab?.()} title="Command Reference">
            <i class="mdi mdi-help-circle-outline"></i>
          </button>
          <status-bar-header-actions></status-bar-header-actions>
        </div>
      </div>

      <div class="search-box">
        <div class="search-container">
          <input
            type="text"
            class="search-input"
            placeholder=${this._t('search_placeholder', 'Suchen...')}
            @input=${(e: Event) => this._onSearchInput(e)}
          />
          ${
            this._search
              ? html`<button class="clear-search-btn" @click=${() => this._clearSearch()} title="Clear search">
                  <i class="mdi mdi-close"></i>
                </button>`
              : ''
          }
        </div>
      </div>

      <div class="script-list">
        ${
          isEmpty
            ? html`<div class="script-list-empty">
                ${isSearchActive ? this._t('no_scripts_found_search') : this._t('no_scripts_found')}
              </div>`
            : repeat(
                groups,
                (g) => g.key,
                (g) => html`
                  <script-group
                    group-key=${g.key}
                    display-name=${g.displayName}
                    ?is-lib=${g.isLib}
                    ?is-none=${g.isNone}
                    .scripts=${g.scripts}
                    ?collapsed=${g.collapsed}
                    ?mqtt-connected=${this._mqttConnected}
                    ?search-active=${isSearchActive}
                    .activeFilename=${this._activeFilename}
                  ></script-group>
                `
              )
        }
      </div>

      <status-bar></status-bar>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-sidebar': AppSidebar;
  }
}
