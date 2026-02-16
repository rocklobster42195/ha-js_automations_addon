/**
 * JS AUTOMATIONS - Worker Wrapper (v2.16.x)
 * Features: Local Cache, Sync Store, Graceful Shutdown, Global Libraries.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const Module = require('module');

// --- 1. MODULE PATH INJECTION ---
if (workerData.storageDir) {
    const nodeModulesPath = path.resolve(workerData.storageDir, 'node_modules');
    // Inject into global search paths
    Module.globalPaths.push(nodeModulesPath);
    module.paths.unshift(nodeModulesPath);
    process.env.NODE_PATH = nodeModulesPath;
    // Force Node.js to re-evaluate paths
    if (typeof Module._initPaths === 'function') {
        Module._initPaths();
    }
}

// Load built-in libraries
const axios = require('axios');
const cron = require('node-cron');

// Default: Allow thread to exit if nothing is happening
parentPort.unref();

// --- 2. LOGGING LOGIC ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        parentPort.postMessage({ type: 'log', level, message: msg });
    }
};

// --- 3. CACHE & SYNC ---
const states = workerData.initialStates || {};
const storeValues = workerData.initialStore || {};
const subscriptionCallbacks = [];
const stopCallbacks = [];
let isListening = false;

/**
 * Ensures the worker is listening for updates from the master.
 */
function ensureMessageListener() {
    if (isListening) return;
    isListening = true;

    parentPort.on('message', async (msg) => {
        // Real-time state cache sync
        if (msg.type === 'state_update') {
            if (msg.state) states[msg.entity_id] = msg.state;
            else delete states[msg.entity_id];
        }

        // Real-time global store sync
        if (msg.type === 'store_update') {
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;
        }

        // Handle ha.on() triggers
        if (msg.type === 'ha_event') {
            subscriptionCallbacks.forEach(sub => sub.callback({
                entity_id: msg.entity_id,
                state: msg.state.state,
                old_state: msg.old_state?.state,
                attributes: msg.state.attributes
            }));
        }

        // Handle master request to stop gracefully
        if (msg.type === 'stop_request') {
            for (const cb of stopCallbacks) {
                try { await cb(); } catch (e) { console.error("onStop Error:", e); }
            }
            process.exit(0);
        }
    });
}

// --- 4. THE GLOBAL API ---
const ha = {
    // Logging
    debug: (m) => sendLog('debug', m),
    log: (m) => sendLog('info', m),
    warn: (m) => sendLog('warn', m),
    error: (m) => sendLog('error', m),
    
    // Commands
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),
    
    // Real-time Data
    states: states,
    
    on: (pattern, callback) => {
        parentPort.ref(); // Keep alive
        ensureMessageListener();
        parentPort.postMessage({ type: 'subscribe', pattern });
        subscriptionCallbacks.push({ pattern, callback });
    },
    
    onStop: (cb) => {
        ensureMessageListener();
        stopCallbacks.push(cb);
    },

    // Persistent Store
    store: {
        val: storeValues,
        set: (key, value) => {
            storeValues[key] = value;
            parentPort.postMessage({ type: 'store_set', key, value });
        },
        delete: (key) => {
            delete storeValues[key];
            parentPort.postMessage({ type: 'store_delete', key });
        }
    }
};

// Injection
global.ha = ha;
global.axios = axios;
global.schedule = (exp, cb) => {
    parentPort.ref(); // Keep alive for cron
    ensureMessageListener();
    return cron.schedule(exp, cb);
};
global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- 5. EXECUTION ---
try {
    const scriptPath = require.resolve(workerData.path);
    delete require.cache[scriptPath]; // Avoid stale code
    require(scriptPath);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
    console.error(`[Worker Error] ${workerData.filename}:`, err);
    // Exit after a short delay to allow log delivery
    setTimeout(() => process.exit(1), 100);
}