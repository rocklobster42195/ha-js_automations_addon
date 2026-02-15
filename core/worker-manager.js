/**
 * JS AUTOMATIONS - Worker Manager (v2.12.0)
 * Status: Crash Detection & Error Tracking
 */
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        this.workers = new Map();
        this.stopReasons = new Map();
        this.lastExitState = new Map(); // Speichert: filename -> "error" | "success"
        this.haConnector = null;
        this.storeManager = null;
        this.subscriptions = new Map();
    }

    setConnector(connector) { this.haConnector = connector; }
    setStore(store) { this.storeManager = store; }

    startScript(scriptMeta) {
        const { filename, name } = scriptMeta;
        if (this.workers.has(filename)) this.stopScript(filename, 'restarting');

        // Reset Fehlerstatus bei Neustart
        this.lastExitState.delete(filename);
        this.subscriptions.set(filename, []);

        const initialStoreValues = {};
        if (this.storeManager) {
            for (let k in this.storeManager.data) {
                initialStoreValues[k] = this.storeManager.data[k].value;
            }
        }

        const worker = new Worker(path.join(__dirname, 'worker-wrapper.js'), {
            workerData: {
                ...scriptMeta,
                initialStates: this.haConnector ? this.haConnector.states : {},
                initialStore: initialStoreValues
            }
        });

        worker.on('message', async (msg) => {
            if (msg.type === 'log') this.emit('log', `[${name}] ${msg.message}`);
            if (msg.type === 'call_service') await this.haConnector?.callService(msg.domain, msg.service, msg.data);
            if (msg.type === 'update_state') await this.haConnector?.updateState(msg.entityId, msg.state, msg.attributes);
            if (msg.type === 'subscribe') this.subscriptions.get(filename).push(msg.pattern);

            if (msg.type === 'store_set') {
                this.storeManager?.set(msg.key, msg.value, name);
                this.broadcastToWorkers({ type: 'store_update', key: msg.key, value: msg.value });
            }
            if (msg.type === 'store_delete') {
                this.storeManager?.delete(msg.key);
                this.broadcastToWorkers({ type: 'store_update', key: msg.key, value: undefined });
            }
        });

        worker.on('error', (err) => {
            this.emit('log', `[${name}] ❌ CRITICAL: ${err.message}`);
            this.lastExitState.set(filename, 'error');
        });

        worker.on('exit', (code) => {
            if (this.workers.get(filename) === worker) {
                this.workers.delete(filename);
                this.subscriptions.delete(filename);
                
                let reason = 'finished';
                let type = 'success';

                if (this.stopReasons.has(filename)) {
                    reason = `stopped (${this.stopReasons.get(filename)})`;
                    this.stopReasons.delete(filename);
                    this.lastExitState.delete(filename); // Manuell gestoppt -> Kein Fehler
                } else if (code !== 0) {
                    reason = `crashed (Code ${code})`;
                    type = 'error';
                    this.lastExitState.set(filename, 'error'); // Fehler merken
                } else {
                    this.lastExitState.set(filename, 'success');
                }

                this.emit('script_exit', { filename, reason, type });
            }
        });

        this.workers.set(filename, worker);
    }

    broadcastToWorkers(payload) {
        for (const worker of this.workers.values()) {
            worker.postMessage(payload);
        }
    }

    dispatchStateChange(entityId, newState, oldState) {
        for (const [filename, patterns] of this.subscriptions) {
            const worker = this.workers.get(filename);
            if (!worker) continue;
            const isMatched = patterns.some(p => this.matches(entityId, p));
            if (isMatched) {
                worker.postMessage({ type: 'ha_event', entity_id: entityId, state: newState, old_state: oldState });
            }
            worker.postMessage({ type: 'state_update', entity_id: entityId, state: newState });
        }
    }

    matches(entityId, pattern) {
        if (typeof pattern === 'string') {
            if (pattern === entityId) return true;
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                return regex.test(entityId);
            }
        }
        if (Array.isArray(pattern)) return pattern.includes(entityId);
        if (pattern instanceof RegExp || (typeof pattern === 'object' && pattern.source)) {
            const r = pattern instanceof RegExp ? pattern : new RegExp(pattern.source, pattern.flags);
            return r.test(entityId);
        }
        return false;
    }

    stopScript(filename, reason = "by user") {
        const worker = this.workers.get(filename);
        if (worker) { this.stopReasons.set(filename, reason); worker.terminate(); }
    }
}
module.exports = new WorkerManager();