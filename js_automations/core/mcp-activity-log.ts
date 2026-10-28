// core/mcp-activity-log.ts
import { EventEmitter } from 'events';

const MAX_ENTRIES = 200;

export interface McpActivityEntry {
  id: number;
  ts: number;
  tool: string;
  /** Script/library file the call targeted, if any. */
  target: string | null;
  ip: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
}

/**
 * In-memory ring buffer of the most recent MCP tool calls. Deliberately not
 * persisted: it backs the live activity view in the MCP tab. Changes made by
 * write tools are additionally traceable through the Git history.
 */
export class McpActivityLog extends EventEmitter {
  private _entries: McpActivityEntry[] = [];
  private _nextId = 1;

  add(entry: Omit<McpActivityEntry, 'id'>): McpActivityEntry {
    const full: McpActivityEntry = { id: this._nextId++, ...entry };
    this._entries.push(full);
    if (this._entries.length > MAX_ENTRIES) this._entries.shift();
    this.emit('entry', full);
    return full;
  }

  /** Newest first. */
  list(): McpActivityEntry[] {
    return [...this._entries].reverse();
  }
}
