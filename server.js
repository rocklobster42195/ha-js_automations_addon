/**
 * JS AUTOMATIONS - Main Server (v2.12.0)
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
const PORT = process.env.PORT || 3000;

if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io', cors: { origin: "*" } });

const connector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, SCRIPTS_DIR);
const depManager = new DependencyManager(SCRIPTS_DIR);
const stateManager = new StateManager(SCRIPTS_DIR);
const storeManager = new StoreManager(SCRIPTS_DIR);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function startSystem() {
    console.log(`🚀 Starting JS Automations Hub...`);
    try {
        await connector.connect();
        workerManager.setConnector(connector);
        workerManager.setStore(storeManager);
        
        connector.onEvent(async (event) => {
            if (event.event_type === 'state_changed') {
                const { entity_id, new_state, old_state } = event.data;
                workerManager.dispatchStateChange(entity_id, new_state, old_state);
            }
        });

        workerManager.on('script_exit', (d) => {
            if (d.type === 'error' || d.reason.includes('finished') || d.reason.includes('by user')) {
                stateManager.saveScriptStopped(d.filename);
            }
            io.emit('log', { message: `[System] ${d.filename} ${d.reason}`, type: d.type });
            io.emit('status_update');
        });

        workerManager.on('log', (msg) => io.emit('log', { message: msg }));

        const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
        const enabled = stateManager.getEnabledScripts();
        for (const file of files) {
            if (enabled.includes(file)) {
                const meta = ScriptParser.parse(path.join(SCRIPTS_DIR, file));
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                workerManager.startScript(meta);
            }
        }
        server.listen(PORT, '0.0.0.0', () => console.log(`🌍 JS Automations Dashboard ready`));
    } catch (err) { console.error(err); }
}

app.get('/api/scripts', (req, res) => {
    try {
        const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
        res.json(files.map(f => {
            const m = ScriptParser.parse(path.join(SCRIPTS_DIR, f));
            
            // Status-Logik
            let status = 'stopped';
            if (workerManager.workers.has(f)) status = 'running';
            else if (workerManager.lastExitState.get(f) === 'error') status = 'error';

            return { ...m, status, running: status === 'running' };
        }));
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/ha/metadata', async (req, res) => res.json(await connector.getHAMetadata()));

app.post('/api/scripts', async (req, res) => {
    const { name, icon, description, area, label, loglevel } = req.body; // <--- loglevel dazu
    
    const safeName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'script';
    const filename = `${safeName}.js`;
    const fullPath = path.join(SCRIPTS_DIR, filename);

    if (fs.existsSync(fullPath)) return res.status(400).json({ error: "Exists" });

    // TEMPLATE MIT LOGLEVEL
    const template = `/**
 * @name ${name}
 * @icon ${icon || 'mdi:script-text'}
 * @description ${description || ''}
 * @area ${area || ''}
 * @label ${label || ''}
 * @loglevel ${loglevel || 'info'}
 */

ha.log("Automation '${name}' gestartet.");
`;

    fs.writeFileSync(fullPath, template, 'utf8');
    
    // Helper erstellen und Sync
    if (connector.createInputBoolean) await connector.createInputBoolean(name); // Falls v1.6.1 Logik
    if (typeof syncScriptToHA === 'function') await syncScriptToHA(filename, false);
    
    res.json({ filename });
});

app.post('/api/scripts/control', async (req, res) => {
    const { filename, action } = req.body;
    if (action === 'toggle') {
        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'by user');
            stateManager.saveScriptStopped(filename);
        } else {
            const meta = ScriptParser.parse(path.join(SCRIPTS_DIR, filename));
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
        }
    } else if (action === 'restart') {
        workerManager.stopScript(filename, 'restarting');
        setTimeout(async () => {
            const meta = ScriptParser.parse(path.join(SCRIPTS_DIR, filename));
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
            io.emit('status_update');
        }, 500);
    }
    io.emit('status_update');
    res.json({ ok: true });
});

app.delete('/api/scripts/:filename', (req, res) => {
    workerManager.stopScript(req.params.filename, 'deleted');
    fs.unlinkSync(path.join(SCRIPTS_DIR, req.params.filename));
    io.emit('status_update');
    res.json({ ok: true });
});

app.get('/api/scripts/:filename/content', (req, res) => res.json({ content: fs.readFileSync(path.join(SCRIPTS_DIR, req.params.filename), 'utf8') }));
app.post('/api/scripts/:filename/content', async (req, res) => {
    const filename = req.params.filename;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    fs.writeFileSync(fullPath, req.body.content, 'utf8');
    if (workerManager.workers.has(filename)) {
        workerManager.stopScript(filename, 'hot-reload');
        setTimeout(async () => {
            workerManager.startScript(ScriptParser.parse(fullPath));
            io.emit('status_update');
        }, 500);
    }
    res.json({ ok: true });
});

startSystem();