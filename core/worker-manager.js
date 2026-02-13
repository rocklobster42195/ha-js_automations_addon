/**
 * JS AUTOMATIONS - Worker Manager (v1.3.0)
 */
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        this.workers = new Map();
        this.stopReasons = new Map();
        this.haConnector = null;
        this.storeManager = null; // <--- NEU
    }

    setConnector(connector) { this.haConnector = connector; }

    // NEU: Store Manager verknüpfen
    setStore(store) { this.storeManager = store; }

    startScript(scriptMeta) {
        const { filename, name } = scriptMeta;
        if (this.workers.has(filename)) this.stopScript(filename, 'restarting');

        const worker = new Worker(path.join(__dirname, 'worker-wrapper.js'), {
            workerData: scriptMeta
        });

        worker.on('message', async (msg) => {
            // Standard Messages
            if (msg.type === 'log') this.emit('log', `[${name}] ${msg.message}`);
            if (msg.type === 'call_service') await this.haConnector?.callService(msg.domain, msg.service, msg.data);
            if (msg.type === 'update_state') await this.haConnector?.updateState(msg.entityId, msg.state, msg.attributes);

            // --- NEU: STORE HANDLING ---
            if (!this.storeManager) return;

            if (msg.type === 'store_set') {
                this.storeManager.set(msg.key, msg.value, name);
            }
            if (msg.type === 'store_delete') {
                this.storeManager.delete(msg.key);
            }
            if (msg.type === 'store_get') {
                if (!this.storeManager) {
                    worker.postMessage({ type: 'store_value', key: msg.key, value: null, requestId: msg.requestId, error: 'StoreManager not initialized' });
                    return;
                }

                const val = this.storeManager.get(msg.key);
                console.log(`[Store] Manager provides "${msg.key}" -> ${val} to ${filename}`);

                // Antwort an genau diesen Worker zurücksenden
                worker.postMessage({
                    type: 'store_value',
                    key: msg.key,
                    value: val,
                    requestId: msg.requestId
                });
            }
        });

        worker.on('error', (err) => {
            this.emit('log', `[${name}] ❌ ERROR: ${err.message}`);
        });

        worker.on('exit', (code) => {
            if (this.workers.get(filename) === worker) {
                this.workers.delete(filename);
                let reason = this.stopReasons.has(filename) ? `stopped (${this.stopReasons.get(filename)})` : (code === 0 ? 'finished' : `crashed (${code})`);
                this.stopReasons.delete(filename);
                this.emit('script_exit', { filename, reason, type: code === 0 ? 'success' : 'error' });
            }
        });

        this.workers.set(filename, worker);
    }

    stopScript(filename, reason = "by user") {
        const worker = this.workers.get(filename);
        if (worker) {
            this.stopReasons.set(filename, reason);
            worker.terminate();
        }
    }
}

module.exports = new WorkerManager();