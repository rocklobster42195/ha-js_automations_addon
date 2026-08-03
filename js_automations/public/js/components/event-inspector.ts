import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';
import { observeTabVisibility } from './tab-visibility';

const EVENT_INSPECTOR_MAX = 200;

const EI_EVENT_TYPES = [
  'state_changed',
  'call_service',
  'automation_triggered',
  'script_started',
  'timer.finished',
  'zha_event',
  'homeassistant_start',
  'homeassistant_stop',
  'component_loaded',
  'tag_scanned',
];

interface HaEventPayload {
  t: number;
  type: string;
  data: Record<string, any>;
}

interface BufferedEvent extends HaEventPayload {
  seq: number;
}

/**
 * EVENTS dev-tools tab: live HA event/state-change stream + a "Fire Event"
 * form. Panel content only — the EVENTS tab button and .dev-tab-panel/.hidden
 * toggling stay owned by layout.js's generic tab switcher (this element IS
 * the panel, id="dev-tab-events").
 *
 * Subscription is two-tiered like the original: the server-side
 * 'subscribe_event_inspector' room join only happens while this tab is
 * actually visible (observeTabVisibility, to avoid needless traffic for a
 * chatty stream), and even while subscribed, incoming events are only kept
 * while not paused (Play/Pause starts paused, same as before).
 */
