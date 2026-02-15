/**
 * JS AUTOMATIONS - Worker Wrapper (v1.5.0)
 * Fully Synchronous Cache & Store API
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const scriptsDir = path.dirname(workerData.path);
module.paths.push(path.join(scriptsDir, 'node_modules'));
if (process.env.SUPERVISOR_TOKEN) module.paths.push('/app/node_modules');

parentPort.unref();

// --- INITIAL CACHE SETUP ---
const states = workerData.initialStates || {};
const storeValues = workerData.initialStore || {};
const subscriptionCallbacks = [];
let isListening = false;

function ensureMessageListener() {
    if (isListening) return;
    isListening = true;
    parentPort.on('message', (msg) => {
        // Synchroner HA-Status Update
        if (msg.type === 'state_update') {
            if (msg.state) states[msg.entity_id] = msg.state;
            else delete states[msg.entity_id];
        }

        // Synchroner Store Update (von anderen Skripten)
        if (msg.type === 'store_update') {
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;
        }

        // Event Trigger (ha.on)
        if (msg.type === 'ha_event') {
            subscriptionCallbacks.forEach(sub => sub.callback({
                entity_id: msg.entity_id,
                state: msg.state.state,
                old_state: msg.old_state?.state,
                attributes: msg.state.attributes
            }));
        }
    });
}

const ha = {
    log: (msg) => parentPort.postMessage({ type: 'log', level: 'info', message: msg }),
    error: (msg) => parentPort.postMessage({ type: 'log', level: 'error', message: msg }),
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),

    // --- API ---
    states: states,

    on: (pattern, callback) => {
        parentPort.ref();
        ensureMessageListener();
        parentPort.postMessage({ type: 'subscribe', pattern });
        subscriptionCallbacks.push({ pattern, callback });
    },

    store: {
        val: storeValues, // Direkter Zugriff: ha.store.val.meinKey
        set: (key, value) => {
            storeValues[key] = value; // Lokal sofort setzen
            parentPort.postMessage({ type: 'store_set', key, value });
        },
        delete: (key) => {
            delete storeValues[key]; // Lokal sofort löschen
            parentPort.postMessage({ type: 'store_delete', key });
        }
    }
};

global.ha = ha;
global.axios = axios;
global.schedule = (exp, cb) => { parentPort.ref(); ensureMessageListener(); return cron.schedule(exp, cb); };
global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

try {
    delete require.cache[require.resolve(workerData.path)];
    require(workerData.path);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
    console.error(`[JS Automations] Crash in ${workerData.name}:`, err);

    // WICHTIG: Den Prozess mit Fehler-Code 1 beenden, 
    // damit der Manager den Status "error" setzen kann.
    setTimeout(() => {
        process.exit(1);
    }, 100); // Kurze
}