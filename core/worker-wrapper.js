const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Module Path Fix
const scriptsDir = path.dirname(workerData.path);
module.paths.push(path.join(scriptsDir, 'node_modules'));
if (process.env.SUPERVISOR_TOKEN) module.paths.push('/app/node_modules');

const stateCallbacks = [];

/**
 * Die API für den User
 */
const ha = {
    log: (msg) => parentPort.postMessage({ type: 'log', level: 'info', message: msg }),
    error: (msg) => parentPort.postMessage({ type: 'log', level: 'error', message: msg }),
    callService: (domain, service, data) => {
        parentPort.postMessage({ type: 'call_service', domain, service, data });
    },
    // NEU: Die Funktion ist jetzt hier verfügbar!
    updateState: (entityId, state, attributes = {}) => {
        parentPort.postMessage({ type: 'update_state', entityId, state, attributes });
    },
    onStateChange: (entityId, callback) => {
        stateCallbacks.push({ entityId, callback });
    }
};

global.ha = ha;

parentPort.on('message', (msg) => {
    if (msg.type === 'state_changed') {
        for (const cb of stateCallbacks) {
            const newState = msg.entities[cb.entityId];
            if (newState) cb.callback(newState);
        }
    }
});

try {
    delete require.cache[require.resolve(workerData.path)];
    require(workerData.path);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
}