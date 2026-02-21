/**
 * JS AUTOMATIONS - Main Server (v1.9.0)
 * Storage Migration & NPM Prune
 */
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
let systemOptions = {};
function loadSystemOptions() {
    if (IS_ADDON && fs.existsSync('/data/options.json')) {
        try {
            systemOptions = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
        } catch (e) { console.error("Failed to load options.json", e); }
    } else if (fs.existsSync(path.join(__dirname, 'config.yaml'))) {
        // Fallback for local dev: Parse config.yaml (simple regex)
        try {
            const yaml = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
            const expertMatch = yaml.match(/expert_mode:\s*(true|false)/);
            if (expertMatch) {
                systemOptions.expert_mode = expertMatch[1] === 'true';
            }
            const langMatch = yaml.match(/ui_language:\s*["']?([a-z]{2})["']?/);
            if (langMatch) {
                systemOptions.ui_language = langMatch[1];
            }
        } catch (e) { console.error("Failed to parse config.yaml", e); }
    }
}
loadSystemOptions();

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
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                workerManager.startScript(file);
            }
        }
        
        // Initialer Prune beim Start (optional)
        depManager.prune();

        server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Dashboard on port ${PORT}`));
    } catch (err) { console.error(err); }
}

// API ENDPUNKTE
app.get('/api/options', (req, res) => {
    res.json(systemOptions);
});

app.get('/api/scripts', (req, res) => {
    const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
    res.json(files.map(f => {
        const m = ScriptParser.parse(path.join(SCRIPTS_DIR, f));
        m.status = workerManager.workers.has(f) ? 'running' : (workerManager.lastExitState.get(f) === 'error' ? 'error' : 'stopped');
        m.running = m.status === 'running';
        return m;
    }));
});

app.post('/api/scripts/control', async (req, res) => {
    const { filename, action } = req.body;
    const fullPath = path.join(SCRIPTS_DIR, filename);

    if (action === 'toggle') {
        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'stopped by user');
        } else {
            // Vor dem Starten Abhängigkeiten prüfen & installieren
            if (fs.existsSync(fullPath)) {
                const meta = ScriptParser.parse(fullPath);
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            }
            workerManager.startScript(filename);
            stateManager.saveScriptStarted(filename);
        }
    } else if (action === 'restart') {
        workerManager.stopScript(filename, 'restarting');
        setTimeout(async () => {
            // Auch beim Restart prüfen
            if (fs.existsSync(fullPath)) {
                const meta = ScriptParser.parse(fullPath);
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            }
            workerManager.startScript(filename);
            io.emit('status_update');
        }, 500);
    }
    io.emit('status_update');
    res.json({ ok: true });
});

app.delete('/api/scripts/:filename', async (req, res) => {
    const filename = req.params.filename;
    workerManager.stopScript(filename, 'deleted');
    fs.unlinkSync(path.join(SCRIPTS_DIR, filename));
    // Trigger Prune nach Löschen
    await depManager.prune();
    io.emit('status_update');
    res.json({ ok: true });
});

// Restliche API (Metadata, Content) bleibt identisch...
app.get('/api/ha/metadata', async (req, res) => res.json(await connector.getHAMetadata()));
app.get('/api/scripts/:filename/content', (req, res) => {
    const filename = req.params.filename;
    // entities.d.ts liegt im .storage Ordner
    const fullPath = filename === 'entities.d.ts' 
        ? path.join(STORAGE_DIR, filename) 
        : path.join(SCRIPTS_DIR, filename);
    
    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content });
    } catch (e) {
        console.error(`[API] File not found: ${fullPath}`);
        res.status(404).json({error: "File not found"});
    }
});
app.post('/api/scripts/:filename/content', async (req, res) => {
    const filename = req.params.filename;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    fs.writeFileSync(fullPath, req.body.content, 'utf8');
    
    // Abhängigkeiten sofort nach dem Speichern installieren
    const meta = ScriptParser.parse(fullPath);
    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);

    if (workerManager.workers.has(filename)) {
        workerManager.stopScript(filename, 'hot-reload');
        setTimeout(async () => {
            workerManager.startScript(filename);
            io.emit('status_update');
        }, 500);
    } else {
        // Auch beim Speichern prüfen ob Pakete entfernt werden können
        depManager.prune();
    }
    io.emit('status_update'); 
    res.json({ ok: true });
});
app.post('/api/scripts', async (req, res) => {
    const { name, icon, description, area, label, loglevel } = req.body;
    const filename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
    fs.writeFileSync(path.join(SCRIPTS_DIR, filename), `/**\n * @name ${name}\n * @icon ${icon || 'mdi:script-text'}\n * @description ${description || ''}\n * @area ${area || ''}\n * @label ${label || ''}\n * @loglevel ${loglevel || 'info'}\n */\n\nha.log("Ready.");\n`, 'utf8');
    res.json({ filename });
});

// STORE API
app.get('/api/store', (req, res) => {
    res.json(storeManager.getAll());
});

app.post('/api/store', (req, res) => {
    const { key, value } = req.body;
    storeManager.set(key, value, 'User-Edit');
    res.json({ ok: true });
});

app.delete('/api/store', (req, res) => {
    storeManager.clear();
    res.json({ ok: true });
});

app.delete('/api/store/:key', (req, res) => {
    storeManager.delete(req.params.key);
    res.json({ ok: true });
});

// LOGS API
app.get('/api/logs', (req, res) => {
    res.json(logManager.getHistory());
});

app.delete('/api/logs', (req, res) => {
    logManager.clear();
    res.json({ ok: true });
});

startSystem();