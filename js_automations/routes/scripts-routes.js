const express = require('express');
const fs = require('fs');
const path = require('path');
const ScriptHeaderParser = require('../core/script-header-parser');
const CapabilityAnalyzer = require('../core/capability-analyzer');
const axios = require('axios');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

module.exports = (workerManager, depManager, stateManager, io, SCRIPTS_DIR, STORAGE_DIR, LIBRARIES_DIR) => {
    const router = express.Router();

    // Helper: Findet Datei in Scripts ODER Libraries Ordner
    const getFilePath = (filename) => {
        const p1 = path.join(SCRIPTS_DIR, filename);
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(LIBRARIES_DIR, filename);
        if (fs.existsSync(p2)) return p2;
        return null;
    };

    // GET List
    router.get('/', (req, res) => {
        const results = [];
        const conflicts = workerManager.getEntityConflicts();

        // Use centralized getScripts for consistency (handles TS/JS filtering)
        const scripts = workerManager.getScripts();
        scripts.forEach(fullPath => {
            const filename = path.basename(fullPath);
            const isLibrary = path.basename(path.dirname(fullPath)) === 'libraries';

            const m = ScriptHeaderParser.parse(fullPath);
            if (!m.name) m.name = filename;

            try {
                const source = fs.readFileSync(fullPath, 'utf8');
                const { detected } = CapabilityAnalyzer.analyze(source);
                const declared = m.permissions || [];
                const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
                m.capabilities = { detected, declared, undeclared, unused };
            } catch (e) {
                m.capabilities = { detected: [], declared: m.permissions || [], undeclared: [], unused: [] };
            }

            if (isLibrary) {
                m.status = 'stopped';
                m.running = false;
            } else {
                m.status = workerManager.workers.has(filename) ? 'running' : (workerManager.lastExitState.get(filename) === 'error' ? 'error' : 'stopped');
                m.running = m.status === 'running';
                if (m.running) {
                    const stats = workerManager.getScriptStats(filename);
                    if (stats) m.ram_usage = stats.ram_usage;
                    if (workerManager.startTimes.has(filename)) m.last_started = workerManager.startTimes.get(filename);
                }
            }
            m.entity_conflicts = conflicts[filename] || null;
            results.push(m);
        });

        res.json(results);
    });

    // POST Control (Toggle/Restart)
    router.post('/control', async (req, res) => {
        const { filename, action } = req.body;
        const fullPath = getFilePath(filename);

        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        if (action === 'toggle') {
            if (workerManager.workers.has(filename)) {
                workerManager.stopScript(filename, 'stopped by user');
            } else {
                if (fs.existsSync(fullPath)) {
                    const meta = ScriptHeaderParser.parse(fullPath);
                    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                }
                // Wir übergeben den vollen Pfad, damit WorkerManager ihn sicher findet
                workerManager.startScript(fullPath);
                stateManager.saveScriptStarted(filename);
            }
        } else if (action === 'restart') {
            workerManager.stopScript(filename, 'restarting');
            setTimeout(async () => {
                if (fs.existsSync(fullPath)) {
                    const meta = ScriptHeaderParser.parse(fullPath);
                    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                }
                workerManager.startScript(fullPath);
                io.emit('status_update');
            }, 500);
        } else if (action === 'dismiss') {
            workerManager.clearErrorState(filename);
        }
        io.emit('status_update');
        res.json({ ok: true });
    });

    // DELETE Script
    router.delete('/:filename', async (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        workerManager.stopScript(filename, 'deleted');
        fs.unlinkSync(fullPath);
        await depManager.prune();
        io.emit('status_update');
        res.json({ ok: true });
    });

    // GET All Typings (Bundle for Monaco)
    router.get('/typings', (req, res) => {
        const typings = [];

        // 1. Static HA API Definition
        const haApiPath = path.join(__dirname, '../core/types/ha-api.d.ts');
        if (fs.existsSync(haApiPath)) {
            typings.push({
                filename: 'ha-api.d.ts',
                content: fs.readFileSync(haApiPath, 'utf8')
            });
        }

        // 2. Dynamic Entity Definitions (generated from HA states)
        const entitiesPath = path.join(STORAGE_DIR, 'entities.d.ts');
        if (fs.existsSync(entitiesPath)) {
            typings.push({
                filename: 'entities.d.ts',
                content: fs.readFileSync(entitiesPath, 'utf8')
            });
        }

        // 3. Dynamic Service Definitions
        const servicesPath = path.join(STORAGE_DIR, 'services.d.ts');
        if (fs.existsSync(servicesPath)) {
            typings.push({
                filename: 'services.d.ts',
                content: fs.readFileSync(servicesPath, 'utf8')
            });
        }

        // 4. NPM @types (axios, lodash, etc.)
        const typesDir = path.join(STORAGE_DIR, 'node_modules/@types');
        if (fs.existsSync(typesDir)) {
            const scanTypes = (dir, base = '') => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.join(base, entry.name);
                    if (entry.isDirectory()) {
                        scanTypes(fullPath, relativePath);
                    } else if (entry.name.endsWith('.d.ts')) {
                        typings.push({
                            filename: `node_modules/@types/${relativePath.replace(/\\/g, '/')}`,
                            content: fs.readFileSync(fullPath, 'utf8')
                        });
                    }
                }
            };
            try {
                scanTypes(typesDir);
            } catch (e) {
                console.warn("[API] Failed to scan @types directory:", e.message);
            }
        }

        res.json(typings);
    });

    // GET Content
    router.get('/:filename/content', (req, res) => {
        const filename = req.params.filename;
        let fullPath;

        // Typdefinitionen (.d.ts) können im .storage Ordner (für dynamische Typen)
        // oder im core/types Ordner (für statische ha-api.d.ts) liegen.
        if (filename.endsWith('.d.ts')) {
            let storagePath = path.join(STORAGE_DIR, filename);
            if (fs.existsSync(storagePath)) {
                fullPath = storagePath;
            } else {
                // Check core/types for static ha-api.d.ts
                let coreTypesPath = path.join(__dirname, '../core/types', filename);
                if (fs.existsSync(coreTypesPath)) {
                    fullPath = coreTypesPath;
                }
            }
        } else {
            fullPath = getFilePath(filename);
        }
        
        if (!fullPath) return res.status(404).json({error: "File not found"});
        
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            res.json({ content });
        } catch (e) {
            console.error(`[API] File not found: ${fullPath}`);
            res.status(404).json({error: "File not found"});
        }
    });

    // GET Download
    router.get('/:filename/download', (req, res) => {
        const { filename } = req.params;

        // Sicherheitsprüfung: Verhindere Path Traversal
        if (!filename || filename.includes('..') || filename.includes('/')) {
            return res.status(400).send('Invalid filename.');
        }
        const filePath = getFilePath(filename);
        if (filePath) {
            res.download(filePath, filename, (err) => {
                if (err) console.error(`[API] Error downloading script ${filename}:`, err);
            });
        } else {
            res.status(404).send('Script not found.');
        }
    });

    // POST Content (Save)
    router.post('/:filename/content', async (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        fs.writeFileSync(fullPath, req.body.content, 'utf8');
        
        const meta = ScriptHeaderParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);

        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'hot-reload');
            setTimeout(async () => {
                workerManager.startScript(fullPath);
                io.emit('status_update');
            }, 500);
        } else {
            depManager.prune();
        }
        io.emit('status_update'); 
        res.json({ ok: true });
    });

    // POST Upload (File)
    router.post('/upload', upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        
        const { type, name } = req.body; // 'automation' oder 'library', optional 'name'
        const originalExt = path.extname(req.file.originalname) || '.js';
        
        // Dateinamen bereinigen (gleiche Logik wie bei Create)
        let filename;
        if (name && name.trim()) {
            filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + originalExt;
        } else {
            filename = path.parse(req.file.originalname).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + originalExt;
        }
        
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const fullPath = path.join(targetDir, filename);

        if (fs.existsSync(fullPath)) {
            return res.status(400).json({ error: `File '${filename}' already exists.` });
        }

        fs.writeFileSync(fullPath, req.file.buffer, 'utf8');
        res.json({ filename });
    });

    // POST Preview (raw source → capability analysis, no file written)
    router.post('/preview', (req, res) => {
        const { source } = req.body;
        if (typeof source !== 'string') return res.status(400).json({ error: 'source required' });
        try {
            const meta = ScriptHeaderParser._parseSource(source);
            const { detected } = CapabilityAnalyzer.analyze(source);
            const declared = meta.permissions || [];
            const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
            res.json({ name: meta.name, description: meta.description, permissions: declared, capabilities: { detected, declared, undeclared, unused } });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST Import (URL/Gist)
    router.post('/import', async (req, res) => {
        const { url, type, name, dryRun } = req.body;
        try {
            const response = await axios.get(url, { responseType: 'text' });
            const code = response.data;
            const urlExt = path.extname(url.split('?')[0]) || '.js';

            // Dateinamen aus URL ableiten und bereinigen
            let filename;
            if (name && name.trim()) {
                filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + urlExt;
            } else {
                filename = path.parse(path.basename(url).split('?')[0]).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + urlExt;
            }

            // Dry-run: analyse and return preview without writing
            if (dryRun) {
                const meta = ScriptHeaderParser._parseSource(code);
                const { detected } = CapabilityAnalyzer.analyze(code);
                const declared = meta.permissions || [];
                const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
                return res.json({ filename, name: meta.name, description: meta.description, permissions: declared, capabilities: { detected, declared, undeclared, unused } });
            }

            const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
            const fullPath = path.join(targetDir, filename);

            if (fs.existsSync(fullPath)) {
                return res.status(400).json({ error: `File '${filename}' already exists.` });
            }

            fs.writeFileSync(fullPath, code, 'utf8');
            res.json({ filename });
        } catch (e) {
            res.status(400).json({ error: "Import failed: " + e.message });
        }
    });

    // POST Create
    router.post('/', async (req, res) => {
        const { name, type, code, extension = '.js' } = req.body;
        const ext = extension.startsWith('.') ? extension : `.${extension}`;
        const filename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + ext;
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const fullPath = path.join(targetDir, filename);
        
        // 1. Create file with initial code
        fs.writeFileSync(fullPath, code || 'ha.log("Ready.");\n', 'utf8');
        
        // 2. Use the central parser to write the metadata header
        ScriptHeaderParser.updateMetadata(fullPath, req.body);

        res.json({ filename });
    });

    // PUT Update Metadata (Header only)
    router.put('/:filename/metadata', async (req, res) => {
        const oldFilename = req.params.filename;
        const { name, type, icon, description, area, label, loglevel, npmModules, includes, extension } = req.body;
        
        let fullPath = getFilePath(oldFilename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        // 1. Calculate new filename & path
        const ext = extension || path.extname(oldFilename);
        const newFilename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + ext;
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const newFullPath = path.join(targetDir, newFilename);
        
        // Check if target exists (only if path actually changes)
        if (newFullPath !== fullPath && fs.existsSync(newFullPath)) {
            return res.status(400).json({ error: `File '${newFilename}' already exists.` });
        }

        // 2. Detect Rename & Library Status
        const wasLibrary = path.dirname(fullPath) === LIBRARIES_DIR;
        const isRenaming = oldFilename !== newFilename;

        // 3. Move/Rename File
        if (newFullPath !== fullPath) {
            if (workerManager.workers.has(oldFilename)) {
                workerManager.stopScript(oldFilename, 'renaming/moving');
            }
            fs.renameSync(fullPath, newFullPath);
            fullPath = newFullPath; // Update path for subsequent write
        }

        // Use Parser to update metadata (handles @expose and formatting centrally)
        // Preserve @permission tag — it's edited in source, not via wizard form
        const existingMeta = ScriptHeaderParser.parse(fullPath);
        ScriptHeaderParser.updateMetadata(fullPath, { ...req.body, permissions: existingMeta.permissions });
        
        // 5. REFACTORING: Update consumers
        let updatedConsumers = 0;
        if (wasLibrary && isRenaming) {
            const allFiles = [];
            if (fs.existsSync(SCRIPTS_DIR)) fs.readdirSync(SCRIPTS_DIR).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')).forEach(f => allFiles.push(path.join(SCRIPTS_DIR, f)));
            if (fs.existsSync(LIBRARIES_DIR)) fs.readdirSync(LIBRARIES_DIR).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')).forEach(f => allFiles.push(path.join(LIBRARIES_DIR, f)));

            for (const file of allFiles) {
                if (file === fullPath) continue; // Skip self

                let cContent = fs.readFileSync(file, 'utf8');
                let changed = false;
                
                // Regex to find @include line(s)
                cContent = cContent.replace(/^(\s*\*\s*@include\s+)(.*)$/gm, (match, prefix, args) => {
                    const parts = args.split(/[\s,]+/).filter(p => p.trim().length > 0);
                    const newParts = parts.map(p => {
                        // Check exact match or without .js
                        if (p === oldFilename || p === oldFilename.replace(/\.js$/, '')) {
                            changed = true;
                            return newFilename; 
                        }
                        return p;
                    });
                    if (changed) {
                        return prefix + newParts.join(', ');
                    }
                    return match;
                });

                if (changed) {
                    fs.writeFileSync(file, cContent, 'utf8');
                    updatedConsumers++;
                    const cFilename = path.basename(file);
                    // Restart consumer if running
                    if (workerManager.workers.has(cFilename)) {
                        workerManager.stopScript(cFilename, 'library update');
                        setTimeout(() => workerManager.startScript(file), 500);
                    }
                }
            }
        }

        const meta = ScriptHeaderParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
        depManager.prune();
        io.emit('status_update');
        
        res.json({ ok: true, filename: newFilename, updatedConsumers });
    });

    return router;
};