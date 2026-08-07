import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { mdiStylesheetLink } from './mdi';

const RENDER_LIMIT = 200;

/**
 * Minimal structural shape of the still-vanilla Monaco `editor` global
 * (tab-manager.js, Phase B) — avoids importing the full Monaco types just to
 * insert text at the cursor. Reverse-direction coupling (a migrated
 * component reaching into not-yet-migrated code) is the same accepted
 * pattern already used elsewhere (e.g. tab-manager.js reaching into
 * <app-sidebar>), just flipped.
 */
interface MinimalMonacoEditor {
  getSelection(): unknown;
  executeEdits(id: string, edits: { range: unknown; text: string; forceMoveMarkers: boolean }[]): void;
  focus(): void;
}

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
      margin-bottom: 10px;
      flex-shrink: 0;
    }

    .search-input:focus {
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
      word-break: break-all;
    }

    .entity-row:hover {
      background: var(--accent);
      color: #000;
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

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  private get _editor(): MinimalMonacoEditor | undefined {
    return (window as unknown as { editor?: MinimalMonacoEditor }).editor;
  }

  connectedCallback() {
    super.connectedCallback();
    window.entityPickerModal = { open: this.open, close: this.close };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.entityPickerModal?.open === this.open) delete window.entityPickerModal;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('_open') && this._open) {
      this.renderRoot.querySelector<HTMLInputElement>('.search-input')?.focus();
    }
  }

  open = (): void => {
    this._filter = '';
    this._open = true;
  };

  close = (): void => {
    this._open = false;
    this._editor?.focus();
  };

  private _onFilterInput = (e: InputEvent): void => {
    this._filter = (e.target as HTMLInputElement).value;
  };

  private _insert(entityId: string): void {
    const editor = this._editor;
    if (editor) {
      const selection = editor.getSelection();
      editor.executeEdits('insert-entity', [{ range: selection, text: entityId, forceMoveMarkers: true }]);
    }
    this.close();
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
          <input
            class="search-input"
            type="text"
            placeholder=${this._t('entity_search_placeholder', 'Entity suchen...')}
            autocomplete="off"
            .value=${this._filter}
            @input=${this._onFilterInput}
          />
          <div class="entity-list">
            ${repeat(
              visible,
              (id) => id,
              (id) => html`<div class="entity-row" @click=${() => this._insert(id)}>${id}</div>`
            )}
            ${filtered.length > RENDER_LIMIT
              ? html`<div class="entity-more">... ${filtered.length - RENDER_LIMIT} more</div>`
              : ''}
          </div>
          <div class="modal-btns">
            <button class="btn-text" @click=${() => this.close()}>${this._t('button_cancel', 'CANCEL')}</button>
          </div>
        </div>
      </div>
    `;
  }
}
