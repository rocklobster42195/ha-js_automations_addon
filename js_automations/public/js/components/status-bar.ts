import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { JsaSettings, JsaStatusBarBridge } from './global';
import { mdiStylesheetLink } from './mdi';
import { fetchAllStatesDeduped } from './ha-entity-cache';

type SlotType = 'none' | 'cpu' | 'ram' | 'custom';

interface SlotConfig {
  type: SlotType;
  customEntity: string;
  showSparkline: boolean;
}

interface SlotRuntime {
  valueText: string;
  valueColor: string;
  iconName: string;
  title: string;
  history: (number | null)[];
  entityId: string | null;
  /** Last numeric value for a 'custom' slot, sampled into history on each system_stats tick. */
  lastNumeric: number | null;
}

const DEFAULT_SLOT: SlotConfig = { type: 'none', customEntity: '', showSparkline: true };

function freshRuntime(): SlotRuntime {
  return {
    valueText: '',
    valueColor: '',
    iconName: 'bookmark',
    title: '',
    history: new Array(10).fill(null),
    entityId: null,
    lastNumeric: null,
  };
}

/**
 * Sidebar footer: HA heartbeat, MQTT status, and up to 3 configurable
 * stat slots (CPU / RAM / a watched entity) with sparklines.
 *
 * Absorbs the heartbeat-icon logic that used to live in socket-client.js's
 * updateConnectionUI() — it reached into #heartbeat-icon by ID, which no
 * longer works once the icon lives in this component's shadow root.
 * socket-client.js now calls window.statusBar.setConnected()/isDisconnected()
 * instead. window.statusBar.updateMqttIndicator() stays for app.js and
 * socket-client.js's other call sites.
 *
 * Also drops the old injectSidebarFooter()/injectStyles() dance from
 * socket-client.js/statusbar.js: injectSidebarFooter() created a second,
 * always-empty `#sidebar-footer` div (a stray leftover from an earlier
 * refactor) purely so a `.sidebar-footer:empty { display: none }` rule could
 * hide it again — this component is the one real footer now, no workaround
 * needed.
 */
@customElement('status-bar')
export class StatusBar extends LitElement {
  static styles = css`
    :host {
      height: 30px;
      background: #0e0e0e;
      color: #fff;
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 12px;
      font-family: 'Segoe UI', sans-serif;
      -webkit-user-select: none;
      user-select: none;
      justify-content: space-between;
      border-top: 1px solid #333;
      flex-shrink: 0;
      box-sizing: border-box;
    }

    /* Mobile View (RFC §7): <app-sidebar> collapses to just its header for any
       non-dashboard screen, so this — normally just the last flex child in its
       column — would otherwise render right below the header instead of at
       the actual bottom of the viewport (main-content sits after it in the
       DOM, not before). Pinning it to the viewport bottom sidesteps that
       structural ordering problem outright, same pattern as any mobile app's
       bottom status/nav bar. app-sidebar reserves matching bottom space in
       whatever's now the visible content so nothing renders underneath it. */
    :host([mobile]) {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      /* The reserved padding-bottom gap in whatever's showing above it already
         visually separates content from the bar — the base border-top on top
         of that reads as a double line on mobile specifically. */
      border-top: none;
      box-shadow: 0 -1px 4px rgba(0, 0, 0, 0.4);
    }

    .status-left {
      display: flex;
      flex-direction: row;
      gap: 10px;
      align-items: center;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: help;
    }

    .stat-item i {
      font-size: 0.85rem;
    }

    #integration-status-item {
      cursor: pointer;
    }

    .integration-icon,
    .heartbeat-icon {
      font-size: 0.9rem;
      color: #999;
    }

    .status-slots {
      display: flex;
      gap: 10px;
      margin-left: auto;
      align-items: center;
      justify-content: flex-end;
      flex: 1;
      min-width: 0;
    }

    .status-slots.has-three-slots .sb-item {
      min-width: 0;
      font-size: 0.8rem;
    }

    .status-slots.hide-sparklines canvas {
      display: none !important;
    }

    .sb-item {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: default;
    }

    .sb-item i {
      font-size: 14px;
    }

    .sb-item .val {
      /* pre, not nowrap: CPU/RAM already pad their text with leading spaces
         (padStart) to reserve a fixed width so the icon doesn't jump around
         as digit count changes — but plain HTML whitespace-collapsing eats
         those spaces unless whitespace is preserved. nowrap alone only stops
         wrapping, it doesn't preserve the spaces. */
      white-space: pre;
    }
  `;

