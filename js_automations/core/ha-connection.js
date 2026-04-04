/**
 * JS AUTOMATIONS - HA Connector (v1.9.0)
 * Handles WebSocket communication and IntelliSense generation.
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class HAConnector {
    /**
     * @param {string} url - HA URL
     * @param {string} token - Access Token
     * @param {string} storageDir - New location for system files (.storage)
     */
    constructor(url, token, storageDir) {
        this.isAddon = !!process.env.SUPERVISOR_TOKEN;
        this.storageDir = storageDir;
        this.baseUrl = this.isAddon ? "http://supervisor/core" : url.replace(/\/$/, '');
        this.url = this.isAddon ? "ws://supervisor/core/api/websocket" : this.baseUrl.replace('http', 'ws').replace('https', 'wss') + '/api/websocket';
        this.token = this.isAddon ? process.env.SUPERVISOR_TOKEN : token;
        
        this.ws = null;
        this.msgId = 1;
        this.isReady = false;
        this.eventListeners = [];
        this.states = {}; // Local cache for all entity states
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log(`🔌 WebSocket: Connecting to ${this.url}...`);
            this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this.handleMessage(msg, resolve, reject);
                } catch(e) {}
            });
            this.ws.on('error', (err) => reject(err));
            this.ws.on('close', () => { this.isReady = false; });
        });
    }

    handleMessage(msg, resolve, reject) {
        if (msg.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.token });
        } else if (msg.type === 'auth_ok') {
            console.log("✅ WebSocket: Authenticated.");
            this.isReady = true;
            this.subscribeEvents();
            this.fetchInitialStates().then(resolve);
        } else if (msg.type === 'event') {
            if (msg.event.event_type === 'state_changed') {
                const { entity_id, new_state } = msg.event.data;
                if (new_state) this.states[entity_id] = new_state;
                else delete this.states[entity_id];
            }
            this.eventListeners.forEach(cb => cb(msg.event));
        }
    }

    async fetchInitialStates() {
        const id = this.msgId++;
        this.send({ id, type: 'get_states' });
        return new Promise((res) => {
            const handler = (data) => {
                const m = JSON.parse(data);
                if (m.id === id) {
                    const results = m.result || [];
                    console.log(`✅ WebSocket: Received ${results.length} initial states from HA.`);
                    results.forEach(s => this.states[s.entity_id] = s);
                    this.ws.removeListener('message', handler);
                    res();
                }
            };
            this.ws.on('message', handler);
        });
    }

    /**
     * Fetches the complete entity registry from Home Assistant.
     */
    async getEntityRegistry() {
        if (!this.isReady) return [];
        const id = this.msgId++;
        this.send({ id, type: 'config/entity_registry/list' });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.result || []);
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve([]); }, 5000);
        });
    }

    /**
     * Fetches the complete device registry from Home Assistant.
     */
    async getDeviceRegistry() {
        if (!this.isReady) return [];
        const id = this.msgId++;
        this.send({ id, type: 'config/device_registry/list' });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.result || []);
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve([]); }, 5000);
        });
    }

    /**
     * Fetches all configuration entries from Home Assistant.
     * Useful to detect MQTT broker settings.
     */
    async getConfigEntries() {
        if (!this.isReady) return [];
        const id = this.msgId++;
        this.send({ id, type: 'config/config_entries/list' });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.result || []);
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve([]); }, 5000);
        });
    }

    /**
     * Updates entity registry properties (area_id, labels, etc.) via WebSocket.
     * @param {string} entityId - The entity ID to update.
     * @param {object} updates - Fields to update (e.g., { area_id, labels }).
     */
    async updateEntityRegistry(entityId, updates) {
        if (!this.isReady) return false;
        const id = this.msgId++;
        this.send({ id, type: 'config/entity_registry/update', entity_id: entityId, ...updates });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.success !== false);
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve(false); }, 5000);
        });
    }

    /**
     * Removes an entity from the Home Assistant entity registry.
     * @param {string} entityId - The entity ID to remove (e.g., 'switch.my_script').
     */
    async removeEntity(entityId) {
        if (!this.isReady) return;
        const id = this.msgId++;
        this.send({ id, type: 'config/entity_registry/remove', entity_id: entityId });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.success);
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve(false); }, 5000);
        });
    }

    getStates() {
        return Object.values(this.states);
    }

    send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
    subscribeEvents() { this.send({ id: this.msgId++, type: 'subscribe_events' }); }
    subscribeToEvents(callback) { this.eventListeners.push(callback); }

    createEntity(domain, name, prefix, options) {
        const entityId = `${domain}.${prefix}_${name}`;
        this.updateState(entityId, 'off', options);
    }

    async updateState(entityId, state, attributes = {}) {
        if (!this.token) return;
        try {
            await fetch(`${this.baseUrl}/api/states/${entityId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ state, attributes })
            });
        } catch (err) {}
    }

    async getHAMetadata() {
        if (!this.isReady) return { areas: [], labels: [], language: 'en' };
        const idA = this.msgId++; const idL = this.msgId++; const idC = this.msgId++;
        this.send({ id: idA, type: 'config/area_registry/list' });
        this.send({ id: idL, type: 'config/label_registry/list' });
        this.send({ id: idC, type: 'get_config' });
        return new Promise((res) => {
            const out = { areas: [], labels: [], language: 'en' }; let c = 0;
            const h = (d) => {
                const m = JSON.parse(d);
                if (m.id === idA) { out.areas = m.result || []; c++; }
                if (m.id === idL) { out.labels = m.result || []; c++; }
                if (m.id === idC) {
                    if (m.result && m.result.language) {
                        out.language = m.result.language.split('-')[0];
                    }
                    c++;
                }
                if (c === 3) { this.ws.removeListener('message', h); res(out); }
            };
            this.ws.on('message', h);
            
            // Safety timeout to prevent hanging if one of the 3 requests fails
            setTimeout(() => {
                if (c < 3) { this.ws.removeListener('message', h); res(out); }
            }, 5000);
        });
    }

    callService(domain, service, data, expectResponse = false) {
        if (!this.isReady) return Promise.reject(new Error("WebSocket not connected"));
        const id = this.msgId++;
        const msg = { id, type: 'call_service', domain, service, service_data: data };
        if (expectResponse) msg.return_response = true;
        this.send(msg);
        
        return new Promise((resolve, reject) => {
            const handler = (data) => {
                try {
                    const msg = JSON.parse(data);
                    if (msg.id === id) {
                        this.ws.removeListener('message', handler);
                        if (msg.success) resolve(msg.result);
                        else reject(new Error(msg.error ? msg.error.message : "Unknown Service Error"));
                    }
                } catch (e) { /* ignore parse errors */ }
            };
            this.ws.on('message', handler);
            setTimeout(() => {
                this.ws.removeListener('message', handler);
                reject(new Error("Service Call Timeout"));
            }, 5000);
        });
    }

    /**
     * Fetches the Home Assistant configuration (including language).
     */
    async getHAConfig() {
        if (!this.isReady) return {};
        const id = this.msgId++;
        this.send({ id, type: 'get_config' });
        return new Promise((resolve) => {
            const handler = (data) => {
                try {
                    const msg = JSON.parse(data);
                    if (msg.id === id) {
                        this.ws.removeListener('message', handler);
                        resolve(msg.result || {});
                    }
                } catch (e) { /* ignore parse errors */ }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve({}); }, 5000);
        });
    }

    /**
     * Fetches all available services from Home Assistant.
     */
    async getServices() {
        if (!this.isReady) return {};
        const id = this.msgId++;
        this.send({ id, type: 'get_services' });
        return new Promise((resolve) => {
            const handler = (data) => {
                const msg = JSON.parse(data);
                if (msg.id === id) {
                    this.ws.removeListener('message', handler);
                    resolve(msg.result || {});
                }
            };
            this.ws.on('message', handler);
            setTimeout(() => { this.ws.removeListener('message', handler); resolve({}); }, 5000);
        });
    }

    /**
     * Checks if the integration (custom component) is loaded.
     * @returns {Promise<{available: boolean, version?: string}>}
     */
    async checkIntegrationAvailable() {
        const services = await this.getServices();
        const api = services && services.js_automations;
        
        if (!api || !api.create_entity) {
            return { available: false };
        }

        let version = null;
        if (api.get_info) {
            try {
                const result = await this.callService('js_automations', 'get_info', {}, true);
                // HA wraps the ServiceResponse in a 'response' property when returned via WebSocket
                version = result?.response?.version || result?.version || null;
            } catch (err) {
                // Fail silently if the service call fails (e.g. old version doesn't support response)
                console.warn(`[HAConnector] Could not fetch integration version: ${err.message}`);
            }
        }

        return {
            available: true,
            version
        };
    }
}
module.exports = HAConnector;