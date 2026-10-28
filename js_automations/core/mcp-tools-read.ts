// core/mcp-tools-read.ts
// MCP tools of the "read" group: they inspect scripts, logs, events and entities
// without changing anything. See docs/internal/ai_concept.md §5.
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpProtocol, McpToolResult } from './mcp-protocol';
import { isSensitiveName, maskDeep, maskWithNotice } from './mcp-secret-filter';
import { resolveScript } from './mcp-script-files';
import { buildScriptList, type WorkerManagerInstance } from './script-list';
import ScriptHeaderParser from './script-header-parser';
import type CardManager from './card-manager';
import type LogManager from './log-manager';
import type StoreManager from './store-manager';
import type HAConnector from './ha-connection';
import type { McpEventBuffer } from './mcp-event-buffer';

export interface McpReadToolDeps {
  workerManager: WorkerManagerInstance;
  logManager: LogManager;
  storeManager: StoreManager;
  haConnector: HAConnector;
  cardManager: CardManager;
  eventBuffer: McpEventBuffer;
  scriptsDir: string;
  librariesDir: string;
  /** Directory containing authoring.md, API_REFERENCE.md and the guides. */
  docsDir: string;
  /** Directory containing ha-api.d.ts. */
  typesDir: string;
}

const LOG_SEVERITY: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_ENTITY_ATTRIBUTE_CHARS = 8000;
const CARD_BLOCK = /\/\* __JSA_CARD__[\s\S]*?__JSA_CARD_END__ \*\//;

const text = (content: string): McpToolResult => ({ content });
const fail = (message: string): McpToolResult => ({ content: message, isError: true });
const iso = (ts: number): string => new Date(ts).toISOString();

/** Doc topics `get_api_reference` can serve (file relative to docsDir / typesDir). */
export const API_TOPICS: Record<string, { dir: 'docs' | 'types'; file: string; about: string }> = {
  authoring: {
    dir: 'docs',
    file: 'guide/authoring.md',
    about: 'How a JSA script is structured: header tags, config, conventions, cards. Start here.',
  },
  api_reference: { dir: 'docs', file: 'API_REFERENCE.md', about: 'Every ha.* function with examples (large).' },
  types: { dir: 'types', file: 'ha-api.d.ts', about: 'TypeScript definitions of the ha global (large).' },
  cards: {
    dir: 'docs',
    file: 'guide/card-packs.md',
    about: 'Script Packs: Lovelace card inside a script, the __jsa__ bridge.',
  },
  native_entities: {
    dir: 'docs',
    file: 'guide/native-entities.md',
    about: 'ha.register(): entities created by scripts.',
  },
  notifications: { dir: 'docs', file: 'guide/notifications.md', about: 'ha.notify and ha.ask.' },
};

