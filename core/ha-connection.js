const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class HAConnector {
    constructor(url, token, scriptsDir) {
        this.isAddon = !!process.env.SUPERVISOR_TOKEN;
        this.scriptsDir = scriptsDir;

        if (this.isAddon) {
            this.baseUrl = "http://supervisor/core"; // Für REST
            this.url = "ws://supervisor/core/api/websocket"; // Für WS
            this.token = process.env.SUPERVISOR_TOKEN;
        } else {
            this.baseUrl = url.replace(/\/$/, '');
            this.url = this.baseUrl.replace('http', 'ws').replace('https', 'wss') + '/api/websocket';
            this.token = token;
        }

        this.ws = null;
        this.msgId = 1;
        this.isReady = false;
        this.onStateUpdateCallback = null;
        this.statesRequestId = -1;
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log(`🔌 Connecting to HA...`);
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

    /**
     * NEU: Erzeugt oder aktualisiert eine Entität in HA via REST API
     */
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
            if (response.ok) {
                // console.log(`[HA] State updated: ${entityId}`);
            } else {
                console.error(`[HA] Failed to update ${entityId}: ${response.statusText}`);
            }
        } catch (err) {
            console.error(`[HA] Error in updateState:`, err.message);
        }
    }

    handleMessage(msg, resolve, reject) {
        if (msg.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.token });
        } else if (msg.type === 'auth_ok') {
            console.log("✅ AUTH OK!");
            this.isReady = true;
            resolve();
            this.subscribeEvents();
            setTimeout(() => this.fetchEntitiesNative(), 1000);
        } else if (msg.type === 'result' && msg.id === this.statesRequestId) {
            this.generateTypeDefinitions(msg.result);
        } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
            if (this.onStateUpdateCallback) {
                const entityId = msg.event.data.entity_id;
                const newEvent = msg.event.data.new_state;
                if (entityId && newEvent) this.onStateUpdateCallback({ [entityId]: newEvent });
            }
        }
    }

    send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
    subscribeEvents() { this.send({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' }); }
    fetchEntitiesNative() { this.statesRequestId = this.msgId++; this.send({ id: this.statesRequestId, type: 'get_states' }); }
    onStateUpdate(callback) { this.onStateUpdateCallback = callback; }

    async callService(domain, service, data) {
        if (!this.isReady) return;
        this.send({ id: this.msgId++, type: 'call_service', domain, service, service_data: data });
    }

    generateTypeDefinitions(states) {
        const entityIds = states.map(s => s.entity_id).sort();
        const content = `/** AUTO-GENERATED */\nexport type EntityID = ${entityIds.map(id => `\n    | "${id}"`).join('')};\nexport interface HAState { entity_id: EntityID; state: string; attributes: any; }`;
        const outputPath = path.join(this.scriptsDir, 'entities.d.ts');
        try { fs.writeFileSync(outputPath, content, 'utf8'); } catch (e) {}
    }
}

module.exports = HAConnector;