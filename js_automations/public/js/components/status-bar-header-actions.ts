import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { JsaSettings, JsaHaState } from './global';
import { mdiStylesheetLink } from './mdi';
import { fetchAllStatesDeduped } from './ha-entity-cache';

interface ActionButton {
  entityId: string;
  iconName: string;
  color: string;
  title: string;
}

/**
 * Header entity-action buttons (up to 3 HA entities configured in Settings →
 * Status Bar), sitting in the sidebar header next to the static buttons.
 * Same settings source as <status-bar> (settings.statusbar.header_action_1/2/3)
 * but a physically separate part of the page, so it's its own component
 * rather than a second root rendered by <status-bar> itself.
 */
@customElement('status-bar-header-actions')
export class StatusBarHeaderActions extends LitElement {
  static styles = css`
    :host {
      display: flex;
      gap: 2px;
      margin-left: auto;
    }

    button {
      background: none;
      border: none;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
      transition:
        background 0.15s,
        opacity 0.15s;
      padding: 0;
    }

    button:hover {
      background: #252525;
    }

    button:active {
      opacity: 0.7;
    }
  `;

  @state() private _buttons: (ActionButton | null)[] = [null, null, null];

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('settings-changed', this._onSettingsChanged);
    this._waitForSocket();
    if (window.currentSettings) this._applySettings(window.currentSettings);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('settings-changed', this._onSettingsChanged);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    window.socket.on('ha_state_changed', (data: { entity_id: string; new_state: JsaHaState | null }) => {
      this._updateButton(data.entity_id, data.new_state);
    });
  };

  private _onSettingsChanged = (e: Event): void => {
    this._applySettings((e as CustomEvent<JsaSettings>).detail);
  };

  private async _applySettings(settings: JsaSettings | null | undefined): Promise<void> {
    const conf = settings?.statusbar;
    const entityIds = [conf?.header_action_1, conf?.header_action_2, conf?.header_action_3].map((id) =>
      (id || '').trim().toLowerCase()
    );

    this._buttons = entityIds.map((id) => (id ? { entityId: id, iconName: 'flash', color: '', title: id } : null));

    const anyConfigured = entityIds.some(Boolean);
    if (!anyConfigured) return;

    let all = window.cachedEntities;
    if (!all || all.length === 0) {
      all = await fetchAllStatesDeduped();
    }
    entityIds.forEach((id, i) => {
      if (!id) return;
      const state = all?.find((s) => s.entity_id === id) ?? null;
      this._updateButton(id, state);
    });
  }

  private _updateButton(entityId: string, state: JsaHaState | null): void {
    const idx = this._buttons.findIndex((b) => b?.entityId === entityId);
    if (idx === -1) return;

    const domain = entityId.split('.')[0];
    const isOn = state?.state === 'on';
    const isButton = domain === 'button' || domain === 'input_button';

    let iconName = 'flash';
    if (state?.attributes?.icon) {
      iconName = state.attributes.icon.replace('mdi:', '');
    } else if (domain === 'switch') {
      iconName = isOn ? 'toggle-switch' : 'toggle-switch-off';
    } else if (isButton) {
      iconName = 'gesture-tap-button';
    }

    const color = this._entityColor(state, isButton || isOn);
    const friendly = state?.attributes?.friendly_name || entityId;

    const next = [...this._buttons];
    next[idx] = { entityId, iconName, color, title: `${friendly}\n(${entityId})` };
    this._buttons = next;
  }

  private _entityColor(state: JsaHaState | null, isActive: boolean): string {
    if (!isActive) return 'var(--secondary-text-color, #777)';
    const a = state?.attributes || {};
    if (a.rgb_color) return `rgb(${a.rgb_color.join(',')})`;
    if (a.icon_color) return String(a.icon_color);
    return 'var(--primary-color, #03a9f4)';
  }

  private _trigger = async (btn: ActionButton): Promise<void> => {
    const domain = btn.entityId.split('.')[0];
    const isButton = domain === 'button' || domain === 'input_button';

    let service: string;
    if (isButton) {
      service = 'press';
    } else if (domain === 'switch') {
      const cached = window.cachedEntities?.find((e) => e.entity_id === btn.entityId);
      service = cached?.state === 'on' ? 'turn_off' : 'turn_on';
      // Optimistic color flip while the service call is in flight.
      const idx = this._buttons.findIndex((b) => b?.entityId === btn.entityId);
      if (idx !== -1) {
        const next = [...this._buttons];
        next[idx] = {
          ...btn,
          color: cached?.state === 'on' ? 'var(--secondary-text-color, #777)' : 'var(--primary-color, #03a9f4)',
        };
        this._buttons = next;
      }
    } else {
      service = 'press';
    }

    try {
      await window.apiFetch!('api/ha/call-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, service, entity_id: btn.entityId }),
      });
    } catch (e) {
      console.error('[Header Action] Service call failed:', e);
    }
  };

  render() {
    return html`
      ${mdiStylesheetLink}
      ${this._buttons.map((btn) =>
        btn
          ? html`
              <button title=${btn.title} @click=${() => this._trigger(btn)}>
                <i class="mdi mdi-${btn.iconName}" style="color: ${btn.color}"></i>
              </button>
            `
          : ''
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'status-bar-header-actions': StatusBarHeaderActions;
  }
}
