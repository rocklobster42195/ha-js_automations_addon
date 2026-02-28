/**
 * JS AUTOMATIONS - Main Server (v1.9.0)
 * Storage Migration & NPM Prune
 */
// DEV SETUP CHECK
if (!process.env.SUPERVISOR_TOKEN && !require('fs').existsSync(require('path').join(__dirname, '.env'))) {
    try {
        // Starte den Wizard synchron in einem Kindprozess, damit wir warten können
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

const HAConnector = require('./core/ha-connection');
const ScriptParser = require('./core/parser');
const workerManager = require('./core/worker-manager');
const DependencyManager = require('./core/dependency-manager');
const StateManager = require('./core/state-manager');
const StoreManager = require('./core/store-manager');
const EntityManager = require('./core/entity-manager');
const LogManager = require('./core/log-manager');
const packageJson = require('./package.json');

const IS_ADDON = !!process.env.SUPERVISOR_TOKEN;
const SCRIPTS_DIR = IS_ADDON ? '/config/js-automations' : path.join(__dirname, 'scripts');
const STORAGE_DIR = path.join(SCRIPTS_DIR, '.storage'); // NEU: Versteckter System-Ordner
const LIBRARIES_DIR = path.join(SCRIPTS_DIR, 'libraries'); // NEU: Libraries Ordner
const PORT = process.env.PORT || 3000;

// Ordnerstrukturen sicherstellen
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fs.existsSync(LIBRARIES_DIR)) fs.mkdirSync(LIBRARIES_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io', cors: { origin: "*" } });

const connector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, STORAGE_DIR);
const depManager = new DependencyManager(SCRIPTS_DIR, STORAGE_DIR); // Übergibt beide Pfade
const stateManager = new StateManager(STORAGE_DIR);
const storeManager = new StoreManager(STORAGE_DIR);
const logManager = new LogManager(STORAGE_DIR);

// OPTIONS LOADING
let systemOptions = { expert_mode: true };
// function loadSystemOptions() {
//     if (IS_ADDON && fs.existsSync('/data/options.json')) {
//         try {
//             systemOptions = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
//         } catch (e) { console.error("Failed to load options.json", e); }
//     } else if (fs.existsSync(path.join(__dirname, 'config.yaml'))) {
//         // Fallback for local dev: Parse config.yaml (simple regex)
//         try {
//             const yaml = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
//             const expertMatch = yaml.match(/expert_mode:\s*(true|false)/);
//             if (expertMatch) {
//                 systemOptions.expert_mode = expertMatch[1] === 'true';
//             }
//             const langMatch = yaml.match(/ui_language:\s*["']?([a-z]{2})["']?/);
//             if (langMatch) {
//                 systemOptions.ui_language = langMatch[1];
//             }
//         } catch (e) { console.error("Failed to parse config.yaml", e); }
//     }
// }
// loadSystemOptions();

// NPM Logs an das Frontend weiterleiten
depManager.on('log', ({ level, message }) => {
    const entry = logManager.add(level, 'System', message);
    io.emit('log', entry);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/locales', express.static(path.join(__dirname, 'locales')));
app.use(express.json());

async function startSystem() {
    console.log(`🚀 Starting JS Automations Hub (v${packageJson.version})...`);
    let startMsg = `Addon started (v${packageJson.version})...`;
    if (systemOptions.expert_mode) {
        startMsg += " (Expert Mode)";
    }
    logManager.add('info', 'System', startMsg);
    try {
        await connector.connect();
        
        // Integration Check (Ping)
        let hasIntegration = await connector.checkIntegrationAvailable();
        const intMsg = hasIntegration 
            ? "✅ Native Integration (js_automations) detected." 
            : "⚠️ Native Integration not found. Using Legacy Mode (HTTP).";
        io.emit('log', logManager.add(hasIntegration ? 'info' : 'warn', 'System', intMsg));

        workerManager.setConnector(connector);
        workerManager.setStore(storeManager);
        workerManager.setStorageDir(STORAGE_DIR); // Dem Manager den neuen Pfad sagen
        workerManager.setScriptsDir(SCRIPTS_DIR);

        const entityManager = new EntityManager(connector, workerManager, stateManager);
        await entityManager.createExposedEntities(hasIntegration);

        // State Verteilung
        connector.subscribeToEvents((event) => {
            if (event.event_type === 'state_changed') {
                const { entity_id, new_state, old_state } = event.data;
                workerManager.dispatchStateChange(entity_id, new_state, old_state);
            }
        });

        // Lifecycle Events
        workerManager.on('script_start', ({ filename, meta }) => {
            // State Persistence: Save started state for everything except buttons
            if (!meta || meta.expose !== 'button') {
                stateManager.saveScriptStarted(filename);
            }

            // Nur Switches bekommen Status-Updates (Buttons sind stateless)
            if (!meta || meta.expose !== 'switch') return;

            const scriptName = path.basename(filename, '.js');
            // FIX: Ensure entityId and unique_id are lowercase to match creation
            const entityId = `switch.js_automations_${scriptName}`.toLowerCase();
            const uniqueId = `js_automations_switch_${scriptName}`.toLowerCase();
            stateManager.set(entityId, 'on');
            
            if (hasIntegration) {
                // Native Update via Service
                const payload = { unique_id: uniqueId, state: 'on' };
                logManager.add('debug', 'System', `Updating system switch state: ${JSON.stringify(payload)}`);
                connector.callService('js_automations', 'update_entity', payload);
            } else {
                // Legacy Update
                connector.updateState(entityId, 'on');
            }
            io.emit('status_update');
        });

        workerManager.on('script_exit', (d) => {
            // State Persistence: Save stopped state for everything except buttons
            // We ignore 'restarting' to preserve the state during updates
            if (!d.meta || d.meta.expose !== 'button') {
                const isPermanentStop = d.type === 'error' || d.reason === 'finished' || d.reason === 'by user' || d.reason.includes('stopped by user');
                if (isPermanentStop) {
                    stateManager.saveScriptStopped(d.filename);
                }
            }

            // Nur Switches bekommen Status-Updates
            if (d.meta && d.meta.expose === 'switch') {
                const scriptName = path.basename(d.filename, '.js');

                // FIX: Ensure entityId and unique_id are lowercase to match creation
                const entityId = `switch.js_automations_${scriptName}`.toLowerCase();
                const uniqueId = `js_automations_switch_${scriptName}`.toLowerCase();
                stateManager.set(entityId, 'off');
                
                if (hasIntegration) {
                    // Native Update via Service
                    const payload = { unique_id: uniqueId, state: 'off' };
                    logManager.add('debug', 'System', `Updating system switch state: ${JSON.stringify(payload)}`);
                    connector.callService('js_automations', 'update_entity', payload);
                } else {
                    // Legacy Update
                    connector.updateState(entityId, 'off');
                }
            }
            
            // NEU: LogManager nutzen & UI Update für ALLE Skripte
            const entry = logManager.add(d.type || 'info', 'System', `${path.basename(d.filename)} ${d.reason}`);
            io.emit('log', entry);
            io.emit('status_update');
        });

        workerManager.on('log', (data) => {
            // data = { source, message, level }
            const entry = logManager.add(data.level || 'info', data.source, data.message);
            io.emit('log', entry);
        });

        // Autostart
        const enabled = stateManager.getEnabledScripts();
        for (const file of enabled) {
            const fullPath = path.join(SCRIPTS_DIR, file);
            if (fs.existsSync(fullPath)) {
                const meta = ScriptParser.parse(fullPath);
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies, false);
                workerManager.startScript(file);
            }
        }
        
        // Initialer Prune beim Start (optional)
        depManager.prune();

        server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Dashboard on http://localhost:${PORT}`));

        // Auto-Reconnection Loop
        let isReconnecting = false;
        setInterval(async () => {
            if (!connector.isReady && !isReconnecting) {
                isReconnecting = true;
                console.log("⚠️ HA Connection lost. Attempting to reconnect...");
                try {
                    await connector.connect();
                    console.log("✅ HA Reconnected!");
                    
                    // Re-Check Integration & Re-Register Entities
                    hasIntegration = await connector.checkIntegrationAvailable();
                    await entityManager.createExposedEntities(hasIntegration);
                    await workerManager.republishNativeEntities();
                } catch (e) {
                    console.error("❌ Reconnection failed:", e.message);
                } finally {
                    isReconnecting = false;
                }
            }
        }, 5000);
    } catch (err) { console.error(err); }
}

// --- ROUTERS ---
const scriptsRouter = require('./routes/scripts')(workerManager, depManager, stateManager, io, SCRIPTS_DIR, STORAGE_DIR, LIBRARIES_DIR);
const storeRouter = require('./routes/store')(storeManager);
const systemRouter = require('./routes/system')(connector, logManager, () => systemOptions);

app.use('/api/scripts', scriptsRouter);
app.use('/api/store', storeRouter);

// Status-Route für Version
app.get('/api/status', (req, res) => {
    res.json({ version: packageJson.version });
});

// FIX: Add missing route for services (IntelliSense)
app.get('/api/ha/services', async (req, res) => {
    try {
        const services = await connector.getServices();
        res.json(services);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use('/api', systemRouter);

// --- SYSTEM STATS (CPU/RAM) ---
function getCpuTick() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }
    return { idle, total: user + nice + sys + idle + irq };
}

let startTick = getCpuTick();

setInterval(() => {
    const endTick = getCpuTick();
    const idleDiff = endTick.idle - startTick.idle;
    const totalDiff = endTick.total - startTick.total;
    const cpuPercent = totalDiff > 0 ? 100 - Math.floor(100 * idleDiff / totalDiff) : 0;
    startTick = endTick;

    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const appMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const appHeap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    // Skript-Stats mitsenden (Map zu Objekt konvertieren)
    const scriptStats = {};
    workerManager.stats.forEach((v, k) => scriptStats[k] = v);

    io.emit('system_stats', { cpu: cpuPercent, ram_used: totalMem - freeMem, ram_total: totalMem, app_ram: appMem, app_heap: appHeap, script_stats: scriptStats });
}, 2000);

startSystem();