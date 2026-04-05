// core/mqtt-manager.js
const mqtt = require('mqtt');
const EventEmitter = require('events');

/**
 * MqttManager handles the connection to the MQTT broker and manages
 * communication for Home Assistant MQTT Discovery.
 */
class MqttManager extends EventEmitter {
    constructor(settingsManager, logManager, haConnection) {
        super();
        this.settingsManager = settingsManager;
        this.logManager = logManager;
        this.haConnection = haConnection;
        this.client = null;
        this.isConnected = false;
        this.healthCheckTimer = null;

        // Global availability topic as defined in the concept
        this.statusTopic = 'jsa/status';
        this.discoveryPrefix = 'homeassistant';

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
    async connect() {
        const settings = this.settingsManager.getSettings().mqtt;
        if (!settings || !settings.enabled) {
            this.logManager.add('debug', 'System', '[MQTT] MQTT is disabled in settings.');
            return;
        }

        return new Promise((resolve, reject) => {
            this._connectToBroker(settings);

            // Wait for first connection success or error
            this.client.once('connect', () => resolve());
            this.client.once('error', (err) => reject(err));
            // Timeout after 10 seconds to not block kernel boot indefinitely
            setTimeout(() => resolve(), 10000);
        });
    }

    /**
     * Handles updates to MQTT settings at runtime.
     * Disconnects or reconnects as needed.
     */
    handleSettingsUpdate(mqttSettings) {
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
     * @param {object} config - { host, port, username, password }
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static testConnection(config) {
        return new Promise((resolve) => {
            const { host, port, username, password } = config;
            const brokerUrl = `mqtt://${host}:${port}`;

            const testClient = mqtt.connect(brokerUrl, {
                clientId: `jsa_test_${Math.random().toString(16).substring(2, 8)}`,
                username: username || undefined,
                password: password || undefined,
                connectTimeout: 5000,
                reconnectPeriod: 0 // Do not attempt to reconnect during test
            });

            let finished = false;

            testClient.on('connect', () => {
                if (finished) return;
                finished = true;
                testClient.end(true);
                resolve({ success: true });
            });

            testClient.on('error', (err) => {
                if (finished) return;
                finished = true;
                testClient.end(true);
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Attempts to discover MQTT broker settings from Home Assistant.
     * @returns {Promise<object|null>}
     */
    async discoverSettings() {
        this.logManager.add('debug', 'System', '[MQTT] Attempting to discover settings from Home Assistant...');

        const entries = await this.haConnection.getConfigEntries();
        const mqttEntry = entries.find(e => e.domain === 'mqtt');

        if (mqttEntry) {
            // HA stores the broker hostname as 'broker' (not 'host') in the config entry
            const brokerFromEntry = mqttEntry.data?.broker || mqttEntry.data?.host;
            const isAddon = !!process.env.SUPERVISOR_TOKEN;
            // Use core-mosquitto only when running as HA addon AND the broker is the Mosquitto addon
            const isMosquittoAddon = isAddon && (!brokerFromEntry || brokerFromEntry === 'core-mosquitto');
            const discovery = {
                host: isMosquittoAddon ? 'core-mosquitto' : (brokerFromEntry || 'localhost'),
                port: mqttEntry.data?.port || 1883,
                username: mqttEntry.data?.username || ''
            };

            this.logManager.add('debug', 'System', `[MQTT] Discovery successful: ${discovery.host}:${discovery.port}`);
            return discovery;
        }

        return null;
    }

    /**
     * Establishes the MQTT connection to the broker.
     * @private
     */
    _connectToBroker(config) {
        const { host, port, username, password } = config;
        const brokerUrl = `mqtt://${host}:${port}`;

        const options = {
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
                retain: true
            }
        };

        this.logManager.add('debug', 'System', `[MQTT] Connecting to broker at ${brokerUrl}...`);

        try {
            this.client = mqtt.connect(brokerUrl, options);

            this.client.on('connect', () => {
                this.isConnected = true;
                this.logManager.add('debug', 'System', '[MQTT] Connection established.');

                // Publish Birth Message
                this.publish(this.statusTopic, 'online', { retain: true });

                // Subscribe to all inbound JSA topics (command topics for switch/button/select/number/text entities)
                this.client.subscribe('jsa/#', (err) => {
                    if (err) this.logManager.add('error', 'System', `[MQTT] Failed to subscribe to jsa/#: ${err.message}`);
                    else this.logManager.add('debug', 'System', '[MQTT] Subscribed to jsa/#');
                });

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
            });

            this.client.on('offline', () => {
                if (this.isConnected) {
                    this.logManager.add('warn', 'System', '[MQTT] Client went offline.');
                    this.isConnected = false;
                    this.emit('status_change', { connected: false, error: 'Offline' });
                }
            });

            this.client.on('close', () => {
                if (this.isConnected) {
                    this.isConnected = false;
                    this.logManager.add('debug', 'System', '[MQTT] Connection closed.');
                    this.emit('status_change', { connected: false });
                }
                this._stopHealthCheck();
            });
        } catch (e) {
            this.logManager.add('error', 'System', `[MQTT] Initialization failed: ${e.message}`);
        }
    }

    /**
     * Starts the periodic connection health monitor.
     * @private
     */
    _startHealthCheck() {
        this._stopHealthCheck();
        // Run health check every 30 seconds
        this.healthCheckTimer = setInterval(() => this._performHealthCheck(), 30000);
    }

    /**
     * Stops the periodic connection health monitor.
     * @private
     */
    _stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    /**
     * Evaluates the current connection health.
     * @private
     */
    _performHealthCheck() {
        if (!this.client) return;

        if (!this.client.connected && this.isConnected) {
            this.logManager.add('debug', 'System', '[MQTT] Health check: Connection appears to be lost.');
            this.isConnected = false;
            this.emit('status_change', { connected: false, error: 'Unresponsive' });
        }
    }

    /**
     * Helper to publish data. Objects are automatically stringified.
     * Providing null or undefined results in an empty payload (clears retained messages).
     */
    publish(topic, payload, options = {}) {
        if (!this.client || !this.isConnected) return;

        let message = '';
        if (payload !== null && payload !== undefined) {
            message = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
        }

        this.client.publish(topic, message, options);
    }

 /**
     * Publishes the state and attributes of an entity based on its configuration.
     * This automatically handles stringification and topic routing for sub-topics.
     * 
     * @param {object} entityConfig The discovery configuration payload.
     * @param {any} state The new state value (null or undefined to clear).
     * @param {object} [attributes] Optional attributes object (null or empty to clear).
     */
    publishEntityState(entityConfig, state, attributes = {}) {
    if (!this.isConnected || !entityConfig) return;

    // 1. Normalize state to MQTT-friendly string (ON/OFF for binary states)
    let normalizedState = (state === undefined || state === null) ? null : String(state);
    if (typeof state === 'boolean') {
        normalizedState = state ? 'ON' : 'OFF';
    } else if (normalizedState && (normalizedState.toLowerCase() === 'on' || normalizedState.toLowerCase() === 'off')) {
        normalizedState = normalizedState.toUpperCase();
    }

    // 2. Unified Payload Handling:
    // If state and attributes topics are the same, we send one combined JSON.
    if (entityConfig.state_topic && entityConfig.state_topic === entityConfig.json_attributes_topic) {

        const finalAttributes = { ...attributes };

        // Extract icon and remove from attributes to avoid shadowing in HA
        const iconToUse = finalAttributes.icon || finalAttributes.entity_icon || null;
        delete finalAttributes.icon;
        delete finalAttributes.entity_icon;

        const unifiedPayload = {
            state: normalizedState,
            attributes: finalAttributes,
        };

        // Only include icon if it has a real value — otherwise value_json.icon
        // would be defined-but-null, breaking the icon_template fallback in HA
        if (iconToUse !== null && iconToUse !== undefined) {
            unifiedPayload.icon = iconToUse;
        }

        this.publish(entityConfig.state_topic, unifiedPayload, { retain: true });

        this.logManager.add('debug', 'System', `[MQTT] Publishing unified payload: ${JSON.stringify(unifiedPayload)}`);
        return;
    }

    // 3. Legacy / Split-Topic Fallback (if topics are different)
    if (entityConfig.json_attributes_topic) {
        const attrPayload = (attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0)
            ? attributes
            : null;
        this.publish(entityConfig.json_attributes_topic, attrPayload, { retain: true });
    }

    if (entityConfig.state_topic) {
        this.publish(entityConfig.state_topic, normalizedState, { retain: true });
    }
}

    /**
     * Subscribes to a topic.
     */
    subscribe(topic) {
        if (this.client) this.client.subscribe(topic);
    }

    _handleIncomingMessage(topic, message) {
        const parts = topic.split('/');
        // Routing logic for command topics: jsa/<domain>/<script_id>/set
        if (parts[0] === 'jsa' && parts[3] === 'set') {
            this.emit('command', { domain: parts[1], scriptId: parts[2], payload: message });
        }
    }

    disconnect() {
        if (this.client) {
            this.client.end(true);
            this.client = null;
            this._stopHealthCheck();
            this.isConnected = false;
            this.emit('status_change', { connected: false });
        }
    }
}

module.exports = MqttManager;