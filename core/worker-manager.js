const { Worker } = require('worker_threads');
const path = require('path');

class WorkerManager {
    constructor() {
        this.workers = new Map();
        this.haConnector = null;
    }

    setConnector(connector) {
        this.haConnector = connector;
        this.haConnector.onStateUpdate((entities) => {
            for (const worker of this.workers.values()) {
                worker.postMessage({ type: 'state_changed', entities });
            }
        });
    }

    startScript(scriptMeta) {
        const { filename, path: scriptPath, name } = scriptMeta;
        if (this.workers.has(filename)) this.stopScript(filename);

        const worker = new Worker(path.join(__dirname, 'worker-wrapper.js'), {
            workerData: scriptMeta
        });

        worker.on('message', async (msg) => {
            if (msg.type === 'log') {
                console.log(`[${name}] ${msg.message}`);
            }
            if (msg.type === 'call_service') {
                if (this.haConnector) await this.haConnector.callService(msg.domain, msg.service, msg.data);
            }
            // NEU: Update State abfangen
            if (msg.type === 'update_state') {
                if (this.haConnector) await this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
            }
        });

        worker.on('error', (err) => console.error(`[${name}] Worker Error:`, err.message));
        worker.on('exit', () => this.workers.delete(filename));
        this.workers.set(filename, worker);
    }

    stopScript(filename) {
        const worker = this.workers.get(filename);
        if (worker) { worker.terminate(); this.workers.delete(filename); }
    }
}

module.exports = new WorkerManager();