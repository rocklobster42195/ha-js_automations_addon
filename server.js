/**
 * JS-AUTOMATION - Main Server
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

const IS_ADDON = !!process.env.SUPERVISOR_TOKEN;
const SCRIPTS_DIR = IS_ADDON ? '/config/js-automation' : path.join(__dirname, 'scripts');
const PORT = process.env.PORT || 3000;

if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const connector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, SCRIPTS_DIR);
const depManager = new DependencyManager(SCRIPTS_DIR);
const stateManager = new StateManager(SCRIPTS_DIR);

async function startSystem() {
    console.log(`🚀 Starting JS-Automation Hub...`);
    try {
        await connector.connect();
        workerManager.setConnector(connector);

        const enabled = stateManager.getEnabledScripts();
        for (const file of enabled) {
            const fullPath = path.join(SCRIPTS_DIR, file);
            if (fs.existsSync(fullPath)) {
                const meta = ScriptParser.parse(fullPath);
                if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                workerManager.startScript(meta);
            }
        }

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🌍 Dashboard ready on port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Startup Error:", err);
    }
}

// --- API ---

app.get('/api/scripts', (req, res) => {
    const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') || f.endsWith('.d.ts'));
    const scripts = files.filter(f => !f.endsWith('.d.ts')).map(file => {
        const meta = ScriptParser.parse(path.join(SCRIPTS_DIR, file));
        return { filename: file, name: meta.name, icon: meta.icon, running: workerManager.workers.has(file) };
    });
    res.json(scripts);
});

app.post('/api/scripts', (req, res) => {
    const { name } = req.body;
    const safeName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'script';
    const filename = `${safeName}.js`;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    if (fs.existsSync(fullPath)) return res.status(400).json({ error: "Exists" });
    fs.writeFileSync(fullPath, `/**\n * @name ${name}\n * @icon mdi:script-text\n */\n\nha.log("Hello!");\n`, 'utf8');
    res.json({ filename });
});

app.post('/api/scripts/control', async (req, res) => {
    const { filename, action } = req.body;
    const fullPath = path.join(SCRIPTS_DIR, filename);
    if (action === 'toggle') {
        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename);
            stateManager.saveScriptStopped(filename);
        } else {
            const meta = ScriptParser.parse(fullPath);
            if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
            workerManager.startScript(meta);
            stateManager.saveScriptStarted(filename);
        }
    } else if (action === 'restart') {
        workerManager.stopScript(filename);
        setTimeout(() => {
            const meta = ScriptParser.parse(fullPath);
            workerManager.startScript(meta);
            io.emit('status_update');
        }, 500);
    }
    io.emit('status_update');
    res.json({ ok: true });
});

app.delete('/api/scripts/:filename', (req, res) => {
    const filename = req.params.filename;
    workerManager.stopScript(filename);
    const fullPath = path.join(SCRIPTS_DIR, filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    io.emit('status_update');
    res.json({ ok: true });
});

// FIX: Hier war die fehlerhafte Syntax (*)
app.get('/api/scripts/:filename/content', (req, res) => {
    const fullPath = path.join(SCRIPTS_DIR, req.params.filename);
    if (fs.existsSync(fullPath)) {
        res.json({ content: fs.readFileSync(fullPath, 'utf8') });
    } else res.status(404).end();
});

// FIX: Hier ebenfalls
app.post('/api/scripts/:filename/content', (req, res) => {
    const filename = req.params.filename;
    fs.writeFileSync(path.join(SCRIPTS_DIR, filename), req.body.content, 'utf8');
    if (workerManager.workers.has(filename)) {
        workerManager.stopScript(filename);
        workerManager.startScript(ScriptParser.parse(path.join(SCRIPTS_DIR, filename)));
    }
    res.json({ ok: true });
});

const originalLog = console.log;
console.log = (...args) => {
    originalLog(...args);
    io.emit('log', { message: args.join(' ') });
};

startSystem();