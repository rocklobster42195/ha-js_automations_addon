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

// Ensure all necessary directories exist before proceeding
config.ensureDirectories();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io', cors: { origin: "*" } });

// Boot the kernel, which instantiates all managers
kernel.boot(io);

// --- Global Middleware & Static Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/locales', express.static(path.join(__dirname, 'locales')));
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
    socket.on('get_integration_status', (callback) => {
        callback({ available: kernel.hasIntegration });
    });
    // The bridge now handles broadcasting the safe mode status, so we
    // don't need to send it on each connection here.
});


// --- API ROUTERS ---
// The kernel holds all manager instances, so we pass them to the routes.
const { workerManager, depManager, stateManager, storeManager, haConnector, logManager, integrationManager, systemService } = kernel;

const scriptsRouter = require('./routes/scripts-routes')(workerManager, depManager, stateManager, io, config.SCRIPTS_DIR, config.STORAGE_DIR, config.LIBRARIES_DIR);

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

const storeRouter = require('./routes/store-route')(storeManagerUiWrapper);
const systemRouter = require('./routes/system-route')(haConnector, logManager, () => kernel.systemOptions, integrationManager, config.SCRIPTS_DIR, systemService);
const settingsRouter = require('./routes/settings-route');
const haRouter = require('./routes/ha-routes')(haConnector);

app.use('/api/scripts', scriptsRouter);
app.use('/api/store', storeRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ha', haRouter);
app.use('/api', systemRouter);






/**
 * Main application entry point.
 */
async function main() {
    try {
        // Start the kernel's main logic
        await kernel.start();

        // Start the web server
        server.listen(config.PORT, '0.0.0.0', () => {
            console.log(`🌍 Dashboard is running on http://localhost:${config.PORT}`);
        });
        


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
