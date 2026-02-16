/**
 * JS AUTOMATIONS - HA Connector (v1.8.2)
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Fix für Node.js Versionen < 18 (lokale Entwicklung)
if (typeof fetch === "undefined") {
    global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}

class HAConnector {
    constructor(url, token, scriptsDir) {
        this.isAddon = !!process.env.SUPERVISOR_TOKEN;
        this.scriptsDir = scriptsDir;
        this.baseUrl = this.isAddon ? "http://supervisor/core" : url.replace(/\/$/, '');
        this.url = this.isAddon ? "ws://supervisor/core/api/websocket" : this.baseUrl.replace('http', 'ws').replace('https', 'wss') + '/api/websocket';
        this.token = this.isAddon ? process.env.SUPERVISOR_TOKEN : token;
        
        this.ws = null;
        this.msgId = 1;
        this.isReady = false;
        this.onEventCallback = null;
        this.states = {}; 
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`🔌 WebSocket: Connecting...`);
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

    async updateState(entityId, state, attributes = {}) {
        if (!this.token) return;
        const url = `${this.baseUrl}/api/states/${entityId}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ state, attributes })
            });
            if (!response.ok) console.error(`[HA] updateState failed for ${entityId}: ${response.status}`);
        } catch (err) {
            console.error(`[HA] fetch error in updateState:`, err.message);
        }
    }

    handleMessage(msg, resolve, reject) {
        if (msg.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.token });
        } else if (msg.type === 'auth_ok') {
            this.isReady = true;
            this.subscribeEvents();
            this.fetchInitialStates().then(resolve);
        } else if (msg.type === 'event') {
            if (msg.event.event_type === 'state_changed') {
                const { entity_id, new_state } = msg.event.data;
                if (new_state) this.states[entity_id] = new_state;
                else delete this.states[entity_id];
            }
            if (this.onEventCallback) this.onEventCallback(msg.event);
        }
    }

    async fetchInitialStates() {
        const id = this.msgId++;
        this.send({ id, type: 'get_states' });
        return new Promise((res) => {
            const handler = (data) => {
                const m = JSON.parse(data);
                if (m.id === id) {
                    (m.result || []).forEach(s => this.states[s.entity_id] = s);
                    this.ws.removeListener('message', handler);
                    res();
                }
            };
            this.ws.on('message', handler);
        });
    }

    send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
    subscribeEvents() { this.send({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' }); }
    onEvent(callback) { this.onEventCallback = callback; }
    async callService(domain, service, data) {
        if (!this.isReady) return;
        this.send({ id: this.msgId++, type: 'call_service', domain, service, service_data: data });
    }

    async getHAMetadata() {
        if (!this.isReady) return { areas: [], labels: [] };
        const idA = this.msgId++; const idL = this.msgId++;
        this.send({ id: idA, type: 'config/area_registry/list' });
        this.send({ id: idL, type: 'config/label_registry/list' });
        return new Promise((res) => {
            const out = { areas: [], labels: [] }; let c = 0;
            const h = (d) => {
                const m = JSON.parse(d);
                if (m.id === idA) { out.areas = m.result || []; c++; }
                if (m.id === idL) { out.labels = m.result || []; c++; }
                if (c === 2) { this.ws.removeListener('message', h); res(out); }
            };
            this.ws.on('message', h);
        });
    }
}
module.exports = HAConnector;