// core/mcp-tools-control.ts
// MCP tools of the "control" group: start, stop and restart scripts, call HA services.
// They mirror what the UI does (POST /api/scripts/control), they do not change any files.
import * as path from 'path';
import { z } from 'zod';
import type { McpProtocol, McpToolResult } from './mcp-protocol';
import { missingScriptMessage, resolveScript, type ScriptDirs } from './mcp-script-files';
import type { WorkerManagerInstance } from './script-list';
import ScriptHeaderParser from './script-header-parser';
import type DependencyManager from './dependency-manager';
import type StateManager from './state-manager';
import type HAConnector from './ha-connection';

export interface McpControlToolDeps extends ScriptDirs {
  workerManager: WorkerManagerInstance;
  depManager: DependencyManager;
  stateManager: StateManager;
  haConnector: HAConnector;
  /** Tells the UI the script list changed. */
  notifyStatusUpdate: () => void;
  /** How long to wait after a start before reporting the status, so an instant crash is visible. */
  settleMs?: number;
}

const MAX_SERVICE_RESULT_CHARS = 8000;
const NAME_PART = /^[a-z0-9_]+$/;

// Services that can take down or take over the host; never callable over MCP.
const BLOCKED_SERVICES = new Set(['homeassistant.restart', 'homeassistant.stop']);
const BLOCKED_DOMAINS = new Set(['hassio', 'shell_command', 'python_script']);

const text = (content: string): McpToolResult => ({ content });
const fail = (message: string): McpToolResult => ({ content: message, isError: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function registerControlTools(protocol: McpProtocol, deps: McpControlToolDeps): void {
  const { workerManager, depManager, stateManager, haConnector } = deps;
  const settleMs = deps.settleMs ?? 1500;

  /** Resolves a runnable script (libraries have no runtime). */
  const resolveRunnable = (filename: string) => {
    const found = resolveScript(deps, filename);
    if (!found) {
      return {
        error: fail(
          missingScriptMessage(filename, `No script named "${filename}". Use list_scripts to see the available files.`)
        ),
      };
    }
    if (found.isLibrary)
      return {
        error: fail(
          `"${filename}" is a library. Libraries cannot be started; they run inside the scripts that @include them.`
        ),
      };
    return { found, name: path.basename(found.fullPath) };
  };

  const startAndReport = async (fullPath: string, name: string): Promise<McpToolResult> => {
    const meta = ScriptHeaderParser.parse(fullPath) as { dependencies?: string[] };
    if (meta.dependencies?.length) await depManager.install(meta.dependencies);
    const started = workerManager.startScript(fullPath);
    if (started) stateManager.saveScriptStarted(name);
    if (settleMs) await sleep(settleMs);
    deps.notifyStatusUpdate();
    if (!started) {
      if (workerManager.isRestartBlocked(name)) {
        const { restart_protection_count: count, restart_protection_time: time } = workerManager.settings;
        return fail(
          `"${name}" was NOT started: restart protection is active (${count} starts within ${time / 1000}s, usually because the script crashed on startup). ` +
            `Fix the error (get_script_errors / get_logs), then wait up to ${time / 1000}s before starting it again.`
        );
      }
      return fail(
        `"${name}" could not be started (not compiled yet, restart protection or missing file). Check get_logs for System messages.`
      );
    }
    const running = workerManager.workers.has(name);
    return text(
      running
        ? `"${name}" is running. Use get_logs / get_script_errors to watch it.`
        : `"${name}" was started but is no longer running. Use get_script_errors to see why.`
    );
  };

  protocol.registerTool({
    name: 'start_script',
    title: 'Start script',
    description: 'Starts a stopped script and reports whether it is still running a moment later.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts') },
    handler: async (args) => {
      const r = resolveRunnable(String(args.filename ?? ''));
      if (r.error) return r.error;
      if (workerManager.workers.has(r.name))
        return text(`"${r.name}" is already running. Use restart_script to restart it.`);
      return startAndReport(r.found.fullPath, r.name);
    },
  });

  protocol.registerTool({
    name: 'stop_script',
    title: 'Stop script',
    description: 'Stops a running script.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts') },
    handler: (args) => {
      const r = resolveRunnable(String(args.filename ?? ''));
      if (r.error) return r.error;
      if (!workerManager.workers.has(r.name)) return text(`"${r.name}" is not running.`);
      workerManager.stopScript(r.name, 'stopped via MCP');
      deps.notifyStatusUpdate();
      return text(`"${r.name}" stopped.`);
    },
  });

  protocol.registerTool({
    name: 'restart_script',
    title: 'Restart script',
    description:
      'Restarts a script (also starts it if it was stopped) and reports whether it is still running a moment later. ' +
      'Use after write_script to try a change, then check get_script_errors / get_logs.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts') },
    handler: async (args) => {
      const r = resolveRunnable(String(args.filename ?? ''));
      if (r.error) return r.error;
      workerManager.stopScript(r.name, 'restarting');
      await sleep(settleMs ? 500 : 0);
      return startAndReport(r.found.fullPath, r.name);
    },
  });

  protocol.registerTool({
    name: 'call_service',
    title: 'Call service',
    description:
      'Calls a Home Assistant service, e.g. domain "light", service "turn_on", data {"entity_id": "light.kitchen"}. ' +
      'This acts on real devices. Host-level services (homeassistant.restart/stop, hassio.*, shell_command.*, python_script.*) are refused.',
    inputSchema: {
      domain: z.string().describe('e.g. "light"'),
      service: z.string().describe('e.g. "turn_on"'),
      data: z.record(z.string(), z.unknown()).optional().describe('Service data incl. entity_id'),
      return_response: z.boolean().optional().describe('Set for services that return data'),
    },
    handler: async (args) => {
      const domain = String(args.domain ?? '');
      const service = String(args.service ?? '');
      if (!NAME_PART.test(domain) || !NAME_PART.test(service)) return fail('Invalid domain or service name.');
      if (BLOCKED_DOMAINS.has(domain) || BLOCKED_SERVICES.has(`${domain}.${service}`)) {
        return fail(`${domain}.${service} is not allowed over MCP.`);
      }
      const result = await haConnector.callService(
        domain,
        service,
        (args.data as Record<string, unknown>) ?? {},
        args.return_response === true
      );
      let out = result === undefined || result === null ? 'Service called.' : JSON.stringify(result, null, 2);
      if (out.length > MAX_SERVICE_RESULT_CHARS) out = out.slice(0, MAX_SERVICE_RESULT_CHARS) + '\n… truncated';
      return text(out);
    },
  });
}