  @property({ type: Boolean, reflect: true }) mobile = false;

  @state() private _connected = true;
  @state() private _connectionLost = false;
  @state() private _mqttEnabled = false;
  @state() private _mqttConnected = false;
  @state() private _mqttError = '';
  @state() private _slots: [SlotConfig, SlotConfig, SlotConfig] = [
    { ...DEFAULT_SLOT },
    { ...DEFAULT_SLOT },
    { ...DEFAULT_SLOT },
  ];
  @state() private _runtime: [SlotRuntime, SlotRuntime, SlotRuntime] = [freshRuntime(), freshRuntime(), freshRuntime()];
  @state() private _hideSparklinesWhenDense = true;

  private _ramTrendHistory: number[] = [];

  @query('#canvas-0') private _canvas0?: HTMLCanvasElement;
  @query('#canvas-1') private _canvas1?: HTMLCanvasElement;
  @query('#canvas-2') private _canvas2?: HTMLCanvasElement;

  private _t(key: string, fallback: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, options) ?? fallback;
  }

  connectedCallback() {
    super.connectedCallback();

    const bridge: JsaStatusBarBridge = {
      init: () => {},
      updateMqttIndicator: (status) => this._updateMqttIndicator(status),
      setConnected: (isConnected) => {
        this._connected = isConnected;
        if (isConnected) this._connectionLost = false;
      },
      isDisconnected: () => !this._connected,
      showConnectionLost: () => {
        this._connectionLost = true;
      },
    };
    window.statusBar = bridge;

    window.addEventListener('settings-changed', this._onSettingsChanged);
    this._waitForSocket();

    if (window.currentSettings) this._applySettings(window.currentSettings);

    // Re-apply the last known MQTT status on (re)connect instead of sitting on the
    // `false` default until the next mqtt_status_changed push — covers both the initial
    // mount and any future remount, not just a specific screen.
    const mqtt = window.currentIntegrationStatus?.mqtt;
    if (mqtt) this._updateMqttIndicator(mqtt);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    window.socket.on('mqtt_status_changed', (status: { connected: boolean; error?: string }) =>
      this._updateMqttIndicator(status)
    );
    window.socket.on('system_stats', (data: Record<string, number>) => this._updateSystemStats(data));
    window.socket.on(
      'ha_state_changed',
      (data: { entity_id: string; new_state: import('./global').JsaHaState | null }) => {
        if (window.cachedEntities) {
          const idx = window.cachedEntities.findIndex((e) => e.entity_id === data.entity_id);
          if (data.new_state) {
            if (idx >= 0) window.cachedEntities[idx] = data.new_state;
            else window.cachedEntities.push(data.new_state);
          } else if (idx >= 0) {
            window.cachedEntities.splice(idx, 1);
          }
        }
        this._updateEntityState(data.entity_id, data.new_state);
      }
    );
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('settings-changed', this._onSettingsChanged);
    if (window.statusBar?.setConnected === undefined) return;
  }

  private _onSettingsChanged = (e: Event): void => {
    this._applySettings((e as CustomEvent<JsaSettings>).detail);
    // Re-apply MQTT indicator now that settings are available — integration_status
    // can arrive before currentSettings is set, leaving updateMqttIndicator() to
    // return early with the wrong (disabled) state.
    const mqtt = window.currentIntegrationStatus?.mqtt;
    if (mqtt) this._updateMqttIndicator(mqtt);
  };

  private _applySettings(settings: JsaSettings | null | undefined): void {
    const conf = settings?.statusbar ?? { slot1: 'cpu', slot2: 'ram', slot3: 'none', show_statusbar: true };

    this.style.display = conf.show_statusbar === false ? 'none' : 'flex';

    const slotDefs: [string | undefined, string | undefined, string | undefined] = [conf.slot1, conf.slot2, conf.slot3];
    const customEntities = [conf.customEntitySlot1, conf.customEntitySlot2, conf.customEntitySlot3];
    const showSparklines = [conf.show_sparkline_slot1, conf.show_sparkline_slot2, conf.show_sparkline_slot3];

    this._hideSparklinesWhenDense = conf.hide_sparkline_on_dense !== false;

    this._slots = slotDefs.map((type, i) => {
      const customEntity = (customEntities[i] || '').trim().toLowerCase();
      // 'custom' with no entity configured has nothing to show — treat like 'none'
      // rather than rendering a permanently-empty placeholder slot.
      const resolvedType = (type as SlotType) || 'none';
      return {
        type: resolvedType === 'custom' && !customEntity ? 'none' : resolvedType,
        customEntity,
        showSparkline: showSparklines[i] !== false,
      };
    }) as [SlotConfig, SlotConfig, SlotConfig];

    this._runtime = [freshRuntime(), freshRuntime(), freshRuntime()];
    this._slots.forEach((slot, i) => {
      if (slot.type === 'custom' && slot.customEntity) {
        this._runtime[i] = {
          ...this._runtime[i],
          entityId: slot.customEntity,
          valueText: 'Waiting...',
          title: slot.customEntity,
        };
        this._fetchInitialState(slot.customEntity);
      }
    });
    this._runtime = [...this._runtime] as [SlotRuntime, SlotRuntime, SlotRuntime];
  }

  private _updateMqttIndicator(status: { connected: boolean; error?: string }): void {
    this._connectionLost = false;
    this._mqttEnabled = !!window.currentSettings?.mqtt?.enabled;
    this._mqttConnected = status.connected;
    this._mqttError = status.error || '';
  }

  private _updateSystemStats(data: Record<string, number>): void {
    this._slots.forEach((slot, i) => {
      if (slot.type === 'none') return;
      const rt = { ...this._runtime[i] };
      const hist = [...rt.history];

      if (slot.type === 'cpu') {
        hist.push(data.cpu);
        if (hist.length > 10) hist.shift();
        rt.valueText = `${Math.round(data.cpu).toString().padStart(3, ' ')} %`;
        rt.valueColor = data.cpu >= 90 ? '#ff5555' : data.cpu >= 70 ? '#ffb86c' : '';
        rt.title = `${this._t('settings.statusbar.cpu_usage', 'CPU Usage')}: ${data.cpu}%`;
        rt.iconName = 'chip';
      } else if (slot.type === 'ram') {
        hist.push(data.app_ram);
        if (hist.length > 10) hist.shift();
        this._ramTrendHistory.push(data.app_ram);
        if (this._ramTrendHistory.length > 30) this._ramTrendHistory.shift();

        rt.valueText = `${Math.round(data.app_ram).toString().padStart(4, ' ')} MB`;
        const pct = data.ram_used_pct || 0;
        const pressureLevel = data.container_mem_limit ? (pct >= 90 ? 2 : pct >= 80 ? 1 : 0) : 0;
        const trendLevel = this._detectRamTrend(this._ramTrendHistory);
        const level = Math.max(pressureLevel, trendLevel);
        rt.valueColor = level >= 2 ? '#ff5555' : level >= 1 ? '#ffb86c' : '';
        rt.iconName = 'memory';

        const sysUsed = data.ram_used > 1024 ? (data.ram_used / 1024).toFixed(1) + ' GB' : data.ram_used + ' MB';
        const sysTotal = data.ram_total > 1024 ? (data.ram_total / 1024).toFixed(1) + ' GB' : data.ram_total + ' MB';
        let title = `${this._t('settings.statusbar.tooltip_heap', 'Heap: {{value}} MB', { value: data.app_heap })}\n`;
        title += `${this._t('settings.statusbar.tooltip_rss', 'RSS: {{value}} MB', { value: data.app_ram })}\n`;
        title += this._t('settings.statusbar.tooltip_system', 'System: {{used}} / {{total}} ({{pct}}%)', {
          used: sysUsed,
          total: sysTotal,
          pct,
        });
        title += `\n${this._t('settings.statusbar.tooltip_scripts', 'Scripts: {{count}}', { count: data.worker_count ?? 0 })}`;
        if (data.container_mem_limit) {
          title += `\n${this._t('settings.statusbar.tooltip_limit', 'Limit: {{value}} MB', { value: data.container_mem_limit })}`;
        }
        if (trendLevel > 0)
          title += `\n${this._t('settings.statusbar.tooltip_leak_warning', 'Sustained growth detected.')}`;
        else if (pressureLevel > 0)
          title += `\n${this._t('settings.statusbar.tooltip_pressure_warning', 'High memory pressure.')}`;
        rt.title = title;
      } else if (slot.type === 'custom') {
        if (rt.lastNumeric !== null) {
          hist.push(rt.lastNumeric);
          if (hist.length > 10) hist.shift();
        }
      }

      rt.history = hist;
      this._runtime[i] = rt;
    });
    this._runtime = [...this._runtime] as [SlotRuntime, SlotRuntime, SlotRuntime];
  }

  private _detectRamTrend(samples: number[]): number {
    const valid = samples.filter((v) => v !== null && !isNaN(v));
    if (valid.length < 15) return 0;
    const mid = Math.floor(valid.length / 2);
    const firstHalfAvg = valid.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalfAvg = valid.slice(mid).reduce((a, b) => a + b, 0) / (valid.length - mid);
    const delta = secondHalfAvg - firstHalfAvg;
    if (delta < 40) return 0;
    return delta >= 100 ? 2 : 1;
  }

  private _updateEntityState(entityId: string, newState: import('./global').JsaHaState | null): void {
    this._slots.forEach((slot, i) => {
      if (slot.type !== 'custom' || slot.customEntity !== entityId) return;
      const rt: SlotRuntime = { ...this._runtime[i] };

      let val: string | null = newState ? newState.state : null;
      let unit = '';
      if (!val || val === 'unavailable' || val === 'unknown') {
        val = '--';
      } else if (newState?.attributes.unit_of_measurement) {
        unit = ` ${newState.attributes.unit_of_measurement}`;
      }
      rt.valueText = `${val}${unit}`;

      const numVal = parseFloat(val);
      rt.lastNumeric = !isNaN(numVal) ? numVal : null;

      let iconName = 'bookmark';
      if (newState) {
        if (newState.attributes.icon) {
          iconName = newState.attributes.icon.replace('mdi:', '');
        } else {
          const domain = entityId.split('.')[0];
          const state = newState.state;
          if (domain === 'sensor') iconName = 'chart-line';
          else if (domain === 'binary_sensor') iconName = 'radiobox-blank';
          else if (domain === 'switch' || domain === 'input_boolean') iconName = 'toggle-switch';
          else if (domain === 'light') iconName = 'lightbulb';
          else if (domain === 'person') iconName = 'account';
          else if (domain === 'sun') iconName = 'white-balance-sunny';
          else if (domain === 'climate') iconName = 'thermostat';
          else if (domain === 'weather') {
            const map: Record<string, string> = {
              'clear-night': 'weather-night',
              cloudy: 'weather-cloudy',
              fog: 'weather-fog',
              hail: 'weather-hail',
              lightning: 'weather-lightning',
              'lightning-rainy': 'weather-lightning-rainy',
              partlycloudy: 'weather-partly-cloudy',
              pouring: 'weather-pouring',
              rainy: 'weather-rainy',
              snowy: 'weather-snowy',
              'snowy-rainy': 'weather-snowy-rainy',
              sunny: 'weather-sunny',
              windy: 'weather-windy',
              'windy-variant': 'weather-windy-variant',
              exceptional: 'alert-circle-outline',
            };
            iconName = map[state] || 'weather-cloudy';
          }
        }
      } else {
        iconName = 'alert-circle-outline';
      }
      rt.iconName = iconName;

      if (newState) {
        const friendly = newState.attributes.friendly_name || entityId;
        rt.title = `${friendly}\n(${entityId})`;
      }

      this._runtime[i] = rt;
    });
    this._runtime = [...this._runtime] as [SlotRuntime, SlotRuntime, SlotRuntime];
  }

  private async _fetchInitialState(entityId: string): Promise<void> {
    try {
      if (!window.getHAStates) return;
      let all = window.cachedEntities;
      if (!all || all.length === 0) {
        all = await fetchAllStatesDeduped();
      }
      const state = all?.find((s) => s.entity_id === entityId) ?? null;
      this._updateEntityState(entityId, state);
      if (!state) this._setSlotError(entityId, '--');
    } catch (e) {
      console.warn('Statusbar: Init fetch failed', e);
      this._setSlotError(entityId, '--');
    }
  }

  private _setSlotError(entityId: string, msg: string): void {
    this._slots.forEach((slot, i) => {
      if (slot.type === 'custom' && slot.customEntity === entityId) {
        this._runtime[i] = { ...this._runtime[i], valueText: msg, iconName: 'alert-circle-outline' };
      }
    });
    this._runtime = [...this._runtime] as [SlotRuntime, SlotRuntime, SlotRuntime];
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('_runtime') || changed.has('_slots')) this._drawSparklines();
  }

  private _drawSparklines(): void {
    const canvases = [this._canvas0, this._canvas1, this._canvas2];
    this._slots.forEach((slot, i) => {
      const canvas = canvases[i];
      if (!canvas || slot.type === 'none' || !slot.showSparkline) return;
      const opts =
        slot.type === 'cpu' ? { max: 100, thresholds: [50, 70, 90] } : { color: this._runtime[i].valueColor || '#888' };
      this._drawSparkline(canvas, this._runtime[i].history, opts);
    });
  }

  private _drawSparkline(
    canvas: HTMLCanvasElement,
    data: (number | null)[],
    options: { min?: number; max?: number; color?: string; thresholds?: number[] }
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const validData = data.filter((v): v is number => v !== null && !isNaN(v));
    if (validData.length === 0) return;

    let min = options.min !== undefined ? options.min : Math.min(...validData);
    let max = options.max !== undefined ? options.max : Math.max(...validData);
    if (max === min) {
      max += 1;
      min -= 1;
    }
    const range = max - min;

    const barW = w / data.length;
    data.forEach((v, i) => {
      if (v === null || isNaN(v)) return;
      let color = options.color || '#666';
      if (options.thresholds) {
        if (v >= options.thresholds[2]) color = '#ff5555';
        else if (v >= options.thresholds[1]) color = '#ffb86c';
        else if (v >= options.thresholds[0]) color = '#f1fa8c';
      }
      ctx.fillStyle = color;
      const normalized = (v - min) / range;
      const barH = Math.max(2, normalized * h);
      ctx.fillRect(i * barW, h - barH, barW, barH);
    });
  }

  render() {
    const activeSlots = this._slots.filter((s) => s.type !== 'none').length;
    const dense = activeSlots >= 3;
    const slotsClass = `status-slots${dense ? ' has-three-slots' : ''}${dense && this._hideSparklinesWhenDense ? ' hide-sparklines' : ''}`;

    // Socket itself is down and no MQTT status has arrived yet — repurpose
    // the same icon to show "connection lost" (matches the original
    // app.js updateSystemNotifications() fallback behavior).
    const mqttTitle = this._connectionLost
      ? 'Connection lost (Socket)'
      : !this._mqttEnabled
        ? this._t('settings.system.mqtt_disabled', 'MQTT disabled')
        : this._mqttConnected
          ? this._t('statusbar.mqtt_connected', 'MQTT connected')
          : this._mqttError
            ? this._t('settings.system.mqtt_error', 'MQTT error: {{error}}', { error: this._mqttError })
            : this._t('settings.system.mqtt_disconnected', 'MQTT disconnected');
    const mqttIconClass =
      this._connectionLost || !this._mqttEnabled || !this._mqttConnected ? 'mdi-circle-outline' : 'mdi-circle-slice-8';
    const mqttColor = this._connectionLost
      ? 'var(--danger)'
      : !this._mqttEnabled
        ? '#555'
        : this._mqttConnected
          ? '#fff'
          : 'var(--danger)';
    const mqttOpacity = this._connectionLost || this._mqttEnabled ? '1' : '0.3';

    const canvasIds = ['canvas-0', 'canvas-1', 'canvas-2'];

    return html`
      ${mdiStylesheetLink}
      <div class="status-left">
        <div
          class="stat-item"
          title=${this._connected ? this._t('statusbar.ha_connected', 'Connected') : this._t('statusbar.ha_disconnected', 'Disconnected')}
        >
          <i
            class="mdi ${this._connected ? 'mdi-circle-slice-8' : 'mdi-circle-outline'} heartbeat-icon"
            style="color: ${this._connected ? '#fff' : 'var(--danger)'}"
          ></i>
        </div>
        <div
          id="integration-status-item"
          class="stat-item"
          title=${mqttTitle}
          @click=${() => (window.appSidebar ? window.appSidebar.openSettings('mqtt') : window.openSettingsTab?.('mqtt'))}
        >
          <i class="mdi ${mqttIconClass} integration-icon" style="color: ${mqttColor}; opacity: ${mqttOpacity}"></i>
        </div>
      </div>
      <div class=${slotsClass}>
        ${this._slots.map((slot, i) => {
          if (slot.type === 'none') return html`<div class="sb-item" style="display: none"></div>`;
          const rt = this._runtime[i];
          return html`
            <div class="sb-item" title=${rt.title}>
              <i class="mdi mdi-${rt.iconName}"></i>
              <span class="val" style="color: ${rt.valueColor}">${rt.valueText}</span>
              ${slot.showSparkline ? html`<canvas id=${canvasIds[i]} width="20" height="16" style="opacity: 0.8"></canvas>` : ''}
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'status-bar': StatusBar;
  }
}
