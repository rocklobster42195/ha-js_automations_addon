/**
 * JS AUTOMATIONS - Worker Wrapper (v2.16.x)
 * Features: Local Cache, Sync Store, Graceful Shutdown, Global Libraries.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const historyHelpers = require('./ha-history-helpers');
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

// --- 1b. CAPABILITY ENFORCEMENT ---
// When capability_enforcement is enabled, block undeclared module access before user code loads.
// Module._load is an internal Node.js API used widely in the ecosystem (Jest, nock, proxyquire).
//
// System packages listed in SYSTEM_INTERNAL_PACKAGES are allowed to require sensitive native
// modules freely — they are used internally by the ha API and their native deps are an
// implementation detail the user has no control over.
// All other npm packages are subject to the same permission checks as user code,
// ensuring that @permission network/exec is enforced even for indirect requires.
let _scriptExecuting = false;

if (workerData.capabilityEnforcement) {
    const _permissions = new Set(workerData.permissions || []);
    const _origLoad = Module._load;

    const NETWORK_MODULES = new Set(['http', 'https', 'net', 'tls', 'dns']);
    const EXEC_MODULES    = new Set(['child_process']);

    // Packages used internally by the ha API that may require privileged native modules.
    // node-cron requires child_process for its BackgroundScheduledTask feature at load time,
    // even when only foreground tasks are used.
    const SYSTEM_INTERNAL_PACKAGES = ['node-cron'];

    Module._load = function (request, parent, isMain) {
        if (_scriptExecuting) {
            const parentFile = parent?.filename || '';
            const isSystemInternal = SYSTEM_INTERNAL_PACKAGES.some(pkg =>
                parentFile.includes(`node_modules/${pkg}`) ||
                parentFile.includes(`node_modules\\${pkg}`)
            );

            if (!isSystemInternal) {
                if (NETWORK_MODULES.has(request) && !_permissions.has('network')) {
                    throw new Error(
                        `PermissionDeniedError: '${request}' requires @permission network in your script header.` +
                        (parentFile.includes('node_modules')
                            ? ` An npm package you imported is using '${request}' internally — add @permission network to your header.`
                            : '')
                    );
                }
                if (EXEC_MODULES.has(request) && !_permissions.has('exec')) {
                    throw new Error(
                        `PermissionDeniedError: 'child_process' requires @permission exec in your script header.` +
                        (parentFile.includes('node_modules')
                            ? ` An npm package you imported is using 'child_process' internally — add @permission exec to your header.`
                            : '')
                    );
                }
            }
        }
        return _origLoad.apply(this, arguments);
    };

    // Block native fetch (Node 18+) when network is not declared
    if (!_permissions.has('network') && typeof globalThis.fetch === 'function') {
        globalThis.fetch = () => {
            throw new Error(
                `PermissionDeniedError: fetch() requires @permission network in your script header.`
            );
        };
    }
}

// Default: Allow thread to exit if nothing is happening
parentPort.unref();

// Reference counting for parentPort keep-alive.
// parentPort.ref()/unref() is a toggle, not a counter — one unref() cancels all
// previous ref() calls. We track intent ourselves so that a completing service call
// does not accidentally cancel the keep-alive from registered ha.on() listeners.
let _refCount = 0;
function _addRef() {
    _refCount++;
    if (_refCount === 1) parentPort.ref();
}
function _releaseRef() {
    if (_refCount > 0) _refCount--;
    if (_refCount === 0) parentPort.unref();
}

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
const eventTypeCallbacks = []; // for ha.onEvent()
const stopCallbacks = [];
const errorCallbacks = [];
let isListening = false;

// Native entity tracking: entity IDs registered via ha.register().
// ha_events for these are always HA echoes of the script's own MQTT publishes
// and are suppressed entirely in the ha_event handler. Commands from HA arrive
// via mqtt_command instead.
const nativeEntityIds = new Set();

// Watch expressions: label → { fn, lastSerialized }
const _watchers = new Map();
// Keep-alive timer for scripts that only use ha.watch() — parentPort.ref() alone is
// unreliable in some Node.js versions (especially after Atomics.wait() returns).
let _watchKeepaliveTimer = null;

// HA non-command states filtered out of mqtt_command dispatches.
// Scripts should never need to guard against these themselves.
const HA_TECH_STATES = new Set(['unknown', 'unavailable', 'None', '']);

const pendingServiceCalls = new Map();
const pendingAsks = new Map(); // correlationId -> { resolve, timer }
const actionHandlers = new Map(); // actionName -> async handler
const entityActionMap = new Map(); // entityId -> actionName (for ha.register action: routing)
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
        this._proxy = null;

        // Return a Proxy to allow calling any service name as a method
        const proxy = new Proxy(this, {
            get: (target, prop) => {
                // Do not treat internal JS properties or 'then' (for Promises) as services
                if (prop in target || typeof prop !== 'string' || prop === 'then') return target[prop];

                // Call via proxy so 'this' inside call() stays the proxy, preserving chaining
                return (data = {}) => target._proxy.call(prop, data);
            }
        });
        this._proxy = proxy;
        return proxy;
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

        // Handle ha.frontend.installCard() response
        if (msg.type === 'install_card_response') {
            const promise = pendingServiceCalls.get(msg.callId);
            if (promise) {
                if (msg.error) promise.reject(new Error(msg.error));
                else promise.resolve(msg.url);
                pendingServiceCalls.delete(msg.callId);
                _releaseRef();
            }
            return;
        }

        // Handle ha.getHistory() response
        if (msg.type === 'get_history_response') {
            const promise = pendingServiceCalls.get(msg.callId);
            if (promise) {
                if (msg.error) promise.reject(new Error(msg.error));
                else promise.resolve(msg.result);
                pendingServiceCalls.delete(msg.callId);
                _releaseRef();
            }
            return;
        }

        if (msg.type === 'get_statistics_response' || msg.type === 'render_template_response' ||
            msg.type === 'get_calendar_events_response' || msg.type === 'get_todo_items_response') {
            const promise = pendingServiceCalls.get(msg.callId);
            if (promise) {
                if (msg.error) promise.reject(new Error(msg.error));
                else promise.resolve(msg.result);
                pendingServiceCalls.delete(msg.callId);
                _releaseRef();
            }
            return;
        }

        // Handle ha.onEvent() callbacks
        if (msg.type === 'ha_custom_event') {
            for (const sub of eventTypeCallbacks) {
                if (sub.eventType === msg.event.event_type) {
                    try { sub.callback(msg.event); }
                    catch (e) { ha.error(`Error in ha.onEvent callback for ${msg.event.event_type}: ${e.message}\n${e.stack}`); }
                }
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

            // Skip entity deletion events (new_state: null) — no useful state to deliver
            if (!msg.state) return;

            // Re-evaluate watch expressions on every state change (change-detected, non-blocking)
            if (_watchers.size > 0) {
                _watchers.forEach((watcher, label) => {
                    try {
                        const value = watcher.fn();
                        const serialized = JSON.stringify(value);
                        if (serialized !== watcher.lastSerialized) {
                            watcher.lastSerialized = serialized;
                            parentPort.postMessage({ type: 'watch_update', label, value, script: workerData.filename });
                        }
                    } catch (e) { /* entity might not exist yet or value not serializable */ }
                });
            }

            // Native entities (ha.register()) are commanded via mqtt_command, not ha_event.
            // Any ha_event for a native entity is an HA echo of the script's own MQTT publish
            // — drop it unconditionally. This correctly handles all entity types including
            // buttons, which have no initial_state and were not covered by the previous
            // state-matching suppression.
            if (nativeEntityIds.has(msg.entity_id)) return;

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

        // Handle MQTT commands for ha.register()ed entities — routed through ha.on() subscriptions.
        // The command payload becomes event.state so existing ha.on() handlers work transparently.
        if (msg.type === 'mqtt_command') {
            // Filter HA technical/non-command states globally — scripts never need to guard
            // against unknown/unavailable/None themselves.
            if (HA_TECH_STATES.has(msg.payload)) return;

            subscriptionCallbacks.forEach(sub => {
                if (!matches(msg.entityId, sub.pattern)) return;
                try {
                    sub.callback({ entity_id: msg.entityId, state: msg.payload, old_state: null, attributes: {} });
                } catch (e) {
                    ha.error(`Error in ha.on command callback for ${msg.entityId}: ${e.message}\n${e.stack}`);
                }
            });

            // Route button press to ha.action() handler if registered via ha.register({ action: '...' })
            const linkedAction = entityActionMap.get(msg.entityId);
            if (linkedAction && actionHandlers.has(linkedAction)) {
                Promise.resolve().then(() => actionHandlers.get(linkedAction)({})).catch(e => {
                    ha.error(`ha.action('${linkedAction}') error: ${e.message}\n${e.stack}`);
                });
            }

            // Update local state cache so ha.getState() reflects the command immediately
            if (states[msg.entityId]) states[msg.entityId].state = msg.payload;
            return;
        }

        // Handle ha.action() calls triggered from the addon UI or a card via Socket.io
        if (msg.type === 'card_action') {
            const handler = actionHandlers.get(msg.action);
            if (!handler) {
                parentPort.postMessage({ type: 'action_response', callId: msg.callId, error: `Unknown action "${msg.action}"` });
                return;
            }
            try {
                const result = await handler(msg.payload ?? {});
                parentPort.postMessage({ type: 'action_response', callId: msg.callId, result: result ?? null });
            } catch (e) {
                ha.error(`ha.action('${msg.action}') error: ${e.message}\n${e.stack}`);
                parentPort.postMessage({ type: 'action_response', callId: msg.callId, error: e.message });
            }
            return;
        }

        // ha.mqtt.subscribe() with no broker configured — release ref, warn once
        if (msg.type === 'mqtt_subscribe_noop') {
            if (_mqttSubscriptions.has(msg.subscriptionId)) {
                _releaseRef();
                ha.warn(`ha.mqtt.subscribe: MQTT broker is not configured. This subscription will never receive messages.`);
            }
            return;
        }

        // Handle incoming raw MQTT message from ha.mqtt.subscribe()
        if (msg.type === 'mqtt_raw_message') {
            const cb = _mqttSubscriptions.get(msg.subscriptionId);
            if (cb) {
                let payload = msg.payload;
                try { payload = JSON.parse(payload); } catch (e) { /* keep as string */ }
                try { cb(msg.topic, payload); }
                catch (e) { ha.error(`Error in ha.mqtt.subscribe callback (${msg.topic}): ${e.message}\n${e.stack}`); }
            }
            return;
        }

        // ha.onWebhook() registration failed on the main process (e.g. id conflict)
        if (msg.type === 'webhook_register_error') {
            _webhookHandlers.delete(msg.id);
            _releaseRef();
            ha.error(`ha.onWebhook('${msg.id}'): ${msg.error}`);
            return;
        }

        // Incoming HTTP request for a registered ha.onWebhook() handler
        if (msg.type === 'webhook_request') {
            const handler = _webhookHandlers.get(msg.id);
            if (!handler) return;

            let responded = false;
            let statusCode = 200;
            const respond = (body, isJson) => {
                if (responded) return;
                responded = true;
                parentPort.postMessage({ type: 'webhook_response', correlationId: msg.correlationId, response: { status: statusCode, body, isJson } });
            };
            const res = {
                status(code) { statusCode = code; return this; },
                json(data) { respond(data, true); },
                send(text) { respond(text, false); },
            };

            try {
                await handler(msg.req, res);
                if (!responded) respond(undefined, false);
            } catch (e) {
                ha.error(`ha.onWebhook('${msg.id}') handler error: ${e.message}\n${e.stack}`);
                if (!responded) {
                    responded = true;
                    parentPort.postMessage({ type: 'webhook_response', correlationId: msg.correlationId, response: { error: e.message } });
                }
            }
            return;
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
            // Flush any pending ha.persistent() debounced saves before exiting.
            for (const flush of persistentFlushRegistry) flush();
            process.exit(0);
        }

        // Emergency flush before force-kill — sent when the worker didn't respond to stop_request.
        if (msg.type === 'flush_persistent') {
            for (const flush of persistentFlushRegistry) flush();
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

    /**
     * Pauses script execution until the developer clicks "Continue" in the UI.
     * The vars object is displayed in the Breakpoints tab as a variable inspector.
     * Auto-resumes after 60 seconds to prevent scripts from hanging indefinitely.
     * @param {string} label - Descriptive label shown in the UI
     * @param {object} [vars] - Variables to inspect (key/value pairs)
     */
    breakpoint: (label, vars = {}) => {
        if (scriptLevel > 0) {
            sendLog('info', `⏸ ha.breakpoint("${label}") skipped — set log level to 'debug' to enable breakpoints`);
            return;
        }
        const sab = new SharedArrayBuffer(4);
        const flag = new Int32Array(sab);
        sendLog('info', `⏸ Breakpoint: "${label}"`);
        parentPort.postMessage({ type: 'breakpoint', label, vars, sab });
        Atomics.wait(flag, 0, 0, 60000);
        sendLog('debug', `▶ Continued from breakpoint: "${label}"`);
    },

    /**
     * Sends a one-shot variable snapshot to the WATCH tab (non-blocking).
     * Appears as a timestamped list entry below the live watch tiles.
     * @param {string} label - Descriptive label shown in the UI
     * @param {object} [vars] - Variables to display (key/value pairs)
     */
    inspect: (label, vars = {}) => {
        if (scriptLevel > 0) {
            sendLog('info', `🔍 ha.inspect("${label}") skipped — set log level to 'debug' to enable inspect snapshots`);
            return;
        }
        parentPort.postMessage({ type: 'inspect', label, vars, script: workerData.filename });
    },

    /**
     * Registers a live watch expression that re-evaluates on every HA state change.
     * Results appear as updating tiles at the top of the WATCH tab.
     * @param {string} label - Unique label for the tile (used to identify it in the UI)
     * @param {function(): unknown} fn - Expression to evaluate; has access to all ha.* APIs
     */
    watch: (label, fn) => {
        ensureMessageListener();
        _addRef();
        if (!_watchKeepaliveTimer) {
            _watchKeepaliveTimer = setInterval(() => {}, 60000);
        }
        parentPort.postMessage({ type: 'subscribe', pattern: '*' });
        const initial = (() => { try { return fn(); } catch (e) { return undefined; } })();
        _watchers.set(label, { fn, lastSerialized: JSON.stringify(initial) });
        parentPort.postMessage({ type: 'watch_update', label, value: initial, script: workerData.filename });
    },

    // Commands
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),

    /**
     * Global helper function for Home Assistant service calls.
     * Format: ha.call('domain.service', { data })
     * Pass { returnResponse: true } to await the service's response payload
     * (e.g. weather.get_forecasts) instead of firing-and-forgetting.
     */
    call: (serviceId, data = {}, options = {}) => {
        const [domain, service] = (serviceId || '').split('.');
        if (!domain || !service) {
            ha.error(`Invalid service ID format: "${serviceId}". Expected "domain.service"`);
            return options.returnResponse ? Promise.resolve(undefined) : undefined;
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

        if (!options.returnResponse) {
            ha.callService(domain, service, data);
            return;
        }

        // Awaitable path: mirrors the ha.entity() callId/service_response dance,
        // but resolves with the actual response payload instead of a chainable proxy.
        ensureMessageListener();
        const callId = ++serviceCallCounter;
        _addRef();
        return new Promise((resolve, reject) => {
            pendingServiceCalls.set(callId, {
                resolve: (result) => { _releaseRef(); resolve(result?.response ?? result); },
                reject: (err) => { _releaseRef(); reject(err); }
            });
            parentPort.postMessage({ type: 'call_service', domain, service, data, callId, returnResponse: true });

            setTimeout(() => {
                const pending = pendingServiceCalls.get(callId);
                if (pending) {
                    pendingServiceCalls.delete(callId);
                    pending.reject(new Error(`Service call ${serviceId} timed out.`));
                }
            }, 10000);
        });
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
        _addRef(); // Prevent the worker from exiting while waiting for the response
        parentPort.postMessage({ type: 'register_ask', correlationId });

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pendingAsks.delete(correlationId);
                // Auto-dismiss the notification on the device so the user doesn't
                // see a stale prompt after the timeout has already resolved.
                ha.notify('clear_notification', { target, data: { tag: correlationId } });
                _releaseRef();
                resolve(defaultAction);
            }, timeout);

            pendingAsks.set(correlationId, {
                resolve: (action) => { _releaseRef(); resolve(action); },
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
                    _addRef(); // Prevent exit while the call is in progress
                    return new Promise((resolve, reject) => {
                        pendingServiceCalls.set(callId, {
                            resolve: () => {
                                _releaseRef();
                                resolve(apiProxy);
                            },
                            reject: (err) => {
                                _releaseRef();
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
        // If action: is specified, link this entity to a ha.action() handler.
        if (config.action) {
            entityActionMap.set(entityId, config.action);
            delete config.action; // Don't forward to MQTT/HA — it's internal routing only
        }
        // Track as a native entity so ha_events for it are suppressed (commands arrive via mqtt_command).
        nativeEntityIds.add(entityId);
        // Send the intent to the main process, which handles the registration via MQTT.
        parentPort.postMessage({ type: 'create_entity', entityId, config });
    },
    
    // Frontend / Lovelace
    frontend: {
        /**
         * Installs the card embedded in this script's __JSA_CARD__ block to
         * config/www/jsa-cards/ and registers it as a Lovelace resource.
         * Skips the write if the card source has not changed (hash-based).
         *
         * In @card dev mode the file write and Lovelace registration are skipped;
         * the preview panel is updated live instead.
         *
         * @param {object} [options]
         * @param {object} [options.config]  - Config object passed to setConfig() on first connect
         * @param {boolean} [options.force]  - Force reinstall even if hash matches
         * @returns {Promise<string>} Installed resource URL
         */
        installCard: (options = {}) => new Promise((resolve, reject) => {
            const callId = `card_${serviceCallCounter++}`;
            ensureMessageListener();
            _addRef();
            pendingServiceCalls.set(callId, { resolve, reject });
            parentPort.postMessage({ type: 'install_card', options, callId });
        }),
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
    entityExists: (entityId) => entityId in states,
    getAreas: () => workerData.initialAreas || [],
    getEntitiesInArea: (areaId) => {
        const entityRegistry = workerData.initialEntityRegistry || [];
        const deviceRegistry = workerData.initialDeviceRegistry || [];
        // Build device_id → area_id map for the fallback lookup
        const deviceAreaMap = new Map(deviceRegistry.map(d => [d.id, d.area_id]));
        return entityRegistry
            .filter(e => {
                if (e.disabled_by) return false;
                // Direct assignment takes priority; fall back to the device's area
                const effectiveArea = e.area_id ?? deviceAreaMap.get(e.device_id) ?? null;
                return effectiveArea === areaId;
            })
            .map(e => e.entity_id);
    },
    history: {
        get: (entityId, options = {}) => {
            _addRef();
            ensureMessageListener();
            const callId = ++serviceCallCounter;
            return new Promise((resolve, reject) => {
                pendingServiceCalls.set(callId, { resolve, reject });
                parentPort.postMessage({
                    type: 'get_history',
                    callId,
                    entityId,
                    start: options.start instanceof Date ? options.start.toISOString() : options.start,
                    end: options.end instanceof Date ? options.end.toISOString() : options.end,
                    minimalResponse: options.minimalResponse,
                    noAttributes: options.noAttributes,
                });
            });
        },

        statistics: (statId, options = {}) => {
            _addRef();
            ensureMessageListener();
            const callId = ++serviceCallCounter;
            return new Promise((resolve, reject) => {
                pendingServiceCalls.set(callId, { resolve, reject });
                parentPort.postMessage({
                    type: 'get_statistics',
                    callId,
                    statId,
                    start: options.start instanceof Date ? options.start.toISOString() : options.start,
                    end: options.end instanceof Date ? options.end.toISOString() : options.end,
                    period: options.period,
                    types: options.types,
                });
            });
        },

        trend:       (entityId, options)        => historyHelpers.trend(ha, entityId, options),
        derivative:  (entityId, options)        => historyHelpers.derivative(ha, entityId, options),
        integral:    (entityId, options)        => historyHelpers.integral(ha, entityId, options),
        stats:       (entityId, options)        => historyHelpers.stats(ha, entityId, options),
        timeSince:   (entityId, state)          => historyHelpers.timeSince(ha, entityId, state),
        timeInState: (entityId, state, options) => historyHelpers.timeInState(ha, entityId, state, options),
    },

    renderTemplate: (template) => {
        _addRef();
        ensureMessageListener();
        const callId = ++serviceCallCounter;
        return new Promise((resolve, reject) => {
            pendingServiceCalls.set(callId, { resolve, reject });
            parentPort.postMessage({ type: 'render_template', callId, template });
        });
    },

    getCalendarEvents: (entityId, options = {}) => {
        _addRef();
        ensureMessageListener();
        const callId = ++serviceCallCounter;
        return new Promise((resolve, reject) => {
            pendingServiceCalls.set(callId, { resolve, reject });
            parentPort.postMessage({
                type: 'get_calendar_events',
                callId,
                entityId,
                start: options.start instanceof Date ? options.start.toISOString() : options.start,
                end: options.end instanceof Date ? options.end.toISOString() : options.end,
            });
        });
    },

    getTodoItems: (entityId) => {
        _addRef();
        ensureMessageListener();
        const callId = ++serviceCallCounter;
        return new Promise((resolve, reject) => {
            pendingServiceCalls.set(callId, { resolve, reject });
            parentPort.postMessage({ type: 'get_todo_items', callId, entityId });
        });
    },

    getLabels: () => workerData.initialLabels || [],

    getEntitiesWithLabel: (labelIdOrName) => {
        const labels = workerData.initialLabels || [];
        const entityRegistry = workerData.initialEntityRegistry || [];
        const label = labels.find(l => l.label_id === labelIdOrName || l.name === labelIdOrName);
        if (!label) return [];
        return entityRegistry
            .filter(e => !e.disabled_by && Array.isArray(e.labels) && e.labels.includes(label.label_id))
            .map(e => e.entity_id);
    },

    getFloors: () => workerData.initialFloors || [],

    getAreasInFloor: (floorIdOrName) => {
        const floors = workerData.initialFloors || [];
        const floor = floors.find(f => f.floor_id === floorIdOrName || f.name === floorIdOrName);
        if (!floor) return [];
        return (workerData.initialAreas || []).filter(a => a.floor_id === floor.floor_id);
    },

    onEvent: (eventType, callback) => {
        ensureMessageListener();
        _addRef();
        eventTypeCallbacks.push({ eventType, callback });
        parentPort.postMessage({ type: 'subscribe_event_type', eventType });
    },

    fireEvent: (eventType, eventData = {}) => {
        parentPort.postMessage({ type: 'fire_event', eventType, eventData });
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
        ensureMessageListener();
        _addRef(); // Keep alive — must come after ensureMessageListener() which may call unref()
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

    /**
     * Registers a named action handler that can be triggered from a Lovelace card
     * (via __jsa__.callAction()), from a ha.register() button entity (via the action: field),
     * or from the addon UI.
     *
     * @param {string} name - Action name, e.g. 'refresh' or 'set-team'
     * @param {function} handler - Async function receiving an optional payload object.
     *   May return a value that is forwarded back to the caller.
     *
     * @example
     * ha.action('refresh', async () => { await update(); });
     *
     * @example
     * ha.action('set-team', async ({ teamId }) => {
     *   CONFIG.teamId = teamId;
     *   await update();
     * });
     */
    action: (name, handler) => {
        ensureMessageListener();
        _addRef(); // Keep alive — must come after ensureMessageListener() which may call unref()
        actionHandlers.set(name, handler);
    },

    onError: (cb) => {
        if (typeof cb === 'function') {
            errorCallbacks.push(cb);
            _addRef(); // Keep process alive if an error handler is used
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
            _addRef(); // Keep process alive
            ensureMessageListener();
        }
    }
};

// Injection
global.ha = ha;

// --- 4b. FS INJECTION ---
if (workerData.filesystemEnabled && workerData.fsDataDir) {
    const { buildHaFs } = require('./fs-service');
    ha.fs = buildHaFs({
        dataDir: workerData.fsDataDir,
        capabilityEnforcement: workerData.capabilityEnforcement,
        permissions: workerData.permissions || [],
        quotas: workerData.fsQuotas || {},
    });
}

// --- 4b2. MQTT SUBSCRIPTIONS ---
const _mqttSubscriptions = new Map(); // subscriptionId → callback
let _mqttSubCounter = 0;

// --- 4c. HTTP CONVENIENCE WRAPPER ---
{
    const _httpPermissions = new Set(workerData.permissions || []);
    const _checkNetworkPermission = () => {
        if (workerData.capabilityEnforcement && !_httpPermissions.has('network')) {
            throw new Error('PermissionDeniedError: ha.http requires @permission network in your script header.');
        }
    };

    const _parseResponse = async (res) => {
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ': ' + body : ''}`);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : res.text();
    };

    ha.http = {
        async get(url, options = {}) {
            _checkNetworkPermission();
            const res = await fetch(url, { method: 'GET', ...options });
            return _parseResponse(res);
        },
        async post(url, body, options = {}) {
            _checkNetworkPermission();
            const isJson = body !== null && typeof body === 'object';
            const res = await fetch(url, {
                method: 'POST',
                headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
                body: isJson ? JSON.stringify(body) : body,
                ...options,
            });
            return _parseResponse(res);
        },
    };
}

// --- 4d. MQTT API ---
{
    ha.mqtt = {
        /**
         * Subscribes to an MQTT topic. Wildcards supported (+ single-level, # multi-level).
         * Returns an unsubscribe function.
         */
        subscribe(topic, callback) {
            ensureMessageListener();
            _addRef();
            const subscriptionId = `mqttsub_${++_mqttSubCounter}`;
            _mqttSubscriptions.set(subscriptionId, callback);
            parentPort.postMessage({ type: 'mqtt_subscribe', subscriptionId, topic });

            return () => {
                if (!_mqttSubscriptions.has(subscriptionId)) return;
                _mqttSubscriptions.delete(subscriptionId);
                _releaseRef();
                parentPort.postMessage({ type: 'mqtt_unsubscribe', subscriptionId });
            };
        },

        /**
         * Publishes a message to an MQTT topic. Objects are JSON-serialized automatically.
         */
        publish(topic, payload, options = {}) {
            parentPort.postMessage({ type: 'mqtt_publish', topic, payload, options });
        }
    };
}

// --- 4e. WEBHOOK API ---
const _webhookHandlers = new Map(); // id -> handler function
{
    const _webhookPermissions = new Set(workerData.permissions || []);
    const _checkWebhookPermission = () => {
        if (workerData.capabilityEnforcement && !_webhookPermissions.has('webhook')) {
            throw new Error('PermissionDeniedError: ha.onWebhook requires @permission webhook in your script header.');
        }
    };

    /**
     * Registers a webhook endpoint at :<webhook_port>/webhook/<id>. See ha-api.d.ts for details.
     */
    ha.onWebhook = (id, optionsOrHandler, maybeHandler) => {
        _checkWebhookPermission();
        const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
        const options = typeof optionsOrHandler === 'function' ? {} : (optionsOrHandler || {});
        if (typeof handler !== 'function') {
            throw new Error('ha.onWebhook requires a handler function.');
        }
        if (_webhookHandlers.has(id)) {
            throw new Error(`ha.onWebhook: webhook id "${id}" is already registered in this script.`);
        }

        ensureMessageListener();
        _addRef(); // Keep the worker alive to handle future requests, like ha.onEvent()
        _webhookHandlers.set(id, handler);
        parentPort.postMessage({
            type: 'webhook_register',
            id,
            method: (options.method || 'POST').toUpperCase(),
            noAuth: !!options.noAuth,
            allowlist: Array.isArray(options.allowlist) ? options.allowlist : undefined,
        });
    };

    /**
     * Verifies an HMAC signature of the form providers like GitHub/Stripe send
     * (e.g. GitHub's `X-Hub-Signature-256: sha256=<hex>`). Always verify against
     * `req.rawBody`, not `req.body` — the parsed/re-serialized JSON is not guaranteed
     * to be byte-identical to what the sender actually signed.
     */
    ha.verifyWebhookSignature = (payload, signature, secret, options = {}) => {
        const algorithm = options.algorithm || 'sha256';
        const encoding = options.encoding || 'hex';
        const prefix = options.prefix !== undefined ? options.prefix : `${algorithm}=`;

        const digest = crypto.createHmac(algorithm, secret).update(String(payload), 'utf8').digest(encoding);
        const expected = prefix ? `${prefix}${digest}` : digest;

        const a = Buffer.from(String(signature || ''));
        const b = Buffer.from(expected);
        if (a.length !== b.length) {
            crypto.timingSafeEqual(b, b); // keep timing roughly consistent
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    };
}

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

// Registry of pending persistent saves — flushed synchronously on worker exit.
const persistentFlushRegistry = [];

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
    let dirty = false;

    const markClean = () => {
        dirty = false;
        parentPort.postMessage({ type: 'store_clean', key });
    };

    const flush = () => {
        if (!dirty) return;
        clearTimeout(saveTimeout);
        ha.store.set(key, target);
        markClean();
    };

    const onChange = () => {
        if (!dirty) {
            // First change since last save: write immediately and mark dirty in parent.
            dirty = true;
            parentPort.postMessage({ type: 'store_dirty', key, dirtyAt: Date.now() });
            ha.store.set(key, target);
            // Schedule clean-up for any rapid subsequent changes within the debounce window.
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(markClean, 50);
        } else {
            // Subsequent rapid change: debounce the save, parent already knows it's dirty.
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => { ha.store.set(key, target); markClean(); }, 50);
        }
    };

    persistentFlushRegistry.push(flush);
    return createDeepProxy(target, onChange);
};

/**
 * Converts human-readable schedule expressions to cron strings.
 * Standard cron expressions pass through unchanged.
 */
function _parseCronExpression(exp) {
    if (typeof exp !== 'string') return exp;
    const s = exp.trim().toLowerCase();

    // "every Nm" / "every N minutes"
    const everyMinutes = s.match(/^every\s+(\d+)\s*m(?:in(?:utes?)?)?$/);
    if (everyMinutes) return `*/${everyMinutes[1]} * * * *`;

    // "every Nh" / "every N hours"
    const everyHours = s.match(/^every\s+(\d+)\s*h(?:ours?)?$/);
    if (everyHours) return `0 */${everyHours[1]} * * *`;

    // "every minute"
    if (s === 'every minute') return '* * * * *';

    // "every hour"
    if (s === 'every hour') return '0 * * * *';

    // "every day at H:MM" / "daily at H:MM"
    const everyDay = s.match(/^(?:every day|daily) at (\d{1,2}):(\d{2})$/);
    if (everyDay) return `${parseInt(everyDay[2])} ${parseInt(everyDay[1])} * * *`;

    // "every weekday at H:MM"
    const everyWeekday = s.match(/^every weekday at (\d{1,2}):(\d{2})$/);
    if (everyWeekday) return `${parseInt(everyWeekday[2])} ${parseInt(everyWeekday[1])} * * 1-5`;

    // "every weekend at H:MM"
    const everyWeekend = s.match(/^every weekend at (\d{1,2}):(\d{2})$/);
    if (everyWeekend) return `${parseInt(everyWeekend[2])} ${parseInt(everyWeekend[1])} * * 6,0`;

    // "every monday at H:MM", "every tuesday at H:MM", etc.
    const dayNames = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    const everyNamed = s.match(/^every (monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2}):(\d{2})$/);
    if (everyNamed) return `${parseInt(everyNamed[3])} ${parseInt(everyNamed[2])} * * ${dayNames[everyNamed[1]]}`;

    return exp;
}

global.schedule = (exp, cb) => {
    _addRef(); // Keep alive for cron
    ensureMessageListener();
    const cronExp = _parseCronExpression(exp);
    // Lazy Load Cron only when used
    return require('node-cron').schedule(cronExp, async () => {
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
    _scriptExecuting = true;
    require(scriptPath);
} catch (err) {
    ha.error(err);
    // Exit after a short delay to allow log delivery
    setTimeout(() => process.exit(1), 100);
}