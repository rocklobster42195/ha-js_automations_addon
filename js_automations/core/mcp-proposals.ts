// core/mcp-proposals.ts
// Access level "propose": the write tools of an AI assistant do not touch the files, they leave a proposal
// that the user reviews as a diff and then applies or rejects. Proposals live in memory only (they are gone
// after an add-on restart, which is intended: nothing unreviewed survives), one open proposal per file.
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

export type ProposalKind = 'script' | 'card';
export type ProposalStatus = 'open' | 'applied' | 'rejected' | 'stale' | 'expired';

export const MAX_OPEN_PROPOSALS = 20;
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface Proposal {
  id: number;
  kind: ProposalKind;
  /** "garage.ts" or "libraries/helpers.ts". */
  filename: string;
  /** Name of a further card; null for the script itself and for the main card. */
  card: string | null;
  /** The file did not exist when the proposal was made. */
  isNew: boolean;
  /** The tool arguments, replayed through the normal write path when the user applies the proposal. */
  args: Record<string, unknown>;
  /** The proposed text: the script without its card block, or the card source. */
  content: string;
  /** Hash of the file as it was when the proposal was made (null for a new file); a mismatch at apply time means stale. */
  baseHash: string | null;
  /** Git commit subject the assistant gave. */
  message: string;
  warnings: string[];
  status: ProposalStatus;
  /** Why the user rejected it, if they said. */
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** What the UI list needs (no file contents). */
export type ProposalSummary = Omit<Proposal, 'args' | 'content' | 'baseHash'>;

export const summarize = (p: Proposal): ProposalSummary => {
  const { args: _args, content: _content, baseHash: _baseHash, ...rest } = p;
  return rest;
};

export type ProposalInput = Pick<
  Proposal,
  'kind' | 'filename' | 'card' | 'isNew' | 'args' | 'content' | 'baseHash' | 'message' | 'warnings'
>;

/** Same hash for "what the file looked like when proposed" and "what it looks like now". */
export const hashText = (text: string): string => crypto.createHash('sha1').update(text).digest('hex');

const sameTarget = (p: Proposal, kind: ProposalKind, filename: string, card: string | null): boolean =>
  p.kind === kind && p.filename === filename && (p.card ?? null) === (card ?? null);

export class McpProposalStore extends EventEmitter {
  private _items: Proposal[] = [];
  private _nextId = 1;

  constructor(private readonly _now: () => number = Date.now) {
    super();
  }

  /** Creates the open proposal for this file, or updates the one that is already open (same id). */
  propose(input: ProposalInput): Proposal {
    this._sweep();
    const now = this._now();
    const existing = this._items.find(
      (p) => p.status === 'open' && sameTarget(p, input.kind, input.filename, input.card)
    );
    let proposal: Proposal;
    if (existing) {
      // Follow-up changes build on the pending text, so the base stays what the file looked like at the start.
      Object.assign(existing, { ...input, baseHash: existing.baseHash, isNew: existing.isNew, updatedAt: now });
      proposal = existing;
    } else {
      proposal = { ...input, id: this._nextId++, status: 'open', reason: null, createdAt: now, updatedAt: now };
      this._items.push(proposal);
      const open = this._items.filter((p) => p.status === 'open').sort((a, b) => a.updatedAt - b.updatedAt);
      for (const old of open.slice(0, Math.max(0, open.length - MAX_OPEN_PROPOSALS))) {
        old.status = 'expired';
        old.updatedAt = now;
      }
    }
    this.emit('proposed', proposal);
    this.emit('changed');
    return proposal;
  }

  get(id: number): Proposal | undefined {
    this._sweep();
    return this._items.find((p) => p.id === id);
  }

  /** Newest first. */
  list(): Proposal[] {
    this._sweep();
    return [...this._items].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
  }

  findOpen(kind: ProposalKind, filename: string, card: string | null = null): Proposal | undefined {
    this._sweep();
    return this._items.find((p) => p.status === 'open' && sameTarget(p, kind, filename, card));
  }

  /** The most recent proposal for this file that is no longer open (applied, rejected, stale or expired). */
  latestClosed(kind: ProposalKind, filename: string, card: string | null = null): Proposal | undefined {
    this._sweep();
    return this.list().find((p) => p.status !== 'open' && sameTarget(p, kind, filename, card));
  }

  /** Forgets every closed proposal (applied, rejected, stale, expired); open ones stay. Returns how many were removed. */
  clearClosed(): number {
    const before = this._items.length;
    this._items = this._items.filter((p) => p.status === 'open');
    const removed = before - this._items.length;
    if (removed) this.emit('changed');
    return removed;
  }

  openCount(): number {
    this._sweep();
    return this._items.filter((p) => p.status === 'open').length;
  }

  close(id: number, status: Exclude<ProposalStatus, 'open'>, reason: string | null = null): Proposal | undefined {
    const p = this._items.find((x) => x.id === id);
    if (!p || p.status !== 'open') return undefined;
    p.status = status;
    p.reason = reason ? reason.slice(0, 500) : null;
    p.updatedAt = this._now();
    this.emit('closed', p);
    this.emit('changed');
    return p;
  }

  /** Open proposals older than the TTL expire; closed ones are forgotten after the same time. */
  private _sweep(): void {
    const now = this._now();
    let changed = false;
    for (const p of this._items) {
      if (p.status === 'open' && now - p.updatedAt > PROPOSAL_TTL_MS) {
        p.status = 'expired';
        p.updatedAt = now;
        changed = true;
      }
    }
    const kept = this._items.filter((p) => p.status === 'open' || now - p.updatedAt <= PROPOSAL_TTL_MS);
    if (kept.length !== this._items.length) {
      this._items = kept;
      changed = true;
    }
    if (changed) this.emit('changed');
  }
}
