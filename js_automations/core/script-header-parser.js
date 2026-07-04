const fs = require('fs');
const path = require('path');

class ScriptHeaderParser {
    static parse(filePath) {
        const metadata = {
            filename: path.basename(filePath),
            path: filePath,
            name: null,
            icon: 'mdi:script-text',
            description: '',
            area: '',
            label: '',
            loglevel: 'info',
            dependencies: [],
            includes: [],
            expose: null,
            permissions: [],
            card: null,   // null | true | 'dev'
        };

        if (filePath.endsWith('.blocks')) {
            const jsa = this._readBlocksFile(filePath)?.jsa || {};
            for (const key of ['name', 'icon', 'description', 'area', 'label', 'loglevel', 'expose']) {
                if (jsa[key] !== undefined) metadata[key] = jsa[key];
            }
            // `permission`/`card` mirror the JSDoc `@permission`/`@card` tag names in the jsa
            // key, but the returned metadata object uses `permissions` (plural) like the
            // JSDoc-based path — keep both in sync so callers don't need a .blocks special case.
            if (jsa.permission !== undefined) metadata.permissions = jsa.permission;
            if (jsa.card !== undefined) metadata.card = jsa.card;
            if (!metadata.name) metadata.name = metadata.filename;
            return metadata;
        }

        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
            // Standard BOM removal
            content = content.replace(/^\uFEFF/, '');
        } catch (e) { return {}; }

        // Strip leading TypeScript triple-slash directives (/// <reference .../>) before
        // matching the JSDoc block — they appear before /** in .ts files and would break
        // the start-of-file anchor used by the JSDoc regex.
        const stripped = content.replace(/^(\/\/\/[^\n]*\n)+/, '');

        // Look for the first JSDoc block at the beginning of the file
        const jsDocMatch = stripped.match(/^\s*\/\*\*([\s\S]*?)\*\//);
        
        if (jsDocMatch) {
            // Block found -> Parsing tags
            const lines = jsDocMatch[1].split('\n');
            lines.forEach(line => {
                const match = line.match(/@(\w+)(?:\s+(.*))?/);
                if (match) {
                    this._applyMeta(metadata, match[1], match[2]);
                }
            });
        } else {
            // Fallback: Search for old // @tags line by line (read-only)
            const lines = content.split('\n');
            for (const line of lines) {
                const match = line.match(/^\s*\/\/\s*@(\w+)(?:\s+(.*))?/);
                if (match) this._applyMeta(metadata, match[1], match[2]);
                else if (line.trim() && !line.startsWith('//')) break; // Stop at executable code
            }
        }

        if (!metadata.name) metadata.name = metadata.filename;
        return metadata;
    }

    // Parse metadata from a raw source string (no file I/O).
    static _parseSource(source) {
        const metadata = { name: null, description: '', permissions: [], dependencies: [], includes: [], expose: null, icon: 'mdi:script-text', area: '', label: '', loglevel: 'info' };
        const content = source.replace(/^\uFEFF/, '').replace(/^(\/\/\/[^\n]*\n)+/, '');
        const jsDocMatch = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
        if (jsDocMatch) {
            jsDocMatch[1].split('\n').forEach(line => {
                const match = line.match(/@(\w+)(?:\s+(.*))?/);
                if (match) this._applyMeta(metadata, match[1], match[2]);
            });
        }
        return metadata;
    }

