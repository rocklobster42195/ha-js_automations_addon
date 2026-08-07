import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

/**
 * Bootloop-protection banner. Always mounted (see index.html); renders
 * nothing until the backend reports Safe Mode is active.
 */
@customElement('safe-mode-banner')
export class SafeModeBanner extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .banner {
      background: linear-gradient(90deg, #d32f2f 0%, #c62828 100%);
      color: white;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue',
        sans-serif;
    }

    .content {
      display: flex;
      align-items: center;
      gap: 15px;
      max-width: 1200px;
      width: 100%;
    }

    .icon {
      font-size: 24px;
    }

    .title {
      font-weight: bold;
      font-size: 14px;
    }

    .desc {
      font-size: 13px;
      opacity: 0.9;
    }

    .btn {
      margin-left: auto;
      font-weight: bold;
      border: none;
      background: #ffffff;
      color: #d32f2f;
      padding: 0 16px;
      height: 32px;
      line-height: 32px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .btn:disabled {
      opacity: 0.7;
      cursor: default;
    }

    @media (max-width: 768px) {
      .content {
        flex-wrap: wrap;
      }
      .title,
      .desc {
        overflow-wrap: break-word;
      }
      .btn {
        margin-left: 0;
        width: 100%;
        justify-content: center;
      }
    }
  `;

  @state() private _active = false;
  @state() private _resolving = false;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    this._waitForSocket();
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }

    window.socket.on('safe_mode', (isActive: boolean) => {
      this._active = !!isActive;
    });

    // The 'safe_mode' event above only fires once, at the exact moment Safe
    // Mode is detected during boot — a client connecting/reloading afterwards
    // would never see it. Query the current status explicitly on every
    // (re)connect as a fallback.
    window.socket.on('connect', () => {
      if (!window.socket?.connected) return;
      window.socket.emit('get_integration_status', (response: { error?: string; safe_mode?: boolean }) => {
        if (response && !response.error) {
          this._active = !!response.safe_mode;
        }
      });
    });
  };

  private _resolve = async (): Promise<void> => {
    this._resolving = true;
    try {
      const res = await window.apiFetch!('api/system/safe-mode/resolve', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this._active = false;
        window.alertToast?.show(
          this._t('safe_mode_deactivated', 'Safe Mode deactivated. You can now start scripts manually.'),
          { variant: 'success' }
        );
      } else {
        this._resolving = false;
      }
    } catch (e) {
      console.error(e);
      window.alertToast?.show(this._t('safe_mode_failed', 'Failed to resolve Safe Mode.'));
      this._resolving = false;
    }
  };

  render() {
    if (!this._active) return html``;
    return html`
      ${mdiStylesheetLink}
      <div class="banner">
        <div class="content">
          <i class="mdi mdi-alert-decagram icon"></i>
          <div>
            <div class="title">${this._t('safe_mode_title', 'SAFE MODE ACTIVE')}</div>
            <div class="desc">${this._t('safe_mode_msg', 'Bootloop detected. Scripts are disabled.')}</div>
          </div>
          <button class="btn" ?disabled=${this._resolving} @click=${this._resolve}>
            <i class="mdi mdi-shield-check"></i> ${this._t('safe_mode_btn', 'Exit Safe Mode')}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'safe-mode-banner': SafeModeBanner;
  }
}
