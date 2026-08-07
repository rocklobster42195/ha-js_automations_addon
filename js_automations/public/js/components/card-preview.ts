import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaHaState } from './global';

interface MockState {
  state: string;
  attributes: Record<string, unknown>;
}

interface PreviewError {
  message: string;
  lineno?: number;
  time: string;
}

type WidthPreset = '180' | '380' | '760' | 'free';
type EntitySource = 'guessed' | 'discovered' | 'manual';

const WIDTH_PRESETS: { key: WidthPreset; label: string; title: string }[] = [
  { key: '180', label: '1col', title: '1col — Narrow column (~180px)' },
  { key: '380', label: '2col', title: '2col — Standard card (~380px)' },
  { key: '760', label: '4col', title: '4col — Full-width card (~760px)' },
  { key: 'free', label: '↔ free', title: 'Free — drag to resize' },
];

const DEFAULT_FREE_WIDTH = 380;

/** Splits an entity_id's object_id part into '_'-delimited segments. */
function objectIdSegments(entityId: string): string[] {
  const objectId = entityId.split('.').slice(1).join('.');
  return objectId.split('_');
}

/**
 * Whether entityId plausibly belongs to a script named `slug` — the slug must
 * appear as a contiguous run of whole '_'-delimited segments in the object_id,
 * not just anywhere as a substring (a raw `.includes()` check let short/generic
 * script names match unrelated entities, e.g. "test" matching "latest_data").
 */
function matchesScriptSlug(entityId: string, slug: string): boolean {
  const slugParts = slug.split('_').filter(Boolean);
  if (slugParts.length === 0) return false;
  const segs = objectIdSegments(entityId);
  for (let i = 0; i <= segs.length - slugParts.length; i++) {
    if (slugParts.every((p, j) => segs[i + j] === p)) return true;
  }
  return false;
}

/**
 * Floating panel that renders a Script Pack card inside a sandboxed iframe.
 * Always mounted (see index.html), renders nothing until `open()`ed.
 *
 * Exposes `window.CardPreview` (open/close/toggle/reload/isOpen) exactly as
 * before — tab-manager.js (not yet migrated) calls these directly, and
 * `window._toggleCardPreview()` backs the editor toolbar's preview button.
 */