    static _applyMeta(metadata, key, val) {
        val = val ? val.trim() : '';
        if (key === 'npm' || key === 'include') {
            const list = val.split(/[\s,]+/).map(s => s.trim().replace(/['"()]/g, '')).filter(s => s);
            if (key === 'npm') metadata.dependencies.push(...list);
            else metadata.includes.push(...list);
        } else if (key === 'card') {
            // @card        → card: true
            // @card dev    → card: 'dev'
            metadata.card = val ? val.toLowerCase().trim() : true;
        } else if (key === 'expose') {
            metadata.expose = val || 'switch';
        } else if (key === 'permission') {
            const tokens = val.split(/[\s,]+/).map(s => s.toLowerCase().trim()).filter(Boolean);
            const expanded = [];
            for (const t of tokens) {
                if (t === 'fs') { expanded.push('fs:read', 'fs:write'); }
                else expanded.push(t);
            }
            metadata.permissions = [...new Set([...metadata.permissions, ...expanded])];
        } else if (metadata.hasOwnProperty(key)) {
            metadata[key] = val;
        }
    }

    // Reads and JSON.parses a .blocks file. Returns null on missing/invalid file.
    static _readBlocksFile(filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    static updateMetadata(filePath, meta) {
        if (!fs.existsSync(filePath)) {
            return;
        }

        if (filePath.endsWith('.blocks')) {
            // Metadata lives in the `jsa` JSON key, not a JSDoc header — prepending a comment
            // would corrupt the file's JSON.
            const parsed = this._readBlocksFile(filePath) || { jsa: {}, blocks: { languageVersion: 0, blocks: [] } };
            parsed.jsa = parsed.jsa || {};
            for (const key of ['name', 'icon', 'description', 'area', 'label', 'loglevel']) {
                if (meta[key] !== undefined) parsed.jsa[key] = meta[key];
            }
            if (meta.expose !== undefined) {
                parsed.jsa.expose = meta.expose ? (meta.expose === 'button' ? 'button' : 'switch') : '';
            }
            // permission/card are not user-editable via the metadata form for .blocks (see docs/blockly_concept.md
            // "Permissions" section) — only overwrite them if the caller explicitly passes them through.
            if (meta.permissions !== undefined) parsed.jsa.permission = meta.permissions;
            if (meta.card !== undefined) parsed.jsa.card = meta.card;

            try {
                fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf8');
            } catch (e) {
                console.error(`[Parser] Could not write to file "${filePath}".`, e);
            }
            return;
        }

        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            return;
        }
        content = content.replace(/^\uFEFF/, ''); // Remove BOM

        // 1. Remove old headers
        // First remove JSDoc block...
        content = content.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
        // ...then all legacy "// @tag" blocks at the start of the file.
        content = content.replace(/^(\s*\/\/\s*@.*\r?\n)+/, '');

        // Generate new header block
        const lines = ['/**'];
        if (meta.name) lines.push(` * @name ${meta.name}`);
        if (meta.icon) lines.push(` * @icon ${meta.icon}`);
        if (meta.description) lines.push(` * @description ${meta.description}`);
        if (meta.area) lines.push(` * @area ${meta.area}`);
        if (meta.label) lines.push(` * @label ${meta.label}`);
        if (meta.loglevel && meta.loglevel !== 'info') lines.push(` * @loglevel ${meta.loglevel}`);
        if (meta.expose) {
            const val = meta.expose === 'button' ? 'button' : 'switch';
            lines.push(` * @expose ${val}`);
        }
        
        const deps = meta.npmModules || meta.dependencies;
        if (deps && deps.length > 0) lines.push(` * @npm ${deps.join(', ')}`);

        const incs = meta.includes;
        if (incs && incs.length > 0) lines.push(` * @include ${incs.join(', ')}`);

        const perms = meta.permissions;
        if (perms && perms.length > 0) lines.push(` * @permission ${perms.join(', ')}`);

        if (meta.card) lines.push(` * @card${meta.card === true ? '' : ' ' + meta.card}`);

        lines.push(' */');
        
        // 3. Writing back to file
        const newContent = lines.join('\n') + '\n' + content.trimStart();
        try {
            fs.writeFileSync(filePath, newContent, 'utf8');
        } catch (e) {
            console.error(`[Parser] Could not write to file "${filePath}".`, e);
        }
    }
}
module.exports = ScriptHeaderParser;