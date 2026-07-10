/**
 * JS AUTOMATIONS - Main Server
 * This file is the application's entry point. It sets up the web server,
 * boots the Kernel, and wires up the API routes.
 */
// DEV SETUP CHECK
if (!process.env.SUPERVISOR_TOKEN && !require('fs').existsSync(require('path').join(__dirname, '..', '.env'))) {
    try {
        require('child_process').execSync(`"${process.execPath}" "${require('path').join(__dirname, 'core', 'dev-setup.js')}"`, { stdio: 'inherit' });
    } catch (e) { process.exit(1); }
}

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('./core/config');
const kernel = require('./core/kernel');
const siblingGuard = require('./core/sibling-guard');

// Ensure all necessary directories exist before proceeding
config.ensureDirectories();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io', cors: { origin: "*" } });

// --- Sibling guard gate ---
// While the sibling addon (stable ↔ beta) is running, every request is answered
// with the blocked page instead of the app. The gate sits in front of all other
// middleware; once the sibling stops, blockedState is cleared and the full app
// (wired by startApp) takes over on the same Express instance.
let blockedState = null; // { siblingName, isBeta } while blocked, else null
app.use((req, res, next) => {
    if (!blockedState) return next();
    if (req.path.startsWith('/locales')) return next();
    if (req.path === '/api/blocked-status') {
        return res.json({ blocked: true, ...blockedState });
    }
    res.status(503).sendFile(path.join(__dirname, 'public', 'blocked.html'));
});

// Locales are served outside the gate so the blocked page can translate itself.
app.use('/locales', express.static(path.join(__dirname, 'locales')));

/**
 * Boots the kernel and wires up all middleware, socket handlers, and API routes.
 * Runs only once the sibling guard has confirmed the sibling addon is not running.
 */
