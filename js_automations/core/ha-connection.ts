/**
 * JS AUTOMATIONS - HA Connector (v1.9.0)
 * Handles WebSocket communication and IntelliSense generation.
 */
import WebSocket from 'ws';

interface HAState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

interface HAEvent {
  event_type: string;
  // Generic: subscribeToEvents() is a listener for any HA event type, not just
  // state_changed (e.g. mobile_app_notification_action carries a `.data.action`
  // field instead), so this can't be narrowed to one event's specific shape.
  data: Record<string, any>;
}

interface CommandResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

interface HistoryOptions {
  start?: Date;
  end?: Date;
  minimalResponse?: boolean;
  noAttributes?: boolean;
}

interface HistoryEntry {
  state: string;
  last_changed: string | undefined;
  attributes?: Record<string, unknown>;
}

interface StatisticsOptions {
  start?: Date;
  end?: Date;
  period?: 'hour' | 'day' | '5minute';
  types?: string[];
}

interface StatisticEntry {
  start: string | undefined;
  mean?: number;
  min?: number;
  max?: number;
  sum?: number;
}

interface CalendarOptions {
  start?: Date;
  end?: Date;
}

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  all_day: boolean;
  description?: string;
  location?: string;
}

interface HAMetadata {
  areas: unknown[];
  labels: unknown[];
  language: string;
}

class HAConnector {
  isAddon: boolean;
  storageDir: string;
  baseUrl: string;
  url: string;
  token: string | undefined;
  ws: WebSocket | null;
  msgId: number;
  isReady: boolean;
  eventListeners: Array<(event: HAEvent) => void>;
  states: Record<string, HAState>;
  private _subscribed?: boolean;
  private _iconsCache: Record<string, unknown> | null;
  private _iconsInFlight: Promise<Record<string, unknown>> | null;
  private _entityRegistryInFlight: Promise<unknown[]> | null;

  /**
   * @param url - HA URL
   * @param token - Access Token
   * @param storageDir - New location for system files (.storage)
   */
  constructor(url: string, token: string | undefined, storageDir: string) {
    this.isAddon = !!process.env.SUPERVISOR_TOKEN;
    this.storageDir = storageDir;
    this.baseUrl = this.isAddon ? 'http://supervisor/core' : url.replace(/\/$/, '');
    this.url = this.isAddon
      ? 'ws://supervisor/core/api/websocket'
      : this.baseUrl.replace('http', 'ws').replace('https', 'wss') + '/api/websocket';
    this.token = this.isAddon ? process.env.SUPERVISOR_TOKEN : token;

    this.ws = null;
    this.msgId = 1;
    this.isReady = false;
    this.eventListeners = [];
    this.states = {}; // Local cache for all entity states
    this._iconsCache = null;
    this._iconsInFlight = null;
    this._entityRegistryInFlight = null;
  }

