/**
 * JS AUTOMATIONS - Worker Wrapper (v1.3.2)
 * Optimized Lifecycle: Auto-exit for one-shots, keep-alive for reactive scripts.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

// Module Path Fix
const scriptsDir = path.dirname(workerData.path);
module.paths.push(path.join(scriptsDir, 'node_modules'));
if (process.env.SUPERVISOR_TOKEN) module.paths.push('/app/node_modules');

// Standardmäßig lassen wir den Worker zu, sich zu beenden (unref)
parentPort.unref();

const stateCallbacks = [];
const storeRequests = new Map();
let isListening = false;

function ensureMessageListener() {
    if (isListening) return;
    isListening = true;

    parentPort.on('message', (msg) => {
        if (msg.type === 'state_changed') {
            for (const cb of stateCallbacks) {
                const newState = msg.entities[cb.entityId];
                if (newState) cb.callback(newState);
            }
        }

        if (msg.type === 'store_value') {
            const resolver = storeRequests.get(msg.requestId);
            if (resolver) {
                resolver(msg.value);
                storeRequests.delete(msg.requestId);
                
                // Falls keine Store-Anfragen mehr offen sind und keine HA-Listener existieren,
                // erlauben wir dem Worker wieder das Beenden.
                if (stateCallbacks.length === 0) {
                    parentPort.unref();
                }
            }
        }
    });
}

const ha = {
    log: (msg) => parentPort.postMessage({ type: 'log', level: 'info', message: msg }),
    error: (msg) => parentPort.postMessage({ type: 'log', level: 'error', message: msg }),
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),
    
    onStateChange: (entityId, callback) => {
        stateCallbacks.push({ entityId, callback });
        // REAKTIV: Wir brauchen eine dauerhafte Verbindung -> Anker werfen!
        parentPort.ref();
        ensureMessageListener();
    },

    store: {
        set: (key, value) => {
            parentPort.postMessage({ type: 'store_set', key, value });
        },
        get: (key) => {
            ensureMessageListener();
            // Während wir auf den Store warten, halten wir den Worker kurzzeitig fest
            parentPort.ref(); 
            
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).substring(7);
                storeRequests.set(requestId, resolve);
                parentPort.postMessage({ type: 'store_get', key, requestId });
            });
        },
        delete: (key) => {
            parentPort.postMessage({ type: 'store_delete', key });
        }
    }
};

// --- GLOBALS ---
global.ha = ha;
global.axios = axios;

global.schedule = (expression, callback) => {
    // Cron-Jobs halten den Prozess durch node-cron intern automatisch am Leben (Timers)
    return cron.schedule(expression, callback);
};

global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- EXECUTION ---
try {
    delete require.cache[require.resolve(workerData.path)];
    require(workerData.path);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
    console.error(`[JS Automations] Crash in ${workerData.name}:`, err);
}