function startApp() {
    // Boot the kernel, which instantiates all managers
    kernel.boot(io);

    // --- Global Middleware & Static Files ---
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());

    // --- Socket.io Connection Handling ---
    io.on('connection', (socket) => {
        // These are simple getters that can be fulfilled by the kernel's managers
        socket.on('get_ha_states', (callback) => {
            try {
                callback(kernel.haConnector.getStates());
            } catch (e) {
                callback({ error: e.message });
            }
        });
        socket.on('get_integration_status', async (callback) => {
            try {
                const status = await kernel.getSystemStatus();
                // Adapt for the frontend expectations
                callback({ ...status, available: status.active });
            } catch (e) {
                callback({ error: e.message });
            }
        });

        // Trigger a ha.action() handler in a running script — used by Lovelace cards and the addon UI.
        // data: { script: 'openligadb.js', action: 'refresh', payload: {} }
        socket.on('call_action', async (data, callback) => {
            try {
                if (!data?.script || !data?.action) {
                    return callback({ error: 'Missing script or action' });
                }
                const result = await workerManager.callAction(data.script, data.action, data.payload ?? {});
                callback({ result });
            } catch (e) {
                callback({ error: e.message });
            }
        });

        // The bridge now handles broadcasting the safe mode status, so we
        // don't need to send it on each connection here.
    });


    // --- API ROUTERS ---
    // The kernel holds all manager instances, so we pass them to the routes.
    const { workerManager, depManager, stateManager, storeManager, haConnector, logManager, systemService } = kernel;

    const scriptsRouter = require('./routes/scripts-routes')(workerManager, depManager, stateManager, io, config.SCRIPTS_DIR, config.STORAGE_DIR, config.LIBRARIES_DIR, kernel.mqttManager, kernel.cardManager);

    // We create a proxy for the StoreManager to broadcast changes to workers from the UI.
    const storeManagerUiWrapper = new Proxy(storeManager, {
        get(target, prop) {
            if (prop === 'set') {
                return (key, value, owner, isSecret) => {
                    const current = target.data[key]?.value;
                    const res = target.set(key, value, owner, isSecret);
                    if (current !== value) {
                        workerManager.broadcastToWorkers({ type: 'store_update', key, value });
                    }
                    return res;
                };
            }
            if (prop === 'delete') {
                return (key) => {
                    const exists = target.data[key] !== undefined;
                    const res = target.delete(key);
                    if (exists) {
                        workerManager.broadcastToWorkers({ type: 'store_update', key, value: undefined });
                    }
                    return res;
                };
            }
            return target[prop];
        }
    });

    const storeRouter = require('./routes/store-route')(storeManagerUiWrapper, workerManager);
    const systemRouter = require('./routes/system-route')(haConnector, logManager, () => kernel.systemOptions, config.SCRIPTS_DIR, systemService, kernel.getSystemStatus.bind(kernel), kernel.mqttManager, workerManager);
    const settingsRouter = require('./routes/settings-route');
    const haRouter = require('./routes/ha-routes')(haConnector);
    const webhookRouter = require('./routes/webhook-route')(kernel.webhookManager);

    app.use('/api/scripts', scriptsRouter);
    app.use('/api/store', storeRouter);
    app.use('/api/settings', settingsRouter);
    app.use('/api/ha', haRouter);
    app.use('/api/webhooks', webhookRouter);

    // System Restart Route
    app.post('/api/system/restart-ha', async (req, res) => {
        try {
            await haConnector.callService('homeassistant', 'restart', {});
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.use('/api', systemRouter);
}


// --- Graceful shutdown ---
// Node drops its default SIGTERM/SIGINT termination as soon as any handler is
// registered (log-manager and settings-manager add flush/save hooks), so
// without an explicit exit the process keeps running until the Supervisor
// SIGKILLs it after its stop timeout (exit code 137). This handler shuts the
// kernel down and exits well within the Supervisor's grace window.
let shuttingDown = false;
function gracefulExit(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`📴 Received ${signal} — shutting down...`);
    try {
        kernel.shutdown();
    } catch (e) {
        console.error('Shutdown error:', e.message);
    }
    server.close();
    // Give workers a moment to stop cleanly, then end the process.
    setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('SIGINT', () => gracefulExit('SIGINT'));

/**
 * Main application entry point.
 */
async function main() {
    try {
        // Sibling guard: never run stable and beta at the same time (shared
        // /config/js-automations and host port 3001). If the sibling addon is
        // running, serve only the blocked page and wait for it to stop.
        const guardResult = await siblingGuard.check();
        if (guardResult.blocked) {
            blockedState = { siblingName: guardResult.siblingName, isBeta: guardResult.isBeta };
            server.listen(config.PORT, '0.0.0.0', () => {
                console.log(`⏸️  Sibling addon "${guardResult.siblingName}" is running — waiting in blocked mode on port ${config.PORT}.`);
            });
            await siblingGuard.waitUntilFree();
            console.log('▶️  Sibling addon stopped — activating this addon now.');
            blockedState = null;
        }

        // Wire up the full application (kernel boot, routes, sockets)
        startApp();

        // Listen right away (unless already listening from blocked mode) so
        // ingress reaches the UI while the kernel is still starting — HA
        // connect, initial TS compilation, and script autostart can take a
        // while, and the Supervisor logs ingress errors for every hit until
        // the port is open.
        if (!server.listening) {
            server.listen(config.PORT, '0.0.0.0', () => {
                console.log(`🌍 Dashboard is running on http://localhost:${config.PORT}`);
            });
        }

        // Start the kernel's main logic
        await kernel.start();

        // Start the HA auto-reconnection loop
        let isReconnecting = false;
        setInterval(async () => {
            if (!isReconnecting) {
                isReconnecting = true;
                await kernel.handleReconnection();
                isReconnecting = false;
            }
        }, 5000);

    } catch (err) {
        console.error('❌ A critical error occurred during startup:', err);
        process.exit(1);
    }
}

main();
