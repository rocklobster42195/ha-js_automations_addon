/**
 * JS AUTOMATIONS - Worker Wrapper (v2.16.x)
 * Features: Local Cache, Sync Store, Graceful Shutdown, Global Libraries.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
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

// --- AXIOS MONKEY-PATCH ---
// This ensures that any script `require('axios')` gets the proper defaults
// to prevent the worker process from hanging.
const originalRequire = Module.prototype.require;
Module.prototype.require = function(requestPath) {
  const requiredModule = originalRequire.apply(this, arguments);
  if (requestPath === 'axios') {
    try {
        const http = require('http');
        const https = require('https');
        requiredModule.defaults.httpAgent = new http.Agent({ keepAlive: false });
        requiredModule.defaults.httpsAgent = new https.Agent({ keepAlive: false });
        if (!requiredModule.defaults.headers.common) requiredModule.defaults.headers.common = {};
        requiredModule.defaults.headers.common['Connection'] = 'close';
    } catch(e) {
        // This could happen if http/https are not available, though unlikely.
        if (parentPort) {
            parentPort.postMessage({ 
                type: 'log', 
                level: 'error', 
                message: `[Worker] Failed to apply essential defaults to axios: ${e.message}` 
            });
        }
    }
  }
  return requiredModule;
};

// Default: Allow thread to exit if nothing is happening
parentPort.unref();

// 🛡️ GLOBAL CRASH HANDLER
// Catches errors that would otherwise terminate the script silently.
process.on('uncaughtException', (err) => {
    // Known Issue: node-unifi sometimes throws errors from internal timeouts 
    // while the connection is still being established. We ignore these so the script continues running.
    if (err.message && err.message.includes('WebSocket is not open')) {
        if (parentPort) {
            parentPort.postMessage({
                type: 'log',
                level: 'warn',
                source: workerData.name || 'System',
                message: `⚠️ Background Error Suppressed: ${err.message}`
            });

            // Inform the script if an error handler is registered
            if (errorCallbacks.length > 0) {
                const errorData = { 
                    message: err.message, 
                    stack: err.stack,
                    type: 'background' // To identify the error source
                };
                errorCallbacks.forEach(cb => {
                    try {
                        cb(errorData);
                    } catch (e) {
                        // Log an error if the user's error handler itself crashes
                        parentPort.postMessage({
                            type: 'log',
                            level: 'error',
                            source: workerData.name || 'System',
                            message: `🔥 CRASH inside ha.onError handler: ${e.message}\n${e.stack}`
                        });
                    }
                });
            }
        }
        return; // Do NOT terminate the process!
    };
    
    if (parentPort) {
        parentPort.postMessage({
            type: 'log',
            level: 'error',
            source: workerData.name || 'System',
            message: `🔥 CRASH: ${err.message}\n${err.stack}`
        });
    } else {
        console.error("🔥 CRASH:", err);
    }
    // Short pause to ensure message delivery before exit
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
    if (parentPort) parentPort.postMessage({ type: 'log', level: 'error', source: workerData.name || 'System', message: `⚠️ Unhandled Rejection: ${reason}` });
});

// 🛡️ GLOBAL SIGNAL HANDLER
// Catches SIGTERM (stop signal) and exits with code 0 instead of 143.
process.on('SIGTERM', () => {
    process.exit(0);
});

// --- 2. LOGGING LOGIC ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        let finalMessage = msg;
        if (msg instanceof Error) {
            finalMessage = msg.stack || msg.toString();
        } else if (typeof msg === 'object' && msg !== null) {
            try {
                // Pretty-print for better readability in logs
                finalMessage = JSON.stringify(msg, null, 2);
            } catch (e) {
                finalMessage = '[Unserializable Object]';
            }
        }
        parentPort.postMessage({ type: 'log', level, message: String(finalMessage) });
    }
};

// --- 3. CACHE & SYNC ---
// Deep copy initialStates to prevent any potential shared references or mutation issues
// This ensures the worker's state cache is truly isolated.
const states = JSON.parse(JSON.stringify(workerData.initialStates || {}));

// Initialize Store: Ensure only the 'value' fields are kept in the local cache
// in case the data structure contains metadata (Refactoring Support).
const rawStore = workerData.initialStore || {};
const storeValues = {};
for (const k in rawStore) {
    const item = rawStore[k];
    storeValues[k] = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
}

const storeListeners = {};
const subscriptionCallbacks = [];
const stopCallbacks = [];
const errorCallbacks = [];
let isListening = false;

const pendingServiceCalls = new Map();
const pendingAsks = new Map(); // correlationId -> { resolve, timer }
const ASK_SEP = '__jsa_ask__';
let serviceCallCounter = 0;

/**
 * EntitySelector Class for bulk actions
 */
