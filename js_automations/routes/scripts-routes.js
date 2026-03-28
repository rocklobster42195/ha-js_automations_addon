const express = require('express');
const fs = require('fs');
const path = require('path');
const ScriptHeaderParser = require('../core/script-header-parser');
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

        // 1. Automations
        if (fs.existsSync(SCRIPTS_DIR)) {
            const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'));
            results.push(...files.map(f => {
                const m = ScriptHeaderParser.parse(path.join(SCRIPTS_DIR, f));
                if (!m.name) m.name = f; // Fallback: Dateiname als Name, falls @name fehlt
                m.status = workerManager.workers.has(f) ? 'running' : (workerManager.lastExitState.get(f) === 'error' ? 'error' : 'stopped');
                m.running = m.status === 'running';
                if (m.running && typeof workerManager.getScriptStats === 'function') {
                    const stats = workerManager.getScriptStats(f);
                    if (stats) m.ram_usage = stats.ram_usage;
                    if (workerManager.startTimes.has(f)) m.last_started = workerManager.startTimes.get(f);
                }
                return m;
            }));
        }

        // 2. Libraries
        if (fs.existsSync(LIBRARIES_DIR)) {
            const files = fs.readdirSync(LIBRARIES_DIR).filter(f => f.endsWith('.js'));
            results.push(...files.map(f => {
                const m = ScriptHeaderParser.parse(path.join(LIBRARIES_DIR, f));
                if (!m.name) m.name = f; // Fallback
                m.status = 'stopped'; // Libraries laufen nicht eigenständig
                m.running = false;
                return m;
            }));
        }

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
        
        // Dateinamen bereinigen (gleiche Logik wie bei Create)
        let filename;
        if (name && name.trim()) {
            filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
        } else {
            filename = path.parse(req.file.originalname).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
        }
        
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const fullPath = path.join(targetDir, filename);

        if (fs.existsSync(fullPath)) {
            return res.status(400).json({ error: `File '${filename}' already exists.` });
        }

        fs.writeFileSync(fullPath, req.file.buffer, 'utf8');
        res.json({ filename });
    });

    // POST Import (URL/Gist)
    router.post('/import', async (req, res) => {
        const { url, type, name } = req.body;
        try {
            const response = await axios.get(url, { responseType: 'text' });
            const code = response.data;
            
            // Dateinamen aus URL ableiten und bereinigen
            let filename;
            if (name && name.trim()) {
                filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
            } else {
                filename = path.parse(path.basename(url).split('?')[0]).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
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
        const { name, type, code } = req.body;
        const filename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
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
        const { name, type, icon, description, area, label, loglevel, npmModules, includes } = req.body;
        
        let fullPath = getFilePath(oldFilename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        // 1. Calculate new filename & path
        const newFilename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '.js';
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
        ScriptHeaderParser.updateMetadata(fullPath, req.body);
        
        // 5. REFACTORING: Update consumers
        let updatedConsumers = 0;
        if (wasLibrary && isRenaming) {
            const allFiles = [];
            if (fs.existsSync(SCRIPTS_DIR)) fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js')).forEach(f => allFiles.push(path.join(SCRIPTS_DIR, f)));
            if (fs.existsSync(LIBRARIES_DIR)) fs.readdirSync(LIBRARIES_DIR).filter(f => f.endsWith('.js')).forEach(f => allFiles.push(path.join(LIBRARIES_DIR, f)));

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