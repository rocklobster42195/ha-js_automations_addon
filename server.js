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
const SCRIPTS_DIR = IS_ADDON ? '/config/js-automation' : path.join(__dirname, 'scripts');
const STORAGE_DIR = path.join(SCRIPTS_DIR, '.storage'); // NEU: Versteckter System-Ordner
const PORT = process.env.PORT || 3000;

// Ordnerstrukturen sicherstellen
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

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
        workerManager.setConnector(connector);
        workerManager.setStore(storeManager);
        workerManager.setStorageDir(STORAGE_DIR); // Dem Manager den neuen Pfad sagen
        workerManager.setScriptsDir(SCRIPTS_DIR);

        const entityManager = new EntityManager(connector, workerManager, stateManager);
        await entityManager.createSwitches();

        // State Verteilung
        connector.subscribeToEvents((event) => {
            if (event.event_type === 'state_changed') {
                const { entity_id, new_state, old_state } = event.data;
                workerManager.dispatchStateChange(entity_id, new_state, old_state);
            }
        });

        // Lifecycle Events
        workerManager.on('script_start', ({ filename }) => {
            const scriptName = path.basename(filename, '.js');
            stateManager.set(`switch.js_automation_${scriptName}`, 'on');
            connector.updateState(`switch.js_automation_${scriptName}`, 'on');
            io.emit('status_update');
        });

        workerManager.on('script_exit', (d) => {
            if (d.type === 'error' || d.reason.includes('finished') || d.reason.includes('stopped by user')) {
                stateManager.saveScriptStopped(d.filename);
            }
            const scriptName = path.basename(d.filename, '.js');

            stateManager.set(`switch.js_automation_${scriptName}`, 'off');
            connector.updateState(`switch.js_automation_${scriptName}`, 'off');
            
            // NEU: LogManager nutzen
            const entry = logManager.add(d.type || 'info', 'System', `${d.filename} ${d.reason}`);
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

        server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Dashboard on port ${PORT}`));
    } catch (err) { console.error(err); }
}

// --- ROUTERS ---
const scriptsRouter = require('./routes/scripts')(workerManager, depManager, stateManager, io, SCRIPTS_DIR, STORAGE_DIR);
const storeRouter = require('./routes/store')(storeManager);
const systemRouter = require('./routes/system')(connector, logManager, () => systemOptions);

app.use('/api/scripts', scriptsRouter);
app.use('/api/store', storeRouter);

// Status-Route für Version
app.get('/api/status', (req, res) => {
    res.json({ version: packageJson.version });
});

app.use('/api', systemRouter);

startSystem();