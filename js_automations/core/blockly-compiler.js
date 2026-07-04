// core/blockly-compiler.js
// Server-side ".blocks" -> JS compilation. `blockly` is required via its root entry point,
// which is already the Node/CJS build with all built-in blocks pre-registered (there is no
// './node' subpath export in blockly@11).
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Blockly = require('blockly');
const { javascriptGenerator } = require('blockly/javascript');

require('./blockly-blocks-shared')(javascriptGenerator);

class BlocklyCompiler extends EventEmitter {
    constructor(scriptsDir, distDir) {
        super();
        this.scriptsDir = scriptsDir;
        this.distDir = distDir;
    }

    _getDistPath(blocksPath) {
        const relativePath = path.relative(this.scriptsDir, blocksPath);
        return path.join(this.distDir, relativePath.replace(/\.blocks$/, '.js'));
    }

    /**
     * Compiles a .blocks file to its dist/*.js counterpart.
     * @param {string} blocksPath Absolute path to the .blocks file.
     * @returns {Promise<boolean>} true on success.
     */
    async compile(blocksPath) {
        if (!blocksPath.endsWith('.blocks')) return false;

        this.emit('log', { level: 'debug', message: `Compiling ${path.basename(blocksPath)}...` });

        let parsed;
        try {
            const raw = fs.readFileSync(blocksPath, 'utf8').replace(/^﻿/, '');
            parsed = JSON.parse(raw);
        } catch (e) {
            this.emit('compiler_signal', { type: 'BLOCKLY_ERR', filename: path.basename(blocksPath), text: `Invalid JSON: ${e.message}` });
            this.emit('log', { level: 'error', message: `[${path.basename(blocksPath)}] Invalid .blocks JSON: ${e.message}` });
            return false;
        }

        const workspace = new Blockly.Workspace();
        let code = '';
        try {
            // Pass the whole parsed file, not parsed.blocks — workspaces.load() reads its own
            // top-level `blocks` key internally; unrelated keys like `jsa` are ignored.
            Blockly.serialization.workspaces.load(parsed, workspace);
            code = javascriptGenerator.workspaceToCode(workspace);
        } catch (e) {
            this.emit('compiler_signal', { type: 'BLOCKLY_ERR', filename: path.basename(blocksPath), text: e.message });
            this.emit('log', { level: 'error', message: `[${path.basename(blocksPath)}] Blockly compile failed: ${e.message}` });
            return false;
        } finally {
            workspace.dispose();
        }

        const distPath = this._getDistPath(blocksPath);
        const targetDir = path.dirname(distPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        // Wrapped in an async IIFE: block-generated code can contain top-level `await` (e.g. a
        // bare action block with no trigger wrapper), which is invalid in a CommonJS module.
        fs.writeFileSync(distPath, `(async () => {\n${code}\n})();\n`, 'utf8');

        this.emit('compiler_signal', { type: 'BLOCKLY_OK', filename: path.basename(blocksPath) });
        return true;
    }

    /**
     * Removes the compiled JS file when a .blocks file is deleted.
     */
    cleanup(blocksPath) {
        const distPath = this._getDistPath(blocksPath);
        if (fs.existsSync(distPath)) fs.unlinkSync(distPath);
    }
}

module.exports = BlocklyCompiler;
