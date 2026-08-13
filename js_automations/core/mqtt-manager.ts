// core/mqtt-manager.ts
import * as mqtt from 'mqtt';
import { EventEmitter } from 'events';

interface MqttSettings {
  enabled?: boolean;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

interface SettingsManagerLike {
  on(event: 'settings_updated', listener: (settings: { mqtt?: MqttSettings }) => void): void;
  getSettings(): { mqtt?: MqttSettings };
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

interface HaConfigEntry {
  domain: string;
  data?: { broker?: string; host?: string; port?: number; username?: string };
  options?: { broker?: string; host?: string; port?: number; username?: string };
}

interface HaConnectionLike {
  getConfigEntries(): Promise<unknown[]>;
}

interface TestConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

interface TestConnectionResult {
  success: boolean;
  error?: string;
}

interface DiscoveredSettings {
  host: string;
  port: number;
  username: string;
  _isFallback?: boolean;
}

interface RawSubscription {
  topic: string;
  scriptId: string;
  callback: (topic: string, payload: string) => void;
}

interface EntityConfig {
  state_topic?: string;
  json_attributes_topic?: string;
}

/**
 * MqttManager handles the connection to the MQTT broker and manages
 * communication for Home Assistant MQTT Discovery.
 */
class MqttManager extends EventEmitter {
  settingsManager: SettingsManagerLike;
  logManager: LogManagerLike;
  haConnection: HaConnectionLike;
  client: mqtt.MqttClient | null;
  isConnected: boolean;
  private healthCheckTimer: ReturnType<typeof setInterval> | null;
  private _lastConfig: MqttSettings | null;
  private _reconnectFallbackTimer: ReturnType<typeof setTimeout> | null;
  private _monitoring: boolean;
  statusTopic: string;
  discoveryPrefix: string;
  private _rawSubscriptions: Map<string, RawSubscription>;

  constructor(settingsManager: SettingsManagerLike, logManager: LogManagerLike, haConnection: HaConnectionLike) {
    super();
    this.settingsManager = settingsManager;
    this.logManager = logManager;
    this.haConnection = haConnection;
    this.client = null;
    this.isConnected = false;
    this.healthCheckTimer = null;
    this._lastConfig = null;
    this._reconnectFallbackTimer = null;
    this._monitoring = false;

    // Global availability topic as defined in the concept
    this.statusTopic = 'jsa/status';
    this.discoveryPrefix = 'homeassistant';

    // Raw MQTT subscriptions from ha.mqtt.subscribe(): subscriptionId → { topic, scriptId, callback }
    this._rawSubscriptions = new Map();

    // Listen for settings changes to apply MQTT configuration dynamically
    this.settingsManager.on('settings_updated', (settings) => {
      if (settings.mqtt) {
        this.handleSettingsUpdate(settings.mqtt);
      }
    });
  }

  /**
   * Initializes the MQTT connection based on current settings.
   * Returns a promise that resolves when the connection is established.
   */
  async connect(): Promise<void> {
    const settings = this.settingsManager.getSettings().mqtt;
    if (!settings || !settings.enabled) {
      this.logManager.add('debug', 'System', '[MQTT] MQTT is disabled in settings.');
      return;
    }

    return new Promise((resolve) => {
      this._connectToBroker(settings);

      // Resolve as soon as MQTT connects, or after 10 s so kernel boot is never blocked.
      // Do NOT reject on error: the mqtt library retries automatically (reconnectPeriod: 5 s).
      // Rejecting would abort kernel.start() and prevent scripts from loading.
      this.client!.once('connect', () => resolve());
      setTimeout(() => resolve(), 10000);
    });
  }

  /**
   * Handles updates to MQTT settings at runtime.
   * Disconnects or reconnects as needed.
   */
  handleSettingsUpdate(mqttSettings: MqttSettings): void {
    const isEnabled = mqttSettings.enabled;

    // If disabled but client exists, shut it down
    if (!isEnabled && this.client) {
      this.logManager.add('debug', 'System', '[MQTT] MQTT disabled in settings. Disconnecting...');
      this.disconnect();
      return;
    }

    // If enabled, reconnect to ensure new settings (host/creds) are applied
    if (isEnabled) {
      this.logManager.add('debug', 'System', '[MQTT] MQTT settings updated. Reconnecting...');
      this.disconnect();
      this._connectToBroker(mqttSettings);
    }
  }