@customElement('event-inspector')
export class EventInspector extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      padding: 0;
      overflow: hidden;
      height: 100%;
      box-sizing: border-box;
    }

    .dev-section-divider {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      height: 22px;
      flex-shrink: 0;
      font-size: 0.6rem;
      font-weight: 600;
      color: #3a3a3a;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      user-select: none;
    }
    .dev-section-divider::before,
    .dev-section-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #2a2a2a;
    }

    .ei-fire-panel {
      border-bottom: 1px solid #1a1a1a;
      padding: 6px 8px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ei-fire-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .ei-fire-type,
    .ei-fire-data {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #ccc;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.78rem;
      font-family: monospace;
    }
    .ei-fire-type:focus,
    .ei-fire-data:focus {
      outline: none;
      border-color: var(--accent);
    }
    .ei-fire-btn {
      flex-shrink: 0;
      padding: 3px 12px;
      background: #1a3a1a;
      color: #8bc34a;
      border: 1px solid #2a4a2a;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .ei-fire-btn:hover {
      background: #2a4a2a;
    }
    .ei-fire-err {
      font-size: 0.72rem;
      color: #e57373;
      flex-shrink: 0;
    }

    .ei-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid #1a1a1a;
      flex-shrink: 0;
    }
    .ei-filter-wrap {
      flex: 1;
      position: relative;
    }
    .ei-filter-wrap:first-child {
      flex: 0 0 175px;
    }
    .ei-filter {
      width: 100%;
      box-sizing: border-box;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #ccc;
      border-radius: 3px;
      padding: 3px 22px 3px 8px;
      font-size: 0.78rem;
      font-family: monospace;
    }
    .ei-filter:focus {
      outline: none;
      border-color: var(--accent);
    }
    .ei-clear-btn {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #555;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      font-size: 0.85rem;
    }
    .ei-clear-btn:hover {
      color: #ccc;
    }

    .ei-dropdown {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      right: 0;
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 3px;
      max-height: 140px;
      overflow-y: auto;
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    .ei-dropdown-row {
      padding: 5px 10px;
      font-size: 0.78rem;
      font-family: monospace;
      color: #aaa;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ei-dropdown-row:hover {
      background: #2a2a2a;
      color: #fff;
    }
    .ei-toolbar button {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 1rem;
      line-height: 1;
    }
    .ei-toolbar button:hover {
      color: #ccc;
      background: #222;
    }

    .ei-list {
      flex: 1;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.78rem;
    }
    .ei-hint {
      padding: 16px 12px;
      color: #777;
      font-family: inherit;
      font-size: 0.8rem;
    }
    .ei-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 3px 8px;
      border-bottom: 1px solid #0d0d0d;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
    }
    .ei-row:hover {
      background: #111;
    }
    .ei-time {
      color: #777;
      flex-shrink: 0;
    }
    .ei-type {
      flex-shrink: 0;
      font-size: 0.72rem;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
    }
    .ei-type-state {
      background: #0d2a35;
      color: #4fc3f7;
    }
    .ei-type-event {
      background: #1a2a0d;
      color: #8bc34a;
    }
    .ei-detail {
      display: flex;
      gap: 8px;
      overflow: hidden;
      min-width: 0;
    }
    .ei-entity {
      color: #aaa;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ei-arrow {
      color: #777;
      flex-shrink: 0;
    }
    .ei-raw {
      background: #0a0a0a;
      color: #888;
      font-family: monospace;
      font-size: 0.75rem;
      padding: 6px 12px;
      margin: 0;
      border-bottom: 1px solid #1a1a1a;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
  `;

  @state() private _events: BufferedEvent[] = [];
  @state() private _paused = true;
  @state() private _typeFilter = '';
  @state() private _entityFilter = '';
  @state() private _typeDropdownOpen = false;
  @state() private _entityDropdownOpen = false;
  @state() private _expandedRows: Set<number> = new Set();
  @state() private _fireType = '';
  @state() private _fireData = '';
  @state() private _fireError: string | null = null;

  private _active = false;
  private _seq = 0;
  private _visibilityObserver?: MutationObserver;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.onHaEventStream = this._onHaEventStream;

    // MutationObserver only fires on subsequent class changes, not the current
    // state — seed it here so an already-visible tab at mount time still subscribes.
    this._active = !this.classList.contains('hidden');

    this._visibilityObserver = observeTabVisibility(this, (visible) => {
      this._active = visible;
      if (visible) window.socket?.emit('subscribe_event_inspector');
      else window.socket?.emit('unsubscribe_event_inspector');
    });

    document.addEventListener('click', this._onDocumentClick, true);
    this._waitForSocket();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.onHaEventStream === this._onHaEventStream) delete window.onHaEventStream;
    this._visibilityObserver?.disconnect();
    document.removeEventListener('click', this._onDocumentClick, true);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    if (window.socket.connected && this._active) window.socket.emit('subscribe_event_inspector');
    // Re-subscribe on reconnect if the tab was already active (the socket-side
    // room membership doesn't survive a disconnect).
    window.socket.on('connect', () => {
      if (this._active) window.socket!.emit('subscribe_event_inspector');
    });
  };

  private _onDocumentClick = (e: MouseEvent): void => {
    const path = e.composedPath();
    const insideFilter = path.some((el) => el instanceof HTMLElement && el.classList.contains('ei-filter-wrap'));
    if (!insideFilter) {
      this._typeDropdownOpen = false;
      this._entityDropdownOpen = false;
    }
  };

  private _matchesFilter = (entry: HaEventPayload): boolean => {
    if (this._typeFilter) {
      if (!entry.type.toLowerCase().includes(this._typeFilter.toLowerCase())) return false;
    }
    if (this._entityFilter) {
      const fd = this._entityFilter.toLowerCase();
      const entityId: string = entry.data?.entity_id || entry.data?.new_state?.entity_id || '';
      if (!entityId.toLowerCase().includes(fd) && !entry.type.toLowerCase().includes(fd)) return false;
    }
    return true;
  };

  private _onHaEventStream = (payload: HaEventPayload): void => {
    if (!this._active || this._paused) return;
    if (!this._matchesFilter(payload)) return;

    const entry: BufferedEvent = { ...payload, seq: this._seq++ };
    const next = [entry, ...this._events];
    if (next.length > EVENT_INSPECTOR_MAX) next.length = EVENT_INSPECTOR_MAX;
    this._events = next;
  };

  private _togglePause(): void {
    this._paused = !this._paused;
  }

  private _clear(): void {
    this._events = [];
    this._expandedRows = new Set();
  }

  private _toggleRow(seq: number): void {
    const next = new Set(this._expandedRows);
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    this._expandedRows = next;
  }

  private _setTypeFilter(val: string): void {
    this._typeFilter = val;
  }

  private _setEntityFilter(val: string): void {
    this._entityFilter = val;
  }

  private _pickType(evtType: string): void {
    this._typeFilter = evtType;
    this._typeDropdownOpen = false;
  }

  private _pickEntity(entityId: string): void {
    this._entityFilter = entityId;
    this._entityDropdownOpen = false;
  }

  private _onTypeKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this._typeFilter = '';
      this._typeDropdownOpen = false;
      (e.target as HTMLElement).blur();
    }
    if (e.key === 'Enter') {
      this._typeDropdownOpen = false;
      (e.target as HTMLElement).blur();
    }
  }

  private _onEntityKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this._entityFilter = '';
      this._entityDropdownOpen = false;
      (e.target as HTMLElement).blur();
    }
    if (e.key === 'Enter') {
      this._entityDropdownOpen = false;
      (e.target as HTMLElement).blur();
    }
  }

  private _fireEvent(): void {
    const event_type = this._fireType.trim();
    if (!event_type) return;

    let data = {};
    const raw = this._fireData.trim();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        this._fireError = 'Invalid JSON';
        return;
      }
    }
    this._fireError = null;
    window.socket?.emit('fire_ha_event', { event_type, data });
  }

  private _typeMatches(): string[] {
    const t = this._typeFilter.toLowerCase().trim();
    return t ? EI_EVENT_TYPES.filter((e) => e.toLowerCase().includes(t)) : EI_EVENT_TYPES;
  }

  private _entityMatches(): string[] {
    const entities = window.allEntities ?? [];
    const t = this._entityFilter.toLowerCase().trim();
    const matches = t ? entities.filter((e) => e.toLowerCase().includes(t)) : entities;
    return matches.slice(0, 80);
  }

  private _renderRow(entry: BufferedEvent) {
    const time = new Date(entry.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isState = entry.type === 'state_changed';

    let detail;
    if (isState) {
      const id = entry.data.entity_id || '';
      const oldS = entry.data.old_state?.state ?? '—';
      const newS = entry.data.new_state?.state ?? '—';
      detail = html`<span class="ei-entity">${id}</span><span class="ei-arrow">${oldS} → ${newS}</span>`;
    } else {
      const entityId = entry.data.entity_id || entry.data.domain || '';
      const preview = entityId || JSON.stringify(entry.data).slice(0, 60);
      detail = html`<span class="ei-entity">${preview}</span>`;
    }

    const expanded = this._expandedRows.has(entry.seq);

    return html`
      <div class="ei-row" @click=${() => this._toggleRow(entry.seq)}>
        <span class="ei-time">${time}</span>
        <span class="ei-type ${isState ? 'ei-type-state' : 'ei-type-event'}">${entry.type}</span>
        <span class="ei-detail">${detail}</span>
      </div>
      ${expanded ? html`<pre class="ei-raw">${JSON.stringify(entry.data, null, 2)}</pre>` : ''}
    `;
  }

  render() {
    const visibleEvents = this._events.filter(this._matchesFilter);

    return html`
      ${mdiStylesheetLink}
      <div class="ei-fire-panel">
        <div class="ei-fire-row">
          <input
            class="ei-fire-type"
            placeholder=${this._t('devtools.fire_event_type', 'Event type, e.g. my_event')}
            autocomplete="off"
            spellcheck="false"
            .value=${this._fireType}
            @input=${(e: Event) => (this._fireType = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._fireEvent()}
          />
          <button class="ei-fire-btn" @click=${() => this._fireEvent()}>
            ${this._t('devtools.fire_event', 'Fire')}
          </button>
        </div>
        <div class="ei-fire-row">
          <input
            class="ei-fire-data"
            placeholder=${this._t('devtools.fire_event_data', 'Data (JSON), e.g. {"key":"value"}')}
            autocomplete="off"
            spellcheck="false"
            .value=${this._fireData}
            @input=${(e: Event) => (this._fireData = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._fireEvent()}
          />
          ${this._fireError ? html`<span class="ei-fire-err">${this._fireError}</span>` : ''}
        </div>
      </div>
      <div class="dev-section-divider">Stream</div>
      <div class="ei-toolbar">
        <div class="ei-filter-wrap">
          <input
            class="ei-filter"
            placeholder="Event type..."
            autocomplete="off"
            .value=${this._typeFilter}
            @input=${(e: Event) => {
              this._setTypeFilter((e.target as HTMLInputElement).value);
              this._typeDropdownOpen = true;
            }}
            @focus=${() => (this._typeDropdownOpen = true)}
            @keydown=${(e: KeyboardEvent) => this._onTypeKey(e)}
          />
          ${
            this._typeFilter
              ? html`<button class="ei-clear-btn" @click=${() => this._setTypeFilter('')} title="Clear">
                  <i class="mdi mdi-close"></i>
                </button>`
              : ''
          }
          ${
            this._typeDropdownOpen && this._typeMatches().length
              ? html`<div class="ei-dropdown">
                  ${this._typeMatches().map(
                    (evtType) => html`
                      <div
                        class="ei-dropdown-row"
                        @mousedown=${(e: Event) => (e.preventDefault(), this._pickType(evtType))}
                      >
                        ${evtType}
                      </div>
                    `
                  )}
                </div>`
              : ''
          }
        </div>
        <div class="ei-filter-wrap">
          <input
            class="ei-filter"
            placeholder="Filter entity..."
            autocomplete="off"
            .value=${this._entityFilter}
            @input=${(e: Event) => {
              this._setEntityFilter((e.target as HTMLInputElement).value);
              this._entityDropdownOpen = true;
            }}
            @focus=${() => (this._entityDropdownOpen = true)}
            @keydown=${(e: KeyboardEvent) => this._onEntityKey(e)}
          />
          ${
            this._entityFilter
              ? html`<button class="ei-clear-btn" @click=${() => this._setEntityFilter('')} title="Clear">
                  <i class="mdi mdi-close"></i>
                </button>`
              : ''
          }
          ${
            this._entityDropdownOpen && this._entityMatches().length
              ? html`<div class="ei-dropdown">
                  ${this._entityMatches().map(
                    (entityId) => html`
                      <div
                        class="ei-dropdown-row"
                        @mousedown=${(e: Event) => (e.preventDefault(), this._pickEntity(entityId))}
                      >
                        ${entityId}
                      </div>
                    `
                  )}
                </div>`
              : ''
          }
        </div>
        <button @click=${() => this._togglePause()} title=${this._paused ? 'Resume' : 'Pause'}>
          <i class="mdi mdi-${this._paused ? 'play' : 'pause'}"></i>
        </button>
        <button @click=${() => this._clear()} title="Clear">
          <i class="mdi mdi-trash-can-outline"></i>
        </button>
      </div>
      <div class="ei-list">
        ${
          visibleEvents.length === 0
            ? html`<div class="ei-hint">
                ${this._t('devtools.event_inspector_hint', 'Click Play to start the live event stream.')}
              </div>`
            : repeat(
                visibleEvents,
                (e) => e.seq,
                (e) => this._renderRow(e)
              )
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'event-inspector': EventInspector;
  }
}
