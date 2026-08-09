import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';
import { observeTabVisibility } from './tab-visibility';

const MQTT_MONITOR_MAX = 200;

interface MqttEntry {
  id: number;
  topic: string;
  payload: string;
  direction: 'in' | 'out';
  ts: number;
}

/**
 * MQTT dev-tools tab: live IN/OUT message feed + an ad-hoc publish form.
 * Panel content only — id="dev-tab-mqtt", layout.js's generic tab switcher
 * owns showing/hiding it.
 *
 * The message stream is appended imperatively into the list div rather than
 * driven through a reactive @state array — same reasoning as <log-viewer>:
 * a live, potentially high-volume append-only stream where re-diffing the
 * whole list on every message would get expensive. Only the publish
 * form/toolbar/pause-state chrome is reactive.
 */
@customElement('mqtt-monitor')
export class MqttMonitor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      padding: 0;
      overflow: hidden;
      height: 100%;
      box-sizing: border-box;
    }

    /* Shared with the not-yet-migrated EVENTS tab (event-inspector.js) —
       duplicated here since Shadow DOM doesn't inherit that global rule. */
    .dev-section-divider {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      height: 22px;
      flex-shrink: 0;
      font-size: 0.6rem;
      font-weight: 600;
      color: #3a3a3a;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      user-select: none;
    }

    .dev-section-divider::before,
    .dev-section-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #2a2a2a;
    }

    .mm-publish-panel {
      border-bottom: none;
      padding: 6px 8px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .mm-publish-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .mm-topic-input {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #ccc;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.78rem;
      font-family: monospace;
    }

    .mm-topic-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .mm-payload-input {
      flex: 1;
      resize: vertical;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #ccc;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.78rem;
      font-family: monospace;
      min-height: 28px;
    }

    .mm-payload-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .mm-retain-label {
      flex-shrink: 0;
      font-size: 0.75rem;
      color: #777;
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
    }

    .mm-publish-btn {
      flex-shrink: 0;
      padding: 3px 12px;
      background: #0d2233;
      color: #4fc3f7;
      border: 1px solid #1a3a4a;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.78rem;
      font-weight: 600;
    }

    .mm-publish-btn:hover {
      background: #1a3a4a;
    }

    .mm-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-bottom: 1px solid #1a1a1a;
      flex-shrink: 0;
    }

    .mm-filter {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #ccc;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.78rem;
      font-family: monospace;
    }

    .mm-filter:focus {
      outline: none;
      border-color: var(--accent);
    }

    .mm-toolbar button {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 1rem;
      line-height: 1;
    }

    .mm-toolbar button:hover {
      color: #ccc;
      background: #222;
    }

    .mm-list {
      flex: 1;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.78rem;
    }

    .mm-hint {
      padding: 16px 12px;
      color: #777;
      font-family: inherit;
      font-size: 0.8rem;
    }

    .mm-paused-banner {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 5px 12px;
      background: #2a2000;
      color: #ffa726;
      font-size: 0.78rem;
      border-bottom: 1px solid #3a2e00;
    }

    .mm-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 8px;
      border-bottom: 1px solid #0d0d0d;
      white-space: nowrap;
      overflow: hidden;
      position: relative;
      cursor: pointer;
    }

    .mm-row:hover {
      background: #111;
    }

    .mm-time {
      color: #777;
      flex-shrink: 0;
    }

    .mm-dir {
      flex-shrink: 0;
      font-size: 0.7rem;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 700;
    }

    .mm-dir-in {
      background: #0a2a0a;
      color: #66bb6a;
    }

    .mm-dir-out {
      background: #2a1a00;
      color: #ffa726;
    }

    .mm-topic {
      flex-shrink: 0;
      color: #aaa;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mm-payload {
      flex: 1;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mm-raw {
      background: #0a0a0a;
      color: #888;
      font-family: monospace;
      font-size: 0.75rem;
      padding: 6px 12px;
      margin: 0;
      border-bottom: 1px solid #1a1a1a;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
  `;

  @state() private _paused = false;
  @state() private _filter = '';

  private _active = false;
  private _buffer: MqttEntry[] = [];
  private _rowId = 0;

  private _t(key: string, fallback: string): string {
    return window.i18next?.t(key, { defaultValue: fallback }) ?? fallback;
  }

  private get _listEl(): HTMLElement | null {
    return (this.renderRoot as ShadowRoot).querySelector('#mm-list');
  }

  connectedCallback() {
    super.connectedCallback();
    this._active = !this.classList.contains('hidden');
    observeTabVisibility(this, (visible) => {
      this._active = visible;
      if (visible) window.socket?.emit('subscribe_mqtt_monitor');
      else window.socket?.emit('unsubscribe_mqtt_monitor');
    });
    this._waitForSocket();
  }

  firstUpdated() {
    this._appendHint(this._listEl!);
  }

  private _waitForSocket = (): void => {
    if (!window.socket) {
      setTimeout(this._waitForSocket, 100);
      return;
    }
    if (window.socket.connected && this._active) window.socket.emit('subscribe_mqtt_monitor');
    // Re-subscribe after socket reconnect (new socket.id — old one is gone from server set)
    window.socket.on('connect', () => {
      if (this._active) window.socket!.emit('subscribe_mqtt_monitor');
    });
    window.socket.on('mqtt_message_stream', (data: Omit<MqttEntry, 'id'>) => this._onMessage(data));
  };

  private _onMessage(data: Omit<MqttEntry, 'id'>): void {
    if (!this._active) return;
    const entry: MqttEntry = { ...data, id: ++this._rowId };
    this._buffer.unshift(entry);
    if (this._buffer.length > MQTT_MONITOR_MAX) this._buffer.pop();
    if (!this._paused && this._matchesFilter(this._filter, entry.topic)) this._renderEntry(entry);
  }

  private _matchesFilter(filter: string, topic: string): boolean {
    if (!filter) return false;
    const fp = filter.split('/');
    const tp = topic.split('/');
    for (let i = 0; i < fp.length; i++) {
      if (fp[i] === '#') return true;
      if (i >= tp.length) return false;
      if (fp[i] !== '+' && fp[i] !== tp[i]) return false;
    }
    return fp.length === tp.length;
  }

  private _renderEntry(entry: MqttEntry): void {
    const list = this._listEl;
    if (!list) return;
    list.querySelector('.mm-hint')?.remove();

    const d = new Date(entry.ts);
    const time =
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) +
      '.' +
      String(d.getMilliseconds()).padStart(3, '0');
    const isIn = entry.direction === 'in';
    const dirClass = isIn ? 'mm-dir-in' : 'mm-dir-out';
    const dirLabel = isIn ? '▶ IN' : '◀ OUT';
    const short = entry.payload.length > 80 ? entry.payload.slice(0, 80) + '…' : entry.payload;

    const row = document.createElement('div');
    row.className = 'mm-row';
    row.dataset.id = String(entry.id);
    row.innerHTML = `
      <span class="mm-time">${time}</span>
      <span class="mm-dir ${dirClass}">${dirLabel}</span>
      <span class="mm-topic" title="${this._esc(entry.topic)}">${this._esc(entry.topic)}</span>
      <span class="mm-payload" title="${this._esc(entry.payload)}">${this._esc(short)}</span>
    `;

    row.addEventListener('click', () => {
      const existing = row.nextSibling as HTMLElement | null;
      if (existing?.classList?.contains('mm-raw')) {
        existing.remove();
        return;
      }
      const pre = document.createElement('pre');
      pre.className = 'mm-raw';
      try {
        pre.textContent = JSON.stringify(JSON.parse(entry.payload), null, 2);
      } catch {
        pre.textContent = entry.payload;
      }
      row.after(pre);
    });

    list.prepend(row);
    while (list.children.length > MQTT_MONITOR_MAX * 2) list.removeChild(list.lastChild!);
  }

  private _publish = (): void => {
    const root = this.renderRoot as ShadowRoot;
    const topicEl = root.querySelector('#mm-topic-input') as HTMLInputElement | null;
    const payloadEl = root.querySelector('#mm-payload-input') as HTMLTextAreaElement | null;
    const retainEl = root.querySelector('#mm-retain-chk') as HTMLInputElement | null;
    const topic = topicEl?.value.trim();
    const payload = payloadEl?.value ?? '';
    const retain = retainEl?.checked ?? false;
    if (!topic) {
      topicEl?.focus();
      return;
    }
    window.socket?.emit('mqtt_ui_publish', { topic, payload, retain });
  };

  private _onFilterInput = (e: Event): void => {
    this._filter = (e.target as HTMLInputElement).value.trim();
    this._rerender();
  };

  private _togglePause = (): void => {
    this._paused = !this._paused;
    if (!this._paused) this._rerender();
  };

  private _clear = (): void => {
    this._buffer = [];
    const list = this._listEl;
    if (!list) return;
    list.innerHTML = '';
    this._appendHint(list);
  };

  private _rerender(): void {
    const list = this._listEl;
    if (!list) return;
    list.innerHTML = '';
    const filtered = this._buffer.filter((e) => this._matchesFilter(this._filter, e.topic));
    filtered.forEach((e) => this._renderEntry(e));
    if (filtered.length === 0) this._appendHint(list);
  }

  private _appendHint(list: HTMLElement): void {
    const hint = document.createElement('div');
    hint.className = 'mm-hint';
    hint.textContent = this._hintText();
    list.appendChild(hint);
  }

  private _hintText(): string {
    return this._filter
      ? this._t('devtools.mqtt_hint', 'Waiting for MQTT messages...')
      : this._t('devtools.mqtt_no_filter', 'Enter a topic in the filter field, e.g. jsa/# or shellies/+/status');
  }

  private _esc(str: string): string {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="mm-publish-panel">
        <div class="mm-publish-row">
          <input
            id="mm-topic-input"
            class="mm-topic-input"
            placeholder="${this._t('devtools.mqtt_topic', 'Topic')}..."
            autocomplete="off"
            spellcheck="false"
          />
          <label class="mm-retain-label">
            <input id="mm-retain-chk" type="checkbox" /> ${this._t('devtools.mqtt_retain', 'Retain')}
          </label>
          <button class="mm-publish-btn" @click=${this._publish}>${this._t('devtools.mqtt_publish', 'Publish')}</button>
        </div>
        <div class="mm-publish-row">
          <textarea
            id="mm-payload-input"
            class="mm-payload-input"
            rows="2"
            placeholder="${this._t('devtools.mqtt_payload', 'Payload')} (JSON or plain text)..."
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <div class="dev-section-divider">Stream</div>
      <div class="mm-toolbar">
        <input
          class="mm-filter"
          placeholder="${this._t('devtools.mqtt_filter', 'Filter topic...')}"
          autocomplete="off"
          .value=${this._filter}
          @input=${this._onFilterInput}
        />
        <button
          title=${this._paused ? this._t('devtools.mqtt_resume', 'Resume') : this._t('devtools.mqtt_pause', 'Pause')}
          @click=${this._togglePause}
        >
          <i class="mdi ${this._paused ? 'mdi-play' : 'mdi-pause'}"></i>
        </button>
        <button title=${this._t('devtools.mqtt_clear', 'Clear')} @click=${this._clear}>
          <i class="mdi mdi-trash-can-outline"></i>
        </button>
      </div>
      ${this._paused ? html`<div class="mm-paused-banner">${this._t('devtools.mqtt_paused_hint', 'Stream paused — new messages are buffered')}</div>` : ''}
      <div id="mm-list" class="mm-list"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mqtt-monitor': MqttMonitor;
  }
}