  /**
   * Static helper to test a connection without using the main client.
   * Useful for the "Test Connection" button in settings.
   */
  static testConnection(config: TestConnectionConfig): Promise<TestConnectionResult> {
    return new Promise((resolve) => {
      const { host, port, username, password } = config;
      const brokerUrl = `mqtt://${host}:${port}`;

      const testClient = mqtt.connect(brokerUrl, {
        clientId: `jsa_test_${Math.random().toString(16).substring(2, 8)}`,
        username: username || undefined,
        password: password || undefined,
        connectTimeout: 5000,
        reconnectPeriod: 0, // Do not attempt to reconnect during test
      });

      let finished = false;

      // mqtt.js's own connectTimeout doesn't reliably fire an 'error' for every
      // failure mode (e.g. a filtered port that neither refuses nor responds) —
      // without this, the test hangs forever and the UI is stuck on "Testing...".
      const fallbackTimer = setTimeout(() => {
        if (finished) return;
        finished = true;
        testClient.end(true);
        resolve({ success: false, error: 'Connection timed out' });
      }, 6000);

      testClient.on('connect', () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallbackTimer);
        testClient.end(true);
        resolve({ success: true });
      });

      testClient.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(fallbackTimer);
        testClient.end(true);
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Attempts to discover MQTT broker settings from Home Assistant.
   */
  async discoverSettings(): Promise<DiscoveredSettings | null> {
    this.logManager.add('debug', 'System', '[MQTT] Attempting to discover settings from Home Assistant...');

    const entries = (await this.haConnection.getConfigEntries()) as HaConfigEntry[];
    const mqttEntry = entries.find((e) => e.domain === 'mqtt');

    if (mqttEntry) {
      this.logManager.add('debug', 'System', `[MQTT] Found MQTT config entry: ${JSON.stringify(mqttEntry)}`);

      // HA stores broker hostname as 'broker' in data or options (varies by HA version)
      const brokerFromEntry =
        mqttEntry.data?.broker || mqttEntry.data?.host || mqttEntry.options?.broker || mqttEntry.options?.host;

      const portFromEntry = mqttEntry.data?.port || mqttEntry.options?.port;

      const usernameFromEntry = mqttEntry.data?.username || mqttEntry.options?.username || '';

      const isAddon = !!process.env.SUPERVISOR_TOKEN;
      // Use core-mosquitto when running as addon and broker points to the Mosquitto addon
      const isMosquittoAddon = isAddon && (!brokerFromEntry || brokerFromEntry === 'core-mosquitto');
      const discovery: DiscoveredSettings = {
        host: isMosquittoAddon ? 'core-mosquitto' : brokerFromEntry || 'localhost',
        port: portFromEntry || 1883,
        username: usernameFromEntry,
      };

      this.logManager.add('debug', 'System', `[MQTT] Discovery successful: ${discovery.host}:${discovery.port}`);
      return discovery;
    }

    // No MQTT config entry found – when running as addon, suggest core-mosquitto as best guess
    const isAddon = !!process.env.SUPERVISOR_TOKEN;
    if (isAddon) {
      this.logManager.add(
        'debug',
        'System',
        '[MQTT] No MQTT config entry found. Suggesting core-mosquitto as fallback.'
      );
      return { host: 'core-mosquitto', port: 1883, username: '', _isFallback: true };
    }

    return null;
  }

  /**
   * Establishes the MQTT connection to the broker.
   */
  private _connectToBroker(config: MqttSettings): void {
    const { host, port, username, password } = config;
    this._lastConfig = config;
    const brokerUrl = `mqtt://${host}:${port}`;

    const options: mqtt.IClientOptions = {
      clientId: `jsa_addon_${Math.random().toString(16).substring(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      keepalive: 60, // Seconds between PINGREQs to detect dead connections
      connectTimeout: 30000,
      username: username || undefined,
      password: password || undefined,
      will: {
        topic: this.statusTopic,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    };

    this.logManager.add('debug', 'System', `[MQTT] Connecting to broker at ${brokerUrl}...`);

    try {
      this.client = mqtt.connect(brokerUrl, options);

      this.client.on('connect', () => {
        this.isConnected = true;
        this._clearReconnectFallback();
        this.logManager.add('debug', 'System', '[MQTT] Connection established.');

        // Publish Birth Message
        this.publish(this.statusTopic, 'online', { retain: true });

        // Subscribe to all inbound JSA topics (command topics for switch/button/select/number/text entities)
        this.client!.subscribe('jsa/#', (err) => {
          if (err) this.logManager.add('error', 'System', `[MQTT] Failed to subscribe to jsa/#: ${err.message}`);
          else this.logManager.add('debug', 'System', '[MQTT] Subscribed to jsa/#');
        });

        // Re-subscribe to any active raw subscriptions (e.g. after reconnect)
        const rawTopics = new Set([...this._rawSubscriptions.values()].map((s) => s.topic));
        for (const topic of rawTopics) {
          this.client!.subscribe(topic, (err) => {
            if (err)
              this.logManager.add(
                'error',
                'System',
                `[MQTT] Failed to resubscribe to raw topic ${topic}: ${err.message}`
              );
          });
        }

        // Re-subscribe to wildcard monitor if active
        if (this._monitoring) this.client!.subscribe('#');

        // Start the health monitoring watchdog
        this._startHealthCheck();

        this.emit('status_change', { connected: true });
      });

