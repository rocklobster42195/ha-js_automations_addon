import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

/**
 * Singleton commit-message modal, same window-bridge Promise pattern as
 * <confirm-dialog> (window.confirmDialog) — a blocking window.prompt() can't
 * be driven from async Lit code, and this needs a text field confirm-dialog
 * doesn't have. Mounted once in index.html.
 */
@customElement('commit-dialog')
export class CommitDialog extends LitElement {
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
      width: 440px;
      max-width: calc(100vw - 40px);
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
      display: flex;
      align-items: center;
      gap: 10px;
    }

    label {
      display: block;
      font-size: 0.82rem;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    input {
      width: 100%;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 9px 10px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }

    input:focus {
      border-color: var(--accent);
    }

    .hint {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 6px;
      line-height: 1.4;
    }

    .modal-btns {
      display: flex;
      align-items: center;
      justify-content: flex-end;
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
  @state() private _message = '';
  @state() private _autosaveNote = false;
  private _resolve: ((value: string | null) => void) | null = null;

  @query('input') private _input?: HTMLInputElement;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, options) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.commitDialog = { prompt: this.prompt };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.commitDialog?.prompt === this.prompt) delete window.commitDialog;
    document.removeEventListener('keydown', this._onKeydown);
  }

  /** wasDirty: whether the active tab had unsaved changes that get auto-saved before committing
   * — surfaced as a one-line note so the user knows what's about to happen. */
  prompt = (defaultMessage: string, wasDirty = false): Promise<string | null> => {
    this._finish(null);
    this._message = defaultMessage;
    this._autosaveNote = wasDirty;
    this._open = true;
    document.addEventListener('keydown', this._onKeydown);
    queueMicrotask(() => this._input?.select());
    return new Promise<string | null>((resolve) => {
      this._resolve = resolve;
    });
  };

  private _finish(result: string | null): void {
    if (!this._open && !this._resolve) return;
    this._open = false;
    document.removeEventListener('keydown', this._onKeydown);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(result);
  }

  private _confirm(): void {
    this._finish(this._input?.value.trim() || this._message);
  }

  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._finish(null);
    if (e.key === 'Enter') this._confirm();
  };

  render() {
    if (!this._open) return html``;
    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => this._finish(null)}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3><i class="mdi mdi-source-commit"></i> ${this._t('commit_dialog_title', 'Commit')}</h3>
          <label>${this._t('commit_dialog_label', 'Message')}</label>
          <input type="text" .value=${this._message} />
          ${
            this._autosaveNote
              ? html`<div class="hint">${this._t('commit_dialog_autosave_note')}</div>`
              : html`<div class="hint">${this._t('commit_dialog_prefilled_note')}</div>`
          }
          <div class="modal-btns">
            <button class="btn-text" @click=${() => this._finish(null)}>
              ${this._t('button_cancel', 'Cancel')}
            </button>
            <button class="btn-primary" @click=${() => this._confirm()}>
              ${this._t('commit_dialog_confirm', 'Commit')}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