class EntitySelector {
    constructor(entities, parentHa) {
        this.list = entities; // Array of HA State objects
        this.ha = parentHa;
        this._throttleMs = workerData.defaultThrottle || 0;

        // Return a Proxy to allow calling any service name as a method
        return new Proxy(this, {
            get: (target, prop) => {
                // Do not treat internal JS properties or 'then' (for Promises) as services
                if (prop in target || typeof prop !== 'string' || prop === 'then') return target[prop];
                
                // Treat unknown properties as service calls (snake_case)
                return (data = {}) => target.call(prop, data);
            }
        });
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
    async call(service, data = {}) {
        for (let i = 0; i < this.list.length; i++) {
            const entity = this.list[i];
            // Uses the awaitable logic from ha.entity()
            await this.ha.entity(entity.entity_id)[service](data);
            
            // Insert a delay if throttle is set and it's not the last element
            if (this._throttleMs > 0 && i < this.list.length - 1) {
                await new Promise(res => setTimeout(res, this._throttleMs));
            }
        }
        return this;
    }

    /** Sets a delay between individual entity calls in a batch */
    throttle(ms) {
        this._throttleMs = ms;
        return this;
    }

    /** Wait for X ms and return this for chaining */
    async wait(ms) {
        await new Promise(res => setTimeout(res, ms));
        return this;
    }

    /** Expands groups to their members */
    expand() {
        const expanded = new Map();
        this.list.forEach(entity => {
            const members = entity.attributes?.entity_id;
            if (Array.isArray(members) && members.length > 0) {
                members.forEach(mid => {
                    const mState = this.ha.states[mid];
                    if (mState) expanded.set(mid, mState);
                });
            } else {
                expanded.set(entity.entity_id, entity);
            }
        });
        return new EntitySelector(Array.from(expanded.values()), this.ha);
    }

    /** Returns the raw array of state objects */
    toArray() { return this.list; }
}

/** Helper: Checks if an entity ID matches a pattern (String, Wildcard, Array, RegExp) */
function matches(entityId, pattern) {
    if (typeof pattern === 'string') {
        if (pattern === entityId) return true;
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            return regex.test(entityId);
        }
        return false;
    }
    if (Array.isArray(pattern)) return pattern.includes(entityId);
    if (pattern instanceof RegExp) return pattern.test(entityId);
    return false;
}

/**
 * Ensures the worker is listening for updates from the master.
 */
