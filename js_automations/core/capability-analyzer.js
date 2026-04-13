'use strict';

// Patterns that indicate network access (HTTP/HTTPS/WebSocket).
// Includes commonly used npm packages that wrap network access internally —
// these would not be caught by scanning their own require('http') calls
// since those are buried inside the package's node_modules.
const NETWORK_PATTERNS = [
    /\bfetch\s*\(/,
    /require\s*\(\s*['"]axios['"]\s*\)/,
    /import\s*\(\s*['"]axios['"]\s*\)/,
    /import\s+\S.*\baxios\b/,
    /\baxios\s*\.\s*\w+\s*\(/,
    /require\s*\(\s*['"]https?['"]\s*\)/,
    /require\s*\(\s*['"]node-fetch['"]\s*\)/,
    /import\s*\(\s*['"]node-fetch['"]\s*\)/,
    /\bnew\s+XMLHttpRequest\b/,
    /require\s*\(\s*['"]got['"]\s*\)/,
    /\bgot\s*\(/,
    // Packages that use network internally (no direct require('http') in user code)
    /require\s*\(\s*['"]node-unifi['"]\s*\)/,
    /require\s*\(\s*['"]ws['"]\s*\)/,
    /require\s*\(\s*['"]socket\.io-client['"]\s*\)/,
    /require\s*\(\s*['"]mqtt['"]\s*\)/,
    /require\s*\(\s*['"]undici['"]\s*\)/,
    /require\s*\(\s*['"]superagent['"]\s*\)/,
    /require\s*\(\s*['"]needle['"]\s*\)/,
    /require\s*\(\s*['"]node-ical['"]\s*\)/,
];

// Patterns that indicate ha.fs read operations
const FS_READ_PATTERNS = [
    /\bha\.fs\.read\s*\(/,
    /\bha\.fs\.list\s*\(/,
    /\bha\.fs\.stat\s*\(/,
    /\bha\.fs\.exists\s*\(/,
    /\bha\.fs\.watch\s*\(/,
];

// Patterns that indicate ha.fs write/mutate operations
const FS_WRITE_PATTERNS = [
    /\bha\.fs\.write\s*\(/,
    /\bha\.fs\.append\s*\(/,
    /\bha\.fs\.delete\s*\(/,
    /\bha\.fs\.move\s*\(/,
    /\bha\.fs\.rotate\s*\(/,
];

// Patterns that indicate shell execution via child_process
const EXEC_PATTERNS = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /import\s*\(\s*['"]child_process['"]\s*\)/,
    /\bexecSync\s*\(/,
    /\bspawnSync\s*\(/,
    /\bexecFileSync\s*\(/,
    /\bexecFile\s*\(/,
];

class CapabilityAnalyzer {
    /**
     * Strips the leading JSDoc block and inline comments from source to
     * avoid false positives from example code in @description or commented-out lines.
     */
    static _preprocess(source) {
        // Remove leading JSDoc block
        let s = source.replace(/^\s*\/\*\*([\s\S]*?)\*\//, '');
        // Remove inline // comments (not inside strings — best-effort)
        s = s.replace(/\/\/[^\n]*/g, '');
        return s;
    }

    /**
     * Analyzes script source and returns detected capability tokens.
     * @param {string} source - Raw script source (UTF-8)
     * @returns {{ detected: string[] }}
     */
    static analyze(source) {
        const s = CapabilityAnalyzer._preprocess(source);
        const detected = [];

        if (NETWORK_PATTERNS.some(p => p.test(s))) detected.push('network');
        if (FS_WRITE_PATTERNS.some(p => p.test(s))) detected.push('fs:write');
        // Only add fs:read if not already implying it via fs:write
        else if (FS_READ_PATTERNS.some(p => p.test(s))) detected.push('fs:read');
        if (EXEC_PATTERNS.some(p => p.test(s))) detected.push('exec');

        return { detected };
    }

    /**
     * Compares declared permissions against detected capabilities.
     * @param {string[]} declared - From @permission tag
     * @param {string[]} detected - From analyze()
     * @returns {{ undeclared: string[], unused: string[] }}
     *   undeclared: detected but not in declared → warning badge
     *   unused:     declared but not detected → dimmed badge
     */
    static diff(declared, detected) {
        // Normalize: expand 'fs' alias and deduplicate
        const norm = (arr) => {
            const out = new Set();
            for (const t of arr) {
                if (t === 'fs') { out.add('fs:read'); out.add('fs:write'); }
                else out.add(t);
            }
            return [...out];
        };
        const d = norm(declared);
        const undeclared = detected.filter(t => !d.includes(t));
        const unused = d.filter(t => !detected.includes(t));
        return { undeclared, unused };
    }
}

module.exports = CapabilityAnalyzer;
