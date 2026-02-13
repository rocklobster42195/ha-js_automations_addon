/**
 * JS AUTOMATIONS - Main Server (v1.3.0)
 * Orchestrates HA connection, worker threads, and global storage.
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

// Core Components
const HAConnector = require('./core/ha-connection');
const ScriptParser = require('./core/parser');
const workerManager = require('./core/worker-manager');
const DependencyManager = require('./core/dependency-manager');
const StateManager = require('./core/state-manager');
const StoreManager = require('./core/store-manager');

// --- PATHS & MODES ---
const IS_ADDON = !!process.env.SUPERVISOR_TOKEN;
const SCRIPTS_DIR = IS_ADDON ? '/config/js-automation' : path.join(__dirname, 'scripts');
const PORT = process.env.PORT || 3000;

if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

// --- INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    path: '/socket.io', 
    cors: { origin: "*" } 
});

const connector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, SCRIPTS_DIR);
const depManager = new DependencyManager(SCRIPTS_DIR);
const stateManager = new StateManager(SCRIPTS_DIR);
const storeManager = new StoreManager(SCRIPTS_DIR);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Main Startup Logic
 */
async function startSystem() {
    console.log(`🚀 Starting JS Automations Hub (Add-on: ${IS_ADDON})`);
    
    try {
        await connector.connect();
        
        // Link Managers
        workerManager.setConnector(connector);
        workerManager.setStore(storeManager);

        // --- LIFECYCLE EVENT HANDLERS ---
        workerManager.on('script_exit', (data) => {
            const { filename, reason, type } = data;
            
            // Persistent state update: remove if finished or crashed
            if (reason.includes('finished') || reason.includes('by user') || reason.includes('crashed')) {
                stateManager.saveScriptStopped(filename);
            }

            // User friendly logs
            let icon = 'ℹ️';
            if (type === 'success') icon = '✅';
            if (type === 'error') icon = '❌';
            if (reason.includes('by user')) icon = '🛑';

            io.emit('log', { message: `[System] ${filename} ${reason} ${icon}` });
            io.emit('status_update');
        });

        workerManager.on('log', (msg) => {
            io.emit('log', { message: msg });
        });

        // --- AUTOSTART ---
        const enabled = stateManager.getEnabledScripts();
        if (enabled.length > 0) {
            console.log(`♻️ Restoring ${enabled.length} scripts...`);
            for (const file of enabled) {
                const fullPath = path.join(SCRIPTS_DIR, file);
                if (fs.existsSync(fullPath)) {
                    const meta = ScriptParser.parse(fullPath);
                    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                    workerManager.startScript(meta);
                }
            }
        }

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🌍 JS Automations Dashboard ready on port ${PORT}`);
        });

    } catch (err) {
        console.error("❌ Fatal System Error:", err);
    }
}

// --- API ENDPOINTS ---

// List Scripts
app.get('/api/scripts', (req, res) => {
    try {
        const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
        const scripts = files.map(file => {
            const meta = ScriptParser.parse(path.join(SCRIPTS_DIR, file));
            return {
                filename: file,
                name: meta.name,
                icon: meta.icon,
                running: workerManager.workers.has(file)
            };
        });
        res.json(scripts);
    } catch (e) { res.status(500).json([]); }
});

// Control (Start/Stop/Restart)
app.post('/api/scripts/control', async (req, res) => {
    const { filename, action } = req.body;
    const fullPath = path.join(SCRIPTS_DIR, filename);

    if (!fs.existsSync(fullPath)) return res.status(404).end();

    if (action === 'toggle') {
        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'by user');
        } else {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
        }
    } 
    else if (action === 'restart') {
        workerManager.stopScript(filename, 'restarting');
        setTimeout(async () => {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
            io.emit('status_update');
        }, 800);
    }

    io.emit('status_update');
    res.json({ ok: true });
});

// Script Content
app.get('/api/scripts/:filename/content', (req, res) => {
    const fullPath = path.join(SCRIPTS_DIR, req.params.filename);
    if (fs.existsSync(fullPath)) {
        res.json({ content: fs.readFileSync(fullPath, 'utf8') });
    } else res.status(404).end();
});

// Save Content
app.post('/api/scripts/:filename/content', (req, res) => {
    const filename = req.params.filename;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    fs.writeFileSync(fullPath, req.body.content, 'utf8');

    // Hot Reload if running
    if (workerManager.workers.has(filename)) {
        workerManager.stopScript(filename, 'hot-reload');
        setTimeout(() => {
            const meta = ScriptParser.parse(fullPath);
            workerManager.startScript(meta);
            io.emit('status_update');
        }, 500);
    }
    res.json({ ok: true });
});

// Create Script
app.post('/api/scripts', (req, res) => {
    const { name } = req.body;
    const safeName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'script';
    const filename = `${safeName}.js`;
    const fullPath = path.join(SCRIPTS_DIR, filename);

    if (fs.existsSync(fullPath)) return res.status(400).json({ error: "Exists" });

    const template = `/**\n * @name ${name}\n * @icon mdi:script-text\n */\n\nha.log("Ready to automate!");\n`;
    fs.writeFileSync(fullPath, template, 'utf8');
    res.json({ filename });
});

// Delete Script
app.delete('/api/scripts/:filename', (req, res) => {
    const filename = req.params.filename;
    workerManager.stopScript(filename, 'deleted');
    stateManager.saveScriptStopped(filename);
    const fullPath = path.join(SCRIPTS_DIR, filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    io.emit('status_update');
    res.json({ ok: true });
});

startSystem();