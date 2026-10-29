// core/mcp-tool-catalog.ts
// Static list of all MCP tools JSA can offer, with their group and default state.
// Pure data on purpose: the settings schema generates one on/off switch per entry,
// and the protocol layer only exposes tools that are both registered (implemented)
// and switched on. See docs/internal/ai_concept.md §5.

export type McpToolGroup = 'read' | 'control' | 'write';

export interface McpToolMeta {
  name: string;
  group: McpToolGroup;
  defaultEnabled: boolean;
  /** Offered only in maintainer mode (Settings → General, expert mode) and without its own settings switch. */
  maintainerOnly?: boolean;
}

export const MCP_TOOL_GROUPS: McpToolGroup[] = ['read', 'control', 'write'];

export const MCP_TOOL_CATALOG: McpToolMeta[] = [
  { name: 'list_scripts', group: 'read', defaultEnabled: true },
  { name: 'read_script', group: 'read', defaultEnabled: true },
  { name: 'get_logs', group: 'read', defaultEnabled: true },
  { name: 'get_script_errors', group: 'read', defaultEnabled: true },
  { name: 'get_events', group: 'read', defaultEnabled: true },
  { name: 'list_entities', group: 'read', defaultEnabled: true },
  { name: 'get_entity', group: 'read', defaultEnabled: true },
  { name: 'get_api_reference', group: 'read', defaultEnabled: true },
  { name: 'get_store', group: 'read', defaultEnabled: false },
  { name: 'jsa_feedback', group: 'read', defaultEnabled: true, maintainerOnly: true },
  { name: 'start_script', group: 'control', defaultEnabled: true },
  { name: 'stop_script', group: 'control', defaultEnabled: true },
  { name: 'restart_script', group: 'control', defaultEnabled: true },
  { name: 'call_service', group: 'control', defaultEnabled: false },
  { name: 'write_script', group: 'write', defaultEnabled: false },
  { name: 'write_card', group: 'write', defaultEnabled: false },
  { name: 'delete_script', group: 'write', defaultEnabled: false },
];

/** Settings key (inside the `mcp` section) of a tool's on/off switch. */
export const toolSettingsKey = (name: string): string => `tool_${name}`;

export function isToolEnabled(
  settings: Record<string, unknown> | undefined,
  meta: McpToolMeta,
  maintainerMode = false
): boolean {
  if (meta.maintainerOnly) return maintainerMode;
  const value = settings?.[toolSettingsKey(meta.name)];
  return typeof value === 'boolean' ? value : meta.defaultEnabled;
}
