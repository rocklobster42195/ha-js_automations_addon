'use strict';

// Patterns that indicate network access (HTTP/HTTPS/WebSocket).
// Includes commonly used npm packages that wrap network access internally —
// these would not be caught by scanning their own require('http') calls
// since those are buried inside the package's node_modules.
const NETWORK_PATTERNS = [
  /\bha\.http\b/,
  /\bha\.frontend\.cacheAsset\s*\(/,
  /\bfetch\s*\(/,
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

// Patterns that indicate ha.onWebhook() usage
const WEBHOOK_PATTERNS = [/\bha\.onWebhook\s*\(/];

// Patterns that indicate direct ha.mqtt.* usage (distinct from the generic
// 'network' capability — used to drive the sidebar's needs-mqtt warning dot
// for scripts that depend on the broker without necessarily @expose-ing an
// entity). Not rendered as its own capability badge (see script-row.ts).
const MQTT_PATTERNS = [/\bha\.mqtt\.(publish|subscribe)\s*\(/];

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
  static _preprocess(source: string): string {
    // Remove leading JSDoc block
    let s = source.replace(/^\s*\/\*\*([\s\S]*?)\*\//, '');
    // Remove inline // comments (not inside strings — best-effort)
    s = s.replace(/\/\/[^\n]*/g, '');
    return s;
  }

  /**
   * Analyzes script source and returns detected capability tokens.
   * @param source - Raw script source (UTF-8)
   */
  static analyze(source: string): { detected: string[] } {
    const s = CapabilityAnalyzer._preprocess(source);
    const detected: string[] = [];

    if (NETWORK_PATTERNS.some((p) => p.test(s))) detected.push('network');
    if (WEBHOOK_PATTERNS.some((p) => p.test(s))) detected.push('webhook');
    if (MQTT_PATTERNS.some((p) => p.test(s))) detected.push('mqtt');
    if (FS_WRITE_PATTERNS.some((p) => p.test(s))) detected.push('fs:write');
    // Only add fs:read if not already implying it via fs:write
    else if (FS_READ_PATTERNS.some((p) => p.test(s))) detected.push('fs:read');
    if (EXEC_PATTERNS.some((p) => p.test(s))) detected.push('exec');

    return { detected };
  }

  /**
   * Compares declared permissions against detected capabilities.
   * @param declared - From @permission tag
   * @param detected - From analyze()
   * @returns undeclared: detected but not in declared → warning badge;
   *   unused: declared but not detected → dimmed badge
   */
  static diff(declared: string[], detected: string[]): { undeclared: string[]; unused: string[] } {
    // Normalize: expand 'fs' alias and deduplicate
    const norm = (arr: string[]): string[] => {
      const out = new Set<string>();
      for (const t of arr) {
        if (t === 'fs') {
          out.add('fs:read');
          out.add('fs:write');
        } else out.add(t);
      }
      return [...out];
    };
    const d = norm(declared);
    const undeclared = detected.filter((t) => !d.includes(t));
    const unused = d.filter((t) => !detected.includes(t));
    return { undeclared, unused };
  }
}

export = CapabilityAnalyzer;
