// core/mcp-change-summary.ts
// Fallback text for the Git commit of an MCP change when the assistant did not say what it changed. A subject like
// "update garage.ts" tells nobody anything later, so derive a short description from the change itself.

const MAX_TOUCHED = 3;

const nonBlank = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** Lines of `after` that `before` does not have, and the other way round (order-insensitive, blank lines ignored). */
function lineChanges(before: string, after: string): { added: string[]; removed: number } {
  const pool = new Map<string, number>();
  for (const line of nonBlank(before)) pool.set(line, (pool.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of nonBlank(after)) {
    const left = pool.get(line) ?? 0;
    if (left > 0) pool.set(line, left - 1);
    else added.push(line);
  }
  let removed = 0;
  for (const count of pool.values()) removed += count;
  return { added, removed };
}

/** Names introduced or touched by the added lines: functions, classes, constants and header tags. */
function touchedNames(added: string[]): string[] {
  const names: string[] = [];
  const push = (n: string): void => {
    if (!names.includes(n)) names.push(n);
  };
  for (const line of added) {
    const tag = /^\*?\s*@(\w+)/.exec(line);
    if (tag) push(`@${tag[1]}`);
    const decl =
      /\b(?:function|class|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/.exec(line) ??
      /\bha\.(?:on|register|action|onWebhook|schedule)\b/.exec(line);
    if (decl) push(decl[1] ?? decl[0]);
  }
  return names.slice(0, MAX_TOUCHED);
}

/** The title a script gives itself in its header, for a "create" subject. */
function headerName(source: string): string | null {
  const m = /^\s*\*?\s*@name\s+(.+?)\s*$/m.exec(source);
  return m ? m[1].replace(/\*\/.*$/, '').trim() || null : null;
}

/**
 * @param label what changed, e.g. "garage.ts" or "card of garage.ts"
 * @param before the previous text, or null when the file is new
 * @param after the new text
 */
export function describeChange(label: string, before: string | null, after: string): string {
  if (before === null) {
    const title = headerName(after);
    const lines = nonBlank(after).length;
    return `create ${label}${title ? ` "${title}"` : ''} (${lines} lines)`;
  }
  const { added, removed } = lineChanges(before, after);
  if (added.length === 0 && removed === 0) return `update ${label} (no content change)`;
  const touched = touchedNames(added);
  return `update ${label}: +${added.length}/-${removed} lines${touched.length ? `, touches ${touched.join(', ')}` : ''}`;
}