@customElement('card-preview')
export class CardPreview extends LitElement {
  static styles = css`
    :host {
      display: none;
      position: fixed;
      top: 60px;
      right: 20px;
      width: max-content;
      min-width: 280px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 70px);
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      z-index: 9000;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      font-size: 0.82rem;
    }
    :host([open]) {
      display: flex;
    }

    .preview-titlebar {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      background: #252525;
      border-bottom: 1px solid #333;
      cursor: move;
      user-select: none;
      gap: 4px;
      color: var(--accent, #03a9f4);
      font-weight: 600;
      font-size: 0.8rem;
    }
    .preview-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-titlebar-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .preview-action-btn {
      background: none;
      border: none;
      color: var(--text-muted, #888);
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 0.9rem;
      line-height: 1;
      transition:
        color 0.15s,
        background 0.15s;
    }
    .preview-action-btn:hover {
      color: var(--text-primary, #e0e0e0);
      background: #333;
    }

    .preview-width-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      background: #1a1a1a;
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }
    .preview-width-label {
      color: #666;
      margin-right: 4px;
      font-size: 0.75rem;
    }
    .preview-width-btn {
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      color: #999;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 0.75rem;
      transition:
        background 0.15s,
        color 0.15s,
        border-color 0.15s;
    }
    .preview-width-btn:hover {
      background: #333;
      color: #ccc;
    }
    .preview-width-btn.active {
      background: var(--accent, #03a9f4);
      border-color: var(--accent, #03a9f4);
      color: #000;
      font-weight: 600;
    }

    .preview-iframe-wrap {
      width: 380px;
      height: 320px;
      max-height: 60vh;
      transition: width 0.2s;
      overflow: hidden;
      background: #111;
      position: relative;
    }
    .preview-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      background: transparent;
    }

    .preview-section {
      border-top: 1px solid #2a2a2a;
      flex-shrink: 0;
    }
    .preview-section > summary {
      padding: 7px 10px;
      cursor: pointer;
      color: #888;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      gap: 5px;
      user-select: none;
      list-style: none;
      transition: color 0.15s;
    }
    .preview-section > summary::-webkit-details-marker {
      display: none;
    }
    .preview-section > summary::before {
      content: '▸';
      font-size: 0.65rem;
      transition: transform 0.15s;
    }
    .preview-section[open] > summary::before {
      transform: rotate(90deg);
    }
    .preview-section > summary:hover {
      color: #bbb;
    }
    .preview-section.has-errors > summary {
      color: var(--danger, #db4437);
    }
    .preview-error-badge {
      font-size: 0.72rem;
      color: var(--danger, #db4437);
      font-weight: 600;
    }

    .preview-config-body {
      padding: 6px 10px 10px;
    }
    .preview-config-textarea {
      width: 100%;
      background: #1a1a1a;
      border: 1px solid #3a3a3a;
      color: #ccc;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 0.75rem;
      font-family: monospace;
      resize: vertical;
      box-sizing: border-box;
      line-height: 1.4;
    }
    .preview-config-textarea:focus {
      outline: none;
      border-color: var(--accent, #03a9f4);
    }
    .preview-config-hint {
      font-size: 0.72rem;
      margin-top: 3px;
      color: #666;
    }
    .preview-config-hint-error {
      color: var(--danger, #db4437);
    }

    .preview-hass-body {
      padding: 6px 10px 10px;
    }
    .preview-hass-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      border-bottom: 1px solid #2a2a2a;
      font-size: 0.78rem;
    }
    .preview-hass-id {
      flex: 1;
      color: #aaa;
      font-family: monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preview-hass-state-val {
      color: var(--accent, #03a9f4);
      font-family: monospace;
      min-width: 60px;
    }
    .preview-hass-edit-btn,
    .preview-hass-del-btn {
      background: none;
      border: none;
      color: #555;
      cursor: pointer;
      padding: 0 2px;
      font-size: 0.85rem;
      line-height: 1;
      transition: color 0.15s;
    }
    .preview-hass-edit-btn:hover {
      color: var(--accent, #03a9f4);
    }
    .preview-hass-del-btn:hover {
      color: var(--danger, #db4437);
    }
    .preview-hass-attrs-editor {
      padding: 4px 0 8px;
    }
    .preview-hass-attrs-editor .preview-input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 4px;
    }
    .preview-hass-attrs-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .preview-hass-attrs-actions button {
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      color: #ccc;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 0.72rem;
    }
    .preview-hass-attrs-actions button:hover {
      background: #333;
    }
    .preview-hass-add-row {
      display: flex;
      gap: 5px;
      margin-top: 8px;
      align-items: center;
    }
    .preview-input {
      flex: 1;
      background: #252525;
      border: 1px solid #3a3a3a;
      color: #ccc;
      border-radius: 4px;
      padding: 4px 7px;
      font-size: 0.78rem;
      min-width: 0;
    }
    .preview-input:focus {
      outline: none;
      border-color: var(--accent, #03a9f4);
    }
    .preview-add-btn {
      background: var(--accent, #03a9f4);
      border: none;
      color: #000;
      border-radius: 4px;
      padding: 4px 9px;
      cursor: pointer;
      font-size: 0.85rem;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    .preview-add-btn:hover {
      opacity: 0.85;
    }
    .preview-clear-all-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      font-size: 0.72rem;
      padding: 2px 0;
      margin-top: 4px;
      text-decoration: underline;
    }
    .preview-clear-all-btn:hover {
      color: var(--danger, #db4437);
    }

    .preview-errors-body {
      padding: 6px 10px 10px;
      max-height: 140px;
      overflow-y: auto;
    }
    .preview-error-row {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 2px 0;
      font-size: 0.77rem;
      border-bottom: 1px solid #2a2a2a;
    }
    .preview-error-row:last-child {
      border-bottom: none;
    }
    .preview-error-time {
      color: #555;
      flex-shrink: 0;
      font-family: monospace;
    }
    .preview-error-msg {
      color: var(--danger, #db4437);
      word-break: break-word;
    }
    .preview-error-line {
      color: #666;
      font-size: 0.72rem;
    }
    .preview-empty-hint {
      color: #444;
      font-size: 0.77rem;
      padding: 4px 0;
    }
  `;

