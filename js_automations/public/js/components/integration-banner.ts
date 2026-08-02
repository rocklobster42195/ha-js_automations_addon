import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { JsaIntegrationStatus } from './global';
import { mdiStylesheetLink } from './mdi';

// Banner is only shown after MQTT has been disconnected for this long —
// prevents flashing during startup / brief reconnects.
const MQTT_ERROR_DELAY_MS = 6000;
const DISMISSED_KEY = 'js_automations_banner_dismissed';

type BannerType = 'mqtt_disabled' | 'mqtt_error' | null;

/**
 * Integration status banner (MQTT disabled / disconnected). Always mounted
 * (see index.html); renders nothing until handleIntegrationStatus() sees a
 * reason to show one.
 *
 * Exposes window.handleIntegrationStatus / window.hideIntegrationBanner as
 * before — app.js, settings.js, and socket-client.js call these directly and
 * haven't been migrated yet.
 */
@customElement('integration-banner')
export class IntegrationBanner extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .banner {
      background: linear-gradient(90deg, #f57c00 0%, #ef6c00 100%);
      color: white;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      position: relative;
      padding-right: 50px;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue',
        sans-serif;
      cursor: pointer;
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
      color: #f57c00;
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

    .close {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      opacity: 0.7;
      padding: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
    }

    .close:hover {
      opacity: 1;
    }
  `;

  @state() private _type: BannerType = null;
  private _mqttErrorTimer: ReturnType<typeof setTimeout> | null = null;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();
    window.handleIntegrationStatus = this._handleStatus;
    window.hideIntegrationBanner = this._hide;
    this._waitForSocket();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.handleIntegrationStatus === this._handleStatus) delete window.handleIntegrationStatus;
    if (window.hideIntegrationBanner === this._hide) delete window.hideIntegrationBanner;
    if (this._mqttErrorTimer) clearTimeout(this._mqttErrorTimer);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    // No separate 'connect' handler here on purpose: socket-client.js's
    // handleConnectionEstablished() already calls requestIntegrationStatus()
    // on every (re)connect, which calls window.handleIntegrationStatus() with
    // the result — registering our own would just duplicate that round-trip.
    window.socket.on('integration_status', (status: JsaIntegrationStatus) => this._handleStatus(status));
  };

  private _hide = (): void => {
    this._type = null;
  };

  private _handleStatus = (status: JsaIntegrationStatus | null): void => {
    if (!status || typeof status !== 'object') return;
    // A full status object MUST have the 'installed' property — a bare
    // connection update isn't enough to decide anything here.
    if (!('installed' in status)) return;
    if (sessionStorage.getItem(DISMISSED_KEY) === 'true') return;

    const mqttStatus = status.mqtt || { enabled: false, connected: false };
    let type: BannerType = null;

    // Priority 1: MQTT enabled but not connected.
    if (mqttStatus.enabled && !mqttStatus.connected) {
      type = 'mqtt_error';
    }
    // Priority 2: MQTT disabled — only warn if scripts actually use @expose.
    else if (!mqttStatus.enabled) {
      const hasExposedScripts = Array.isArray(window.allScripts) && window.allScripts.some((s) => s.expose);
      if (hasExposedScripts) type = 'mqtt_disabled';
    }

    if (type === 'mqtt_error') {
      // Debounce: only show if MQTT is still disconnected after the delay —
      // avoids flashing during server startup or brief reconnects.
      if (!this._mqttErrorTimer) {
        this._mqttErrorTimer = setTimeout(() => {
          this._mqttErrorTimer = null;
          const cur = window.currentIntegrationStatus?.mqtt;
          if (cur && cur.enabled && !cur.connected) {
            this._type = 'mqtt_error';
          }
        }, MQTT_ERROR_DELAY_MS);
      }
    } else {
      if (this._mqttErrorTimer) {
        clearTimeout(this._mqttErrorTimer);
        this._mqttErrorTimer = null;
      }
      this._type = type;
    }
  };

  private _dismiss = (e: Event): void => {
    e.stopPropagation();
    sessionStorage.setItem(DISMISSED_KEY, 'true');
    this._hide();
  };

  private _openSettings = (target: string): void => {
    window.openSettingsTab?.(target);
  };

  render() {
    if (!this._type) return html``;

    const isDisabled = this._type === 'mqtt_disabled';
    const title = isDisabled
      ? this._t('settings.system.mqtt_banner_disabled_title', 'MQTT disabled')
      : this._t('settings.system.mqtt_banner_disconnected_title', 'MQTT Disconnected');
    const desc = isDisabled
      ? this._t('settings.system.mqtt_banner_disabled_desc', 'Enable MQTT to expose scripts to Home Assistant.')
      : this._t('settings.system.mqtt_banner_disconnected_desc', 'Connection to broker lost.');
    const icon = isDisabled ? 'mdi-transmission-tower-off' : 'mdi-alert-circle-outline';
    const btnText = this._t('settings.system.mqtt_configure_btn', 'Configure MQTT');

    return html`
      ${mdiStylesheetLink}
      <div class="banner" @click=${() => this._openSettings('mqtt')}>
        <div class="content">
          <i class="mdi ${icon} icon"></i>
          <div>
            <div class="title">${title}</div>
            <div class="desc">${desc}</div>
          </div>
          <button
            class="btn"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._openSettings(this._type?.startsWith('mqtt') ? 'mqtt' : 'installer');
            }}
          >
            <i class="mdi mdi-cog"></i> ${btnText}
          </button>
        </div>
        <button class="close" title=${this._t('banner_close_tooltip', 'Close')} @click=${this._dismiss}>
          <i class="mdi mdi-close"></i>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'integration-banner': IntegrationBanner;
  }
}
