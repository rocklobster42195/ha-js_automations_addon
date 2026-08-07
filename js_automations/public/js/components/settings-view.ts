import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaSettings, JsaHaState } from './global';

const SETTINGS_TAB_ID = 'System: Settings';

type SettingsItemType =
  | 'toggle'
  | 'boolean'
  | 'select'
  | 'number'
  | 'entity-picker'
  | 'button'
  | 'mqtt-test'
  | 'mqtt-autodetect'
  | 'info'
  | 'text'
  | 'password';

interface SettingsItem {
  key: string;
  type?: SettingsItemType;
  label: string | null;
  description?: string;
  default?: unknown;
  hidden?: boolean;
  condition?: { key: string; value: unknown };
  options?: (string | { value: string; label: string })[];
  min?: number;
  max?: number;
  mode?: 'password';
  indent?: boolean;
  active?: boolean;
  buttonLabel?: string;
  actionUrl?: string;
  text?: string;
}

interface SettingsCategory {
  id: string;
  icon: string;
  label: string;
  items: SettingsItem[];
}

/**
 * "System: Settings" tab — schema-driven settings UI (category sidebar +
 * scroll-spy'd content). Mounted permanently at `#settings-wrapper`;
 * tab-manager.js toggles the `.hidden` class on tab switches, same as
 * `<store-explorer>`.
 *
 * `window.currentSettings` and the `'settings-changed'` window event stay —
 * status-bar.ts/status-bar-header-actions.ts read/listen to both regardless
 * of whether this tab is ever opened.
 */