function ensureMessageListener() {
    if (isListening) return;
    isListening = true;

    // Ensure the listener doesn't prevent the worker from exiting 
    // as long as no active triggers (ha.on, schedule) are registered.
    parentPort.unref();

    parentPort.on('message', async (msg) => {
        // Handle response from service calls (for ha.entity() / awaitable calls)
        if (msg.type === 'service_response') {
            const promise = pendingServiceCalls.get(msg.callId);
            if (promise) {
                if (msg.error) promise.reject(new Error(msg.error));
                else promise.resolve(msg.result);
                pendingServiceCalls.delete(msg.callId);
            }
            return;
        }

        // Handle ha.ask() responses from the main process
        if (msg.type === 'ask_response') {
            const pending = pendingAsks.get(msg.correlationId);
            if (pending) {
                clearTimeout(pending.timer);
                pendingAsks.delete(msg.correlationId);
                pending.resolve(msg.action);
            }
            return;
        }

        // Real-time state cache sync
        if (msg.type === 'state_update') {
            if (msg.state) {
                // Deep clone the incoming state to ensure no external references are held
                // and to create a truly independent object for the worker's cache.
                states[msg.entity_id] = JSON.parse(JSON.stringify(msg.state));
            } else { // msg.state is null or undefined, so delete the entity
                delete states[msg.entity_id];
            }
        }

        // Real-time global store sync
        if (msg.type === 'store_update') {
            const oldValue = storeValues[msg.key];
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;

            if (storeListeners[msg.key]) {
                storeListeners[msg.key].forEach(cb => {
                    try { 
                        cb(msg.value, oldValue); 
                    } catch (e) { 
                        ha.error(`Store Listener Error (${msg.key}): ${e.message}\n${e.stack}`); 
                    }
                });
            }
        }

        // Handle ha.on() triggers
        if (msg.type === 'ha_event') {
            // FIX: Update cache immediately so ha.states is current in the callback
            if (msg.state) states[msg.entity_id] = JSON.parse(JSON.stringify(msg.state));

            subscriptionCallbacks.forEach(sub => {
                // 1. Check Pattern Match
                if (!matches(msg.entity_id, sub.pattern)) return;

                // 2. Check Filter Logic (if present)
                if (sub.filter && sub.filter !== 'any') {
                    const valNew = msg.state?.state;
                    const valOld = msg.old_state?.state;
                    
                    // Helper for numeric conversion
                    const nNew = parseFloat(valNew);
                    const nOld = parseFloat(valOld);
                    // Check if values are valid numbers for numeric comparisons
                    const isNum = !isNaN(nNew) && (sub.threshold === undefined ? !isNaN(nOld) : true);
                    
                    // Determine comparison value (Threshold or Old Value)
                    const compVal = sub.threshold !== undefined ? parseFloat(sub.threshold) : nOld;
                    const compValStr = sub.threshold !== undefined ? String(sub.threshold) : valOld;

                    let match = false;
                    switch (sub.filter) {
                        case 'ne': match = sub.threshold !== undefined ? valNew != compValStr : valNew !== valOld; break;
                        case 'eq': match = sub.threshold !== undefined ? valNew == compValStr : valNew === valOld; break;
                        case 'gt': match = isNum && nNew > compVal; break;
                        case 'ge': match = isNum && nNew >= compVal; break;
                        case 'lt': match = isNum && nNew < compVal; break;
                        case 'le': match = isNum && nNew <= compVal; break;
                    }
                    if (!match) return;
                }

                try {
                    sub.callback({
                        entity_id: msg.entity_id,
                        state: msg.state.state,
                        old_state: msg.old_state?.state,
                        attributes: msg.state.attributes
                    });
                } catch (e) {
                    ha.error(`Error in ha.on callback for ${msg.entity_id}: ${e.message}\n${e.stack}`);
                }
            });
        }

        // Handle master request to stop gracefully
        if (msg.type === 'stop_request') {
            for (const cb of stopCallbacks) {
                try { 
                    await cb(); 
                } catch (e) { 
                    ha.error(`onStop Error: ${e.message}\n${e.stack}`); 
                }
            }
            process.exit(0);
        }

        // Handle stats request
        if (msg.type === 'get_stats') {
            const mem = process.memoryUsage();
            parentPort.postMessage({
                type: 'stats',
                heapUsed: mem.heapUsed,
                rss: mem.rss
            });
        }
    });
}

