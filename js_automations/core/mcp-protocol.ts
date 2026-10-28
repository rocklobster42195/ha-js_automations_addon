// core/mcp-protocol.ts
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

interface SettingsManagerLike {
  getSettings(): { mcp?: Record<string, unknown> } | undefined;
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

  /** Names of the tools a client currently sees (implemented AND switched on). */
  listEnabledTools(): string[] {
    const settings = this._settingsManager.getSettings()?.mcp;
    return MCP_TOOL_CATALOG.filter((meta) => this._tools.has(meta.name) && isToolEnabled(settings, meta)).map(
      (meta) => meta.name
    );
  }

  async handle(req: Request, res: Response): Promise<void> {
    const ip = (req.ip as string) || 'unknown';
    const server = new McpServer({ name: 'js-automations', version: this._version });

    for (const name of this.listEnabledTools()) {
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

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
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
