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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function startSystem() {
    console.log(`🚀 Starting JS Automations Hub (v2.15)...`);
    try {
        await connector.connect();
        workerManager.setConnector(connector);
        workerManager.setStore(storeManager);
        workerManager.setStorageDir(STORAGE_DIR); // Dem Manager den neuen Pfad sagen

        // State Verteilung
        connector.onEvent(async (event) => {
            if (event.event_type === 'state_changed') {
                const { entity_id, new_state, old_state } = event.data;
                workerManager.dispatchStateChange(entity_id, new_state, old_state);
            }
        });

        // Lifecycle Events
        workerManager.on('script_exit', (d) => {
            if (d.type === 'error' || d.reason.includes('finished') || d.reason.includes('by user')) {
                stateManager.saveScriptStopped(d.filename);
            }
            io.emit('log', { message: `[System] ${d.filename} ${d.reason}`, level: d.type });
            io.emit('status_update');
        });

        workerManager.on('log', (msg) => io.emit('log', { message: msg }));

        // Autostart
        const enabled = stateManager.getEnabledScripts();
        for (const file of enabled) {
            const fullPath = path.join(SCRIPTS_DIR, file);
            if (fs.existsSync(fullPath)) {
                const meta = ScriptParser.parse(fullPath);
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                workerManager.startScript(meta);
            }
        }
        
        // Initialer Prune beim Start (optional)
        depManager.prune();

        server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Dashboard on port ${PORT}`));
    } catch (err) { console.error(err); }
}

// API ENDPUNKTE
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
            workerManager.stopScript(filename, 'by user');
        } else {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
        }
    } else if (action === 'restart') {
        workerManager.stopScript(filename, 'restarting');
        setTimeout(async () => {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
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
app.get('/api/scripts/:filename/content', (req, res) => res.json({ content: fs.readFileSync(path.join(SCRIPTS_DIR, req.params.filename), 'utf8') }));
app.post('/api/scripts/:filename/content', async (req, res) => {
    const filename = req.params.filename;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    fs.writeFileSync(fullPath, req.body.content, 'utf8');
    if (workerManager.workers.has(filename)) {
        workerManager.stopScript(filename, 'hot-reload');
        setTimeout(async () => {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
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

startSystem();