  /** Reflects as the `open` attribute (for :host([open]) CSS) — named `visible` on
   * the class itself since `open(filename)` is also this component's public API method. */
  @property({ type: Boolean, reflect: true, attribute: 'open' }) visible = false;

  @state() private _title = 'Card Preview';
  @state() private _iframeSrc = '';
  @state() private _mockStates: Record<string, MockState> = {};
  @state() private _configText = '{}';
  @state() private _configError: string | null = null;
  @state() private _entitySource: EntitySource = 'guessed';
  @state() private _errors: PreviewError[] = [];
  @state() private _width: WidthPreset = '380';
  @state() private _newEntityId = '';
  @state() private _newEntityState = '';
  @state() private _editingAttrsFor: string | null = null;
  @state() private _stateDraft = '';
  @state() private _attrsDraft = '';

  // Entities the user explicitly removed — discovery/refresh/live-state-change must not
  // silently re-add them (they used to reappear on the next 30s poll or state change).
  // Reactive (not a plain field) so the "restore" list below the entity list stays in sync.
  @state() private _excludedEntities: Set<string> = new Set();

  private _currentScript: string | null = null;
  private _cardConfig: Record<string, unknown> = {};
  private _discoveryPromise: Promise<void> = Promise.resolve();
  private _freeWidthPx = DEFAULT_FREE_WIDTH;
  private _resizeObserver?: ResizeObserver;
  private _resizeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pollStatesInterval?: ReturnType<typeof setInterval>;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    window.CardPreview = this;
    window._toggleCardPreview = () => this.toggle(window._activeCardParentScript);
    window.addEventListener('message', this._onIframeMessage);
    this._waitForSocket();