// --- 4. THE GLOBAL API ---
const ha = {
    // Internationalization
    language: workerData.language || 'en',
    
    /**
     * Returns a localized string based on the current language.
     * @param {object} mapping - Object mapping language codes to strings (e.g. { en: "Hi", de: "Hallo" })
     * @param {string} [fallback] - Optional fallback string if language is not found
     */
    localize: (mapping, fallback) => {
        const lang = workerData.language || 'en';
        if (mapping[lang]) return mapping[lang];
        // Try short code if lang is like "en-US"
        const short = lang.split('-')[0];
        if (mapping[short]) return mapping[short];
        return fallback || Object.values(mapping)[0] || '';
    },

    // Logging
    debug: (m) => sendLog('debug', m),
    log: (m) => sendLog('info', m),
    warn: (m) => sendLog('warn', m),
    error: (m) => sendLog('error', m),
    stop: (reason) => parentPort.postMessage({ type: 'script_lifecycle', action: 'stop', reason }),
    restart: (reason) => parentPort.postMessage({ type: 'script_lifecycle', action: 'restart', reason }),
    
    // Commands
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),

    /**
     * Global helper function for Home Assistant service calls.
     * Format: ha.call('domain.service', { data })
     */
    call: (serviceId, data = {}) => {
        const [domain, service] = (serviceId || '').split('.');
        if (!domain || !service) {
            ha.error(`Invalid service ID format: "${serviceId}". Expected "domain.service"`);
            return;
        }

        // Synchronous check against the local cache
        const target = data.entity_id || data.media_player_entity_id;
        if (target) {
            const ids = Array.isArray(target) ? target : [target];
            for (const id of ids) {
                if (typeof id === 'string' && !states[id]) {
                    ha.warn(`Service call "${serviceId}" targets unknown entity: "${id}". Call will likely fail.`);
                }
            }
        }

        ha.callService(domain, service, data);
    },

    /**
     * Sends a notification via Home Assistant's notify service.
     * @param {string} message - The notification message.
     * @param {object} [options] - Optional options.
     * @param {string} [options.title] - Notification title.
     * @param {string} [options.target] - Target service (e.g. 'notify.mobile_app_phone'). Defaults to 'notify.notify'.
     * @param {object} [options.data] - Additional service data (e.g. action buttons, image).
     */
    notify: (message, options = {}) => {
        const { title, target, data, persistent } = options;
        
        let service;
        if (persistent) {
            // Route to Home Assistant's persistent notification system (visible in browser)
            service = 'persistent_notification';
        } else {
            service = target
                ? (target.startsWith('notify.') ? target.slice(7) : target)
                : 'notify';
        }

        // HA notify service expects platform-specific fields (actions, tag, image, …)
        // nested under a 'data' key, not spread at the top level.
        const serviceData = { message, title };
        if (data) serviceData.data = data;
        ha.callService('notify', service, serviceData);
    },

    /**
     * Sends an actionable notification and waits for the user's response.
     * Returns a Promise that resolves with the chosen action string,
     * or with `defaultAction` (default: null) if the timeout expires.
     *
     * @param {string} message - The notification message body.
     * @param {object} options
     * @param {string} [options.title] - Notification title.
     * @param {string} [options.target] - Notify service target. Defaults to 'notify.notify'.
     * @param {number} [options.timeout=60000] - ms to wait before resolving with defaultAction.
     * @param {string|null} [options.defaultAction=null] - Value to resolve with on timeout.
     * @param {Array<{action: string, title: string}>} [options.actions=[]] - Action buttons.
     */
    ask: (message, options = {}) => {
        const { title, target, timeout = 60000, defaultAction = null, actions = [] } = options;

        const correlationId = `jsa_ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Tag each action with the correlation ID so concurrent calls don't interfere
        const taggedActions = actions.map(a => ({
            ...a,
            action: `${a.action}${ASK_SEP}${correlationId}`
        }));

        ha.notify(message, {
            title,
            target,
            data: { actions: taggedActions, tag: correlationId }
        });

        ensureMessageListener();
        parentPort.ref(); // Prevent the worker from exiting while waiting for the response
        parentPort.postMessage({ type: 'register_ask', correlationId });

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pendingAsks.delete(correlationId);
                parentPort.unref();
                resolve(defaultAction);
            }, timeout);

            pendingAsks.set(correlationId, {
                resolve: (action) => { parentPort.unref(); resolve(action); },
                timer
            });
        });
    },

    /**
     * Fluent API for interacting with a single entity.
     */
    entity: (entityId) => {
        const domain = entityId.split('.')[0];
        
        // Ensure the worker waits for the response (service_response)
        ensureMessageListener();

        const api = {
            wait: (ms) => new Promise(res => setTimeout(() => res(apiProxy), ms)),
            getAttribute: (name) => states[entityId]?.attributes?.[name],
            get state() { return states[entityId]?.state; },
            get attributes() { return states[entityId]?.attributes || {}; }
        };

        const apiProxy = new Proxy(api, {
            get: (target, service) => {
                // Do not treat internal JS properties or 'then' (for Promises) as services
                if (service in target || typeof service !== 'string' || service === 'then') return target[service];

                return (data = {}) => {
                    const callId = ++serviceCallCounter;
                    parentPort.ref(); // Prevent exit while the call is in progress
                    return new Promise((resolve, reject) => {
                        pendingServiceCalls.set(callId, { 
                            resolve: () => {
                                parentPort.unref();
                                resolve(apiProxy);
                            }, 
                            reject: (err) => {
                                parentPort.unref();
                                reject(err);
                            }
                        });
                        parentPort.postMessage({ 
                            type: 'call_service', 
                            domain, 
                            service, 
                            data: { ...data, entity_id: entityId },
                            callId 
                        });
                        
                        // Safety timeout
                        setTimeout(() => {
                            const pending = pendingServiceCalls.get(callId);
                            if (pending) {
                                pendingServiceCalls.delete(callId);
                                // Use the wrapper which also calls parentPort.unref()
                                pending.reject(new Error(`Service call ${domain}.${service} for ${entityId} timed out.`));
                            }
                        }, 10000);
                    });
                };
            }
        });
        return apiProxy;
    },

    update: (entityId, arg2, arg3) => {
        let state = arg2;
        let attributes = arg3;

        // Overload: ha.update(id, { attributes }) -> Keep current state and merge attributes
        if (attributes === undefined && typeof arg2 === 'object' && arg2 !== null && !Array.isArray(arg2)) {
            const current = states[entityId];
            state = current ? current.state : undefined;
            attributes = { ...arg2 }; // Clone to avoid mutation of user object
        }

        // ALIAS: name -> friendly_name (for consistency with ha.register)
        if (attributes && attributes.name && !attributes.friendly_name) {
            attributes = { ...attributes, friendly_name: attributes.name };
            delete attributes.name;
        }

        // ALIAS: unit -> unit_of_measurement
        if (attributes && attributes.unit && !attributes.unit_of_measurement) {
            attributes = { ...attributes, unit_of_measurement: attributes.unit };
            delete attributes.unit;
        }

        // Optimistic Update: Set locally immediately so the code can continue working synchronously
        if (!states[entityId]) {
            states[entityId] = { entity_id: entityId, state: String(state), attributes: attributes || {}, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
        } else {
            const current = states[entityId];
            if (state !== undefined) current.state = String(state);
            if (attributes) current.attributes = { ...current.attributes, ...attributes };
            current.last_updated = new Date().toISOString();
        }

        // Send the full merged attribute set to ensure MQTT attributes are not partially cleared.
        parentPort.postMessage({ type: 'update_state', entityId, state: states[entityId].state, attributes: states[entityId].attributes });
    },
    
    /**
     * Registers a native Home Assistant entity (via MQTT).
     * Creates it or updates the configuration if it already exists.
     * @param {string} entityId - The desired Entity ID (e.g. 'sensor.my_value')
     * @param {object} config - Configuration (name, icon, type, unit_of_measurement, etc.)
     */
    register: (entityId, config = {}) => {
        // Optimistic Update for registered entities
        if (!states[entityId]) {
            states[entityId] = { 
                entity_id: entityId, 
                state: config.initial_state !== undefined ? String(config.initial_state) : 'unknown', 
                attributes: { friendly_name: config.name || config.friendly_name, icon: config.icon, ...config.attributes },
                last_changed: new Date().toISOString(),
                last_updated: new Date().toISOString()
            };
        }

        // ALIAS: unit -> unit_of_measurement
        if (config.unit && !config.unit_of_measurement) {
            config = { ...config, unit_of_measurement: config.unit };
            delete config.unit;
        }
        // Send the intent to the main process, which handles the registration via MQTT.
        parentPort.postMessage({ type: 'create_entity', entityId, config });
    },
    
    // Real-time Data
    states: states,
    getState: (entityId) => states[entityId],
    getAttr: (entityId, attr) => states[entityId]?.attributes?.[attr],
    getStateValue: (entityId) => {
        const val = states[entityId]?.state;
        if (val === undefined) return undefined;
        if (val === 'on') return true;
        if (val === 'off') return false;
        const num = Number(val);
        if (!isNaN(num) && val.trim() !== '') return num;
        return val;
    },
    getGroupMembers: (entityId) => {
        const s = states[entityId];
        return (s && Array.isArray(s.attributes?.entity_id)) ? s.attributes.entity_id : [];
    },
    
    /**
     * Reads a value from the script header.
     */
    getHeader: (key, defaultValue) => {
        if (!key) return defaultValue;
        const k = key.toLowerCase();
        const val = workerData[k];
        return val !== undefined ? val : defaultValue;
    },

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
    
    on: (pattern, arg2, arg3, arg4) => {
        parentPort.ref(); // Keep alive
        ensureMessageListener();
        parentPort.postMessage({ type: 'subscribe', pattern });
        
        let callback, filter, threshold;
        if (typeof arg2 === 'function') {
            callback = arg2;
        } else if (typeof arg3 === 'function') {
            filter = arg2;
            callback = arg3;
        } else {
            filter = arg2;
            threshold = arg3;
            callback = arg4;
        }
        subscriptionCallbacks.push({ pattern, callback, filter, threshold });
    },

    /**
     * Waits for a specific event or state change.
     * Returns a Promise that resolves when the condition is met.
     */
    waitFor: (pattern, arg2, arg3, arg4) => {
        return new Promise((resolve, reject) => {
            let filter, threshold, options = {};

            // Helper to identify the options object
            const isOptions = (o) => typeof o === 'object' && o !== null && !Array.isArray(o);

            if (isOptions(arg2)) {
                options = arg2;
            } else if (isOptions(arg3)) {
                filter = arg2;
                options = arg3;
            } else if (isOptions(arg4)) {
                filter = arg2;
                threshold = arg3;
                options = arg4;
            } else {
                if (arg2 !== undefined) filter = arg2;
                if (arg3 !== undefined) threshold = arg3;
            }

            const timeoutMs = options.timeout || 5000;
            let timer;

            const callback = (event) => {
                clearTimeout(timer);
                const idx = subscriptionCallbacks.indexOf(subscription);
                if (idx !== -1) subscriptionCallbacks.splice(idx, 1);
                resolve(event);
            };

            const subscription = { pattern, callback, filter, threshold };
            
            ensureMessageListener();
            parentPort.postMessage({ type: 'subscribe', pattern });
            subscriptionCallbacks.push(subscription);

            timer = setTimeout(() => {
                const idx = subscriptionCallbacks.indexOf(subscription);
                if (idx !== -1) subscriptionCallbacks.splice(idx, 1);
                reject(new Error(`Timeout waiting for ${pattern}`));
            }, timeoutMs);
        });
    },
    
    /**
     * Waits until a specific condition function returns true.
     * This is useful for complex state checks involving multiple entities.
     */
    waitUntil: (condition, options = {}) => {
        const overallTimeout = options.timeout || 30000; // Default 30s overall timeout
        const pollInterval = options.pollInterval || 5000; // Default 5s wait between checks

        return new Promise(async (resolve, reject) => {
            const startTime = Date.now();

            // Initial check
            if (condition()) {
                return resolve();
            }

            while (Date.now() - startTime < overallTimeout) {
                try {
                    // Wait for ANY state change to re-evaluate efficiently.
                    // A timeout is used here to periodically re-check even if no events fire.
                    await ha.waitFor(/.*/, { timeout: pollInterval });
                } catch (e) {
                    // This catch is for the ha.waitFor timeout, which is expected.
                    // We just continue the loop to re-check the condition.
                }

                // Re-check the condition after a wait or an event
                if (condition()) {
                    return resolve();
                }
            }

            // If the loop finishes, it means the overall timeout was reached.
            reject(new Error(`waitUntil timed out after ${overallTimeout / 1000}s`));
        });
    },

    onStop: (cb) => {
        ensureMessageListener();
        stopCallbacks.push(cb);
    },

    onError: (cb) => {
        if (typeof cb === 'function') {
            errorCallbacks.push(cb);
            parentPort.ref(); // Keep process alive if an error handler is used
        }
    },

    // Persistent Store
    store: {
        val: storeValues,
        set: (key, value, isSecret = false) => {
            storeValues[key] = value;
            parentPort.postMessage({ type: 'store_set', key, value, isSecret });
        },
        get: (key) => storeValues[key], // Safe now as it's filtered above
        delete: (key) => {
            delete storeValues[key];
            parentPort.postMessage({ type: 'store_delete', key });
        },
        on: (key, cb) => {
            if (typeof cb !== 'function') return;
            if (!storeListeners[key]) storeListeners[key] = [];
            storeListeners[key].push(cb);
            parentPort.ref(); // Keep process alive
            ensureMessageListener();
        }
    }
};

// Injection
global.ha = ha;

/**
 * Helper to create a deep, recursive proxy that triggers a callback on any modification.
 * @param {object} target The object to wrap.
 * @param {function} onSave The callback to execute on change.
 * @returns {Proxy}
 */
function createDeepProxy(target, onSave) {
    const proxyCache = new WeakMap();

    const handler = {
        get(obj, prop) {
            const value = Reflect.get(obj, prop);
            if (typeof value === 'object' && value !== null) {
                if (proxyCache.has(value)) return proxyCache.get(value);
                const newProxy = createDeepProxy(value, onSave);
                proxyCache.set(value, newProxy);
                return newProxy;
            }
            return value;
        },
        set(obj, prop, value) {
            const success = Reflect.set(obj, prop, value);
            if (success) onSave();
            return success;
        },
        deleteProperty(obj, prop) {
            const success = Reflect.deleteProperty(obj, prop);
            if (success) onSave();
            return success;
        }
    };
    return new Proxy(target, handler);
}

ha.persistent = (key, defaultValue = {}) => {
    // Primitives cannot be proxied — return a ref-like { value } wrapper instead.
    if (typeof defaultValue !== 'object' || defaultValue === null) {
        if (ha.store.get(key) === undefined || ha.store.get(key) === null) {
            ha.store.set(key, defaultValue);
        }
        return {
            get value() { return ha.store.get(key) ?? defaultValue; },
            set value(v) { ha.store.set(key, v); }
        };
    }

    let target = ha.store.get(key);
    if (target === undefined || target === null || typeof target !== 'object' || Array.isArray(target) !== Array.isArray(defaultValue)) {
        target = defaultValue;
        ha.store.set(key, target);
    }

    let saveTimeout;
    const debouncedSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => ha.store.set(key, target), 50);
    };

    return createDeepProxy(target, debouncedSave);
};

global.schedule = (exp, cb) => {
    parentPort.ref(); // Keep alive for cron
    ensureMessageListener();
    // Lazy Load Cron only when used
    return require('node-cron').schedule(exp, async () => {
        try {
            await cb();
        } catch (e) {
            ha.error(`Scheduled Task Error (${exp}): ${e.message}\n${e.stack}`);
        }
    });
};
global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- 5. LIBRARY INJECTION ---
function loadLibraries() {
    const scriptPath = workerData.path;
    try {
        // 1. Read script content to parse headers
        const content = fs.readFileSync(scriptPath, 'utf8');
        
        // 2. Find all @include tags (supports multiple lines and comma-separation)
        // Matches: @include lib1.js, lib2.js
        const includeMatches = content.matchAll(/@include\s+(.+)/g);
        const librariesToLoad = new Set();

        for (const match of includeMatches) {
            match[1].split(',').forEach(lib => {
                const cleanName = lib.trim();
                if (cleanName) librariesToLoad.add(cleanName);
            });
        }

        // 3. Load and execute libraries
        if (librariesToLoad.size > 0) {
            // We assume the 'libraries' folder is in the same directory
            const libDir = path.join(path.dirname(scriptPath), 'libraries');
            
            librariesToLoad.forEach(libName => {
                // Handle potential .ts extensions in @include or missing extensions
                let actualLibName = libName;
                if (actualLibName.endsWith('.ts')) {
                    actualLibName = actualLibName.replace(/\.ts$/, '.js');
                } else if (!actualLibName.endsWith('.js')) {
                    actualLibName += '.js';
                }
                
                const libPath = path.join(libDir, actualLibName);
                
                if (fs.existsSync(libPath)) {
                    const libCode = fs.readFileSync(libPath, 'utf8');
                    // Execute the code in the global context of this worker
                    vm.runInThisContext(libCode, { filename: libPath });
                } else {
                    ha.warn(`Library not found: ${libName} (checked in ${libDir})`);
                }
            });
        }
    } catch (e) {
        ha.error(e);
    }
}

// --- 6. EXECUTION ---
try {
    loadLibraries(); // Load libraries first
    const scriptPath = require.resolve(workerData.path);
    delete require.cache[scriptPath]; // Avoid stale code
    require(scriptPath);
} catch (err) {
    ha.error(err);
    console.error(`[Worker Error] ${workerData.filename}:`, err);
    // Exit after a short delay to allow log delivery
    setTimeout(() => process.exit(1), 100);
}