export function registerReadTools(protocol: McpProtocol, deps: McpReadToolDeps): void {
  const { workerManager, logManager, storeManager, haConnector, cardManager, eventBuffer } = deps;

  protocol.registerTool({
    name: 'list_scripts',
    title: 'List scripts',
    description:
      'Lists all JS Automations scripts and libraries with their header metadata (name, description, label, expose, ' +
      'permissions, card) and runtime status (running, stopped, error). Use this first to find the file names the other tools need.',
    readOnly: true,
    handler: () => {
      const scripts = buildScriptList(workerManager, cardManager)
        .filter((m) => !String(m.filename).endsWith('.blocks'))
        .map((m) => ({
          filename: m.filename,
          name: m.name,
          description: m.description || undefined,
          kind: m.path && path.basename(path.dirname(m.path)) === 'libraries' ? 'library' : 'script',
          status: m.status,
          label: m.label || undefined,
          area: m.area || undefined,
          expose: m.expose || undefined,
          permissions: m.permissions?.length ? m.permissions : undefined,
          undeclaredPermissions: m.capabilities?.undeclared?.length ? m.capabilities.undeclared : undefined,
          includes: m.includes?.length ? m.includes : undefined,
          npm: m.dependencies?.length ? m.dependencies : undefined,
          card: m.card || undefined,
          entityConflicts: m.entity_conflicts || undefined,
        }));
      return { content: { count: scripts.length, scripts } };
    },
  });

  protocol.registerTool({
    name: 'read_script',
    title: 'Read script',
    description:
      'Returns the source code of a script or library. If the script has a Lovelace card, the card source is appended ' +
      'as plain JavaScript (the Base64 block is stripped). Known credential patterns are masked.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts, e.g. "smart_watering.ts"') },
    readOnly: true,
    handler: (args) => {
      const filename = String(args.filename ?? '');
      const found = resolveScript(deps, filename);
      if (!found) return fail(`No script or library named "${filename}". Use list_scripts to see the available files.`);

      let source = fs.readFileSync(found.fullPath, 'utf8');
      const hasCard = CARD_BLOCK.test(source);
      source = source.replace(CARD_BLOCK, '/* card source: see the "Card source" section below */');
      let output = source;
      if (hasCard) {
        const card = cardManager.getCardSource(found.fullPath);
        if (card) output += `\n\n=== Card source (plain JavaScript) ===\n${card}`;
      }
      return text(maskWithNotice(output));
    },
  });

  protocol.registerTool({
    name: 'get_logs',
    title: 'Get logs',
    description:
      'Returns recent log lines (last 1000 kept), oldest first. Filter by script, minimum level, age and text. ' +
      'Credentials are masked. Combine with get_script_errors after changing or restarting a script.',
    inputSchema: {
      script: z.string().optional().describe('File name or display name of a script; omit for all logs incl. System'),
      level: z.enum(['error', 'warn', 'info', 'debug']).optional().describe('Minimum severity, default "info"'),
      since_minutes: z.number().positive().optional().describe('Only entries from the last N minutes'),
      search: z.string().optional().describe('Case-insensitive text the message must contain'),
      limit: z.number().int().positive().max(500).optional().describe('Max lines (most recent), default 100'),
    },
    readOnly: true,
    handler: (args) => {
      const minSeverity = LOG_SEVERITY[(args.level as string) ?? 'info'];
      const cutoff = args.since_minutes ? Date.now() - (args.since_minutes as number) * 60000 : 0;
      const needle = typeof args.search === 'string' ? args.search.toLowerCase() : '';
      const limit = (args.limit as number) ?? 100;
      const matchScript = args.script ? scriptMatcher(deps, String(args.script)) : null;

      const lines = logManager
        .getHistory()
        .filter((e) => (LOG_SEVERITY[e.level] ?? 2) <= minSeverity)
        .filter((e) => e.ts >= cutoff)
        .filter((e) => !matchScript || matchScript(e))
        .filter((e) => !needle || e.message.toLowerCase().includes(needle))
        .slice(-limit)
        .map((e) => `${iso(e.ts)} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`);

      if (!lines.length) return text('No matching log entries.');
      return text(maskWithNotice(lines.join('\n')));
    },
  });

  protocol.registerTool({
    name: 'get_script_errors',
    title: 'Get script errors',
    description:
      'Summarizes why a script is not working: its current status, how it last exited and its most recent error/warning ' +
      'log lines, including compiler errors from the System log that mention the file. Use after write_script or restart_script.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts') },
    readOnly: true,
    handler: (args) => {
      const filename = String(args.filename ?? '');
      const found = resolveScript(deps, filename);
      if (!found) return fail(`No script or library named "${filename}". Use list_scripts to see the available files.`);
      const base = path.basename(filename);
      const matches = scriptMatcher(deps, base);

      const history = logManager.getHistory();
      const own = history.filter((e) => (LOG_SEVERITY[e.level] ?? 2) <= LOG_SEVERITY.warn && matches(e)).slice(-10);
      const system = history
        .filter(
          (e) => e.source === 'System' && (LOG_SEVERITY[e.level] ?? 2) <= LOG_SEVERITY.warn && e.message.includes(base)
        )
        .slice(-5);

      const running = workerManager.workers.has(base);
      const status = found.isLibrary
        ? 'library'
        : running
          ? 'running'
          : workerManager.lastExitState.get(base) === 'error'
            ? 'error'
            : 'stopped';
      const fmt = (e: { ts: number; level: string; source: string; message: string }) =>
        `${iso(e.ts)} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`;

      const report = [
        `status: ${status}`,
        found.isLibrary
          ? 'note: libraries have no runtime of their own; errors show up in the scripts that @include them.'
          : '',
        `recent errors/warnings from the script (${own.length}):`,
        ...(own.length ? own.map(fmt) : ['  none']),
        `compiler/system messages mentioning ${base} (${system.length}):`,
        ...(system.length ? system.map(fmt) : ['  none']),
      ]
        .filter(Boolean)
        .join('\n');
      return text(maskWithNotice(report));
    },
  });

  protocol.registerTool({
    name: 'get_events',
    title: 'Get recent events',
    description:
      'Returns recent Home Assistant events (state changes and others) seen since the add-on started, newest first. ' +
      'Useful to check whether a trigger entity actually changed. Only events seen while MCP is enabled are kept (last 300).',
    inputSchema: {
      event_type: z.string().optional().describe('e.g. "state_changed" or a custom event type'),
      entity_id: z.string().optional().describe('Only events about this entity'),
      since_minutes: z.number().positive().optional(),
      limit: z.number().int().positive().max(200).optional().describe('Default 50'),
    },
    readOnly: true,
    handler: (args) => {
      const events = eventBuffer.query({
        type: args.event_type as string | undefined,
        entityId: args.entity_id as string | undefined,
        sinceMs: args.since_minutes ? (args.since_minutes as number) * 60000 : undefined,
        limit: (args.limit as number) ?? 50,
      });
      if (!events.length) return text('No matching events in the buffer.');
      const lines = events.map((e) => {
        const d = e.data as { entity_id?: string; new_state?: { state?: string }; old_state?: { state?: string } };
        if (e.type === 'state_changed' && d?.entity_id) {
          return `${iso(e.ts)} state_changed ${d.entity_id}: ${d.old_state?.state ?? '∅'} -> ${d.new_state?.state ?? '∅'}`;
        }
        const raw = JSON.stringify(e.data);
        return `${iso(e.ts)} ${e.type} ${raw.length > 300 ? raw.slice(0, 300) + '…' : raw}`;
      });
      return text(maskWithNotice(lines.join('\n')));
    },
  });

  protocol.registerTool({
    name: 'list_entities',
    title: 'List entities',
    description:
      'Lists Home Assistant entities with their current state, optionally filtered by domain or search text.',
    inputSchema: {
      domain: z.string().optional().describe('e.g. "light", "sensor"'),
      search: z.string().optional().describe('Case-insensitive match on entity_id or friendly name'),
      limit: z.number().int().positive().max(500).optional().describe('Default 100'),
    },
    readOnly: true,
    handler: (args) => {
      const domain = typeof args.domain === 'string' ? args.domain.toLowerCase() : '';
      const needle = typeof args.search === 'string' ? args.search.toLowerCase() : '';
      const limit = (args.limit as number) ?? 100;
      const all = haConnector.getStates().filter((s) => {
        if (domain && !s.entity_id.startsWith(`${domain}.`)) return false;
        if (!needle) return true;
        const friendly = String(s.attributes?.friendly_name ?? '').toLowerCase();
        return s.entity_id.toLowerCase().includes(needle) || friendly.includes(needle);
      });
      const lines = all
        .slice(0, limit)
        .map((s) => `${s.entity_id} | ${s.state} | ${String(s.attributes?.friendly_name ?? '')}`);
      const more = all.length > limit ? `\n… ${all.length - limit} more, narrow the filter or raise the limit.` : '';
      return text(lines.length ? `${all.length} match(es):\n${lines.join('\n')}${more}` : 'No matching entities.');
    },
  });

  protocol.registerTool({
    name: 'get_entity',
    title: 'Get entity',
    description: 'Returns the state and all attributes of one entity.',
    inputSchema: { entity_id: z.string().describe('e.g. "sensor.outside_temperature"') },
    readOnly: true,
    handler: (args) => {
      const id = String(args.entity_id ?? '');
      const state = haConnector.getStates().find((s) => s.entity_id === id);
      if (!state) return fail(`Entity "${id}" not found. Use list_entities to search.`);
      let json = JSON.stringify(state, null, 2);
      if (json.length > MAX_ENTITY_ATTRIBUTE_CHARS) json = json.slice(0, MAX_ENTITY_ATTRIBUTE_CHARS) + '\n… truncated';
      return text(json);
    },
  });

  protocol.registerTool({
    name: 'get_store',
    title: 'Get store',
    description:
      'Lists the values in the shared ha.store (used by scripts for config and state). Values stored as secrets are never ' +
      'returned, and values under key names that look like credentials (token, password, secret, api key…) are masked.',
    inputSchema: {
      key: z.string().optional().describe('Exact key to read'),
      search: z.string().optional().describe('Case-insensitive text the key must contain'),
    },
    readOnly: true,
    handler: (args) => {
      const needle = typeof args.search === 'string' ? args.search.toLowerCase() : '';
      const entries = Object.entries(storeManager.getAllPublic()).filter(
        ([key]) => (!args.key || key === args.key) && (!needle || key.toLowerCase().includes(needle))
      );
      if (!entries.length) return text('No matching store entries.');
      const lines = entries.slice(0, 200).map(([key, e]) => {
        let value: string;
        if (e.isSecret) value = '(secret, value withheld)';
        else if (isSensitiveName(key)) value = '*** (masked: sensitive key name)';
        else {
          value = JSON.stringify(maskDeep(e.value)) ?? 'undefined';
          if (value.length > 500) value = value.slice(0, 500) + '…';
        }
        return `${key} | ${value} | owner: ${e.owner ?? 'n/a'} | updated: ${e.updated}`;
      });
      const more = entries.length > 200 ? `\n… ${entries.length - 200} more, use search or key.` : '';
      return text(maskWithNotice(lines.join('\n') + more));
    },
  });

  protocol.registerTool({
    name: 'get_api_reference',
    title: 'Get API reference',
    description:
      'Returns JS Automations documentation for writing scripts. Call with topic "authoring" first (script structure, header ' +
      'tags, conventions, cards); use the others for details. Topics: ' +
      Object.entries(API_TOPICS)
        .map(([name, t]) => `${name} (${t.about})`)
        .join(' ') +
      ' Without a topic, only this topic list is returned.',
    inputSchema: { topic: z.enum(Object.keys(API_TOPICS) as [string, ...string[]]).optional() },
    readOnly: true,
    handler: (args) => {
      const topic = args.topic as string | undefined;
      if (!topic) {
        return text(
          Object.entries(API_TOPICS)
            .map(([name, t]) => `${name}: ${t.about}`)
            .join('\n')
        );
      }
      const spec = API_TOPICS[topic];
      const file = path.join(spec.dir === 'docs' ? deps.docsDir : deps.typesDir, spec.file);
      try {
        return text(fs.readFileSync(file, 'utf8'));
      } catch {
        return fail(`Documentation file for "${topic}" is not available in this installation.`);
      }
    },
  });
}

/** Builds a predicate matching log entries that belong to a script (by file name or display name). */
function scriptMatcher(deps: McpReadToolDeps, script: string): (e: { source: string; scriptId?: string }) => boolean {
  const found = resolveScript(deps, script);
  const filename = found ? path.basename(found.fullPath) : script;
  const names = new Set([script.toLowerCase(), filename.toLowerCase(), filename.replace(/\.[^.]+$/, '').toLowerCase()]);
  if (found) {
    const display = (ScriptHeaderParser.parse(found.fullPath) as { name?: string | null }).name;
    if (display) names.add(display.toLowerCase());
  }
  return (e) =>
    (e.scriptId ? e.scriptId.toLowerCase() === filename.toLowerCase() : false) || names.has(e.source.toLowerCase());
}