    this._pollStatesInterval = setInterval(() => {
      if (this.visible) this._refreshTrackedStates();
    }, 30000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.CardPreview === this) delete window.CardPreview;
    window.removeEventListener('message', this._onIframeMessage);
    if (this._pollStatesInterval) clearInterval(this._pollStatesInterval);
    this._resizeObserver?.disconnect();
  }

  firstUpdated() {
    this._makeDraggable();
    this._resizeObserver = new ResizeObserver((entries) => {
      if (this._width !== 'free') return;
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      if (this._resizeSaveTimer) clearTimeout(this._resizeSaveTimer);
      this._resizeSaveTimer = setTimeout(() => {
        this._freeWidthPx = Math.round(width);
        localStorage.setItem('jsa_preview_free_width_px', String(this._freeWidthPx));
      }, 300);
    });
    const wrap = this.renderRoot.querySelector('.preview-iframe-wrap');
    if (wrap) this._resizeObserver.observe(wrap);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    window.socket.on('ha_state_changed', ({ entity_id, new_state }: { entity_id: string; new_state: JsaHaState }) => {
      if (!new_state || !this.visible) return;
      if (!Object.prototype.hasOwnProperty.call(this._mockStates, entity_id)) return;
      const incoming = new_state.attributes ?? {};
      const current = this._mockStates[entity_id].attributes ?? {};
      // Ignore transient re-registration states: "unknown" with no attributes
      // while the current mock already has meaningful data.
      if (new_state.state === 'unknown' && !incoming.datetime && current.datetime) return;
      this._mockStates = { ...this._mockStates, [entity_id]: { state: new_state.state, attributes: incoming } };
      this._pushHassToIframe();
    });
  };

  // ── Public API (window.CardPreview bridge) ────────────────────────────

  open(scriptFilename: string): void {
    if (!scriptFilename) return;
    this._loadScript(scriptFilename);
    this.visible = true;
    this._restorePosition();
    this._syncPreviewBtn(true);
  }

  close(): void {
    this.visible = false;
    this._syncPreviewBtn(false);
  }

  toggle(scriptFilename: string | null | undefined): void {
    if (!scriptFilename) return;
    if (!this.visible) {
      this.open(scriptFilename);
    } else if (this._currentScript !== scriptFilename) {
      this._loadScript(scriptFilename);
    } else {
      this.close();
    }
  }

  reload(): void {
    if (!this._currentScript) return;
    this._clearErrors();
    this._iframeSrc = this._previewUrl(this._currentScript);
  }

  isOpen(): boolean {
    return this.visible;
  }

  private _syncPreviewBtn(active: boolean): void {
    document.getElementById('btn-card-menu')?.classList.toggle('preview-active', active);
  }

  // ── Panel lifecycle ────────────────────────────────────────────────────

  private _previewUrl(filename: string): string {
    const base = window.BASE_PATH ?? '/';
    return `${base}api/scripts/${filename}/card/preview-html?t=${Date.now()}`;
  }

  private _loadScript(filename: string): void {
    this._currentScript = filename;
    this._title = filename.replace(/\.[^.]+$/, '') + ' — card';
    this._clearErrors();

    const stored = localStorage.getItem(`jsa_preview_states_${filename}`);
    this._mockStates = stored ? this._tryParse(stored, {}) : {};

    const storedExcluded = localStorage.getItem(`jsa_preview_excluded_${filename}`);
    this._excludedEntities = new Set(storedExcluded ? this._tryParse<string[]>(storedExcluded, []) : []);

    const storedCfg = localStorage.getItem(`jsa_preview_config_${filename}`);
    if (storedCfg) {
      this._cardConfig = this._tryParse(storedCfg, {});
      this._entitySource = 'manual';
    } else {
      const scriptName = filename.replace(/\.[^.]+$/, '').replace(/-/g, '_');
      const meta = window.allScripts?.find((s) => s.filename === filename);
      const domain = meta?.expose === 'button' ? 'button' : meta?.expose === 'switch' ? 'switch' : 'sensor';
      this._cardConfig = { entity_id: `${domain}.${scriptName}` };
      this._entitySource = 'guessed';
    }
    this._configText = JSON.stringify(this._cardConfig, null, 2);
    this._configError = null;

    this._iframeSrc = this._previewUrl(filename);
    this._discoveryPromise = this._autoDiscoverEntities(filename);
  }

  private async _autoDiscoverEntities(filename: string | null): Promise<void> {
    if (!filename || !window.getHAStates) return;
    const scriptSlug = filename.replace(/\.[^.]+$/, '').replace(/-/g, '_');
    const storedCfg = localStorage.getItem(`jsa_preview_config_${filename}`);

    try {
      const statesArr = await window.getHAStates();
      if (!Array.isArray(statesArr)) return;
      let changed = false;
      const next = { ...this._mockStates };
      for (const s of statesArr) {
        if (!matchesScriptSlug(s.entity_id, scriptSlug)) continue;
        if (this._excludedEntities.has(s.entity_id)) continue;
        const incoming = s.attributes ?? {};
        const current = (next[s.entity_id] || {}).attributes ?? {};
        if (s.state === 'unknown' && !incoming.datetime && current.datetime) continue;
        next[s.entity_id] = { state: s.state, attributes: incoming };
        changed = true;
        if (!storedCfg && !String(this._cardConfig.entity_id ?? '').includes(s.entity_id.split('.')[0])) {
          this._cardConfig = { entity_id: s.entity_id };
          this._configText = JSON.stringify(this._cardConfig, null, 2);
          this._entitySource = 'discovered';
        }
      }
      if (changed) {
        this._mockStates = next;
        this._saveMockStates();
      }
    } catch {
      /* HA not reachable — user can add entities manually */
    }
  }

  // ── Width ──────────────────────────────────────────────────────────────

  private _setWidth(width: WidthPreset): void {
    this._width = width;
    localStorage.setItem('jsa_preview_width', width);
    const wrap = this.renderRoot.querySelector<HTMLElement>('.preview-iframe-wrap');
    if (!wrap) return;
    if (width === 'free') {
      const current = wrap.getBoundingClientRect().width || this._freeWidthPx;
      wrap.style.width = current + 'px';
      wrap.style.resize = 'horizontal';
      wrap.style.overflow = 'hidden';
    } else {
      wrap.style.width = width + 'px';
      wrap.style.resize = 'none';
      wrap.style.overflow = '';
    }
  }

  // ── Mock hass ──────────────────────────────────────────────────────────

  private _addMockStateFromInputs(): void {
    const entityId = this._newEntityId.trim();
    const state = this._newEntityState.trim();
    if (!entityId) return;

    this._mockStates = {
      ...this._mockStates,
      [entityId]: {
        state: state || 'unknown',
        attributes: this._mockStates[entityId]?.attributes ?? { friendly_name: entityId },
      },
    };
    this._newEntityId = '';
    this._newEntityState = '';
    if (this._excludedEntities.has(entityId)) {
      this._excludedEntities = new Set(this._excludedEntities);
      this._excludedEntities.delete(entityId);
      this._saveExcludedEntities();
    }
    this._saveMockStates();
    this._pushHassToIframe();
  }

  private _deleteMockState(entityId: string): void {
    const next = { ...this._mockStates };
    delete next[entityId];
    this._mockStates = next;
    // Remember this as an explicit removal so discovery/refresh/live state changes
    // don't just bring it right back on the next cycle.
    this._excludedEntities = new Set(this._excludedEntities).add(entityId);
    this._saveExcludedEntities();
    this._saveMockStates();
    this._pushHassToIframe();
  }

  private _clearAllMockStates(): void {
    for (const id of Object.keys(this._mockStates)) this._excludedEntities.add(id);
    this._excludedEntities = new Set(this._excludedEntities);
    this._saveExcludedEntities();
    this._mockStates = {};
    this._saveMockStates();
    this._pushHassToIframe();
  }

  private _saveExcludedEntities(): void {
    if (this._currentScript) {
      localStorage.setItem(`jsa_preview_excluded_${this._currentScript}`, JSON.stringify([...this._excludedEntities]));
    }
  }

  private _toggleAttrEditor(entityId: string): void {
    if (this._editingAttrsFor === entityId) {
      this._editingAttrsFor = null;
      return;
    }
    this._editingAttrsFor = entityId;
    this._stateDraft = this._mockStates[entityId]?.state ?? '';
    this._attrsDraft = JSON.stringify(this._mockStates[entityId]?.attributes ?? {}, null, 2);
  }

  private _saveEntityEdit(entityId: string): void {
    try {
      const attributes = JSON.parse(this._attrsDraft || '{}');
      const state = this._stateDraft.trim() || 'unknown';
      this._mockStates = { ...this._mockStates, [entityId]: { state, attributes } };
      this._saveMockStates();
      this._pushHassToIframe();
      this._editingAttrsFor = null;
    } catch {
      // Leave the editor open — the textarea itself has no dedicated error slot,
      // an invalid JSON attempt just doesn't save.
    }
  }

  private _saveMockStates(): void {
    if (this._currentScript) {
      localStorage.setItem(`jsa_preview_states_${this._currentScript}`, JSON.stringify(this._mockStates));
    }
  }

  // ── Card config ────────────────────────────────────────────────────────

  private _onCardConfigInput(e: Event): void {
    const raw = (e.target as HTMLTextAreaElement).value;
    this._configText = raw;
    const trimmed = raw.trim();
    if (!trimmed) {
      this._cardConfig = {};
      this._configError = null;
    } else {
      try {
        this._cardConfig = JSON.parse(trimmed);
        this._configError = null;
      } catch {
        this._configError = this._t('preview.invalid_json', 'Invalid JSON');
        return; // don't push invalid config
      }
    }
    this._entitySource = 'manual';
    if (this._currentScript) {
      localStorage.setItem(`jsa_preview_config_${this._currentScript}`, JSON.stringify(this._cardConfig));
    }
    this._pushConfigToIframe();
  }

  private _iframe(): HTMLIFrameElement | null {
    return this.renderRoot.querySelector<HTMLIFrameElement>('#card-preview-iframe');
  }

  private _pushConfigToIframe(): void {
    const win = this._iframe()?.contentWindow;
    if (!win) return;
    // _stub:true tells cards to show demo data when no real entity state exists.
    // The real HA dashboard never sends this flag, so production behavior is unaffected.
    win.postMessage({ type: 'jsa-set-config', config: { _stub: true, ...this._cardConfig } }, '*');
  }

  private _pushHassToIframe(): void {
    const win = this._iframe()?.contentWindow;
    if (!win) return;
    const states: Record<string, unknown> = {};
    for (const [id, s] of Object.entries(this._mockStates)) {
      states[id] = {
        entity_id: id,
        state: s.state,
        attributes: s.attributes ?? { friendly_name: id },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }
    win.postMessage({ type: 'jsa-set-hass', states }, '*');
  }

  // ── Errors ─────────────────────────────────────────────────────────────

  private _addError(message: string, lineno?: number): void {
    this._errors = [...this._errors, { message, lineno, time: new Date().toLocaleTimeString() }];
  }

  private _clearErrors(): void {
    this._errors = [];
  }

  // ── iframe messages ────────────────────────────────────────────────────

  private _onIframeMessage = (e: MessageEvent): void => {
    if (!e.data) return;
    if (e.data.type === 'jsa-card-error') {
      this._addError(e.data.message, e.data.lineno);
      const src = e.data.scriptName ?? this._currentScript ?? this._t('preview.card_source', 'Card');
      window.appendLog?.({ ts: Date.now(), level: 'error', source: src, message: `[Card Preview] ${e.data.message}` });
    }
    if (e.data.type === 'jsa-card-loaded') {
      // Push stored config immediately so the card uses the right entityId from the start.
      this._pushConfigToIframe();
      // Push whatever mockStates we already have (from localStorage) so the card renders
      // immediately rather than waiting for discovery (which requires a socket round-trip).
      this._pushHassToIframe();
      // Then let discovery refresh from live HA and push again once complete.
      this._discoveryPromise.then(() => this._pushHassToIframe());
    }
    if (e.data.type === 'jsa-action-done') {
      if (e.data.config && e.data.config.entityId) {
        this._cardConfig = { entityId: e.data.config.entityId };
        this._configText = JSON.stringify(this._cardConfig, null, 2);
        this._entitySource = 'manual';
        if (this._currentScript) {
          localStorage.setItem(`jsa_preview_config_${this._currentScript}`, JSON.stringify(this._cardConfig));
        }
        this._pushConfigToIframe();
        // Poll until the new entity has real data (ha.update() is fire-and-forget).
        this._pollEntityReady(e.data.config.entityId);
      } else {
        // Non-config action (e.g. refresh) — rediscover and push once.
        this._autoDiscoverEntities(this._currentScript).then(() => this._pushHassToIframe());
        setTimeout(() => this._autoDiscoverEntities(this._currentScript).then(() => this._pushHassToIframe()), 2000);
      }
    }
  };

  private _pollEntityReady = async (entityId: string, attempt = 0): Promise<void> => {
    if (attempt > 8) {
      this._refreshTrackedStates();
      return;
    }
    if (!window.getHAStates) return;
    try {
      const statesArr = await window.getHAStates();
      const match = statesArr.find((s) => s.entity_id === entityId);
      if (match) {
        this._mockStates = {
          ...this._mockStates,
          [entityId]: { state: match.state, attributes: match.attributes ?? {} },
        };
        this._saveMockStates();
        this._pushHassToIframe();
        // Attributes may still be populating (e.g. ha.update() in flight) — give it
        // a couple more short polls if we got the entity but no attributes yet.
        if (Object.keys(match.attributes ?? {}).length === 0 && attempt < 3) {
          setTimeout(() => this._pollEntityReady(entityId, attempt + 1), 1200);
        }
      } else {
        setTimeout(() => this._pollEntityReady(entityId, attempt + 1), 1200);
      }
    } catch {
      setTimeout(() => this._pollEntityReady(entityId, attempt + 1), 1500);
    }
  };

  private async _refreshTrackedStates(): Promise<void> {
    const tracked = Object.keys(this._mockStates);
    if (tracked.length === 0 || !window.getHAStates) return;
    try {
      const statesArr = await window.getHAStates();
      const stateMap = new Map(statesArr.map((s) => [s.entity_id, s]));
      let changed = false;
      const next = { ...this._mockStates };
      for (const id of tracked) {
        const s = stateMap.get(id);
        if (!s) continue;
        const incoming = s.attributes ?? {};
        const current = next[id].attributes ?? {};
        if (s.state === 'unknown' && !incoming.datetime && current.datetime) continue;
        next[id] = { state: s.state, attributes: incoming };
        changed = true;
      }
      if (changed) {
        this._mockStates = next;
        this._pushHassToIframe();
      }
    } catch {
      /* silent — socket update will still arrive */
    }
  }

  // ── Drag & position ────────────────────────────────────────────────────

  private _makeDraggable(): void {
    const handle = this.renderRoot.querySelector<HTMLElement>('.preview-titlebar');
    if (!handle) return;
    let sx = 0,
      sy = 0,
      sl = 0,
      st = 0;

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return; // don't drag on button click
      e.preventDefault();
      sx = e.clientX;
      sy = e.clientY;
      const r = this.getBoundingClientRect();
      sl = r.left;
      st = r.top;

      const onMove = (ev: MouseEvent) => {
        this.style.left = `${sl + ev.clientX - sx}px`;
        this.style.top = `${st + ev.clientY - sy}px`;
        this.style.right = 'auto';
        this.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._savePosition();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private _savePosition(): void {
    const r = this.getBoundingClientRect();
    localStorage.setItem('jsa_preview_pos', JSON.stringify({ left: r.left, top: r.top }));
  }

  private _restorePosition(): void {
    const stored = localStorage.getItem('jsa_preview_pos');
    if (stored) {
      const { left, top } = this._tryParse<{ left?: number; top?: number }>(stored, {});
      if (left !== undefined) {
        const minTop = 60;
        const maxLeft = window.innerWidth - 100;
        this.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
        this.style.top = `${Math.max(minTop, top ?? minTop)}px`;
        this.style.right = 'auto';
        this.style.bottom = 'auto';
      }
    } else {
      this.style.right = '20px';
      this.style.top = '80px';
      this.style.left = 'auto';
      this.style.bottom = 'auto';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _tryParse<T>(str: string, fallback: T): T {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  private _entitySourceLabel(): string {
    switch (this._entitySource) {
      case 'discovered':
        return this._t('preview.entity_discovered', 'Entity auto-detected from Home Assistant.');
      case 'manual':
        return this._t('preview.entity_manual', 'Manually configured.');
      default:
        return this._t('preview.entity_guessed', 'Guessed default — not yet confirmed against a real entity.');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  private _renderMockStates() {
    const entries = Object.entries(this._mockStates);
    if (entries.length === 0) {
      return html`<div class="preview-empty-hint">
        ${this._t('preview.no_entities', 'No entities. Add one below to inject into mock hass.')}
      </div>`;
    }
    return html`
      ${repeat(
        entries,
        ([id]) => id,
        ([id, s]) => html`
          <div class="preview-hass-row">
            <span class="preview-hass-id">${id}</span>
            <span class="preview-hass-state-val">${s.state}</span>
            <button
              class="preview-hass-edit-btn"
              @click=${() => this._toggleAttrEditor(id)}
              title="Edit state & attributes"
            >
              <i class="mdi mdi-pencil-outline"></i>
            </button>
            <button class="preview-hass-del-btn" @click=${() => this._deleteMockState(id)} title="Remove">
              <i class="mdi mdi-close-circle-outline"></i>
            </button>
          </div>
          ${
            this._editingAttrsFor === id
              ? html`
                  <div class="preview-hass-attrs-editor">
                    <input
                      type="text"
                      class="preview-input"
                      placeholder="state"
                      .value=${this._stateDraft}
                      @input=${(e: Event) => (this._stateDraft = (e.target as HTMLInputElement).value)}
                    />
                    <textarea
                      class="preview-config-textarea"
                      rows="4"
                      spellcheck="false"
                      .value=${this._attrsDraft}
                      @input=${(e: Event) => (this._attrsDraft = (e.target as HTMLTextAreaElement).value)}
                    ></textarea>
                    <div class="preview-hass-attrs-actions">
                      <button @click=${() => this._saveEntityEdit(id)}>Save</button>
                      <button @click=${() => (this._editingAttrsFor = null)}>Cancel</button>
                    </div>
                  </div>
                `
              : nothing
          }
        `
      )}
      ${
        entries.length > 0
          ? html`<button class="preview-clear-all-btn" @click=${() => this._clearAllMockStates()}>
              ${this._t('preview.clear_all', 'Clear all')}
            </button>`
          : nothing
      }
    `;
  }

  private _renderErrors() {
    if (this._errors.length === 0) {
      return html`<div class="preview-empty-hint">${this._t('preview.no_errors', 'No errors.')}</div>`;
    }
    return this._errors.map(
      (e) => html`
        <div class="preview-error-row">
          <span class="preview-error-time">${e.time}</span>
          <span class="preview-error-msg"
            >${e.message}${
              e.lineno
                ? html` <span class="preview-error-line">${this._t('preview.line', 'line')} ${e.lineno}</span>`
                : nothing
            }</span
          >
        </div>
      `
    );
  }

  render() {
    if (!this.visible) return nothing;

    return html`
      ${mdiStylesheetLink}
      <div class="preview-titlebar">
        <i class="mdi mdi-view-dashboard-outline" style="margin-right:6px;opacity:.7;"></i>
        <span class="preview-title">${this._title}</span>
        <div class="preview-titlebar-actions">
          <button
            class="preview-action-btn"
            title="Configure card"
            @click=${() => this._iframe()?.contentWindow?.postMessage({ type: 'jsa-open-editor' }, '*')}
          >
            <i class="mdi mdi-cog-outline"></i>
          </button>
          <button class="preview-action-btn" title="Reload preview" @click=${() => this.reload()}>
            <i class="mdi mdi-refresh"></i>
          </button>
          <button class="preview-action-btn" title="Close preview" @click=${() => this.close()}>
            <i class="mdi mdi-close"></i>
          </button>
        </div>
      </div>

      <div class="preview-width-bar">
        <span class="preview-width-label">Width:</span>
        ${WIDTH_PRESETS.map(
          (p) => html`
            <button
              class="preview-width-btn ${this._width === p.key ? 'active' : ''}"
              title=${p.title}
              @click=${() => this._setWidth(p.key)}
            >
              ${p.label}
            </button>
          `
        )}
      </div>

      <div class="preview-iframe-wrap">
        <iframe
          id="card-preview-iframe"
          class="preview-iframe"
          frameborder="0"
          sandbox="allow-scripts allow-same-origin"
          src=${this._iframeSrc}
        ></iframe>
      </div>

      <details class="preview-section" id="preview-config-section" open>
        <summary>
          <i class="mdi mdi-cog-outline"></i>
          ${this._t('preview.card_config', 'Card Config')} <small>(setConfig)</small>
        </summary>
        <div class="preview-config-body">
          <textarea
            class="preview-config-textarea"
            rows="3"
            spellcheck="false"
            .value=${this._configText}
            @input=${(e: Event) => this._onCardConfigInput(e)}
          ></textarea>
          <div class="preview-config-hint ${this._configError ? 'preview-config-hint-error' : ''}">
            ${this._configError ?? this._entitySourceLabel()}
          </div>
        </div>
      </details>

      <details class="preview-section" id="preview-hass-section">
        <summary>
          <i class="mdi mdi-code-braces"></i>
          ${this._t('preview.entity_states', 'Preview Data')}
        </summary>
        <div class="preview-hass-body">
          <div id="preview-hass-list">${this._renderMockStates()}</div>
          <div class="preview-hass-add-row">
            <input
              type="text"
              class="preview-input"
              placeholder="entity_id"
              .value=${this._newEntityId}
              @input=${(e: Event) => (this._newEntityId = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter')
                  this.renderRoot.querySelector<HTMLInputElement>('.preview-hass-state-input')?.focus();
              }}
            />
            <input
              type="text"
              class="preview-input preview-hass-state-input"
              placeholder="state"
              .value=${this._newEntityState}
              @input=${(e: Event) => (this._newEntityState = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this._addMockStateFromInputs();
              }}
            />
            <button class="preview-add-btn" title="Add entity" @click=${() => this._addMockStateFromInputs()}>
              <i class="mdi mdi-plus"></i>
            </button>
          </div>
        </div>
      </details>

      <details
        class="preview-section ${this._errors.length ? 'has-errors' : ''}"
        id="preview-errors-section"
        ?open=${this._errors.length > 0}
      >
        <summary>
          <i class="mdi mdi-alert-circle-outline"></i>
          ${this._t('preview.errors', 'Errors')}
          <span class="preview-error-badge">${this._errors.length ? `(${this._errors.length})` : ''}</span>
        </summary>
        <div class="preview-errors-body">${this._renderErrors()}</div>
      </details>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'card-preview': CardPreview;
  }
}
