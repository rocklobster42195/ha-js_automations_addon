const express = require('express');
const fs = require('fs');
const path = require('path');
const ScriptParser = require('../core/parser');

module.exports = (workerManager, depManager, stateManager, io, SCRIPTS_DIR, STORAGE_DIR) => {
    const router = express.Router();

    // GET List
    router.get('/', (req, res) => {
        const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
        res.json(files.map(f => {
            const m = ScriptParser.parse(path.join(SCRIPTS_DIR, f));
            m.status = workerManager.workers.has(f) ? 'running' : (workerManager.lastExitState.get(f) === 'error' ? 'error' : 'stopped');
            m.running = m.status === 'running';
            return m;
        }));
    });

    // POST Control (Toggle/Restart)
    router.post('/control', async (req, res) => {
        const { filename, action } = req.body;
        const fullPath = path.join(SCRIPTS_DIR, filename);

        if (action === 'toggle') {
            if (workerManager.workers.has(filename)) {
                workerManager.stopScript(filename, 'stopped by user');
            } else {
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

    // DELETE Script
    router.delete('/:filename', async (req, res) => {
        const filename = req.params.filename;
        workerManager.stopScript(filename, 'deleted');
        fs.unlinkSync(path.join(SCRIPTS_DIR, filename));
        await depManager.prune();
        io.emit('status_update');
        res.json({ ok: true });
    });

    // GET Content
    router.get('/:filename/content', (req, res) => {
        const filename = req.params.filename;
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

    // POST Content (Save)
    router.post('/:filename/content', async (req, res) => {
        const filename = req.params.filename;
        const fullPath = path.join(SCRIPTS_DIR, filename);
        fs.writeFileSync(fullPath, req.body.content, 'utf8');
        
        const meta = ScriptParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);

        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'hot-reload');
            setTimeout(async () => {
                workerManager.startScript(filename);
                io.emit('status_update');
            }, 500);
        } else {
            depManager.prune();
        }
        io.emit('status_update'); 
        res.json({ ok: true });
    });

    // POST Create
    router.post('/', async (req, res) => {
        const { name, icon, description, area, label, loglevel, npmModules, code } = req.body;
        const filename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
        
        let header = `/**\n * @name ${name}\n * @icon ${icon || 'mdi:script-text'}\n * @description ${description || ''}\n * @area ${area || ''}\n * @label ${label || ''}\n * @loglevel ${loglevel || 'info'}\n`;
        if (npmModules && Array.isArray(npmModules)) {
            npmModules.forEach(pkg => header += ` * @npm ${pkg}\n`);
        }
        header += ` */\n\n`;
        
        const content = header + (code || 'ha.log("Ready.");\n');
        
        fs.writeFileSync(path.join(SCRIPTS_DIR, filename), content, 'utf8');
        res.json({ filename });
    });

    // PUT Update Metadata (Header only)
    router.put('/:filename/metadata', async (req, res) => {
        const filename = req.params.filename;
        const { name, icon, description, area, label, loglevel, npmModules } = req.body;
        const fullPath = path.join(SCRIPTS_DIR, filename);

        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

        let content = fs.readFileSync(fullPath, 'utf8');

        let newHeader = `/**\n * @name ${name}\n * @icon ${icon || 'mdi:script-text'}\n * @description ${description || ''}\n * @area ${area || ''}\n * @label ${label || ''}\n * @loglevel ${loglevel || 'info'}\n`;
        if (npmModules && Array.isArray(npmModules)) {
            npmModules.forEach(pkg => newHeader += ` * @npm ${pkg}\n`);
        }
        newHeader += ` */`;

        // Replace existing header (matches /** ... */ at start of file)
        const headerRegex = /^\/\*\*[\s\S]*?\*\//;
        if (headerRegex.test(content)) {
            content = content.replace(headerRegex, newHeader);
        } else {
            content = newHeader + '\n\n' + content;
        }

        fs.writeFileSync(fullPath, content, 'utf8');
        
        const meta = ScriptParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
        depManager.prune();
        io.emit('status_update');
        
        res.json({ ok: true });
    });

    return router;
};