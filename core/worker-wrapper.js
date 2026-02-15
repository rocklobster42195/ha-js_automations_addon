const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const scriptsDir = path.dirname(workerData.path);
module.paths.push(path.join(scriptsDir, 'node_modules'));
if (process.env.SUPERVISOR_TOKEN) module.paths.push('/app/node_modules');

parentPort.unref();

// --- LOG LEVEL LOGIK ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        parentPort.postMessage({ type: 'log', level, message: msg });
    }
};

const states = workerData.initialStates || {};
const storeValues = workerData.initialStore || {};
const subscriptionCallbacks = [];
let isListening = false;

function ensureMessageListener() {
    if (isListening) return;
    isListening = true;
    parentPort.on('message', (msg) => {
        if (msg.type === 'state_update') {
            if (msg.state) states[msg.entity_id] = msg.state;
            else delete states[msg.entity_id];
        }
        if (msg.type === 'store_update') {
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;
        }
        if (msg.type === 'ha_event') {
            subscriptionCallbacks.forEach(sub => sub.callback({
                entity_id: msg.entity_id, state: msg.state.state,
                old_state: msg.old_state?.state, attributes: msg.state.attributes
            }));
        }
    });
}

const ha = {
    debug: (m) => sendLog('debug', m),
    log: (m) => sendLog('info', m),
    warn: (m) => sendLog('warn', m),
    error: (m) => sendLog('error', m),
    callService: (d, s, data) => parentPort.postMessage({ type: 'call_service', domain: d, service: s, data }),
    updateState: (id, s, a) => parentPort.postMessage({ type: 'update_state', entityId: id, state: s, attributes: a }),
    states: states,
    on: (p, cb) => { parentPort.ref(); ensureMessageListener(); parentPort.postMessage({ type: 'subscribe', pattern: p }); subscriptionCallbacks.push({ pattern: p, callback: cb }); },
    store: {
        val: storeValues,
        set: (k, v) => { storeValues[k] = v; parentPort.postMessage({ type: 'store_set', key: k, value: v }); },
        delete: (k) => { delete storeValues[k]; parentPort.postMessage({ type: 'store_delete', key: k }); }
    }
};

global.ha = ha;
global.axios = axios;
global.schedule = (e, cb) => { parentPort.ref(); ensureMessageListener(); return cron.schedule(e, cb); };
global.sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
    delete require.cache[require.resolve(workerData.path)];
    require(workerData.path);
} catch (err) {
    sendLog('error', `Runtime Error: ${err.message}`);
    setTimeout(() => process.exit(1), 100);
}