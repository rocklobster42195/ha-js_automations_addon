// core/mcp-event-buffer.ts

const MAX_EVENTS = 300;

export interface BufferedEvent {
  ts: number;
  type: string;
  data: unknown;
}

export interface EventQuery {
  type?: string;
  entityId?: string;
  sinceMs?: number;
  limit: number;
}

/**
 * In-memory ring buffer of recent Home Assistant events, so an MCP client can ask
 * "what happened just now?" — the Event Inspector itself is a live stream without
 * history. Never persisted.
 */
export class McpEventBuffer {
  private _events: BufferedEvent[] = [];

  push(event: { event_type: string; data?: unknown }): void {
    this._events.push({ ts: Date.now(), type: event.event_type, data: event.data ?? {} });
    if (this._events.length > MAX_EVENTS) this._events.shift();
  }

  /** Newest first, filtered. */
  query({ type, entityId, sinceMs, limit }: EventQuery): BufferedEvent[] {
    const cutoff = sinceMs ? Date.now() - sinceMs : 0;
    const out: BufferedEvent[] = [];
    for (let i = this._events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this._events[i];
      if (e.ts < cutoff) break;
      if (type && e.type !== type) continue;
      if (entityId && (e.data as { entity_id?: string })?.entity_id !== entityId) continue;
      out.push(e);
    }
    return out;
  }
}
