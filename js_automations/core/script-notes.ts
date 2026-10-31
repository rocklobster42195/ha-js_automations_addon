// core/script-notes.ts
// Per-script notes (Markdown) that live next to the scripts in SCRIPTS_DIR/notes. They carry what an
// assistant learned about a script (entity quirks, decisions, open points) across chats. Keyed by the
// script name without extension, so a .js -> .ts migration keeps its notes; libraries get a subfolder.
import * as fs from 'fs';
import * as path from 'path';

export const MAX_NOTES_CHARS = 32_000;

const baseName = (filename: string): string => path.basename(filename).replace(/\.(js|ts)$/, '');

export function notesPath(notesDir: string, filename: string, isLibrary: boolean): string {
  return path.join(notesDir, isLibrary ? 'libraries' : '', `${baseName(filename)}.md`);
}

export function hasNotes(notesDir: string, filename: string, isLibrary: boolean): boolean {
  try {
    return fs.statSync(notesPath(notesDir, filename, isLibrary)).size > 0;
  } catch {
    return false;
  }
}

export function readNotes(notesDir: string, filename: string, isLibrary: boolean): string | null {
  try {
    return fs.readFileSync(notesPath(notesDir, filename, isLibrary), 'utf8');
  } catch {
    return null;
  }
}

/** Removes the notes of a deleted script (they stay in Git history and come back with a restore). */
export function removeNotes(notesDir: string, filename: string, isLibrary: boolean): void {
  fs.rmSync(notesPath(notesDir, filename, isLibrary), { force: true });
}

/** Replaces the notes; empty content removes the file. */
export function writeNotes(notesDir: string, filename: string, isLibrary: boolean, content: string): void {
  const file = notesPath(notesDir, filename, isLibrary);
  if (!content.trim()) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content.trimEnd() + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function appendNotes(notesDir: string, filename: string, isLibrary: boolean, addition: string): string {
  const current = readNotes(notesDir, filename, isLibrary);
  const next = current ? `${current.trimEnd()}\n\n${addition.trim()}` : addition.trim();
  writeNotes(notesDir, filename, isLibrary, next);
  return next;
}

export function moveNotes(notesDir: string, oldFilename: string, newFilename: string, isLibrary: boolean): void {
  const from = notesPath(notesDir, oldFilename, isLibrary);
  const to = notesPath(notesDir, newFilename, isLibrary);
  if (from === to || !fs.existsSync(from) || fs.existsSync(to)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}
