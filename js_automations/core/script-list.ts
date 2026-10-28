// core/script-list.ts
// Builds the script/library overview (header metadata + runtime status). Shared by
// GET /api/scripts and the MCP tools so both always agree.
import * as fs from 'fs';
import * as path from 'path';
import ScriptHeaderParser from './script-header-parser';
import CapabilityAnalyzer from './capability-analyzer';
import type CardManager from './card-manager';

// worker-manager.ts exports a singleton instance (export = new WorkerManager()), not the class
// itself, so the type has to be derived from the module's export value.
export type WorkerManagerInstance = typeof import('./worker-manager');

export function buildScriptList(workerManager: WorkerManagerInstance, cardManager: CardManager | undefined): any[] {
  const results: any[] = [];
  const conflicts = workerManager.getEntityConflicts();

  // Use centralized getScripts for consistency (handles TS/JS filtering)
  const scripts = workerManager.getScripts();
  scripts.forEach((fullPath) => {
    const filename = path.basename(fullPath);
    const isLibrary = path.basename(path.dirname(fullPath)) === 'libraries';

    const m: any = ScriptHeaderParser.parse(fullPath);
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
      m.status = workerManager.workers.has(filename)
        ? 'running'
        : workerManager.lastExitState.get(filename) === 'error'
          ? 'error'
          : 'stopped';
      m.running = m.status === 'running';
      if (m.running) {
        const stats = workerManager.getScriptStats(filename);
        if (stats) m.ram_usage = stats.ram_usage;
        if (workerManager.startTimes.has(filename)) m.last_started = workerManager.startTimes.get(filename);
      }
    }
    m.entity_conflicts = conflicts[filename] || null;

    // Card installation status: check registry + actual file presence
    if (m.card && cardManager) {
      const scriptName = filename.replace(/\.[^.]+$/, '');
      const entry = cardManager.registry[scriptName];
      m.cardInstalled = !!(entry && fs.existsSync(path.join(cardManager.wwwCardsDir, `${entry.cardName}.js`)));
    }

    results.push(m);
  });

  return results;
}
