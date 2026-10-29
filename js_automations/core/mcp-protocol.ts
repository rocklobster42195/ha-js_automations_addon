// core/mcp-protocol.ts
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
import type { McpActivityLog } from './mcp-activity-log';
import { MCP_TOOL_CATALOG, isToolEnabled } from './mcp-tool-catalog';

export interface McpToolResult {
  /** Plain text for the model. Objects are serialized as indented JSON. */
  content: string | object;
  isError?: boolean;
}

export interface McpToolDefinition {
  /** Must match an entry of MCP_TOOL_CATALOG. */
  name: string;
  title: string;
  description: string;
  inputSchema?: ZodRawShape;
  /** Read-only tools can be run without side effects; shown to the client as a hint. */
  readOnly?: boolean;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
}

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  /** Arguments the user fills in when picking the prompt (zod shape of strings). */
  args?: ZodRawShape;
  /** Builds the instruction text sent to the model. */
  build: (args: Record<string, unknown>) => string;
}

export interface McpResourceDefinition {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  /** Read at request time, so the content always matches the installed version. */
  read: () => string;
}

// Sent to every client on initialize: the few things a model must know before touching JSA.
const SERVER_INSTRUCTIONS = [
  'JS Automations (JSA) runs JavaScript/TypeScript automation scripts for Home Assistant.',
  'Before writing or changing a script, call get_api_reference with topic "authoring" and follow it: scripts have a JSDoc header,',
  'a typed config block and native entities via ha.register(). Use list_scripts and read_script to see existing conventions,',
  'write_script to save (it is syntax-checked and committed to Git), then restart_script and get_script_errors / get_logs to verify.',
  'Never put credentials into script source: keep them in the store (an empty field of the persisted ha.persistent() config, or an ha.store secret),',
  'warn while they are empty and tell the user where to fill them in.',
].join(' ');

// Added for maintainer mode only: the person at the other end develops JSA itself.
const MAINTAINER_INSTRUCTIONS = [
  'MAINTAINER MODE: you are working with the developers of JS Automations (https://github.com/rocklobster42195/ha-js_automations_addon), not an ordinary user.',
  'While you work, note anything about JSA itself that could be better with the jsa_feedback tool: an API that is awkward or could be simpler, a missing feature,',
  'wrong or unclear documentation, surprising behavior. Do this silently: do not mention the notes and do not interrupt the task for them.',
  'Write each note so it could become a GitHub issue and name the file or function when you can see the source.',
  'The tool tells you when a note is worth raising; only then tell the user, once and briefly.',
  'Hard errors are different: if JSA itself fails (crash, data loss, wrong result, a tool that fails although used correctly), record it with severity hard_error and tell the user immediately in your next reply.',
].join(' ');

interface SettingsManagerLike {
  getSettings(): { mcp?: Record<string, unknown>; general?: Record<string, unknown> } | undefined;
}

interface LogManagerLike {
  add(level: string, source: string, message: string): void;
}

/**
 * MCP protocol layer: answers JSON-RPC requests arriving on the (already
 * authenticated) /mcp endpoint. Stateless Streamable HTTP with plain JSON
 * responses — a fresh server/transport pair per request, so there are no
 * sessions to leak and a settings change (tool switched on/off) applies to the
 * very next request.
 */
export class McpProtocol {
  private _tools = new Map<string, McpToolDefinition>();
  private _prompts = new Map<string, McpPromptDefinition>();
  private _resources = new Map<string, McpResourceDefinition>();

  constructor(
    private readonly _settingsManager: SettingsManagerLike,
    private readonly _logManager: LogManagerLike,
    private readonly _activity: McpActivityLog,
    private readonly _version: string
  ) {}

  /** Registers the implementation of a catalog tool. */
  registerTool(def: McpToolDefinition): void {
    if (!MCP_TOOL_CATALOG.some((t) => t.name === def.name)) {
      throw new Error(`MCP tool "${def.name}" is not in the tool catalog`);
    }
    this._tools.set(def.name, def);
  }

  /** Prompts appear as selectable templates in the client; they never run anything by themselves. */
  registerPrompt(def: McpPromptDefinition): void {
    this._prompts.set(def.name, def);
  }

