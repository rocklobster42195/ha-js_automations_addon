import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { mdiStylesheetLink } from './mdi';

type StoreValueType = 'string' | 'number' | 'boolean' | 'json';

/**
 * Store Explorer's create/edit form (RFC Phase A item 6). Fully absorbs
 * store-modal.js's form logic — the tab-lifecycle half of that file
 * (openStoreTab) moved to <store-explorer> as openTab() instead, since it
 * doesn't semantically belong to this component. Mounted once in index.html.
 */
@customElement('store-item-modal')
export class StoreItemModal extends LitElement {
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
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      box-sizing: border-box;
    }

    h3 {
      margin: 0 0 20px 0;
      font-size: 1.1rem;
      color: var(--text-primary);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 140px;
      gap: 15px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 15px;
    }

    .row .form-group {
      margin-top: 0;
    }

    .form-group label {
      font-size: 0.65rem;
      color: var(--text-secondary);
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    input,
    textarea,
    select {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 10px;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      width: 100%;
    }

    input:focus,
    textarea:focus,
    select:focus {
      border-color: var(--accent);
    }

    input.invalid,
    textarea.invalid {
      border-color: var(--danger);
      background-color: rgba(244, 67, 54, 0.1);
    }

    textarea {
      min-height: 42px;
      max-height: 300px;
      resize: vertical;
      line-height: 1.4;
    }

    .icon-input-container {
      display: flex;
      align-items: flex-start;
      gap: 5px;
    }

    .icon-input-container textarea {
      flex: 1;
    }

    .icon-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 10px;
    }

    .icon-col .mdi {
      cursor: pointer;
      opacity: 0.7;
    }

    .icon-col .mdi:hover {
      opacity: 1;
    }

    .secret-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 10px;
      margin-top: 15px;
    }

    .secret-row input[type='checkbox'] {
      width: auto;
    }

    .secret-row label {
      margin: 0;
      cursor: pointer;
      font-size: 0.9rem;
      color: var(--text-primary);
      text-transform: none;
    }

    .form-error-msg {
      color: var(--danger);
      font-size: 0.75rem;
      margin-top: 4px;
      min-height: 1.2em;
    }

    .modal-btns {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-top: 20px;
    }

    button {
      cursor: pointer;
      border: none;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--accent);
      color: #000;
      font-weight: bold;
      padding: 10px 30px;
      border-radius: 6px;
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
  @state() private _mode: 'create' | 'edit' = 'create';
  @state() private _key = '';
  @state() private _value = '';
  @state() private _type: StoreValueType | 'null' = 'string';
  @state() private _isSecret = false;
  @state() private _valueMasked = false;
  @state() private _keyError = '';
  @state() private _valueError = '';

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.storeItemModal = { open: this.open, close: this.close };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.storeItemModal?.open === this.open) delete window.storeItemModal;
  }

  open = (key?: string): void => {
    if (!key) {
      this._show('', '', false, 'string');
      return;
    }
    const item = window.storeExplorer?.getItem(key);
    if (item === undefined) return;
    const val = item && typeof item === 'object' && 'value' in (item as Record<string, unknown>) ? (item as { value: unknown }).value : item;
    const isSecret = (item as { isSecret?: boolean } | undefined)?.isSecret ?? false;

    const valStr = typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : String(val ?? '');

    let type: StoreValueType | 'null' = typeof val as StoreValueType;
    if (val === null) type = 'null';
    else if (Array.isArray(val)) type = 'json';
    else if (typeof val === 'object') type = 'json';

    this._show(key, valStr, isSecret, type);
  };

  close = (): void => {
    this._open = false;
  };

  private _show(key: string, value: string, isSecret: boolean, type: StoreValueType | 'null'): void {
    this._mode = key ? 'edit' : 'create';
    this._key = key;
    this._value = value;
    this._type = type;
    this._isSecret = isSecret;
    this._valueMasked = isSecret;
    this._keyError = '';
    this._valueError = '';
    this._open = true;
  }

  private _validateKey(showEmptyError = false): boolean {
    const key = this._key.trim();

    if (!key) {
      this._keyError = showEmptyError ? this._t('store.messages.key_required') : '';
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(key)) {
      this._keyError = this._t('store.messages.error_invalid_key');
      return false;
    }
    if (this._mode === 'create' && window.storeExplorer?.hasKey(key)) {
      this._keyError = this._t('store.messages.error_duplicate_key');
      return false;
    }
    this._keyError = '';
    return true;
  }

  private _validateValue(): boolean {
    const val = this._value.trim();
    if (this._type === 'json' && val) {
      try {
        JSON.parse(val);
        this._valueError = '';
        return true;
      } catch (e) {
        this._valueError = this._t('store.messages.invalid_json', undefined, {
          error: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    }
    this._valueError = '';
    return true;
  }

  private _onKeyInput(e: InputEvent): void {
    this._key = (e.target as HTMLInputElement).value;
    this._validateKey(false);
  }

  private _onTypeChange(e: Event): void {
    this._type = (e.target as HTMLSelectElement).value as StoreValueType;
    this._validateValue();
  }

  private _onValueInput(e: InputEvent): void {
    this._value = (e.target as HTMLTextAreaElement).value;
    this._validateValue();
  }

  private _onSecretChange(e: Event): void {
    this._isSecret = (e.target as HTMLInputElement).checked;
    this._valueMasked = this._isSecret;
  }

  private _toggleValueVisibility(): void {
    this._valueMasked = !this._valueMasked;
  }

  private _prettify(): void {
    if (this._type !== 'json') return;
    try {
      const obj = JSON.parse(this._value);
      this._value = JSON.stringify(obj, null, 2);
      this._validateValue();
    } catch {
      // validateValue() already surfaces the error; nothing more to do here.
    }
  }

  private _save = async (): Promise<void> => {
    if (!this._validateKey(true) || !this._validateValue()) return;

    const key = this._key.trim();
    const valStr = this._value;
    const selectedType = this._type;
    const isSecret = this._isSecret;
    let value: unknown = valStr;

    try {
      const isTrimmedEmpty = valStr.trim() === '';
      if (selectedType === 'number') {
        if (isTrimmedEmpty) throw new Error(this._t('store.messages.error_number_empty'));
        value = Number(valStr);
        if (Number.isNaN(value)) throw new Error(this._t('store.messages.error_invalid_number'));
      } else if (selectedType === 'boolean') {
        value = valStr.toLowerCase() === 'true' || valStr === '1';
      } else if (selectedType === 'json') {
        const trimmedVal = valStr.trim();
        if (trimmedVal.startsWith('{') || trimmedVal.startsWith('[')) {
          value = JSON.parse(trimmedVal);
        } else {
          throw new Error(this._t('store.messages.error_invalid_json_start'));
        }
      }
    } catch (e) {
      window.alertToast?.show(
        this._t('store.messages.invalid_json', undefined, { error: e instanceof Error ? e.message : String(e) })
      );
      return;
    }

    try {
      await window.apiFetch!('api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, isSecret }),
      });
      this.close();
      // The server echoes this write back via the 'store_changed' socket event, which
      // patches <store-explorer> in place. Only fall back to a full reload if that
      // channel is down.
      window.storeExplorer?.refreshIfSocketDown();
    } catch (e) {
      window.alertToast?.show(
        this._t('store.messages.save_error', undefined, { error: e instanceof Error ? e.message : String(e) })
      );
    }
  };

  render() {
    if (!this._open) return html``;
    const isEdit = this._mode === 'edit';

    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => this.close()}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${isEdit ? this._t('store.modal.title_edit') : this._t('store.modal.title_new')}</h3>
          <div class="row">
            <div class="form-group">
              <label>${this._t('store.modal.label_key')}</label>
              <input
                type="text"
                class=${this._keyError ? 'invalid' : ''}
                placeholder=${this._t('store.modal.placeholder_key')}
                .value=${this._key}
                ?disabled=${isEdit}
                @input=${(e: InputEvent) => this._onKeyInput(e)}
              />
              <div class="form-error-msg">${this._keyError}</div>
            </div>
            <div class="form-group">
              <label>${this._t('store.modal.label_type')}</label>
              <select .value=${this._type} @change=${(e: Event) => this._onTypeChange(e)}>
                <option value="string">${this._t('store.types.string', 'String')}</option>
                <option value="number">${this._t('store.types.number', 'Number')}</option>
                <option value="boolean">${this._t('store.types.boolean', 'Boolean')}</option>
                <option value="json">${this._t('store.types.object', 'JSON / Object')}</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>${this._t('store.modal.label_value')}</label>
            <div class="icon-input-container">
              <textarea
                class=${this._valueError ? 'invalid' : ''}
                placeholder=${this._t('store.modal.placeholder_value')}
                style=${styleMap({ '-webkit-text-security': this._valueMasked ? 'disc' : 'none' })}
                .value=${this._value}
                @input=${(e: InputEvent) => this._onValueInput(e)}
              ></textarea>
              <div class="icon-col">
                ${this._type === 'json'
                  ? html`<i
                      class="mdi mdi-format-indent-increase"
                      title=${this._t('store.actions.prettify')}
                      @click=${() => this._prettify()}
                    ></i>`
                  : nothing}
                <i
                  class="mdi ${this._valueMasked ? 'mdi-eye' : 'mdi-eye-off'}"
                  @click=${() => this._toggleValueVisibility()}
                ></i>
              </div>
            </div>
            <div class="form-error-msg">${this._valueError}</div>
          </div>
          <div class="secret-row">
            <input
              type="checkbox"
              id="store-secret-check"
              .checked=${this._isSecret}
              @change=${(e: Event) => this._onSecretChange(e)}
            />
            <label for="store-secret-check">${this._t('store.modal.label_secret')}</label>
          </div>
          <div class="modal-btns">
            <button class="btn-primary" @click=${() => this._save()}>${this._t('store.btn_save', 'SAVE')}</button>
            <button class="btn-text" @click=${() => this.close()}>${this._t('store.btn_cancel', 'CANCEL')}</button>
          </div>
        </div>
      </div>
    `;
  }
}