@customElement('settings-view')
export class SettingsView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: var(--surface-0, #1e1e1e);
    }
    :host(.hidden) {
      display: none;
    }

    .settings-header {
      padding: 10px 20px;
      border-bottom: 1px solid #333;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .settings-header h2 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 400;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .settings-header-spacer {
      flex: 1;
    }
    .settings-close-btn {
      background: none;
      border: none;
      color: #aaa;
      cursor: pointer;
      font-size: 1.2rem;
    }
    .settings-close-btn:hover {
      color: #fff;
    }

    .settings-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    .settings-categories {
      width: 200px;
      flex-shrink: 0;
      border-right: 1px solid #333;
      padding: 10px 0;
      overflow-y: auto;
    }
    .settings-category-item {
      position: relative;
      padding: 12px 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #aaa;
      background-color: transparent;
      font-size: 0.9rem;
      transition: all 0.2s ease;
    }
    .settings-category-item:hover {
      background-color: #252525;
      color: #fff;
    }
    .settings-category-item.active {
      background-color: #333;
      color: #fff;
      border-right: 3px solid var(--accent);
    }
    .settings-category-item.has-update-dot::after {
      content: '';
      position: absolute;
      top: 50%;
      right: 15px;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      background-color: var(--warn, #f59e0b);
      border-radius: 50%;
      pointer-events: none;
    }

    /* Mobile View (RFC §7): the 200px vertical sidebar eats too much width on
       a narrow screen, and icon-only would make categories like "Danger Zone"
       or "MQTT Broker" ambiguous with no hover/tooltip on touch — so instead
       it becomes a horizontal, scrollable chip row across the top. */
    :host([mobile]) .settings-body {
      flex-direction: column;
    }
    :host([mobile]) .settings-categories {
      width: auto;
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      border-right: none;
      border-bottom: 1px solid #333;
      padding: 8px 10px;
      gap: 8px;
    }
    :host([mobile]) .settings-category-item {
      flex-shrink: 0;
      padding: 8px 14px;
      border-radius: 20px;
      background: #1a1a1a;
    }
    :host([mobile]) .settings-category-item.active {
      background: var(--accent);
      color: #000;
      border-right: none;
    }
    :host([mobile]) .settings-category-item.has-update-dot::after {
      right: 6px;
    }

    .settings-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 40px 100px 40px;
      scroll-behavior: smooth;
    }
    .settings-section {
      scroll-margin-top: 20px;
      margin-bottom: 50px;
    }
    .settings-section h3 {
      margin-top: 0;
      margin-bottom: 25px;
      font-size: 1.2rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .settings-category-danger {
      background-color: rgba(244, 67, 54, 0.1);
      border: 1px solid rgba(244, 67, 54, 0.3);
      border-radius: 8px;
      padding: 15px;
    }

    .settings-item-wrapper {
      margin-bottom: 20px;
    }
    .settings-item-wrapper:last-child {
      margin-bottom: 0;
    }
    .settings-item-wrapper.indent {
      margin-left: 20px;
      padding-left: 10px;
      border-left: 1px solid #555;
    }
    .settings-item-wrapper.disabled {
      opacity: 0.6;
      pointer-events: none;
    }
    .settings-item-label {
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      font-size: 0.9rem;
    }
    .settings-item-desc {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 8px;
    }
    .settings-info-box {
      background: #0d2a35;
      border-left: 3px solid #4fc3f7;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.82rem;
      color: #b0c4d8;
      line-height: 1.5;
    }

    .settings-input {
      padding: 5px;
      background-color: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .settings-input-text {
      width: 100%;
      max-width: 400px;
    }
    .settings-input-number {
      width: 100px;
    }
    .settings-input-entity {
      width: 200px;
    }

    /* Toggle switch */
    .setting-toggle {
      position: relative;
      display: inline-flex;
      align-items: center;
      width: 42px;
      height: 24px;
      cursor: pointer;
    }
    .setting-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .toggle-slider {
      position: absolute;
      inset: 0;
      background: #444;
      border-radius: 24px;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .setting-toggle input:checked + .toggle-slider {
      background: var(--accent, #03a9f4);
    }
    .setting-toggle input:checked + .toggle-slider::before {
      transform: translateX(18px);
    }

    .settings-btn {
      width: fit-content;
      margin-top: 5px;
      font-size: 0.9rem;
      cursor: pointer;
      border-radius: 6px;
      padding: 10px 30px;
      font-weight: bold;
      border: none;
    }
    .settings-btn-primary {
      background: var(--accent);
      color: #000;
    }
    .settings-btn-outline {
      background: transparent;
      color: var(--accent);
      border: 2px solid var(--accent);
    }
    .settings-btn-outline:hover {
      background: var(--accent);
      color: #000;
    }
    .settings-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }
  `;

  /** Set externally by app-sidebar.ts's updated() (mirrors expert-mode) — this
   * component isn't a child of <app-sidebar>, so it can't receive it as a
   * property the normal way. */
  @property({ type: Boolean, reflect: true }) mobile = false;

  @state() private _schema: SettingsCategory[] | null = null;
  @state() private _settings: JsaSettings = {};
  @state() private _activeCategory: string | null = null;
  @state() private _updateAvailable = false;
  @state() private _entityOptions: JsaHaState[] = [];
  @state() private _mqttTesting = false;
  @state() private _mqttDiscovering = false;

  private _entitiesLoaded = false;
  private _pendingScrollTarget: string | null = null;
  private _isProgrammaticScroll = false;
  private _scrollSpyObserver?: IntersectionObserver;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.openSettingsTab = this._openTab;
    window.loadSettingsData = this._load;
    window.renderSettingsCategories = this._refreshBadges;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.openSettingsTab === this._openTab) delete window.openSettingsTab;
    if (window.loadSettingsData === this._load) delete window.loadSettingsData;
    if (window.renderSettingsCategories === this._refreshBadges) delete window.renderSettingsCategories;
    this._scrollSpyObserver?.disconnect();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('_schema') && this._schema) {
      this._initScrollSpy();
    }
    if (changed.has('_activeCategory') && this.mobile) {
      // Keeps the horizontal chip row (mobile only) following along as the
      // active category changes — whether from tapping a chip or scroll-spy.
      this.renderRoot
        .querySelector(`.settings-category-item[data-cat-id="${this._activeCategory}"]`)
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  private _openTab = (targetId?: string | null): void => {
    this._pendingScrollTarget = targetId ?? null;

    const section = document.getElementById('editor-section');
    if (section) section.classList.remove('hidden');

    const existing = window.openTabs?.find((t) => t.filename === SETTINGS_TAB_ID);
    if (!existing) {
      window.openTabs?.push({
        filename: SETTINGS_TAB_ID,
        icon: 'mdi:cog',
        isDirty: false,
        type: 'settings',
        model: null,
      });
    }

    window.renderTabs?.();
    window.switchToTab?.(SETTINGS_TAB_ID);

    if (this._schema && targetId) {
      setTimeout(() => this._scrollToSection(targetId), 100);
    }
  };

  private _close(): void {
    window.appSidebar?.returnToDashboard();
    window.closeTab?.(SETTINGS_TAB_ID);
  }

  private _load = async (isBackgroundRefresh = false): Promise<void> => {
    try {
      const [schemaRes, settingsRes] = await Promise.all([
        window.apiFetch!('api/settings/schema'),
        window.apiFetch!('api/settings'),
      ]);

      if (!schemaRes.ok || !settingsRes.ok) {
        console.error('Settings API Error:', schemaRes.status, settingsRes.status);
        throw new Error(`Failed to load settings (API ${settingsRes.status})`);
      }

      this._schema = await schemaRes.json();
      const settings: JsaSettings = await settingsRes.json();
      this._settings = settings;
      window.currentSettings = settings;
      this._applyExpertMode(!!settings.general && (settings.general as { expert_mode?: boolean }).expert_mode);
      window.dispatchEvent(new CustomEvent('settings-changed', { detail: settings }));

      if (isBackgroundRefresh && window.activeTabFilename === SETTINGS_TAB_ID) {
        return;
      }

      this._refreshBadges();

      if (this._pendingScrollTarget) {
        const target = this._pendingScrollTarget;
        this._pendingScrollTarget = null;
        setTimeout(() => this._scrollToSection(target), 200);
      } else if (this._schema && this._schema.length > 0) {
        this._activeCategory = this._schema[0].id;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  private _refreshBadges = (): void => {
    this._updateAvailable = !!window.newVersionInfo?.update_available;
  };

  private _applyExpertMode(enabled: boolean | undefined): void {
    document.body.classList.toggle('expert-mode', !!enabled);
  }

  private _selectCategory(catId: string): void {
    this._isProgrammaticScroll = true;
    this._scrollToSection(catId);
    this._activeCategory = catId;

    if (catId === 'system') {
      window.hideIntegrationBanner?.();
      this._updateAvailable = false;
    }

    setTimeout(() => {
      this._isProgrammaticScroll = false;
    }, 800);
  }

  private _scrollToSection(id: string): void {
    const root = this.renderRoot;
    let element = root.querySelector(`#settings-section-${id}`);
    if (id === 'integration' || id === 'installer') {
      element = root.querySelector('#settings-installer-anchor') || root.querySelector('#settings-section-system');
    }
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private _initScrollSpy(): void {
    this._scrollSpyObserver?.disconnect();

    const content = this.renderRoot.querySelector('.settings-content');
    const sections = this.renderRoot.querySelectorAll('.settings-section');
    if (!content || sections.length === 0) return;

    this._scrollSpyObserver = new IntersectionObserver(
      (entries) => {
        if (this._isProgrammaticScroll) return;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const catId = entry.target.id.replace('settings-section-', '');
            this._activeCategory = catId;
            if (catId === 'system') window.hideIntegrationBanner?.();
          }
        });
      },
      { root: content, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    sections.forEach((section) => this._scrollSpyObserver!.observe(section));
  }

  private async _saveSetting(catId: string, key: string, value: unknown): Promise<void> {
    const next: JsaSettings = { ...this._settings, [catId]: { ...(this._settings[catId] as object), [key]: value } };
    this._settings = next;
    window.currentSettings = next;
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: next }));

    try {
      await window.apiFetch!('api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [catId]: { [key]: value } }),
      });

      if (catId === 'general' && key === 'expert_mode') {
        this._applyExpertMode(value as boolean);
      }

      if (catId === 'general' && key === 'ui_language') {
        const url = new URL(window.location.href);
        url.searchParams.set('open', 'settings');
        window.location.href = url.toString();
      }
    } catch (e) {
      console.error('Save failed', e);
      alert('Fehler beim Speichern der Einstellung.');
    }
  }

  private async _loadEntitiesForAutocomplete(): Promise<void> {
    if (this._entitiesLoaded) return;
    this._entitiesLoaded = true;

    if (window.allEntities && window.allEntities.length > 0) {
      this._entityOptions = window.allEntities.map((id) => ({ entity_id: id, state: '', attributes: {} }));
      return;
    }

    if (!window.cachedEntities || window.cachedEntities.length === 0) {
      try {
        if (window.getHAStates) window.cachedEntities = await window.getHAStates();
      } catch (e) {
        console.warn('Failed to load entities via Socket', e);
      }
    }
    this._entityOptions = window.cachedEntities ?? [];
  }

  private async _testMqttConnection(): Promise<void> {
    this._mqttTesting = true;
    try {
      const res = await window.apiFetch!('api/mqtt/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._settings.mqtt ?? {}),
      });
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const result = await res.json();
      if (result.success) {
        alert(this._t('settings.system.mqtt_test_success'));
      } else {
        alert(this._t('settings.system.mqtt_test_error', undefined, { error: result.error }));
      }
    } catch (e) {
      console.error('MQTT Test failed:', e);
      alert(
        this._t('settings.system.mqtt_test_error', undefined, { error: e instanceof Error ? e.message : String(e) })
      );
    } finally {
      this._mqttTesting = false;
    }
  }

  private async _discoverMqttSettings(): Promise<void> {
    this._mqttDiscovering = true;
    try {
      const res = await window.apiFetch!('api/mqtt/discover');
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const result = await res.json();

      if (result && result.host) {
        const mqtt: Record<string, unknown> = { ...(this._settings.mqtt ?? {}), host: result.host, port: result.port };
        if (result.username) mqtt.username = result.username;
        this._settings = { ...this._settings, mqtt };
        window.currentSettings = this._settings;

        if (result._isFallback) {
          alert(this._t('settings.mqtt.mqtt_autodetect_fallback'));
        } else {
          alert(
            this._t('settings.system.mqtt_autodetect_success') +
              '\n\n' +
              this._t('settings.mqtt.mqtt_autodetect_password_hint')
          );
        }
      } else {
        alert(this._t('settings.system.mqtt_autodetect_not_found'));
      }
    } catch (e) {
      console.error('MQTT Discovery failed:', e);
      alert('Discovery failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      this._mqttDiscovering = false;
    }
  }

  private _renderCategorySidebar() {
    if (!this._schema) return nothing;
    return this._schema.map((cat) => {
      const showDot = cat.id === 'system' && this._updateAvailable;
      return html`
        <div
          class="settings-category-item ${this._activeCategory === cat.id ? 'active' : ''} ${
            showDot ? 'has-update-dot' : ''
          }"
          data-cat-id=${cat.id}
          @click=${() => this._selectCategory(cat.id)}
        >
          <i class="mdi ${cat.icon.replace('mdi:', 'mdi-')}"></i>
          <span>${this._t(cat.label, cat.label)}</span>
        </div>
      `;
    });
  }

  private _itemValue(catId: string, item: SettingsItem): unknown {
    const catSettings = (this._settings[catId] as Record<string, unknown>) || {};
    return catSettings[item.key] !== undefined ? catSettings[item.key] : item.default;
  }

  private _renderItemInput(catId: string, item: SettingsItem) {
    const value = this._itemValue(catId, item);

    switch (item.type) {
      case 'toggle':
        return html`
          <label class="setting-toggle">
            <input
              type="checkbox"
              .checked=${!!value}
              @change=${(e: Event) => this._saveSetting(catId, item.key, (e.target as HTMLInputElement).checked)}
            />
            <span class="toggle-slider"></span>
          </label>
        `;
      case 'boolean':
        return html`
          <input
            type="checkbox"
            .checked=${!!value}
            @change=${(e: Event) => this._saveSetting(catId, item.key, (e.target as HTMLInputElement).checked)}
          />
        `;
      case 'select':
        return html`
          <select
            class="settings-input"
            @change=${(e: Event) => this._saveSetting(catId, item.key, (e.target as HTMLSelectElement).value)}
          >
            ${(item.options ?? []).map((opt) => {
              const optVal = typeof opt === 'object' ? opt.value : opt;
              const optLabel = typeof opt === 'object' ? opt.label : opt;
              return html`<option value=${optVal} ?selected=${optVal === value}>
                ${this._t(optLabel, optLabel)}
              </option>`;
            })}
          </select>
        `;
      case 'number':
        return html`
          <input
            type="number"
            class="settings-input settings-input-number"
            .value=${value as number}
            min=${item.min ?? nothing}
            max=${item.max ?? nothing}
            @change=${(e: Event) =>
              this._saveSetting(catId, item.key, parseFloat((e.target as HTMLInputElement).value))}
          />
        `;
      case 'entity-picker':
        return html`
          <input
            type="text"
            class="settings-input settings-input-entity"
            list="settings-entities-datalist"
            .value=${value as string}
            @focus=${() => this._loadEntitiesForAutocomplete()}
            @change=${(e: Event) => this._saveSetting(catId, item.key, (e.target as HTMLInputElement).value)}
          />
        `;
      case 'button':
        return html`
          <button
            class="settings-btn settings-btn-primary"
            @click=${() => {
              if (item.actionUrl) window.location.href = item.actionUrl;
            }}
          >
            ${item.buttonLabel ? this._t(item.buttonLabel) : this._t(item.label ?? '')}
          </button>
        `;
      case 'mqtt-test':
        return html`
          <button
            class="settings-btn settings-btn-primary"
            ?disabled=${this._mqttTesting}
            @click=${() => this._testMqttConnection()}
          >
            ${
              this._mqttTesting
                ? html`<i class="mdi mdi-loading mdi-spin"></i> ${this._t('settings.mqtt.mqtt_testing', 'Testing...')}`
                : this._t('settings.mqtt.mqtt_test_btn')
            }
          </button>
        `;
      case 'mqtt-autodetect':
        return html`
          <button
            class="settings-btn settings-btn-outline"
            ?disabled=${this._mqttDiscovering}
            @click=${() => this._discoverMqttSettings()}
          >
            ${
              this._mqttDiscovering
                ? html`<i class="mdi mdi-loading mdi-spin"></i>
                    ${this._t('settings.mqtt.mqtt_detecting', 'Detecting...')}`
                : this._t('settings.mqtt.mqtt_autodetect_btn')
            }
          </button>
        `;
      case 'info':
        return html`<div class="settings-info-box">${unsafeHTML(this._t(item.text ?? ''))}</div>`;
      default:
        return html`
          <input
            type=${item.mode === 'password' ? 'password' : 'text'}
            class="settings-input settings-input-text"
            .value=${value as string}
            @change=${(e: Event) => this._saveSetting(catId, item.key, (e.target as HTMLInputElement).value)}
          />
        `;
    }
  }

  private _renderItem(catId: string, item: SettingsItem) {
    if (item.hidden) return nothing;
    if (item.condition) {
      const catSettings = (this._settings[catId] as Record<string, unknown>) || {};
      if (catSettings[item.condition.key] !== item.condition.value) return nothing;
    }

    const indent =
      item.indent || (item.condition && (item.condition.key === 'slot1' || item.condition.key === 'slot2'));

    return html`
      <div class="settings-item-wrapper ${indent ? 'indent' : ''} ${item.active === false ? 'disabled' : ''}">
        ${item.label !== null ? html`<label class="settings-item-label">${this._t(item.label)}</label>` : ''}
        ${item.description ? html`<div class="settings-item-desc">${this._t(item.description)}</div>` : ''}
        ${this._renderItemInput(catId, item)}
      </div>
    `;
  }

  private _renderCategorySection(category: SettingsCategory) {
    return html`
      <section
        id="settings-section-${category.id}"
        class="settings-section ${category.id === 'danger' ? 'settings-category-danger' : ''}"
      >
        <h3><i class="mdi ${category.icon.replace('mdi:', 'mdi-')}"></i> <span>${this._t(category.label)}</span></h3>
        ${category.items.map((item) => this._renderItem(category.id, item))}
      </section>
    `;
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="settings-header">
        <h2><i class="mdi mdi-cog"></i> <span>${this._t('settings_title', 'Settings')}</span></h2>
        <div class="settings-header-spacer"></div>
        <button class="settings-close-btn" @click=${() => this._close()} title="Close">
          <i class="mdi mdi-close"></i>
        </button>
      </div>
      <div class="settings-body">
        <div class="settings-categories">${this._renderCategorySidebar()}</div>
        <div class="settings-content">
          <datalist id="settings-entities-datalist">
            ${this._entityOptions.map(
              (e) => html`<option value=${e.entity_id} label=${e.attributes?.friendly_name ?? nothing}></option>`
            )}
          </datalist>
          ${this._schema?.map((category) => this._renderCategorySection(category))}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'settings-view': SettingsView;
  }
}