      this.client.on('message', (topic, message) => {
        this._handleIncomingMessage(topic, message.toString());
      });

      this.client.on('error', (err) => {
        this.logManager.add('error', 'System', `[MQTT] Error: ${err.message}`);
        this.emit('status_change', { connected: false, error: err.message });
        // Workaround: mqtt.js sometimes fails to auto-reconnect after initial ECONNREFUSED.
        // If still disconnected after 15s, force a fresh client.
        this._scheduleReconnectFallback();
      });

      this.client.on('offline', () => {
        if (this.isConnected) {
          this.logManager.add('warn', 'System', '[MQTT] Client went offline.');
          this.isConnected = false;
          this.emit('status_change', { connected: false, error: 'Offline' });
        }
        // Not just 'error': a clean broker-side disconnect (e.g. co-located
        // Mosquitto restarting during a HAOS update) goes straight to 'offline'
        // without an 'error' event, so the stuck-client fallback must arm here too.
        this._scheduleReconnectFallback();
      });

      this.client.on('close', () => {
        if (this.isConnected) {
          this.isConnected = false;
          this.logManager.add('debug', 'System', '[MQTT] Connection closed.');
          this.emit('status_change', { connected: false });
        }
        this._stopHealthCheck();
        // Only arm the fallback for unexpected closes; disconnect() nulls
        // this.client before end(true), so a deliberate shutdown is a no-op here.
        if (this.client) this._scheduleReconnectFallback();
      });
    } catch (e) {
      this.logManager.add('error', 'System', `[MQTT] Initialization failed: ${(e as Error).message}`);
    }
  }

  /**
   * Starts the periodic connection health monitor.
   */
  private _startHealthCheck(): void {
    this._stopHealthCheck();
    // Run health check every 30 seconds
    this.healthCheckTimer = setInterval(() => this._performHealthCheck(), 30000);
  }

  /**
   * Stops the periodic connection health monitor.
   */
  private _stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Evaluates the current connection health. Corrective, not just observational:
   * covers the edge case where the socket dies without emitting 'close'/'offline'
   * (e.g. a silent network partition), which would otherwise leave the client
   * stuck forever since nothing else would arm the reconnect fallback.
   */
  private _performHealthCheck(): void {
    if (!this.client) return;

    if (!this.client.connected && this.isConnected) {
      this.logManager.add('debug', 'System', '[MQTT] Health check: Connection appears to be lost.');
      this.isConnected = false;
      this.emit('status_change', { connected: false, error: 'Unresponsive' });
    }

    if (!this.client.connected) {
      this._scheduleReconnectFallback();
    }
  }

  /**
   * Defense-in-depth check, meant to be called after Home Assistant reconnects.
   * A HAOS/HA-core restart is exactly the window where the MQTT broker (often the
   * co-located Mosquitto addon) can also be briefly unavailable, which can leave
   * the very first connect() attempt in a state mqtt.js's own reconnectPeriod
   * timer never recovers from. Forces a fresh connection attempt if MQTT is
   * enabled but not currently connected; a no-op otherwise.
   */
  ensureConnected(): void {
    const settings = this.settingsManager.getSettings().mqtt;
    if (!settings || !settings.enabled || this.isConnected) return;

    this.logManager.add(
      'warn',
      'System',
      '[MQTT] Still not connected after HA reconnect. Forcing fresh connection attempt...'
    );
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this._clearReconnectFallback();
    this._connectToBroker(this._lastConfig || settings);
  }

  /**
   * Helper to publish data. Objects are automatically stringified.
   * Providing null or undefined results in an empty payload (clears retained messages).
   */
  publish(topic: string, payload: unknown, options: mqtt.IClientPublishOptions = {}): void {
    if (!this.client || !this.isConnected) return;

    let message = '';
    if (payload !== null && payload !== undefined) {
      message = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    }

    this.client.publish(topic, message, options);
    this.emit('raw_message', { topic, payload: message, direction: 'out', ts: Date.now() });
  }

  /**
   * Publishes the state and attributes of an entity based on its configuration.
   * This automatically handles stringification and topic routing for sub-topics.
   *
   * @param entityConfig The discovery configuration payload.
   * @param state The new state value (null or undefined to clear).
   * @param attributes Optional attributes object (null or empty to clear).
   */
  publishEntityState(entityConfig: EntityConfig, state: unknown, attributes: Record<string, unknown> = {}): void {
    if (!this.isConnected || !entityConfig) return;

    // 1. Normalize state to MQTT-friendly string (ON/OFF for binary states)
    let normalizedState = state === undefined || state === null ? null : String(state);
    if (typeof state === 'boolean') {
      normalizedState = state ? 'ON' : 'OFF';
    } else if (normalizedState && (normalizedState.toLowerCase() === 'on' || normalizedState.toLowerCase() === 'off')) {
      normalizedState = normalizedState.toUpperCase();
    }

    // 2. Unified Payload Handling:
    // If state and attributes topics are the same, we send one combined JSON.
    if (entityConfig.state_topic && entityConfig.state_topic === entityConfig.json_attributes_topic) {
      const finalAttributes: Record<string, unknown> = { ...attributes };

      // Extract icon and remove from attributes to avoid shadowing in HA
      const iconToUse = finalAttributes.icon || finalAttributes.entity_icon || null;
      delete finalAttributes.icon;
      delete finalAttributes.entity_icon;

      const unifiedPayload: { state: string | null; attributes: Record<string, unknown>; icon?: unknown } = {
        state: normalizedState,
        attributes: finalAttributes,
      };

      // Only include icon if it has a real value — otherwise value_json.icon
      // would be defined-but-null, breaking the icon_template fallback in HA
      if (iconToUse !== null && iconToUse !== undefined) {
        unifiedPayload.icon = iconToUse;
      }

      this.publish(entityConfig.state_topic, unifiedPayload, { retain: true });

      this.logManager.add(
        'debug',
        'System',
        `[MQTT] Publishing unified payload to ${entityConfig.state_topic}: ${JSON.stringify(unifiedPayload)}`
      );
      return;
    }

    // 3. Legacy / Split-Topic Fallback (if topics are different)
    if (entityConfig.json_attributes_topic) {
      const attrPayload =
        attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0 ? attributes : null;
      this.publish(entityConfig.json_attributes_topic, attrPayload, { retain: true });
      this.logManager.add(
        'debug',
        'System',
        `[MQTT] Publishing attributes to ${entityConfig.json_attributes_topic}: ${JSON.stringify(attrPayload)}`
      );
    }

    if (entityConfig.state_topic) {
      this.publish(entityConfig.state_topic, normalizedState, { retain: true });
      this.logManager.add(
        'debug',
        'System',
        `[MQTT] Publishing state to ${entityConfig.state_topic}: ${JSON.stringify(normalizedState)}`
      );
    }
  }

  /**
   * Subscribes to a topic.
   */
  subscribe(topic: string): void {
    if (this.client) this.client.subscribe(topic);
  }

  /**
   * Registers a raw MQTT subscription for a script (ha.mqtt.subscribe()).
   * Subscribes to the broker topic and stores the callback.
   * @param subscriptionId - Unique ID for this subscription
   * @param topic - MQTT topic filter (wildcards + and # supported)
   * @param scriptId - Owning script filename for cleanup on stop
   * @param callback - Called with (topic, payload) on match
   */
  subscribeRaw(
    subscriptionId: string,
    topic: string,
    scriptId: string,
    callback: (topic: string, payload: string) => void
  ): void {
    this._rawSubscriptions.set(subscriptionId, { topic, scriptId, callback });
    if (this.client && this.isConnected) {
      this.client.subscribe(topic, (err) => {
        if (err)
          this.logManager.add('error', 'System', `[MQTT] Failed to subscribe to raw topic ${topic}: ${err.message}`);
      });
    }
  }

  /**
   * Removes a single raw subscription by ID. Unsubscribes from the broker if
   * no other subscription needs the same topic.
   */
  unsubscribeRaw(subscriptionId: string): void {
    const sub = this._rawSubscriptions.get(subscriptionId);
    if (!sub) return;
    this._rawSubscriptions.delete(subscriptionId);
    const stillNeeded = [...this._rawSubscriptions.values()].some((s) => s.topic === sub.topic);
    if (!stillNeeded && this.client && this.isConnected) {
      this.client.unsubscribe(sub.topic);
    }
  }

  /**
   * Removes all raw subscriptions belonging to a specific script.
   * Called automatically when a script stops.
   * @param scriptId - Script filename
   */
  unsubscribeAllRawByScript(scriptId: string): void {
    for (const subscriptionId of [...this._rawSubscriptions.keys()]) {
      if (this._rawSubscriptions.get(subscriptionId)!.scriptId === scriptId) {
        this.unsubscribeRaw(subscriptionId);
      }
    }
  }

  /**
   * Checks whether an MQTT topic matches a filter pattern.
   * Supports + (single-level) and # (multi-level) wildcards.
   * @param filter - Topic filter (e.g. 'shellies/+/light/0/status')
   * @param topic  - Actual incoming topic
   */
  private _mqttTopicMatches(filter: string, topic: string): boolean {
    const fp = filter.split('/');
    const tp = topic.split('/');
    for (let i = 0; i < fp.length; i++) {
      if (fp[i] === '#') return true;
      if (i >= tp.length) return false;
      if (fp[i] !== '+' && fp[i] !== tp[i]) return false;
    }
    return fp.length === tp.length;
  }

  startMonitoring(): void {
    if (this._monitoring) return;
    this._monitoring = true;
    if (this.client && this.isConnected) {
      this.client.subscribe('#', (err) => {
        if (err) this.logManager.add('error', 'System', `[MQTT] Monitor: failed to subscribe to #: ${err.message}`);
      });
    }
  }

  stopMonitoring(): void {
    if (!this._monitoring) return;
    this._monitoring = false;
    if (this.client && this.isConnected) this.client.unsubscribe('#');
  }

  private _handleIncomingMessage(topic: string, message: string): void {
    this.emit('raw_message', { topic, payload: message, direction: 'in', ts: Date.now() });

    const parts = topic.split('/');
    // Routing logic for command topics: jsa/<domain>/<script_id>/set
    if (parts[0] === 'jsa' && parts[3] === 'set') {
      this.emit('command', { domain: parts[1], scriptId: parts[2], payload: message });
    }

    // Route to raw subscriptions (ha.mqtt.subscribe())
    for (const sub of this._rawSubscriptions.values()) {
      if (this._mqttTopicMatches(sub.topic, topic)) {
        sub.callback(topic, message);
      }
    }
  }

  /**
   * Schedules a forced client restart if the client is still disconnected after 15 seconds.
   * Guards against the edge case where mqtt.js fails to auto-reconnect after the initial
   * ECONNREFUSED (e.g. when the broker is not yet ready on addon startup).
   */
  private _scheduleReconnectFallback(): void {
    if (this._reconnectFallbackTimer || this.isConnected) return;
    this._reconnectFallbackTimer = setTimeout(() => {
      this._reconnectFallbackTimer = null;
      if (this.isConnected || !this._lastConfig || !this.client) return;
      if (this.client.disconnecting) return;
      this.logManager.add('warn', 'System', '[MQTT] Fallback: client appears stuck. Forcing fresh reconnect...');
      this.client.end(true);
      this.client = null;
      this._connectToBroker(this._lastConfig);
    }, 15000);
  }

  /**
   * Cancels any pending forced-reconnect fallback timer.
   */
  private _clearReconnectFallback(): void {
    if (this._reconnectFallbackTimer) {
      clearTimeout(this._reconnectFallbackTimer);
      this._reconnectFallbackTimer = null;
    }
  }

  disconnect(): void {
    this._clearReconnectFallback();
    if (this.client) {
      this.client.end(true);
      this.client = null;
      this._stopHealthCheck();
      this.isConnected = false;
      this.emit('status_change', { connected: false });
    }
  }
}

export = MqttManager;
