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
        this.states = {}; 
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
                    this.generateTypeDefinitions(m.result || []);
                    res();
                }
            };
            this.ws.on('message', handler);
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
        });
    }

    callService(domain, service, data) {
        if (!this.isReady) return Promise.reject(new Error("WebSocket not connected"));
        const id = this.msgId++;
        this.send({ id, type: 'call_service', domain, service, service_data: data });
        
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
     * Ruft die Home Assistant Konfiguration ab (inkl. Sprache).
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
     * Ruft alle verfügbaren Services von Home Assistant ab.
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
     * Prüft, ob die Integration (Custom Component) geladen ist.
     * Sendet 'get_services' und sucht nach 'js_automations'.
     */
    async checkIntegrationAvailable() {
        const services = await this.getServices();
        return 'js_automations' in services;
    }

    /**
     * Generates IntelliSense file in .storage directory
     */
    generateTypeDefinitions(states) {
        const entityIds = states.map(s => s.entity_id).sort();
        const content = `/** AUTO-GENERATED BY JS AUTOMATIONS */\nexport type EntityID = ${entityIds.map(id => `\n    | "${id}"`).join('')};\nexport interface HAState { entity_id: EntityID; state: string; attributes: any; }`;
        // PATH CHANGE: Moved to .storage
        const outputPath = path.join(this.storageDir, 'entities.d.ts');
        if (!fs.existsSync(this.storageDir)) {
            try { fs.mkdirSync(this.storageDir, { recursive: true }); } catch (e) {}
        }
        try { fs.writeFileSync(outputPath, content, 'utf8'); } catch (e) {}
    }
}
module.exports = HAConnector;