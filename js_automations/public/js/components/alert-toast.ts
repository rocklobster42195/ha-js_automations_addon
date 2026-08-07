import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

export type AlertToastVariant = 'error' | 'info' | 'success' | 'warning';

export interface AlertToastOptions {
  variant?: AlertToastVariant;
  /** Ignored for the 'error' variant, which is always manual-dismiss only. */
  duration?: number;
}

const VARIANT_ICON: Record<AlertToastVariant, string> = {
  error: 'mdi-alert-circle',
  warning: 'mdi-alert',
  success: 'mdi-check-circle',
  info: 'mdi-information',
};

const VARIANT_COLOR_VAR: Record<AlertToastVariant, string> = {
  error: '--danger',
  warning: '--warning',
  success: '--success',
  info: '--accent',
};

const DEFAULT_AUTO_DISMISS_MS = 5500;

/**
 * Singleton toast replacing native window.alert() app-wide (RFC Phase A item
 * 6). Single-slot — a new show() replaces whatever's currently showing, no
 * queue — every current call site is a synchronous, non-concurrent error
 * path. Mounted once in index.html.
 */
@customElement('alert-toast')
export class AlertToast extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      max-width: 380px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent-color);
      border-radius: 8px;
      padding: 14px 12px 14px 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    }

    .toast-icon {
      font-size: 1.3rem;
      color: var(--accent-color);
      flex-shrink: 0;
      margin-top: 1px;
    }

    .toast-message {
      flex: 1;
      color: var(--text-primary);
      font-size: 0.88rem;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .toast-close {
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 1.1rem;
      flex-shrink: 0;
      line-height: 1;
    }

    .toast-close:hover {
      color: var(--text-primary);
    }
  `;

  @state() private _open = false;
  @state() private _message = '';
  @state() private _variant: AlertToastVariant = 'error';
  private _timer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.alertToast = { show: this.show };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.alertToast?.show === this.show) delete window.alertToast;
    if (this._timer) clearTimeout(this._timer);
  }

  show = (message: string, opts: AlertToastOptions = {}): void => {
    if (this._timer) clearTimeout(this._timer);
    this._message = message;
    this._variant = opts.variant ?? 'error';
    this._open = true;
    if (this._variant !== 'error') {
      this._timer = setTimeout(() => this._close(), opts.duration ?? DEFAULT_AUTO_DISMISS_MS);
    }
  };

  private _close(): void {
    this._open = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  render() {
    if (!this._open) return html``;
    const colorVar = `var(${VARIANT_COLOR_VAR[this._variant]})`;
    return html`
      ${mdiStylesheetLink}
      <div class="toast" style="--accent-color: ${colorVar}" role="alert">
        <i class="mdi ${VARIANT_ICON[this._variant]} toast-icon"></i>
        <div class="toast-message">${this._message}</div>
        <i class="mdi mdi-close toast-close" @click=${() => this._close()}></i>
      </div>
    `;
  }
}
