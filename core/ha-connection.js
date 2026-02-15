/**
 * JS AUTOMATIONS - HA Connector (v1.7.0)
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class HAConnector {
    constructor(url, token, scriptsDir) {
        this.isAddon = !!process.env.SUPERVISOR_TOKEN;
        this.scriptsDir = scriptsDir;
        if (this.isAddon) {
            this.baseUrl = "http://supervisor/core";
            this.url = "ws://supervisor/core/api/websocket";
            this.token = process.env.SUPERVISOR_TOKEN;
        } else {
            this.baseUrl = url.replace(/\/$/, '');
            this.url = this.baseUrl.replace('http', 'ws').replace('https', 'wss') + '/api/websocket';
            this.token = token;
        }
        this.ws = null;
        this.msgId = 1;
        this.isReady = false;
        this.onEventCallback = null;
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
            resolve();
        } else if (msg.type === 'event') {
            if (this.onEventCallback) this.onEventCallback(msg.event);
        }
    }

    send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }

    subscribeEvents() {
        this.send({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' });
    }

    onEvent(callback) { this.onEventCallback = callback; }

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
        if (!this.isReady) return { areas: [], labels: [] };
        const idAreas = this.msgId++;
        const idLabels = this.msgId++;
        this.send({ id: idAreas, type: 'config/area_registry/list' });
        this.send({ id: idLabels, type: 'config/label_registry/list' });
        return new Promise((resolve) => {
            const metadata = { areas: [], labels: [] };
            let count = 0;
            const h = (data) => {
                const m = JSON.parse(data);
                if (m.id === idAreas) { metadata.areas = m.result || []; count++; }
                if (m.id === idLabels) { metadata.labels = m.result || []; count++; }
                if (count === 2) { this.ws.removeListener('message', h); resolve(metadata); }
            };
            this.ws.on('message', h);
        });
    }
}
module.exports = HAConnector;