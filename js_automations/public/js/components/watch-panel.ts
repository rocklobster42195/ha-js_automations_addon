import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface HaStateValue {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

type WatchValue = HaStateValue | string | number | boolean | null | undefined | Record<string, unknown>;

interface WatchRow {
  mainTr: HTMLTableRowElement;
  attrsTr: HTMLTableRowElement | null;
  valueEl: HTMLTableCellElement;
  iconEl: HTMLElement | null;
  chevronEl: HTMLElement | null;
  filename: string;
  lastValue: WatchValue;
}

interface BreakpointEntry {
  row: HTMLElement;
  continueBtn: HTMLButtonElement;
  iconEl: HTMLElement;
}

interface HaIconEntry {
  default?: string;
  state?: Record<string, string>;
  range?: Record<string, string>;
}

const DOMAIN_ICONS: Record<string, (state: string) => string> = {
  switch: (s) => (s === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off'),
  light: (s) => (s === 'on' ? 'mdi:lightbulb' : 'mdi:lightbulb-outline'),
  binary_sensor: () => 'mdi:checkbox-marked-circle-outline',
  sensor: () => 'mdi:eye',
  input_boolean: (s) => (s === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off'),
  automation: (s) => (s === 'on' ? 'mdi:robot' : 'mdi:robot-off'),
  cover: () => 'mdi:garage',
  climate: () => 'mdi:thermostat',
  media_player: () => 'mdi:cast',
  person: () => 'mdi:account',
  device_tracker: () => 'mdi:crosshairs-gps',
  input_select: () => 'mdi:format-list-bulleted',
  select: () => 'mdi:format-list-bulleted',
  input_number: () => 'mdi:ray-vertex',
  number: () => 'mdi:ray-vertex',
  button: () => 'mdi:gesture-tap-button',
  scene: () => 'mdi:palette',
  script: () => 'mdi:script-text',
  fan: (s) => (s === 'on' ? 'mdi:fan' : 'mdi:fan-off'),
  lock: (s) => (s === 'locked' ? 'mdi:lock' : 'mdi:lock-open'),
  alarm_control_panel: () => 'mdi:shield-home',
  vacuum: () => 'mdi:robot-vacuum',
  water_heater: () => 'mdi:water-boiler',
  humidifier: () => 'mdi:air-humidifier',
};

/**
 * WATCH dev-tools tab: live watch expression list (ha.watch()) + inspect
 * snapshots and breakpoints (ha.inspect()/ha.breakpoint()). Panel content
 * only — id="dev-tab-watch", layout.js's generic tab switcher owns
 * showing/hiding it.
 *
 * The render() template is entirely static (no reactive @state at all) —
 * unlike the other dev-tools panels there's no chrome here that depends on
 * component state, just two list containers. All updates are imperative DOM
 * manipulation driven by socket events, same as the original.
 *
 * Exposes window.onWatchUpdate/onWatchClear/onInspectSnapshot/onBreakpointHit/
 * onBreakpointContinued as before — socket-client.js is the central socket
 * event dispatcher and calls these directly, and hasn't been migrated yet.
 */
@customElement('watch-panel')
export class WatchPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 0;
      overflow: hidden;
      height: 100%;
      box-sizing: border-box;
    }

    .watch-wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .watch-section-label {
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      color: #777;
      padding: 6px 12px 4px;
      border-bottom: 1px solid #1a1a1a;
      text-transform: uppercase;
    }

    .watch-list-section {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-bottom: 1px solid #222;
    }

    .watch-list {
      flex: 1;
      overflow-y: auto;
    }

    .watch-hint {
      padding: 8px 12px;
      color: #777;
      font-size: 0.8rem;
    }

    .watch-table {
      width: 100%;
      border-collapse: collapse;
    }

    .watch-main-row td {
      padding: 5px 6px;
      font-size: 0.82rem;
      border-bottom: 1px solid #111;
      vertical-align: middle;
    }

    .watch-main-row--expandable {
      cursor: pointer;
    }

    .watch-main-row--expandable:hover td {
      background: #080808;
    }

    .watch-col-icon {
      width: 28px;
      padding-left: 12px !important;
      font-size: 1rem;
      transition: color 0.3s;
    }

    .watch-col-label {
      color: #aaa;
      white-space: nowrap;
      padding-right: 16px !important;
    }

    .watch-col-value {
      font-family: monospace;
      font-weight: 600;
      white-space: nowrap;
      color: var(--text-primary);
      padding-left: 12px !important;
    }

    .watch-val-bool-true {
      color: #4caf50;
    }

    .watch-val-bool-false {
      color: #ef5350;
    }

    .watch-val-number {
      color: #4fc3f7;
    }

    .watch-val-null {
      color: #666;
      font-style: italic;
    }

    .watch-val-object {
      font-size: 0.78rem;
      color: #aaa;
    }

    .watch-col-script {
      font-size: 0.68rem;
      color: #777;
      white-space: nowrap;
      padding-left: 12px !important;
      padding-right: 6px !important;
    }

    .watch-col-chevron {
      width: 20px;
      padding-right: 12px !important;
      color: #777;
      font-size: 0.9rem;
      text-align: right;
    }

    .watch-main-row--expandable:hover .watch-col-chevron {
      color: #888;
    }

    /* Global .hidden (style.css) doesn't reach into this shadow root. */
    .hidden {
      display: none;
    }

    .watch-attrs-row td {
      padding: 4px 12px 8px 40px;
      border-bottom: 1px solid #111;
      background: #060606;
    }

    .watch-attr-table {
      border-collapse: collapse;
      font-size: 0.78rem;
      width: 100%;
    }

    .watch-attr-key {
      color: var(--accent);
      padding: 1px 16px 1px 0;
      vertical-align: top;
      white-space: nowrap;
      font-family: monospace;
    }

    .watch-attr-val {
      color: #aaa;
      vertical-align: top;
      width: 100%;
    }

    .watch-attr-val pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      font-size: 0.78rem;
      font-family: monospace;
    }

    .watch-inspect-header {
      display: flex;
      align-items: center;
      border-bottom: 1px solid #1a1a1a;
    }

    .watch-inspect-header .watch-section-label {
      flex: 1;
      border-bottom: none;
    }

    .watch-clear-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 4px 10px;
      font-size: 0.85rem;
      line-height: 1;
    }

    .watch-clear-btn:hover {
      color: #888;
    }

    .inspect-row--breakpoint {
      border-left: 3px solid #ff9800;
      background: #0d0800;
    }

    .inspect-row--breakpoint-done {
      border-left: 3px solid #2a2a2a;
      opacity: 0.5;
    }

    .inspect-bp-icon {
      color: #ff9800;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    .inspect-bp-icon-done {
      color: #666;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    .inspect-bp-continue {
      margin-left: auto;
      flex-shrink: 0;
      padding: 2px 10px;
      background: #ff9800;
      color: #000;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      border: none;
    }

    .inspect-bp-continue:hover {
      opacity: 0.85;
    }

    .watch-inspect-section {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .watch-inspect-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }

    .watch-inspect-list .watch-hint {
      padding-left: 12px;
    }

    .inspect-row {
      border-bottom: 1px solid #111;
      padding: 6px 12px;
    }

    .inspect-row:hover {
      background: #080808;
    }

    .inspect-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
    }

    .inspect-time {
      font-size: 0.72rem;
      color: #777;
      flex-shrink: 0;
      font-family: monospace;
    }

    .inspect-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
    }

    .inspect-script {
      font-size: 0.7rem;
      color: #777;
      margin-left: auto;
    }

    .inspect-var-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }

    .inspect-var-table thead th {
      text-align: left;
      padding: 2px 6px;
      color: #777;
      font-weight: 500;
      border-bottom: 1px solid #1a1a1a;
    }

    .inspect-var-table tbody tr:hover {
      background: #0d0d0d;
    }

    .inspect-var-key {
      color: var(--accent);
      padding: 2px 6px;
      vertical-align: top;
      white-space: nowrap;
    }

    .inspect-var-type {
      color: #777;
      font-style: italic;
      padding: 2px 6px;
      vertical-align: top;
      white-space: nowrap;
    }

    .inspect-var-val {
      padding: 2px 6px;
      vertical-align: top;
      width: 100%;
    }

    .inspect-var-val pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-primary);
      font-size: 0.78rem;
      font-family: monospace;
    }

    .inspect-empty {
      font-size: 0.78rem;
      color: #666;
      padding: 2px 0;
    }
  `;

  private _watchRows = new Map<string, WatchRow>();
  private _activeBreakpoints = new Map<string, BreakpointEntry>();
  private _watchTable: HTMLTableElement | null = null;
  private _haIcons: Record<string, Record<string, HaIconEntry>> | null = null;
  private _haIconsLoadPromise: Promise<void> | null = null;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key, { defaultValue: fallback }) ?? fallback;
  }

  private get _watchListEl(): HTMLElement | null {
    return (this.renderRoot as ShadowRoot).querySelector('#watch-list');
  }

  private get _inspectListEl(): HTMLElement | null {
    return (this.renderRoot as ShadowRoot).querySelector('#watch-inspect-list');
  }

  connectedCallback() {
    super.connectedCallback();
    window.onWatchUpdate = this.onWatchUpdate;
    window.onWatchClear = this.onWatchClear;
    window.onInspectSnapshot = this.onInspectSnapshot;
    window.onBreakpointHit = this.onBreakpointHit;
    window.onBreakpointContinued = this.onBreakpointContinued;
    window.watchPanel = this;
    this._loadHAIcons();
    this._waitForSocket();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.onWatchUpdate === this.onWatchUpdate) delete window.onWatchUpdate;
    if (window.onWatchClear === this.onWatchClear) delete window.onWatchClear;
    if (window.onInspectSnapshot === this.onInspectSnapshot) delete window.onInspectSnapshot;
    if (window.onBreakpointHit === this.onBreakpointHit) delete window.onBreakpointHit;
    if (window.onBreakpointContinued === this.onBreakpointContinued) delete window.onBreakpointContinued;
    if (window.watchPanel === this) delete window.watchPanel;
  }

  /** Mobile per-script inline status (RFC §7 follow-up) — a snapshot at call
   * time of this script's currently active watch tiles, keyed by filename
   * (unlike log entries, watch payloads carry the real filename, not the
   * display name). */
  getTilesForFilename(filename: string): { label: string; value: WatchValue }[] {
    return [...this._watchRows.entries()]
      .filter(([, e]) => e.filename === filename)
      .map(([label, e]) => ({ label, value: e.lastValue }));
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    // Ask the backend to replay cached watch tiles / inspect snapshots now that
    // the DOM is ready. A blind replay at socket-connect time can fire before
    // this runs (e.g. while Monaco is still loading), silently dropping it
    // since the list elements weren't in the DOM yet.
    if (window.socket.connected) window.socket.emit('subscribe_watch');
    window.socket.on('connect', () => window.socket!.emit('subscribe_watch'));
  };

  private _loadHAIcons(): Promise<void> | undefined {
    if (this._haIcons || this._haIconsLoadPromise) return this._haIconsLoadPromise ?? undefined;
    this._haIconsLoadPromise = window.apiFetch!('api/ha/icons')
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        this._haIcons = data || {};
        this._refreshWatchIcons();
      })
      .catch(() => {
        this._haIcons = {};
      });
    return this._haIconsLoadPromise;
  }

  // Re-renders icons for already-visible watch rows once the HA icon catalog arrives late.
  private _refreshWatchIcons(): void {
    for (const e of this._watchRows.values()) {
      if (!e.iconEl || e.lastValue === undefined) continue;
      e.iconEl.className = this._mdiClass(this._getEntityIcon(e.lastValue));
      e.iconEl.style.color = this._iconColor(e.lastValue);
    }
  }

  // Resolves an icon from HA's icon translations, mirroring the frontend's own
  // precedence: exact state match > numeric range (highest threshold <= value)
  // > domain/device_class default.
  private _lookupHAIcon(domain: string, deviceClass: string | undefined, state: string): string | null {
    if (!this._haIcons) return null;
    const domainIcons = this._haIcons[domain];
    if (!domainIcons) return null;
    const entry = (deviceClass && domainIcons[deviceClass]) || domainIcons['_'];
    if (!entry) return null;
    if (entry.state && Object.prototype.hasOwnProperty.call(entry.state, state)) {
      return entry.state[state];
    }
    if (entry.range) {
      const num = Number(state);
      if (!isNaN(num)) {
        const best = Object.keys(entry.range)
          .map(Number)
          .filter((t) => t <= num)
          .sort((a, b) => b - a)[0];
        if (best !== undefined) return entry.range[String(best)];
      }
    }
    return entry.default || null;
  }

  private _isStateObject(v: WatchValue): v is HaStateValue {
    return v !== null && typeof v === 'object' && typeof (v as HaStateValue).entity_id === 'string' && 'state' in v;
  }

  private _getEntityIcon(v: WatchValue): string | null {
    if (!this._isStateObject(v)) return null;
    if (v.attributes?.icon) return v.attributes.icon as string;
    const domain = v.entity_id.split('.')[0];
    const deviceClass = v.attributes?.device_class as string | undefined;
    const haIcon = this._lookupHAIcon(domain, deviceClass, v.state);
    if (haIcon) return haIcon;
    // Fallback while the HA icon catalog is still loading (or unreachable).
    const fn = DOMAIN_ICONS[domain];
    return fn ? fn(v.state) : null;
  }

  private _ensureWatchTable(): HTMLTableElement {
    if (!this._watchTable) {
      const list = this._watchListEl!;
      list.querySelectorAll('.watch-hint').forEach((h) => h.remove());
      this._watchTable = document.createElement('table');
      this._watchTable.className = 'watch-table';
      list.appendChild(this._watchTable);
    }
    return this._watchTable;
  }

  onWatchUpdate = (data: { label: string; value: WatchValue; name?: string; filename: string }): void => {
    const list = this._watchListEl;
    if (!list) return;
    const { label, value, name, filename } = data;

    const icon = this._getEntityIcon(value);
    const valText = this._formatValue(value);
    const valClass = 'watch-col-value ' + this._valueClass(value);
    const hasAttrs = this._isStateObject(value) && Object.keys(value.attributes || {}).length > 0;

    if (this._watchRows.has(label)) {
      const e = this._watchRows.get(label)!;
      e.lastValue = value;
      e.valueEl.textContent = valText;
      e.valueEl.className = valClass;
      if (e.iconEl) {
        e.iconEl.className = this._mdiClass(icon);
        e.iconEl.style.color = this._iconColor(value);
      }
      if (e.attrsTr && !e.attrsTr.classList.contains('hidden')) {
        e.attrsTr.querySelector('td')!.innerHTML = this._renderAttrs(value);
      }
      return;
    }

    const table = this._ensureWatchTable();

    const mainTr = table.insertRow();
    mainTr.className = 'watch-main-row';

    const tdIcon = mainTr.insertCell();
    tdIcon.className = 'watch-col-icon';
    let iconEl: HTMLElement | null = null;
    if (icon) {
      iconEl = document.createElement('i');
      iconEl.className = this._mdiClass(icon);
      iconEl.style.color = this._iconColor(value);
      tdIcon.appendChild(iconEl);
    }

    const tdLabel = mainTr.insertCell();
    tdLabel.className = 'watch-col-label';
    tdLabel.textContent = label;

    const tdValue = mainTr.insertCell();
    tdValue.className = valClass;
    tdValue.textContent = valText;

    const tdScript = mainTr.insertCell();
    tdScript.className = 'watch-col-script';
    tdScript.textContent = name || '';

    const tdChevron = mainTr.insertCell();
    tdChevron.className = 'watch-col-chevron';
    let chevronEl: HTMLElement | null = null;
    let attrsTr: HTMLTableRowElement | null = null;

    if (hasAttrs) {
      chevronEl = document.createElement('i');
      chevronEl.className = 'mdi mdi-chevron-down';
      tdChevron.appendChild(chevronEl);

      attrsTr = table.insertRow();
      attrsTr.className = 'watch-attrs-row hidden';
      const tdAttrs = attrsTr.insertCell();
      tdAttrs.colSpan = 5;
      tdAttrs.innerHTML = this._renderAttrs(value);

      mainTr.classList.add('watch-main-row--expandable');
      const finalAttrsTr = attrsTr;
      const finalChevronEl = chevronEl;
      mainTr.addEventListener('click', () => {
        const isOpen = !finalAttrsTr.classList.contains('hidden');
        finalAttrsTr.classList.toggle('hidden', isOpen);
        finalChevronEl.className = `mdi ${isOpen ? 'mdi-chevron-down' : 'mdi-chevron-up'}`;
      });
    }

    this._watchRows.set(label, { mainTr, attrsTr, valueEl: tdValue, iconEl, chevronEl, filename, lastValue: value });
  };

  onWatchClear = (data: { filename: string }): void => {
    const list = this._watchListEl;
    if (!list) return;
    const toRemove = [...this._watchRows.entries()].filter(([, e]) => e.filename === data.filename);
    for (const [label, entry] of toRemove) {
      entry.mainTr.remove();
      entry.attrsTr?.remove();
      this._watchRows.delete(label);
    }
    if (this._watchRows.size === 0) {
      if (this._watchTable) {
        this._watchTable.remove();
        this._watchTable = null;
      }
      list.querySelectorAll('.watch-hint').forEach((h) => h.remove());
      const hint = document.createElement('div');
      hint.className = 'watch-hint';
      hint.textContent = this._t(
        'devtools.watch_hint',
        "No watch expressions active. Use ha.watch('label', () => expr) in a script."
      );
      list.appendChild(hint);
    }
  };

  onInspectSnapshot = (data: { label: string; vars?: Record<string, unknown>; name?: string }): void => {
    const list = this._inspectListEl;
    if (!list) return;
    const { label, vars, name } = data;

    list.querySelector('.watch-hint')?.remove();

    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const row = document.createElement('div');
    row.className = 'inspect-row';

    const header = document.createElement('div');
    header.className = 'inspect-header';
    header.innerHTML = `<span class="inspect-time">${now}</span>
                        <span class="inspect-label">${this._esc(label)}</span>
                        <span class="inspect-script">${this._esc(name || '')}</span>`;

    row.appendChild(header);
    row.insertAdjacentHTML('beforeend', this._renderVarTable(vars));
    list.insertBefore(row, list.firstChild);
  };

  private _renderVarTable(vars: Record<string, unknown> | undefined, emptyHint = true): string {
    const entries = Object.entries(vars || {});
    if (entries.length === 0) {
      return emptyHint ? `<div class="inspect-empty">${this._t('devtools.inspect_empty', 'No variables.')}</div>` : '';
    }
    return `<table class="inspect-var-table">
            <thead><tr>
                <th>${this._t('devtools.col_variable', 'Variable')}</th>
                <th>${this._t('devtools.col_type', 'Type')}</th>
                <th>${this._t('devtools.col_value', 'Value')}</th>
            </tr></thead>
            <tbody>${entries
              .map(
                ([k, v]) => `
                <tr>
                    <td class="inspect-var-key">${this._esc(k)}</td>
                    <td class="inspect-var-type">${this._esc(typeof v)}</td>
                    <td class="inspect-var-val"><pre>${this._esc(this._prettyVal(v))}</pre></td>
                </tr>`
              )
              .join('')}
            </tbody>
        </table>`;
  }

  private _setWatchTabBadge(count: number): void {
    const watchTab = document.querySelector('.log-pane-tab[data-tab="watch"]');
    if (!watchTab) return;
    let badge = watchTab.querySelector('.tab-bp-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tab-bp-badge';
        watchTab.appendChild(badge);
      }
      badge.textContent = String(count);
    } else {
      badge?.remove();
    }
  }

  onBreakpointHit = (data: {
    filename: string;
    name?: string;
    label: string;
    vars?: Record<string, unknown>;
  }): void => {
    const list = this._inspectListEl;
    if (!list) return;
    const { filename, name, label, vars } = data;

    list.querySelector('.watch-hint')?.remove();

    // Auto-switch to WATCH tab
    const watchTab = document.querySelector('.log-pane-tab[data-tab="watch"]');
    if (watchTab && !watchTab.classList.contains('active')) (watchTab as HTMLElement).click();

    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const row = document.createElement('div');
    row.className = 'inspect-row inspect-row--breakpoint';

    const iconEl = document.createElement('i');
    iconEl.className = 'mdi mdi-pause inspect-bp-icon';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'inspect-bp-continue';
    continueBtn.textContent = 'Continue';
    continueBtn.onclick = () => this._continueBreakpoint(filename);

    const header = document.createElement('div');
    header.className = 'inspect-header';
    header.appendChild(iconEl);
    header.insertAdjacentHTML(
      'beforeend',
      `<span class="inspect-time">${now}</span>
         <span class="inspect-label">${this._esc(label)}</span>
         <span class="inspect-script">${this._esc(name || '')}</span>`
    );
    header.appendChild(continueBtn);

    row.appendChild(header);
    row.insertAdjacentHTML('beforeend', this._renderVarTable(vars, false));
    list.insertBefore(row, list.firstChild);
    this._activeBreakpoints.set(filename, { row, continueBtn, iconEl });
    this._setWatchTabBadge(this._activeBreakpoints.size);
    list.scrollTop = 0;
  };

  onBreakpointContinued = (data: { filename: string }): void => {
    const entry = this._activeBreakpoints.get(data.filename);
    if (!entry) return;
    entry.row.classList.remove('inspect-row--breakpoint');
    entry.row.classList.add('inspect-row--breakpoint-done');
    entry.iconEl.className = 'mdi mdi-play inspect-bp-icon-done';
    entry.continueBtn.remove();
    this._activeBreakpoints.delete(data.filename);
    this._setWatchTabBadge(this._activeBreakpoints.size);
  };

  private _continueBreakpoint(filename: string): void {
    window.socket?.emit('debug_continue', filename);
  }

  private _clearInspectList = (): void => {
    const list = this._inspectListEl;
    if (!list) return;
    list.innerHTML = '';
    this._activeBreakpoints.clear();
    this._setWatchTabBadge(0);
    const hint = document.createElement('div');
    hint.className = 'watch-hint';
    hint.textContent = this._t(
      'devtools.inspect_hint',
      "No entries yet. Use ha.inspect('label', { vars }) in a script."
    );
    list.appendChild(hint);
  };

  private _renderAttrs(v: WatchValue): string {
    if (!this._isStateObject(v)) return '';
    const entries = Object.entries(v.attributes || {});
    if (entries.length === 0) return '';
    return `<table class="watch-attr-table">
        ${entries
          .map(
            ([k, val]) => `
        <tr>
            <td class="watch-attr-key">${this._esc(k)}</td>
            <td class="watch-attr-val"><pre>${this._esc(this._prettyVal(val))}</pre></td>
        </tr>`
          )
          .join('')}
    </table>`;
  }

  private _formatValue(v: WatchValue): string {
    if (v === undefined || v === null) return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (this._isStateObject(v)) return v.state;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  private _valueClass(v: WatchValue): string {
    if (typeof v === 'boolean') return v ? 'watch-val-bool-true' : 'watch-val-bool-false';
    if (typeof v === 'number') return 'watch-val-number';
    if (v === null || v === undefined) return 'watch-val-null';
    if (this._isStateObject(v)) {
      const s = v.state;
      if (s === 'on' || s === 'locked' || s === 'home') return 'watch-val-bool-true';
      if (s === 'off' || s === 'unlocked' || s === 'not_home') return 'watch-val-bool-false';
      const num = Number(s);
      if (!isNaN(num) && String(s).trim() !== '') return 'watch-val-number';
      return '';
    }
    if (typeof v === 'object') return 'watch-val-object';
    return '';
  }

  private _iconColor(v: WatchValue): string {
    const cls = this._valueClass(v);
    if (cls === 'watch-val-bool-true') return '#4caf50';
    if (cls === 'watch-val-bool-false') return '#555';
    if (cls === 'watch-val-number') return '#4fc3f7';
    return 'var(--accent)';
  }

  private _mdiClass(icon: string | null): string {
    if (!icon) return '';
    return 'mdi ' + icon.replace(':', '-');
  }

  private _prettyVal(v: unknown): string {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  private _esc(s: unknown): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="watch-wrap">
        <div class="watch-list-section">
          <div class="watch-section-label">${this._t('devtools.watch_section', 'LIVE WATCH')}</div>
          <div id="watch-list" class="watch-list">
            <div class="watch-hint">
              ${this._t('devtools.watch_hint', "No watch expressions active. Use ha.watch('label', () => expr) in a script.")}
            </div>
          </div>
        </div>
        <div class="watch-inspect-section">
          <div class="watch-inspect-header">
            <span class="watch-section-label">${this._t('devtools.inspect_section', 'INSPECT')}</span>
            <button class="watch-clear-btn" title="Clear" @click=${this._clearInspectList}>
              <i class="mdi mdi-trash-can-outline"></i>
            </button>
          </div>
          <div id="watch-inspect-list" class="watch-inspect-list">
            <div class="watch-hint">
              ${this._t('devtools.inspect_hint', "No entries yet. Use ha.inspect('label', { vars }) in a script.")}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'watch-panel': WatchPanel;
  }
}
