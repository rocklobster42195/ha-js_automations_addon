import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

export interface ConfirmDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Singleton modal replacing native window.confirm() app-wide. A blocking
 * confirm() can't be driven from async Lit code the way the 9 call sites
 * need, so this exposes a Promise-based window.confirmDialog.confirm()
 * bridge instead (RFC Phase A item 6). Mounted once in index.html.
 */
@customElement('confirm-dialog')
export class ConfirmDialog extends LitElement {
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
      width: 420px;
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
    }

    p {
      margin: 0;
      color: var(--text-primary);
      font-size: 0.9rem;
      line-height: 1.5;
      white-space: pre-wrap;
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

    .btn-primary.danger {
      background: var(--danger);
      color: #fff;
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
  @state() private _opts: ConfirmDialogOptions = {};
  private _resolve: ((value: boolean) => void) | null = null;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    window.confirmDialog = { confirm: this.confirm };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.confirmDialog?.confirm === this.confirm) delete window.confirmDialog;
    document.removeEventListener('keydown', this._onKeydown);
  }

  confirm = (message: string, opts: ConfirmDialogOptions = {}): Promise<boolean> => {
    // A stale pending prompt (shouldn't happen — every call site is a single
    // user-click flow) resolves false rather than queuing, so nothing gets stuck.
    this._finish(false);
    this._message = message;
    this._opts = opts;
    this._open = true;
    document.addEventListener('keydown', this._onKeydown);
    return new Promise<boolean>((resolve) => {
      this._resolve = resolve;
    });
  };

  private _finish(result: boolean): void {
    if (!this._open && !this._resolve) return;
    this._open = false;
    document.removeEventListener('keydown', this._onKeydown);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(result);
  }

  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._finish(false);
  };

  render() {
    if (!this._open) return html``;
    const { title, confirmLabel, cancelLabel, danger } = this._opts;
    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => this._finish(false)}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          ${title ? html`<h3>${title}</h3>` : ''}
          <p>${this._message}</p>
          <div class="modal-btns">
            <button class="btn-text" @click=${() => this._finish(false)}>
              ${cancelLabel ?? this._t('button_cancel', 'CANCEL')}
            </button>
            <button class="btn-primary ${danger ? 'danger' : ''}" @click=${() => this._finish(true)}>
              ${confirmLabel ?? this._t('button_confirm', 'OK')}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
