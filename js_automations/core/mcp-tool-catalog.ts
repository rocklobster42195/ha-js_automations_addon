// core/mcp-tool-catalog.ts
// Static list of all MCP tools JSA can offer, with their group and default state.
// Pure data on purpose: the settings schema derives its switches from it, and the protocol layer
// only exposes tools that are both registered (implemented) and allowed. See docs/internal/ai_concept.md §5.

export type McpToolGroup = 'read' | 'control' | 'write';

export interface McpToolMeta {
  name: string;
  group: McpToolGroup;
  defaultEnabled: boolean;
  /** Offered only in maintainer mode (Settings → General, expert mode) and without its own settings switch. */
  maintainerOnly?: boolean;
}

export const MCP_TOOL_GROUPS: McpToolGroup[] = ['read', 'control', 'write'];

/**
 * Settings → MCP Server → Access level: each level includes the ones before it. "custom" ignores the levels and
 * uses the switch of every single tool.
 */
export type McpAccessLevel = 'read' | 'control' | 'write' | 'custom';

export const MCP_ACCESS_LEVELS: McpAccessLevel[] = ['read', 'control', 'write', 'custom'];

const LEVEL_GROUPS: Record<Exclude<McpAccessLevel, 'custom'>, McpToolGroup[]> = {
  read: ['read'],
  control: ['read', 'control'],
  write: ['read', 'control', 'write'],
};

/**
 * Tools that can do the most damage or reveal the most. They belong to no access level: each has its own
 * switch, off by default, whatever the level is.
 */
export const MCP_SEPARATE_SWITCH_TOOLS: string[] = ['get_store', 'call_service', 'run_snippet', 'delete_script'];

export const MCP_TOOL_CATALOG: McpToolMeta[] = [
  { name: 'list_scripts', group: 'read', defaultEnabled: true },
  { name: 'read_script', group: 'read', defaultEnabled: true },
  { name: 'get_logs', group: 'read', defaultEnabled: true },
  { name: 'get_script_errors', group: 'read', defaultEnabled: true },
  { name: 'get_events', group: 'read', defaultEnabled: true },
  { name: 'list_entities', group: 'read', defaultEnabled: true },
  { name: 'get_entity', group: 'read', defaultEnabled: true },
  { name: 'get_api_reference', group: 'read', defaultEnabled: true },
  { name: 'get_script_notes', group: 'read', defaultEnabled: true },
  { name: 'get_store', group: 'read', defaultEnabled: false },
  { name: 'jsa_feedback', group: 'read', defaultEnabled: true, maintainerOnly: true },
  { name: 'start_script', group: 'control', defaultEnabled: true },
  { name: 'stop_script', group: 'control', defaultEnabled: true },
  { name: 'restart_script', group: 'control', defaultEnabled: true },
  { name: 'call_service', group: 'control', defaultEnabled: false },
  { name: 'run_snippet', group: 'control', defaultEnabled: false },
  { name: 'write_script', group: 'write', defaultEnabled: false },
  { name: 'write_card', group: 'write', defaultEnabled: false },
  { name: 'edit_script', group: 'write', defaultEnabled: false },
  { name: 'edit_card', group: 'write', defaultEnabled: false },
  { name: 'save_script_notes', group: 'write', defaultEnabled: false },
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
  const level = settings?.access_level as McpAccessLevel | undefined;
  if (level && level !== 'custom' && level in LEVEL_GROUPS && !MCP_SEPARATE_SWITCH_TOOLS.includes(meta.name)) {
    return LEVEL_GROUPS[level].includes(meta.group);
  }
  const value = settings?.[toolSettingsKey(meta.name)];
  return typeof value === 'boolean' ? value : meta.defaultEnabled;
}

/**
 * Settings written before access levels existed carry one switch per tool. A user who changed any of them away
 * from the default keeps exactly that choice by moving to "custom"; everyone else gets the default level.
 */
export function migrateMcpAccessLevel(mcp: Record<string, unknown> | undefined): void {
  if (!mcp || mcp.access_level !== undefined) return;
  const changed = MCP_TOOL_CATALOG.some((meta) => {
    if (meta.maintainerOnly || MCP_SEPARATE_SWITCH_TOOLS.includes(meta.name)) return false;
    const value = mcp[toolSettingsKey(meta.name)];
    return typeof value === 'boolean' && value !== meta.defaultEnabled;
  });
  if (changed) mcp.access_level = 'custom';
}
