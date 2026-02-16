/**
 * JS AUTOMATIONS - Worker Manager (v1.8.0)
 * Graceful Stop Logic
 */
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        this.workers = new Map();
        this.stopReasons = new Map();
        this.lastExitState = new Map();
        this.haConnector = null;
        this.storeManager = null;
        this.subscriptions = new Map();
        this.storageDir = '';
    }

    setConnector(connector) { this.haConnector = connector; }
    setStore(store) { this.storeManager = store; }
    setStorageDir(dir) { this.storageDir = dir; }

    startScript(scriptMeta) {
        const { filename, name } = scriptMeta;
        if (this.workers.has(filename)) this.stopScript(filename, 'restarting');

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
                initialStore: initialStoreValues,
                storageDir: this.storageDir,
                loglevel: scriptMeta.loglevel || 'info'
            },
            env: { ...process.env, NODE_PATH: path.resolve(this.storageDir, 'node_modules') }
        });

        worker.on('message', async (msg) => {
            if (msg.type === 'log') this.emit('log', `[${name}] ${msg.message}`, msg.level);
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
            this.emit('log', `[${name}] ❌ CRITICAL: ${err.message}`, 'error');
            this.lastExitState.set(filename, 'error');
        });

        worker.on('exit', (code) => {
            if (this.workers.get(filename) === worker) {
                this.workers.delete(filename);
                this.subscriptions.delete(filename);
                let reason = this.stopReasons.get(filename) || (code === 0 ? 'finished' : `crashed (Code ${code})`);
                const type = (code !== 0 && !this.stopReasons.has(filename)) ? 'error' : 'success';
                if (type === 'error') this.lastExitState.set(filename, 'error');
                this.stopReasons.delete(filename);
                this.emit('script_exit', { filename, reason, type });
            }
        });

        this.workers.set(filename, worker);
    }

    broadcastToWorkers(payload) {
        for (const worker of this.workers.values()) worker.postMessage(payload);
    }

    dispatchStateChange(entityId, newState, oldState) {
        for (const [filename, patterns] of this.subscriptions) {
            const worker = this.workers.get(filename);
            if (!worker) continue;
            if (patterns.some(p => this.matches(entityId, p))) {
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

    /**
     * Stoppt ein Skript höflich (Graceful Shutdown)
     */
    stopScript(filename, reason = "by user") {
        const worker = this.workers.get(filename);
        if (worker) {
            this.stopReasons.set(filename, reason);
            
            // 1. Versuche höflichen Stop
            worker.postMessage({ type: 'stop_request' });

            // 2. Sicherheits-Hammer nach 2 Sekunden
            setTimeout(() => {
                if (this.workers.get(filename) === worker) {
                    console.log(`[Manager] Worker ${filename} did not stop gracefully. Terminating...`);
                    worker.terminate();
                }
            }, 2000);
        }
    }
}
module.exports = new WorkerManager();