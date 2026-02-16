/**
 * JS AUTOMATIONS - Worker Wrapper (v1.8.0)
 * Logic: Synchronous State Cache, Global Store, Log-Levels, 
 * Graceful Shutdown and Entity Selectors.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const Module = require('module');

// --- 1. MODULE PATH RESOLUTION ---
if (workerData.storageDir) {
    const nodeModulesPath = path.resolve(workerData.storageDir, 'node_modules');
    Module.globalPaths.push(nodeModulesPath);
    module.paths.unshift(nodeModulesPath);
    process.env.NODE_PATH = nodeModulesPath;
    if (typeof Module._initPaths === 'function') {
        Module._initPaths();
    }
}

// Load built-in global libraries
const axios = require('axios');
const cron = require('node-cron');

// Default: Allow worker to exit if idle
parentPort.unref();

// --- 2. LOG LEVEL LOGIC ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        parentPort.postMessage({ type: 'log', level, message: msg });
    }
};

// --- 3. STATE & STORE CACHE ---
const states = workerData.initialStates || {};
const storeValues = workerData.initialStore || {};
const subscriptionCallbacks = [];
const stopCallbacks = [];
let isListening = false;

/**
 * EntitySelector Class for bulk actions
 */
class EntitySelector {
    constructor(entities, parentHa) {
        this.list = entities; // Array of HA State objects
        this.ha = parentHa;
    }

    /** Returns the number of entities in the current selection */
    get count() { return this.list.length; }

    /** Filters the current selection using a callback function */
    where(callback) {
        return new EntitySelector(this.list.filter(callback), this.ha);
    }

    /** Executes a function for each entity in the selection */
    each(callback) {
        this.list.forEach(callback);
        return this;
    }

    /** Calls a service for all entities in the selection */
    call(service, data = {}) {
        this.list.forEach(entity => {
            const domain = entity.entity_id.split('.')[0];
            this.ha.callService(domain, service, { ...data, entity_id: entity.entity_id });
        });
        return this;
    }

    /** Shortcut to turn all selected entities ON */
    turnOn(data = {}) { return this.call('turn_on', data); }

    /** Shortcut to turn all selected entities OFF */
    turnOff(data = {}) { return this.call('turn_off', data); }

    /** Returns the raw array of state objects */
    toArray() { return this.list; }
}

function ensureMessageListener() {
    if (isListening) return;
    isListening = true;
    parentPort.on('message', async (msg) => {
        // Sync Home Assistant States
        if (msg.type === 'state_update') {
            if (msg.state) states[msg.entity_id] = msg.state;
            else delete states[msg.entity_id];
        }
        // Sync Global Store
        if (msg.type === 'store_update') {
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;
        }
        // Handle Subscriptions (ha.on)
        if (msg.type === 'ha_event') {
            subscriptionCallbacks.forEach(sub => sub.callback({
                entity_id: msg.entity_id,
                state: msg.state.state,
                old_state: msg.old_state?.state,
                attributes: msg.state.attributes
            }));
        }
        // Handle Graceful Stop
        if (msg.type === 'stop_request') {
            for (const callback of stopCallbacks) {
                try { await callback(); } catch (e) { console.error("Error in onStop:", e); }
            }
            process.exit(0);
        }
    });
}

// --- 4. THE GLOBAL HA API ---
const ha = {
    debug: (m) => sendLog('debug', m),
    log: (m) => sendLog('info', m),
    warn: (m) => sendLog('warn', m),
    error: (m) => sendLog('error', m),
    
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (id, s, a) => parentPort.postMessage({ type: 'update_state', entityId: id, state: s, attributes: a }),
    
    states: states,

    /** Selects entities based on a pattern (String, Wildcard, Regex, Array) */
    select: (pattern) => {
        const allIds = Object.keys(states);
        let matchedIds = [];

        if (typeof pattern === 'string') {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                matchedIds = allIds.filter(id => regex.test(id));
            } else {
                matchedIds = allIds.filter(id => id === pattern);
            }
        } else if (pattern instanceof RegExp) {
            matchedIds = allIds.filter(id => pattern.test(id));
        } else if (Array.isArray(pattern)) {
            matchedIds = allIds.filter(id => pattern.includes(id));
        }

        const matchedStates = matchedIds.map(id => states[id]);
        return new EntitySelector(matchedStates, ha);
    },

    on: (p, cb) => { 
        parentPort.ref(); 
        ensureMessageListener(); 
        parentPort.postMessage({ type: 'subscribe', pattern: p }); 
        subscriptionCallbacks.push({ pattern: p, callback: cb }); 
    },
    
    onStop: (cb) => {
        ensureMessageListener();
        stopCallbacks.push(cb);
    },

    store: {
        val: storeValues,
        set: (k, v) => { storeValues[k] = v; parentPort.postMessage({ type: 'store_set', key: k, value: v }); },
        delete: (k) => { delete storeValues[k]; parentPort.postMessage({ type: 'store_delete', key: k }); },
        get: (k) => { 
            sendLog('warn', `ha.store.get('${k}') is deprecated. Use sync: ha.store.val.${k}`);
            return storeValues[k]; 
        }
    }
};

// --- 5. GLOBAL INJECTIONS ---
global.ha = ha;
global.axios = axios;
global.schedule = (e, cb) => { parentPort.ref(); ensureMessageListener(); return cron.schedule(e, cb); };
global.sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- 6. EXECUTION ---
try {
    const scriptResolved = require.resolve(workerData.path);
    delete require.cache[scriptResolved];
    require(scriptResolved);
} catch (err) {
    sendLog('error', `Runtime Error: ${err.message}`);
    console.error(`[Worker Error] ${workerData.filename}:`, err);
    setTimeout(() => process.exit(1), 100);
}