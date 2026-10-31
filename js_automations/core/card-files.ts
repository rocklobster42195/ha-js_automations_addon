// core/card-files.ts
// A script's Lovelace cards as plain files in SCRIPTS_DIR/cards, named after the script:
//   cards/<script>-card.js          main card (what installCard() installs)
//   cards/<script>-<x>-card.js      further cards of the same script
// Ownership is the prefix "<script>-": script names are [a-z0-9_], never a hyphen, so it is unambiguous.
// The embedded Base64 block (`/* __JSA_CARD__ ... __JSA_CARD_END__ */`) stays the single-file exchange format:
// download packs the card files into it, upload/import unpacks them again. An unnamed block is the main card,
// a named one (`/* __JSA_CARD__ <name>`) a further card.
import * as fs from 'fs';
import * as path from 'path';

const CARD_NAME = /^[a-z0-9_]+(-[a-z0-9_]+)*$/;
const BLOCK = /\/\* __JSA_CARD__([^\n]*)\n([\s\S]*?)__JSA_CARD_END__ \*\//g;

export interface CardBlock {
  /** null = the main card */
  name: string | null;
  code: string;
}

export const cardBase = (scriptFilename: string): string => path.basename(scriptFilename).replace(/\.(js|ts)$/, '');

export const mainCardName = (base: string): string => `${base}-card`;

/** Resolves a card name ("" / undefined = main card) to its file, or null if the name is not a card of this script. */
export function cardFilePath(cardsDir: string, base: string, card?: string): string | null {
  const name = card || mainCardName(base);
  if (!CARD_NAME.test(name) || !name.startsWith(`${base}-`)) return null;
  return path.join(cardsDir, `${name}.js`);
}

/** Names (without ".js") of the card files of a script, the main card first. */
export function listCardNames(cardsDir: string, base: string): string[] {
  let files: string[];
  try {
    files = fs.readdirSync(cardsDir);
  } catch {
    return [];
  }
  const main = mainCardName(base);
  const names = files
    .filter((f) => f.endsWith('.js') && f.startsWith(`${base}-`))
    .map((f) => f.slice(0, -3))
    .filter((n) => CARD_NAME.test(n));
  return names.sort((a, b) => (a === main ? -1 : b === main ? 1 : a.localeCompare(b)));
}

export function readCardFile(cardsDir: string, base: string, card?: string): string | null {
  const file = cardFilePath(cardsDir, base, card);
  if (!file) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Writes a card file atomically; returns its path, or null for an invalid card name. */
export function writeCardFile(cardsDir: string, base: string, card: string | undefined, code: string): string | null {
  const file = cardFilePath(cardsDir, base, card);
  if (!file) return null;
  fs.mkdirSync(cardsDir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, code, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** Deletes all card files of a script; returns the removed paths. */
export function removeCardFiles(cardsDir: string, base: string): string[] {
  const removed: string[] = [];
  for (const name of listCardNames(cardsDir, base)) {
    const file = path.join(cardsDir, `${name}.js`);
    fs.rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}

/** Renames the card files of a script to follow a script rename (tag names inside the code stay as they are). */
export function moveCardFiles(cardsDir: string, oldBase: string, newBase: string): void {
  if (oldBase === newBase) return;
  for (const name of listCardNames(cardsDir, oldBase)) {
    const target = path.join(cardsDir, `${newBase}-${name.slice(oldBase.length + 1)}.js`);
    if (!fs.existsSync(target)) fs.renameSync(path.join(cardsDir, `${name}.js`), target);
  }
}

/** All embedded card blocks of a script source, decoded, in file order. */
export function extractBlocks(source: string): CardBlock[] {
  const blocks: CardBlock[] = [];
  for (const m of source.matchAll(BLOCK)) {
    const base64 = m[2].trim();
    if (!base64) continue;
    const name = m[1].trim();
    blocks.push({ name: name || null, code: Buffer.from(base64, 'base64').toString('utf8') });
  }
  return blocks;
}

export function encodeBlock(code: string, name?: string | null): string {
  return `/* __JSA_CARD__${name ? ` ${name}` : ''}\n${Buffer.from(code, 'utf8').toString('base64')}\n__JSA_CARD_END__ */`;
}

export const hasBlock = (source: string): boolean => new RegExp(BLOCK.source).test(source);

export function stripBlocks(source: string): string {
  return source.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * The single-file exchange form: the script followed by its cards as blocks. The main card comes first so that
 * older versions (which read only the first block) still find it.
 */
export function packSource(source: string, cards: CardBlock[]): string {
  const body = stripBlocks(source).trimEnd();
  if (cards.length === 0) return `${body}\n`;
  const ordered = [...cards].sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : 0));
  return `${body}\n\n${ordered.map((c) => encodeBlock(c.code, c.name)).join('\n\n')}\n`;
}

/** Packs the card files of a script (or its legacy embedded block, if it has no files) into its source. */
export function packScript(cardsDir: string, scriptFilename: string, source: string): string {
  const base = cardBase(scriptFilename);
  const names = listCardNames(cardsDir, base);
  if (names.length === 0) return source;
  const main = mainCardName(base);
  const cards: CardBlock[] = [];
  for (const name of names) {
    const code = readCardFile(cardsDir, base, name);
    if (code !== null) cards.push({ name: name === main ? null : name, code });
  }
  return packSource(source, cards);
}

/**
 * Unpacks the card blocks of an imported source into card files of the script `base` and returns the source
 * without them. A named card that carries the prefix of the script it was packed from (`fromBase`, e.g. when
 * duplicating) is renamed to the new script's prefix; one without any matching prefix gets the new one prepended
 * (the script may have been renamed on import).
 */
export function unpackScript(cardsDir: string, base: string, source: string, fromBase?: string): string {
  if (!hasBlock(source)) return source;
  const unpacked = source.replace(new RegExp(BLOCK.source, 'g'), (match: string, nameRaw: string, base64: string) => {
    const encoded = base64.trim();
    if (!encoded) return '';
    let card: string | undefined;
    const raw = nameRaw.trim();
    if (raw) {
      // "Day Card" becomes "day-card": a name that is not a valid card name is repaired where that is possible.
      const wanted = raw
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!wanted) return match;
      if (wanted.startsWith(`${base}-`)) card = wanted;
      else if (fromBase && wanted.startsWith(`${fromBase}-`)) card = `${base}-${wanted.slice(fromBase.length + 1)}`;
      else card = `${base}-${wanted}`;
    }
    // A block that cannot be written stays in the script instead of being lost.
    return writeCardFile(cardsDir, base, card, Buffer.from(encoded, 'base64').toString('utf8')) ? '' : match;
  });
  return `${unpacked.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
