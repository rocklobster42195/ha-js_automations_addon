import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';
import { fetchAllStatesDeduped } from './ha-entity-cache';

const RENDER_LIMIT = 200;
const SHOW_STATES_STORAGE_KEY = 'js_entity_picker_show_states';

/**
 * "Insert Entity" modal (Ctrl+E in the editor), RFC Phase A item 6. Ports
 * editor-config.js's openEntityPicker/closeEntityPicker/renderEntityList/
 * filterEntityPicker/insertEntityToEditor as-is (200-row render cap, same
 * behavior), as its own singleton component. Mounted once in index.html.
 */
@customElement('entity-picker-modal')
export class EntityPickerModal extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.85);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(3px);
    }

    .modal {
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 25px;
      width: 520px;
      max-width: calc(100vw - 40px);
      height: 80vh;
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      box-sizing: border-box;
    }

    h3 {
      margin: 0 0 16px 0;
      font-size: 1.1rem;
      color: var(--text-primary);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }

    .search-input {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 10px;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .toggle-states-btn {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 1.2rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .toggle-states-btn:hover {
      color: var(--text-primary);
      background: #333;
    }

    .toggle-states-btn.active {
      color: var(--accent);
      border-color: var(--accent);
    }

    .entity-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
    }

    .entity-row {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      font-family: monospace;
      color: var(--text-secondary);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .entity-row-id {
      word-break: break-all;
    }

    .entity-row-state {
      flex-shrink: 0;
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .entity-row:hover {
      background: var(--accent);
      color: #000;
    }

    .entity-row:hover .entity-row-state {
      color: #000;
      opacity: 0.7;
    }

    .entity-more {
      padding: 10px;
      text-align: center;
      color: var(--text-muted);
    }

    .modal-btns {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 15px;
      margin-top: 20px;
      flex-shrink: 0;
    }

    button {
      cursor: pointer;
      border: none;
      font-family: inherit;
    }

    .btn-text {
      background: transparent;
      color: var(--text-secondary);
      font-size: 0.8rem;
      padding: 10px;
    }

    .btn-text:hover {
      color: var(--text-primary);
    }
  `;

  @state() private _open = false;
  @state() private _filter = '';
  @state() private _showStates = localStorage.getItem(SHOW_STATES_STORAGE_KEY) === 'true';
  /** Built lazily from window.cachedEntities once states are actually needed — null until then
   * (and while show-states is off, stays null so no lookup work happens per row at all). */
  @state() private _entityStates: Map<string, { state: string; unit?: string }> | null = null;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    window.entityPickerModal = { open: this.open, close: this.close };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.entityPickerModal?.open === this.open) delete window.entityPickerModal;
    document.removeEventListener('keydown', this._onKeydown);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('_open') && this._open) {
      this.renderRoot.querySelector<HTMLInputElement>('.search-input')?.focus();
    }
  }

  open = (): void => {
    this._filter = '';
    this._open = true;
    document.addEventListener('keydown', this._onKeydown);
    // Lazy: only fetch if the toggle was already on last time (localStorage) — someone who
    // never uses this never pays for the extra fetch.
    if (this._showStates) this._ensureStatesLoaded();
  };

  close = (): void => {
    this._open = false;
    document.removeEventListener('keydown', this._onKeydown);
    window.monacoEditor?.focus();
  };

  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private _onFilterInput = (e: InputEvent): void => {
    this._filter = (e.target as HTMLInputElement).value;
  };

  private _toggleShowStates = (): void => {
    this._showStates = !this._showStates;
    localStorage.setItem(SHOW_STATES_STORAGE_KEY, String(this._showStates));
    if (this._showStates) this._ensureStatesLoaded();
  };

  /** Same cache-first pattern status-bar.ts/status-bar-header-actions.ts already use — checks
   * window.cachedEntities before calling fetchAllStatesDeduped(), so this rides for free
   * whenever anything else (status bar slots, header actions) already warmed the cache. */
  private async _ensureStatesLoaded(): Promise<void> {
    if (this._entityStates) return;
    let all = window.cachedEntities;
    if (!all || all.length === 0) {
      try {
        all = await fetchAllStatesDeduped();
      } catch {
        return;
      }
    }
    const map = new Map<string, { state: string; unit?: string }>();
    for (const s of all) {
      map.set(s.entity_id, { state: s.state, unit: s.attributes?.unit_of_measurement });
    }
    this._entityStates = map;
  }

  private _insert(entityId: string): void {
    window.monacoEditor?.insertTextAtCursor(entityId);
    this.close();
  }

  private _stateLabel(entityId: string): string | null {
    const entry = this._entityStates?.get(entityId);
    if (!entry) return null;
    return entry.unit ? `${entry.state} ${entry.unit}` : entry.state;
  }

  render() {
    if (!this._open) return html``;
    const term = this._filter.toLowerCase();
    const all = window.allEntities ?? [];
    const filtered = term ? all.filter((id) => id.toLowerCase().includes(term)) : all;
    const visible = filtered.slice(0, RENDER_LIMIT);

    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => this.close()}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${this._t('modal_insert_entity_title', 'Entity einfügen')}</h3>
          <div class="search-row">
            <input
              class="search-input"
              type="text"
              placeholder=${this._t('entity_search_placeholder', 'Entity suchen...')}
              autocomplete="off"
              .value=${this._filter}
              @input=${this._onFilterInput}
            />
            <button
              class="toggle-states-btn ${this._showStates ? 'active' : ''}"
              title=${this._t('entity_picker_show_states_title', 'Show current states')}
              @click=${this._toggleShowStates}
            >
              <i class="mdi ${this._showStates ? 'mdi-eye' : 'mdi-eye-outline'}"></i>
            </button>
          </div>
          <div class="entity-list">
            ${repeat(
              visible,
              (id) => id,
              (id) => {
                const stateLabel = this._showStates ? this._stateLabel(id) : null;
                return html`
                  <div class="entity-row" @click=${() => this._insert(id)}>
                    <span class="entity-row-id">${id}</span>
                    ${stateLabel ? html`<span class="entity-row-state">${stateLabel}</span>` : nothing}
                  </div>
                `;
              }
            )}
            ${
              filtered.length > RENDER_LIMIT
                ? html`<div class="entity-more">... ${filtered.length - RENDER_LIMIT} more</div>`
                : ''
            }
          </div>
          <div class="modal-btns">
            <button class="btn-text" @click=${() => this.close()}>${this._t('button_cancel', 'CANCEL')}</button>
          </div>
        </div>
      </div>
    `;
  }
}