  registerResource(def: McpResourceDefinition): void {
    this._resources.set(def.name, def);
  }

  /** Maintainer mode (Settings → General, expert mode): the AI is told it works with the JSA developers. */
  isMaintainerMode(): boolean {
    return this._settingsManager.getSettings()?.general?.maintainer_mode === true;
  }

  /** Names of the tools a client currently sees (implemented AND switched on). */
  listEnabledTools(): string[] {
    const settings = this._settingsManager.getSettings()?.mcp;
    const maintainer = this.isMaintainerMode();
    return MCP_TOOL_CATALOG.filter(
      (meta) => this._tools.has(meta.name) && isToolEnabled(settings, meta, maintainer)
    ).map((meta) => meta.name);
  }

  async handle(req: Request, res: Response): Promise<void> {
    const ip = (req.ip as string) || 'unknown';
    this._logConnection(req.body, ip);
    const server = new McpServer(
      { name: 'js-automations', version: this._version },
      {
        instructions: this.isMaintainerMode()
          ? `${SERVER_INSTRUCTIONS} ${MAINTAINER_INSTRUCTIONS}`
          : SERVER_INSTRUCTIONS,
      }
    );

    const enabledTools = this.listEnabledTools();
    if (!enabledTools.length) {
      // With every tool switched off the SDK would not know tools/list at all and answer "Method not found",
      // which clients show as a broken connection. Offer an empty list instead.
      server.server.registerCapabilities({ tools: {} });
      server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
    }

    for (const name of enabledTools) {
      const def = this._tools.get(name) as McpToolDefinition;
      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          ...(def.inputSchema ? { inputSchema: def.inputSchema } : {}),
          annotations: { readOnlyHint: !!def.readOnly },
        },
        (async (args: Record<string, unknown> = {}) => this._runTool(def, args, ip)) as never
      );
    }

    for (const def of this._prompts.values()) {
      server.registerPrompt(
        def.name,
        { title: def.title, description: def.description, ...(def.args ? { argsSchema: def.args } : {}) },
        ((args: Record<string, unknown> = {}) => ({
          messages: [{ role: 'user' as const, content: { type: 'text' as const, text: def.build(args) } }],
        })) as never
      );
    }
    for (const def of this._resources.values()) {
      server.registerResource(
        def.name,
        def.uri,
        { title: def.title, description: def.description, mimeType: def.mimeType },
        (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: def.mimeType, text: def.read() }] })
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** Notes new client connections in the system log, so "does my AI client reach JSA at all?" can be answered. */
  private _logConnection(body: unknown, ip: string): void {
    for (const message of Array.isArray(body) ? body : [body]) {
      if (!message || typeof message !== 'object' || (message as { method?: string }).method !== 'initialize') continue;
      const info = (message as { params?: { clientInfo?: { name?: unknown; version?: unknown } } }).params?.clientInfo;
      const name = typeof info?.name === 'string' ? info.name.slice(0, 60) : 'unknown client';
      const version = typeof info?.version === 'string' ? ` ${info.version.slice(0, 20)}` : '';
      this._logManager.add('info', 'System', `[MCP] Client connected: ${name}${version} from ${ip}`);
    }
  }

  private async _runTool(def: McpToolDefinition, args: Record<string, unknown>, ip: string) {
    const started = Date.now();
    let ok = true;
    let error: string | null = null;
    let text: string;
    try {
      const result = await def.handler(args);
      ok = !result.isError;
      text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
      if (!ok) error = text;
    } catch (e) {
      ok = false;
      error = (e as Error).message;
      text = `Error: ${error}`;
      this._logManager.add('error', 'System', `[MCP] Tool "${def.name}" failed: ${error}`);
    }
    this._activity.add({
      ts: started,
      tool: def.name,
      target: typeof args.filename === 'string' ? args.filename : null,
      ip,
      ok,
      error,
      durationMs: Date.now() - started,
    });
    return { content: [{ type: 'text' as const, text }], ...(ok ? {} : { isError: true }) };
  }
}
