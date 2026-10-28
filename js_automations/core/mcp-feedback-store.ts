// core/mcp-feedback-store.ts
// Notes an AI assistant leaves about JS Automations itself while the maintainers work with it
// (API that could be simpler, missing features, doc gaps, bugs). Local only — nothing is sent anywhere.
// Similar notes are merged and counted, so a suggestion only reaches the user once it keeps coming up;
// hard errors are the exception and are reported at once.
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { maskSecrets } from './mcp-secret-filter';

export type FeedbackKind = 'bug' | 'api' | 'feature' | 'docs' | 'other';
export type FeedbackSeverity = 'normal' | 'hard_error';
/** How the assistant should treat the note: tell the user right away, tell them once later, or stay quiet. */
export type FeedbackMention = 'now' | 'later' | null;

export interface FeedbackNote {
  id: string;
  kind: FeedbackKind;
  severity: FeedbackSeverity;
  title: string;
  detail: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Whether the user was already told: never, once as a suggestion, or immediately as a hard error. */
  told: 'no' | 'later' | 'now';
}

export interface FeedbackInput {
  kind: FeedbackKind;
  severity?: FeedbackSeverity;
  title: string;
  detail?: string;
  /** Id of an existing note this observation repeats (preferred over fuzzy matching). */
  sameAs?: string;
}

export interface FeedbackResult {
  note: FeedbackNote;
  created: boolean;
  mention: FeedbackMention;
}

/** A normal observation is brought up once it was made this many times. */
export const MENTION_THRESHOLD = 3;
const MAX_NOTES = 200;
const MAX_TITLE = 120;
const MAX_DETAIL = 1500;
const SIMILARITY = 0.6;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'are',
  'not',
  'could',
  'should',
  'der',
  'die',
  'das',
  'und',
  'mit',
  'nicht',
]);

const tokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß.]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const clean = (text: string): string => maskSecrets(text).text.trim();

export class McpFeedbackStore extends EventEmitter {
  private _notes: FeedbackNote[] = [];
  private readonly _file: string;

  constructor(storageDir: string) {
    super();
    this._file = path.join(storageDir, 'mcp-feedback.json');
    this._load();
  }

  private _load(): void {
    try {
      if (!fs.existsSync(this._file)) return;
      const data = JSON.parse(fs.readFileSync(this._file, 'utf8'));
      if (Array.isArray(data))
        this._notes = data.filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string');
    } catch {
      this._notes = []; // a damaged notes file must never break MCP
    }
  }

  private _save(): void {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify(this._notes, null, 2), 'utf8');
    } catch {
      // Notes are a convenience; failing to persist them is not worth surfacing to the assistant.
    }
  }

  /** Hard errors first, then most-repeated, then newest. */
  list(): FeedbackNote[] {
    return [...this._notes].sort(
      (a, b) =>
        Number(b.severity === 'hard_error') - Number(a.severity === 'hard_error') ||
        b.count - a.count ||
        b.lastSeen - a.lastSeen
    );
  }

  add(input: FeedbackInput): FeedbackResult {
    const now = Date.now();
    const title = clip(clean(input.title), MAX_TITLE);
    const detail = clip(clean(input.detail ?? ''), MAX_DETAIL);
    const severity: FeedbackSeverity = input.severity === 'hard_error' ? 'hard_error' : 'normal';

    let note =
      this._notes.find((n) => n.id === input.sameAs) ??
      this._notes.find((n) => n.kind === input.kind && similarity(n.title, title) >= SIMILARITY);
    const created = !note;

    if (note) {
      note.count++;
      note.lastSeen = now;
      if (severity === 'hard_error') note.severity = 'hard_error'; // can only escalate
      if (detail && detail.length > note.detail.length) note.detail = detail; // keep the most informative version
    } else {
      note = {
        id: `fb_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: input.kind,
        severity,
        title,
        detail,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        told: 'no',
      };
      this._notes.push(note);
      this._prune();
    }

    let mention: FeedbackMention = null;
    if (note.severity === 'hard_error' && note.told !== 'now') mention = 'now';
    else if (note.severity === 'normal' && note.told === 'no' && note.count >= MENTION_THRESHOLD) mention = 'later';
    if (mention) note.told = mention;

    this._save();
    this.emit('changed');
    return { note, created, mention };
  }

  remove(id: string): boolean {
    const before = this._notes.length;
    this._notes = this._notes.filter((n) => n.id !== id);
    if (this._notes.length === before) return false;
    this._save();
    this.emit('changed');
    return true;
  }

  /** Keeps the file bounded: drops the least repeated, oldest normal notes first. */
  private _prune(): void {
    if (this._notes.length <= MAX_NOTES) return;
    const droppable = this._notes
      .filter((n) => n.severity === 'normal')
      .sort((a, b) => a.count - b.count || a.lastSeen - b.lastSeen);
    const excess = this._notes.length - MAX_NOTES;
    const drop = new Set(droppable.slice(0, excess).map((n) => n.id));
    this._notes = this._notes.filter((n) => !drop.has(n.id));
  }
}