  connect(): Promise<void> {
    this._subscribed = false; // reset per-connection subscription guard
    this._iconsCache = null; // re-fetch icon translations in case HA core was updated
    return new Promise((resolve, reject) => {
      console.log(`🔌 WebSocket: Connecting to ${this.url}...`);
      this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
      this.ws.setMaxListeners(0); // Remove the default 10 listener limit for this central component
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg, resolve);
        } catch (e) {
          /* ignore malformed message */
        }
      });
      this.ws.on('error', (err) => reject(err));
      this.ws.on('close', () => {
        this.isReady = false;
      });
    });
  }

  private handleMessage(msg: Record<string, any>, resolve: () => void): void {
    if (msg.type === 'auth_required') {
      this.send({ type: 'auth', access_token: this.token });
    } else if (msg.type === 'auth_ok') {
      console.log('✅ WebSocket: Authenticated.');
      this.isReady = true;
      this.subscribeEvents();
      this.fetchInitialStates().then(resolve);
    } else if (msg.type === 'event') {
      if (msg.event.event_type === 'state_changed') {
        const { entity_id, new_state } = msg.event.data;
        if (new_state) this.states[entity_id] = new_state;
        else delete this.states[entity_id];
      }
      this.eventListeners.forEach((cb) => cb(msg.event));
    }
  }

  async fetchInitialStates(): Promise<void> {
    const id = this.msgId++;
    this.send({ id, type: 'get_states' });
    return new Promise((res) => {
      const handler = (data: WebSocket.RawData): void => {
        const m = JSON.parse(data.toString());
        if (m.id === id) {
          const results: HAState[] = m.result || [];
          console.log(`✅ WebSocket: Received ${results.length} initial states from HA.`);
          results.forEach((s) => (this.states[s.entity_id] = s));
          this.ws!.removeListener('message', handler);
          res();
        }
      };
      this.ws!.on('message', handler);
    });
  }

  /**
   * Fetches the complete entity registry from Home Assistant.
   *
   * Coalesced: EntityManager's post-registration ACK poll calls this once per
   * entity every 500ms while confirming it appeared in HA. With many entities
   * registering at boot (e.g. ~30 across a dozen scripts), that used to mean
   * dozens of full-registry-list round-trips per second — a self-inflicted
   * flood that visibly overwhelmed both HA and this addon for minutes at a
   * time. Concurrent callers now share a single in-flight request instead of
   * each firing their own.
   */
  async getEntityRegistry(): Promise<unknown[]> {
    if (!this.isReady) return [];
    if (this._entityRegistryInFlight) return this._entityRegistryInFlight;
    const id = this.msgId++;
    this.send({ id, type: 'config/entity_registry/list' });
    this._entityRegistryInFlight = new Promise<unknown[]>((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          resolve(msg.result || []);
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve([]);
      }, 5000);
    }).finally(() => {
      this._entityRegistryInFlight = null;
    });
    return this._entityRegistryInFlight;
  }

  /**
   * Fetches the complete device registry from Home Assistant.
   */
  async getDeviceRegistry(): Promise<unknown[]> {
    if (!this.isReady) return [];
    const id = this.msgId++;
    this.send({ id, type: 'config/device_registry/list' });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          resolve(msg.result || []);
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve([]);
      }, 5000);
    });
  }

  /**
   * Fetches all configuration entries from Home Assistant.
   * Useful to detect MQTT broker settings.
   */
  async getConfigEntries(): Promise<unknown[]> {
    if (!this.isReady) return [];
    const id = this.msgId++;
    this.send({ id, type: 'config/config_entries/list' });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          resolve(msg.result || []);
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve([]);
      }, 5000);
    });
  }

  /**
   * Updates entity registry properties (area_id, labels, etc.) via WebSocket.
   * @param entityId - The entity ID to update.
   * @param updates - Fields to update (e.g., { area_id, labels }).
   */
  async updateEntityRegistry(entityId: string, updates: Record<string, unknown>): Promise<CommandResult> {
    if (!this.isReady) return { success: false, error: 'not_ready' };
    const id = this.msgId++;
    this.send({ id, type: 'config/entity_registry/update', entity_id: entityId, ...updates });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          if (msg.success !== false) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: msg.error?.message || msg.error?.code || JSON.stringify(msg.error) });
          }
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve({ success: false, error: 'timeout' });
      }, 5000);
    });
  }

  /**
   * Deletes an entity state from Home Assistant's state machine via REST API.
   * Use this to remove orphaned states (present in state machine but not in entity registry)
   * that would block entity_id assignment or rename operations.
   * @param entityId - The entity ID whose state to delete.
   */
  async deleteState(entityId: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/api/states/${entityId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      });
      return resp.ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * Removes an entity from the Home Assistant entity registry.
   * @param entityId - The entity ID to remove (e.g., 'switch.my_script').
   */
  async removeEntity(entityId: string): Promise<boolean> {
    if (!this.isReady) return false;
    const id = this.msgId++;
    this.send({ id, type: 'config/entity_registry/remove', entity_id: entityId });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          resolve(msg.success);
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Fetches the state history for an entity from Home Assistant.
   */
  async getHistory(entityId: string, options: HistoryOptions = {}): Promise<HistoryEntry[]> {
    if (!this.isReady) return [];
    const start = options.start instanceof Date ? options.start : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = options.end instanceof Date ? options.end : new Date();
    const result = await this.sendCommand(
      'history/history_during_period',
      {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [entityId],
        minimal_response: options.minimalResponse !== false,
        no_attributes: options.noAttributes === true,
        significant_changes_only: false,
      },
      10000
    );
    if (!result || typeof result !== 'object') return [];
    const entries: Record<string, any>[] = (result as Record<string, any>)[entityId] || [];
    // HA returns timestamps as Unix floats (seconds) in minimal_response mode.
    // Field names: state/last_changed/last_updated (full) or s/lc/lu (compact).
    // last_changed may be absent when only last_updated changed — fall back to last_updated.
    const toIso = (ts: number | null | undefined): string | undefined =>
      ts != null ? new Date(ts * 1000).toISOString() : undefined;
    return entries.map((e) => {
      const rawTs = e.last_changed ?? e.lc ?? e.last_updated ?? e.lu;
      return {
        state: e.state ?? e.s,
        last_changed: typeof rawTs === 'number' ? toIso(rawTs) : rawTs,
        ...(e.attributes ? { attributes: e.attributes } : {}),
      };
    });
  }

  /**
   * Fetches long-term statistics for a statistic ID (e.g. energy sensors).
   */
  async getStatistics(statId: string, options: StatisticsOptions = {}): Promise<StatisticEntry[]> {
    if (!this.isReady) return [];
    const start = options.start instanceof Date ? options.start : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const payload: Record<string, unknown> = {
      start_time: start.toISOString(),
      statistic_ids: [statId],
      period: options.period || 'hour',
      types: options.types || ['mean', 'min', 'max', 'sum'],
    };
    if (options.end instanceof Date) payload.end_time = options.end.toISOString();
    const result = await this.sendCommand('recorder/statistics_during_period', payload, 10000);
    if (!result || typeof result !== 'object') return [];
    const entries: Record<string, any>[] = (result as Record<string, any>)[statId] || [];
    const toIso = (ts: number | string | null | undefined): string | undefined =>
      ts != null ? (typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : ts) : undefined;
    return entries.map((e) => {
      const entry: StatisticEntry = { start: toIso(e.start) };
      if (e.mean !== undefined) entry.mean = e.mean;
      if (e.min !== undefined) entry.min = e.min;
      if (e.max !== undefined) entry.max = e.max;
      if (e.sum !== undefined) entry.sum = e.sum;
      return entry;
    });
  }

  /**
   * Evaluates a Jinja2 template string via HA's template engine.
   * render_template uses a subscription model: HA first sends a "result" frame
   * confirming the subscription (result: null), then an "event" frame with the value.
   */
  renderTemplate(template: string): Promise<string | number | boolean | null> {
    if (!this.isReady) return Promise.resolve(null);
    const id = this.msgId++;
    this.send({ id, type: 'render_template', template });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve(null);
      }, 5000);
      const handler = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== id) return;
          // "result" frame just confirms the subscription — ignore unless it's an error
          if (msg.type === 'result' && !msg.success) {
            clearTimeout(timer);
            this.ws!.removeListener('message', handler);
            resolve(null);
            return;
          }
          // "event" frame carries the actual rendered value
          if (msg.type === 'event') {
            clearTimeout(timer);
            this.ws!.removeListener('message', handler);
            this.send({ id: this.msgId++, type: 'unsubscribe_events', subscription: id });
            resolve(msg.event?.result ?? null);
          }
        } catch {
          /* ignore malformed message */
        }
      };
      this.ws!.on('message', handler);
    });
  }

  /**
   * Fetches upcoming events from a HA calendar entity.
   */
  async getCalendarEvents(entityId: string, options: CalendarOptions = {}): Promise<CalendarEvent[]> {
    if (!this.isReady) return [];
    const start = options.start instanceof Date ? options.start : new Date();
    const end = options.end instanceof Date ? options.end : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (!this.baseUrl || !this.token) return [];
    try {
      const url = `${this.baseUrl}/api/calendars/${entityId}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!res.ok) return [];
      const events = await res.json();
      if (!Array.isArray(events)) return [];
      return events.map((e: any) => ({
        summary: e.summary || '',
        start: e.start?.dateTime || e.start?.date || e.start || '',
        end: e.end?.dateTime || e.end?.date || e.end || '',
        all_day: !!(e.start?.date && !e.start?.dateTime),
        ...(e.description ? { description: e.description } : {}),
        ...(e.location ? { location: e.location } : {}),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetches items from a HA todo list entity.
   */
  async getTodoItems(entityId: string): Promise<unknown[]> {
    if (!this.isReady) return [];
    const result = await this.sendCommand('todo/item/list', { entity_id: entityId }, 10000);
    if (!result || typeof result !== 'object') return [];
    const r = result as Record<string, any>;
    return r.items || r[entityId]?.items || [];
  }

  /**
   * Fetches the HA floor registry (HA 2024.2+).
   */
  async getFloorRegistry(): Promise<unknown[]> {
    if (!this.isReady) return [];
    const result = await this.sendCommand('config/floor_registry/list');
    return Array.isArray(result) ? result : [];
  }

  getStates(): HAState[] {
    return Object.values(this.states);
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  subscribeEvents(): void {
    if (this._subscribed) return;
    this._subscribed = true;
    this.send({ id: this.msgId++, type: 'subscribe_events' });
  }

  subscribeToEvents(callback: (event: HAEvent) => void): void {
    this.eventListeners.push(callback);
  }

  /**
   * Fires a custom event on the HA event bus.
   * Used to send jsa_action_result back to the originating Lovelace card.
   */
  fireEvent(eventType: string, eventData: Record<string, unknown> = {}): Promise<unknown> {
    return this.sendCommand('fire_event', { event_type: eventType, event_data: eventData });
  }

  /**
   * Fetches HA's own entity_component icon translations (domain → device_class → {default, state, range}).
   * Used by the WATCH tab to mirror HA's real device_class icons instead of guessing them.
   * Cached per connection since these only change on an HA core update/restart.
   */
  async getIcons(): Promise<Record<string, unknown>> {
    if (!this.isReady) return {};
    if (this._iconsCache) return this._iconsCache;
    if (this._iconsInFlight) return this._iconsInFlight;
    this._iconsInFlight = this.sendCommand('frontend/get_icons', { category: 'entity_component' })
      .then((result: any) => {
        this._iconsCache = (result && result.resources) || {};
        return this._iconsCache as Record<string, unknown>;
      })
      .finally(() => {
        this._iconsInFlight = null;
      });
    return this._iconsInFlight;
  }

  /**
   * Sends a WebSocket command to HA and waits for the matching response.
   * @param type    - HA WebSocket message type
   * @param payload - Additional fields merged into the message
   * @returns HA response result (or { success: false, error } on failure/timeout)
   */
  sendCommand(type: string, payload: Record<string, unknown> = {}, timeout = 5000): Promise<unknown> {
    if (!this.isReady) return Promise.resolve({ success: false, error: 'not_ready' });
    const id = this.msgId++;
    this.send({ id, type, ...payload });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve({ success: false, error: 'timeout' });
      }, timeout);
      const handler = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== id) return;
          clearTimeout(timer);
          this.ws!.removeListener('message', handler);
          if (msg.success === false) {
            resolve({ success: false, error: msg.error?.message || msg.error?.code || JSON.stringify(msg.error) });
          } else if (Array.isArray(msg.result)) {
            resolve(msg.result);
          } else {
            resolve({ success: true, ...(msg.result || {}) });
          }
        } catch {
          /* ignore parse errors from unrelated messages */
        }
      };
      this.ws!.on('message', handler);
    });
  }

  createEntity(domain: string, name: string, prefix: string, options: Record<string, unknown>): void {
    const entityId = `${domain}.${prefix}_${name}`;
    this.updateState(entityId, 'off', options);
  }

  async updateState(entityId: string, state: string, attributes: Record<string, unknown> = {}): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${this.baseUrl}/api/states/${entityId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, attributes }),
      });
    } catch (err) {
      /* ignore, best-effort state push */
    }
  }

  /**
   * Fetches the Home Assistant configuration (including language).
   */
  async getHAMetadata(): Promise<HAMetadata> {
    if (!this.isReady) return { areas: [], labels: [], language: 'en' };
    const idA = this.msgId++;
    const idL = this.msgId++;
    const idC = this.msgId++;
    this.send({ id: idA, type: 'config/area_registry/list' });
    this.send({ id: idL, type: 'config/label_registry/list' });
    this.send({ id: idC, type: 'get_config' });
    return new Promise((res) => {
      const out: HAMetadata = { areas: [], labels: [], language: 'en' };
      let c = 0;
      const h = (d: WebSocket.RawData): void => {
        const m = JSON.parse(d.toString());
        if (m.id === idA) {
          out.areas = m.result || [];
          c++;
        }
        if (m.id === idL) {
          out.labels = m.result || [];
          c++;
        }
        if (m.id === idC) {
          if (m.result && m.result.language) {
            out.language = m.result.language.split('-')[0];
          }
          c++;
        }
        if (c === 3) {
          this.ws!.removeListener('message', h);
          res(out);
        }
      };
      this.ws!.on('message', h);

      // Safety timeout to prevent hanging if one of the 3 requests fails
      setTimeout(() => {
        if (c < 3) {
          this.ws!.removeListener('message', h);
          res(out);
        }
      }, 5000);
    });
  }

  callService(domain: string, service: string, data: Record<string, unknown>, expectResponse = false): Promise<unknown> {
    if (!this.isReady) return Promise.reject(new Error('WebSocket not connected'));
    const id = this.msgId++;
    const msg: Record<string, unknown> = { id, type: 'call_service', domain, service, service_data: data };
    if (expectResponse) {
      msg.return_response = true;
      // Response-required calls attribute results per matched entity using the
      // dedicated `target` selector — entity_id folded into service_data alone
      // (fine for regular actions) resolves to zero matched entities here and
      // HA replies "did not match any entities" regardless of a valid entity_id.
      if (data && data.entity_id) msg.target = { entity_id: data.entity_id };
    }
    this.send(msg);

    return new Promise((resolve, reject) => {
      const handler = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            this.ws!.removeListener('message', handler);
            if (msg.success) resolve(msg.result);
            else reject(new Error(msg.error ? msg.error.message : 'Unknown Service Error'));
          }
        } catch (e) {
          /* ignore parse errors */
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        reject(new Error('Service Call Timeout'));
      }, 5000);
    });
  }

  /**
   * Fetches the Home Assistant configuration (including language).
   */
  async getHAConfig(): Promise<Record<string, unknown>> {
    if (!this.isReady) return {};
    const id = this.msgId++;
    this.send({ id, type: 'get_config' });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            this.ws!.removeListener('message', handler);
            resolve(msg.result || {});
          }
        } catch (e) {
          /* ignore parse errors */
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve({});
      }, 5000);
    });
  }

  /**
   * Fetches all available services from Home Assistant.
   */
  async getServices(): Promise<Record<string, any>> {
    if (!this.isReady) return {};
    const id = this.msgId++;
    this.send({ id, type: 'get_services' });
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData): void => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          this.ws!.removeListener('message', handler);
          resolve(msg.result || {});
        }
      };
      this.ws!.on('message', handler);
      setTimeout(() => {
        this.ws!.removeListener('message', handler);
        resolve({});
      }, 5000);
    });
  }

  /**
   * Checks if the integration (custom component) is loaded.
   */
  async checkIntegrationAvailable(): Promise<{ available: boolean; version?: string | null }> {
    const services = await this.getServices();
    const api = services && services.js_automations;

    if (!api || !api.create_entity) {
      return { available: false };
    }

    let version = null;
    if (api.get_info) {
      try {
        const result: any = await this.callService('js_automations', 'get_info', {}, true);
        // HA wraps the ServiceResponse in a 'response' property when returned via WebSocket
        version = result?.response?.version || result?.version || null;
      } catch (err) {
        // Fail silently if the service call fails (e.g. old version doesn't support response)
        console.warn(`[HAConnector] Could not fetch integration version: ${(err as Error).message}`);
      }
    }

    return {
      available: true,
      version,
    };
  }
}
export = HAConnector;
