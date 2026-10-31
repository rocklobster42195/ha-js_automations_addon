// core/mcp-tools-write.ts
// MCP tools of the "write" group: create/change/delete scripts, libraries and cards.
// Every change is checked first (syntax blocks, type problems warn) and recorded as a Git
// commit, preceded by a snapshot of any uncommitted state so nothing is ever unrecoverable.
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpProtocol, McpToolResult } from './mcp-protocol';
import { isValidScriptName, missingScriptMessage, resolveScript, type ScriptDirs } from './mcp-script-files';
import { checkScript, checkSyntax, formatIssues } from './mcp-script-check';
import { isSensitiveName, maskSecrets } from './mcp-secret-filter';
import { applyEdits, type TextEdit } from './mcp-edits';
import ScriptHeaderParser from './script-header-parser';
import { cardBase, cardFilePath, hasBlock, mainCardName, stripBlocks, writeCardFile } from './card-files';
import { appendNotes, MAX_NOTES_CHARS, readNotes, writeNotes } from './script-notes';
import type { WorkerManagerInstance } from './script-list';
import type CardManager from './card-manager';
import type DependencyManager from './dependency-manager';
import type GitManager from './git-manager';
import type StoreManager from './store-manager';

export interface McpWriteToolDeps extends ScriptDirs {
  workerManager: WorkerManagerInstance;
  cardManager: CardManager;
  depManager: DependencyManager;
  gitManager: GitManager;
  storeManager: StoreManager;
  /** Directory of the per-script notes (see script-notes.ts). */
  notesDir: string;
  /** Directory of the card source files (see card-files.ts). */
  cardsDir: string;
  /** STORAGE_DIR (ha-api.d.ts and the generated entity/service typings live here). */
  storageDir: string;
  typesDir: string;
  notifyStatusUpdate: () => void;
  /** Tells open editors that a file changed on disk behind their back. */
  notifyContentChanged: (filename: string) => void;
}

const MAX_SOURCE_CHARS = 512_000;
const CARD_BLOCK = /\/\* __JSA_CARD__[\s\S]*?__JSA_CARD_END__ \*\//;
// Placeholder read_script leaves where the Base64 card block was; must not be written back.
const CARD_PLACEHOLDER =
  /^\/\* card source: (?:see the "Card source" section below|not included here[^\n]*?) \*\/\r?\n?/m;
const NEW_FILE_NAME = /^[a-z0-9_]+\.(js|ts)$/;

const CARD_RELOAD_HINT =
  'Frontend: the card is installed or updated when the script runs (restart_script). Dashboards that are already open ' +
  'keep the old card until the browser tab is hard-reloaded (Ctrl+F5); a brand-new card is unknown to Lovelace until then.';
const MAX_COMMIT_SUBJECT = 120;
const COMMIT_MESSAGE_HINT = `Short description for the Git commit (up to ${MAX_COMMIT_SUBJECT} characters; longer text is cut)`;
// Cut instead of rejecting: a validation error would only surface after the whole source was sent.
const commitSubject = (message: unknown, fallback: string): string =>
  `mcp: ${(message ? String(message) : fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_COMMIT_SUBJECT)}`;

const text = (content: string): McpToolResult => ({ content });
const fail = (message: string): McpToolResult => ({ content: message, isError: true });

export function registerWriteTools(protocol: McpProtocol, deps: McpWriteToolDeps): void {
  const { workerManager, cardManager, depManager, gitManager, storeManager } = deps;

  /**
   * Store entries a script left behind (its persisted config and state; the store records the script's display
   * name as owner). Deleting a script never deletes them, and an assistant cannot either — so say what remains,
   * and where a credential-like field is still filled in, without ever showing a value.
   */
  const leftoverStoreNotice = (displayName: string): string => {
    const owned = Object.entries(storeManager.getAllPublic()).filter(([, entry]) => entry.owner === displayName);
    if (!owned.length) return '';
    const describe = ([key, entry]: (typeof owned)[number]): string => {
      if (entry.isSecret) return `${key} (secret)`;
      const value = entry.value;
      const filled: string[] = [];
      if (isSensitiveName(key) && typeof value === 'string' && value !== '') filled.push(key);
      if (value && typeof value === 'object') {
        for (const [field, v] of Object.entries(value)) {
          if (isSensitiveName(field) && typeof v === 'string' && v !== '') filled.push(field);
        }
      }
      return filled.length ? `${key} (credential-like field filled in: ${filled.join(', ')})` : key;
    };
    const shown = owned.slice(0, 10).map(describe).join('; ');
    return (
      `\nStore entries of this script remain (its saved config/state): ${shown}${owned.length > 10 ? '; …' : ''}. ` +
      'Deleting a script does not delete them and assistants cannot either — the user can remove them in the Store Explorer.'
    );
  };

  // Git and file writes of concurrent MCP calls must not interleave (index.lock, torn reads).
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const rel = (fullPath: string): string => path.relative(deps.scriptsDir, fullPath).split(path.sep).join('/');

  const NO_COMMIT = 'git: nothing to commit';

  /**
   * Safety commit of local edits that were not in Git yet, taken before an MCP change overwrites the file.
   * Returns null when there was nothing to save (the usual case), so the result does not mention it at all.
   */
  const snapshotNote = async (fullPath: string, message: string): Promise<string | null> => {
    const r = await commitFile(fullPath, message);
    return r === NO_COMMIT ? null : `saved earlier uncommitted edits first: ${r}`;
  };

  /** Commits just this file; never throws (a Git problem must not undo or block the change). */
  const commitFile = async (fullPath: string, message: string, includeDeletions = false): Promise<string> => {
    try {
      const r = await gitManager.commit(message, { paths: [rel(fullPath)], includeDeletions });
      return r.hash ? `git commit ${r.hash}` : NO_COMMIT;
    } catch (e) {
      return `git commit FAILED (${(e as Error).message}) — the change itself was applied`;
    }
  };

  const writeAtomic = (fullPath: string, content: string): void => {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const tmp = `${fullPath}.mcp-tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, fullPath);
  };

  const runningNote = (filename: string): string =>
    workerManager.workers.has(filename)
      ? `\n"${filename}" is running with the previous version — call restart_script to apply the change.`
      : '';

  /** Shared by write_script and edit_script: checks, snapshot, atomic write, commit, warnings. */
  const writeScriptCore = async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const filename = String(args.filename ?? '');
    let content = String(args.content ?? '');
    if (!isValidScriptName(filename)) {
      return fail(
        'Invalid file name. Use a plain ".js" or ".ts" name (optionally prefixed "libraries/"); Blockly files are not supported.'
      );
    }
    if (content.length > MAX_SOURCE_CHARS) return fail(`Source is too large (limit ${MAX_SOURCE_CHARS} characters).`);
    if (content.includes('__JSA_CARD__')) {
      return fail('The source must not contain a __JSA_CARD__ block. Use write_card to change the Lovelace card.');
    }
    content = content.replace(CARD_PLACEHOLDER, '');

    const existing = resolveScript(deps, filename);
    let fullPath: string;
    let isLibrary: boolean;
    if (existing) {
      fullPath = existing.fullPath;
      isLibrary = existing.isLibrary;
    } else {
      const bare = filename.replace(/^libraries[/\\]/, '');
      if (!NEW_FILE_NAME.test(bare)) {
        return fail(
          'New file names may only contain lowercase letters, digits and underscores, e.g. "garage_watch.ts".'
        );
      }
      isLibrary = /^libraries[/\\]/.test(filename) || args.kind === 'library';
      const dir = isLibrary ? deps.librariesDir : deps.scriptsDir;
      const otherExt = bare.endsWith('.ts') ? bare.replace(/\.ts$/, '.js') : bare.replace(/\.js$/, '.ts');
      if (fs.existsSync(path.join(dir, otherExt))) {
        return fail(
          `"${otherExt}" already exists. A script exists only once per name; a .ts file would hide the .js file. Pick another name.`
        );
      }
      fullPath = path.join(dir, bare);
    }
    const name = path.basename(fullPath);

    const check = checkScript(content, name, {
      storageDir: deps.storageDir,
      typesDir: deps.typesDir,
      targetDir: path.dirname(fullPath),
    });
    if (check.syntaxErrors.length) {
      return fail(
        `Not written — syntax errors:\n${formatIssues(check.syntaxErrors)}\nFix them and call write_script again.`
      );
    }

    // Keep the existing card: read_script strips the Base64 block, so the new source has none.
    let previous: string | null = null;
    if (existing) {
      previous = fs.readFileSync(fullPath, 'utf8');
      const card = CARD_BLOCK.exec(previous);
      if (card) content = `${content.trimEnd()}\n\n${card[0]}\n`;
    }

    const verb = existing ? 'update' : 'create';
    const commitMessage = commitSubject(args.message, `${verb} ${name}`);
    const notes: string[] = [];
    if (existing) {
      const snap = await snapshotNote(fullPath, `mcp: snapshot before changing ${name}`);
      if (snap) notes.push(snap);
    }
    writeAtomic(fullPath, content);
    notes.push(await commitFile(fullPath, commitMessage));
    deps.notifyStatusUpdate();
    deps.notifyContentChanged(name);

    const lines = [
      `${existing ? 'Updated' : 'Created'} ${isLibrary ? 'library' : 'script'} "${name}" (${content.length} characters).`,
    ];
    if (previous !== null && previous === content) lines.push('The content is identical to the previous version.');
    if (check.typeIssues.length) {
      lines.push(
        `Type warnings (${check.typeIssues.length}) — the file was written anyway. Fix every warning that points to a real mistake with another write_script call before you report the script as done, and tell the user about any you leave on purpose:\n${formatIssues(check.typeIssues)}\n` +
          'If a warning is about the payload of ha.call(), the typed payload of every service is in get_api_reference topic "services" (search "domain.service", e.g. "media_player.play_media").'
      );
    } else if (name.endsWith('.ts')) {
      lines.push('Type check: no problems found.');
    }
    const credentialHits = maskSecrets(content.replace(CARD_BLOCK, '')).masked;
    if (credentialHits) {
      lines.push(
        `WARNING: ${credentialHits} value(s) in the source look like credentials. Do not keep credentials in source code: ` +
          "declare them as empty fields of the persisted config (e.g. apiKey: '' in DEFAULT_CONFIG via ha.persistent), warn while they are " +
          'empty and tell the user to fill them in with the Store Explorer. Then rewrite the script.'
      );
    }
    lines.push(notes.join('; '));
    lines.push(
      'If this change involved decisions, device quirks or open points that the source does not show, record them with save_script_notes (if available).'
    );
    const text_ = lines.join('\n') + runningNote(name);
    return text(text_ + (isLibrary ? '\nScripts that @include this library need a restart to pick it up.' : ''));
  };

  protocol.registerTool({
    name: 'write_script',
    title: 'Write script',
    description:
      'Creates or replaces a script or library with the complete new source. ALWAYS read the authoring guide first ' +
      '(get_api_reference topic "authoring") and read_script the file before changing it. Core rules: entity IDs, thresholds, ' +
      'times and texts go into one typed `const CONFIG` in the source (not the store); values that must survive a restart go ' +
      'into ONE ha.persistent object per script (key "<script>_state"), never one store key per value; credentials never go ' +
      'into the source (empty fields in the store, with a warning while empty). The source is syntax-checked ' +
      '(errors block the write) and type-checked (TypeScript only; problems are returned as warnings). Every change is ' +
      'committed to Git, so it can be undone. The Lovelace card of an existing script is preserved (use write_card to change ' +
      'it). Does not start or restart the script. New file names: lowercase letters, digits and underscores, ".js" or ".ts"; ' +
      'prefix "libraries/" or set kind "library" for a library.',
    inputSchema: {
      filename: z.string().describe('e.g. "garage_watch.ts" or "libraries/helpers.ts"'),
      content: z.string().describe('The complete file content, starting with the JSDoc header'),
      kind: z.enum(['script', 'library']).optional().describe('Only for new files; default "script"'),
      message: z.string().optional().describe(COMMIT_MESSAGE_HINT),
    },
    handler: (args) => serialized(() => writeScriptCore(args)),
  });

  /** Shared by write_card and edit_card. */
  const writeCardCore = async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const filename = String(args.filename ?? '');
    const source = String(args.source ?? '');
    const found = resolveScript(deps, filename);
    if (!found)
      return fail(missingScriptMessage(filename, `No script named "${filename}". Create it with write_script first.`));
    if (found.isLibrary) return fail('Libraries cannot have a card.');
    if (!source.trim()) return fail('The card source is empty.');
    if (source.includes('__JSA_CARD') || source.length > MAX_SOURCE_CHARS) {
      return fail('Invalid card source (contains a __JSA_CARD marker or is too large).');
    }
    const syntax = checkSyntax(source, 'card.js');
    if (syntax.length) return fail(`Not written — syntax errors in the card:\n${formatIssues(syntax)}`);

    const name = path.basename(found.fullPath);
    const base = cardBase(name);
    const card = args.card ? String(args.card) : undefined;
    const isMain = !card || card === mainCardName(base);
    if (!cardFilePath(deps.cardsDir, base, card)) {
      return fail(
        `Invalid card name "${card}". Use lowercase letters, digits, underscores and hyphens, starting with "${base}-" (e.g. "${base}-day-card"); omit "card" for the main card.`
      );
    }

    const notes: string[] = [];
    const snap = await snapshotNote(found.fullPath, `mcp: snapshot before changing card of ${name}`);
    if (snap) notes.push(snap);
    writeCardFile(deps.cardsDir, base, card, source);
    // An old embedded block moves out of the script with the first card save (the card file wins anyway).
    const script = fs.readFileSync(found.fullPath, 'utf8');
    if (isMain && hasBlock(script)) writeAtomic(found.fullPath, `${stripBlocks(script).trimEnd()}\n`);
    notes.push(await commitFile(found.fullPath, commitSubject(args.message, `update card of ${name}`)));
    deps.notifyStatusUpdate();
    deps.notifyContentChanged(name);

    const meta = ScriptHeaderParser.parse(found.fullPath) as { card?: boolean | string | null };
    const lines = [`Card "${card ?? mainCardName(base)}" of "${name}" saved (${source.length} characters).`];
    if (!isMain)
      lines.push('This is not the main card: it is stored but not installed yet (only the main card is installed).');
    else if (!meta.card)
      lines.push('Note: the header has no "@card" tag yet — add it with write_script so the card gets installed.');
    else if (meta.card === 'dev')
      lines.push('The header says "@card dev": the card is preview-only until you switch it to plain "@card".');
    lines.push(notes.join('; '));
    lines.push(CARD_RELOAD_HINT);
    return text(lines.join('\n') + runningNote(name));
  };

  protocol.registerTool({
    name: 'write_card',
    title: 'Write card',
    description:
      'Sets a Lovelace card of an existing script (a plain Web Component, see the "cards" topic of get_api_reference). ' +
      'Pass the card as plain JavaScript; it is stored as its own file cards/<script>-card.js. Without "card" the main ' +
      'card is written; "card" names a further card of the script and must start with "<script>-" (e.g. ' +
      '"garmin-day-card" for garmin.ts) — only the main card is installed for now, further ones are just stored. The ' +
      'script header needs "@card" (or "@card dev") for the card to be installed. Committed to Git like write_script.',
    inputSchema: {
      filename: z.string().describe('The script that owns the card, e.g. "smart_watering.ts"'),
      source: z.string().describe('Card source as plain JavaScript'),
      card: z
        .string()
        .optional()
        .describe('Name of a further card, e.g. "garmin-day-card"; omit for the main card of the script'),
      message: z.string().optional().describe(COMMIT_MESSAGE_HINT),
    },
    handler: (args) => serialized(() => writeCardCore(args)),
  });

  const EDITS_SCHEMA = z
    .array(
      z.object({
        old_string: z.string().describe('Exact text to replace; must match once (or set replace_all)'),
        new_string: z.string().describe('The replacement text'),
        replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match'),
      })
    )
    .min(1)
    .max(50)
    .describe('Edits applied in order; each sees the result of the previous one. All or nothing');
  const EDIT_RULES =
    'old_string must match the file exactly once, including indentation and line breaks: include enough surrounding ' +
    'lines to make it unique, or set replace_all. If any edit cannot be applied, nothing is changed.';

  const withEditNote = (r: McpToolResult, edited: { replacements: number }): McpToolResult =>
    r.isError || typeof r.content !== 'string'
      ? r
      : { ...r, content: `Applied ${edited.replacements} replacement(s).\n${r.content}` };

  protocol.registerTool({
    name: 'edit_script',
    title: 'Edit script',
    description:
      'Changes an existing script or library by search and replace, so you do not have to resend the whole source for ' +
      'a small change. read_script the file first (use offset/limit for a part). ' +
      EDIT_RULES +
      ' The result is checked, committed to Git and reported exactly like write_script (syntax errors block, type ' +
      'problems warn); the script is not restarted. The Lovelace card is not part of the text: use edit_card.',
    inputSchema: {
      filename: z.string().describe('File name as shown by list_scripts, e.g. "smart_watering.ts"'),
      edits: EDITS_SCHEMA,
      message: z.string().optional().describe(COMMIT_MESSAGE_HINT),
    },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        const found = resolveScript(deps, filename);
        if (!found) {
          return fail(
            missingScriptMessage(
              filename,
              `No script or library named "${filename}". Use write_script to create it, or list_scripts to see the files.`
            )
          );
        }
        // An old embedded card block is not part of the text being edited; writeScriptCore keeps it.
        const current = fs.readFileSync(found.fullPath, 'utf8').replace(CARD_BLOCK, '');
        const result = applyEdits(current, args.edits as TextEdit[]);
        if (!result.ok) return fail(`Not changed — ${result.error}`);
        const written = await writeScriptCore({
          filename: found.isLibrary ? `libraries/${path.basename(found.fullPath)}` : path.basename(found.fullPath),
          content: result.text,
          message: args.message,
        });
        return withEditNote(written, result);
      }),
  });

  protocol.registerTool({
    name: 'edit_card',
    title: 'Edit card',
    description:
      'Changes a Lovelace card of an existing script by search and replace, so you do not have to resend the whole card ' +
      '(often tens of thousands of characters). read_script with part "card" shows it. ' +
      EDIT_RULES +
      ' The result is syntax-checked and committed like write_card; "card" names a further card, default is the main card.',
    inputSchema: {
      filename: z.string().describe('The script that owns the card, e.g. "smart_watering.ts"'),
      edits: EDITS_SCHEMA,
      card: z.string().optional().describe('Name of a further card, e.g. "garmin-day-card"; omit for the main card'),
      message: z.string().optional().describe(COMMIT_MESSAGE_HINT),
    },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        const found = resolveScript(deps, filename);
        if (!found) {
          return fail(
            missingScriptMessage(filename, `No script named "${filename}". Use list_scripts to see the files.`)
          );
        }
        if (found.isLibrary) return fail('Libraries cannot have a card.');
        const base = cardBase(found.fullPath);
        const card = args.card && String(args.card) !== mainCardName(base) ? String(args.card) : undefined;
        if (!cardFilePath(deps.cardsDir, base, card)) {
          return fail(
            `Invalid card name "${args.card}". It must start with "${base}-" (e.g. "${base}-day-card"); omit "card" for the main card.`
          );
        }
        const current = cardManager.getCardSource(found.fullPath, card);
        if (current === null || current === undefined) {
          return fail(
            `"${filename}" has no ${card ? `card "${card}"` : 'card'} yet. Create it with write_card first (list_scripts shows the existing cards).`
          );
        }
        const result = applyEdits(current, args.edits as TextEdit[]);
        if (!result.ok) return fail(`Not changed — ${result.error}`);
        const written = await writeCardCore({
          filename,
          source: result.text,
          card,
          message: args.message,
        });
        return withEditNote(written, result);
      }),
  });

  protocol.registerTool({
    name: 'save_script_notes',
    title: 'Save script notes',
    description:
      'Saves notes about a script or library so a later session (or a new chat) can pick up where this one stopped. Write what ' +
      'is not obvious from the source: decisions and their reasons, entity/device quirks, what was tested live and what not, ' +
      'open points. Short Markdown, no source code copies, never credentials. mode "append" (default) adds a section; ' +
      '"replace" rewrites everything (read get_script_notes first and keep what is still true); empty content with "replace" ' +
      'deletes the notes. Notes are included in backups.',
    inputSchema: {
      filename: z.string().describe('File name as shown by list_scripts, e.g. "smart_watering.ts"'),
      content: z.string().describe('The notes (Markdown)'),
      mode: z.enum(['append', 'replace']).optional().describe('Default "append"'),
    },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        const content = String(args.content ?? '');
        const replace = args.mode === 'replace';
        const found = resolveScript(deps, filename);
        if (!found) return fail(missingScriptMessage(filename, `No script or library named "${filename}".`));
        if (!replace && !content.trim()) return fail('The note is empty.');
        if (maskSecrets(content).masked) {
          return fail('Not saved — the text contains values that look like credentials. Remove them and save again.');
        }
        const name = path.basename(found.fullPath);
        const current = readNotes(deps.notesDir, found.fullPath, found.isLibrary) ?? '';
        const total = replace ? content.trim().length : current.length + content.trim().length;
        if (total > MAX_NOTES_CHARS) {
          return fail(
            `Not saved — the notes would exceed ${MAX_NOTES_CHARS} characters. Use mode "replace" with a condensed version.`
          );
        }
        const deleting = replace && !content.trim();
        if (replace) writeNotes(deps.notesDir, found.fullPath, found.isLibrary, content);
        else appendNotes(deps.notesDir, found.fullPath, found.isLibrary, content);
        deps.notifyStatusUpdate();
        return text(
          deleting
            ? `Notes of "${name}" deleted.`
            : `Notes of "${name}" ${replace ? 'replaced' : 'extended'} (${total} characters).`
        );
      }),
  });

  protocol.registerTool({
    name: 'delete_script',
    title: 'Delete script',
    description:
      'Deletes a script or library: stops it, removes the file, its card and its webhook registrations. The last state and ' +
      'the deletion are committed to Git, so it can be restored from the version history. Its Store entries (saved config, ' +
      'possibly credentials) are NOT deleted — the result lists them so the user can remove them in the Store Explorer.',
    inputSchema: { filename: z.string().describe('File name as shown by list_scripts') },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        const found = resolveScript(deps, filename);
        if (!found) return fail(missingScriptMessage(filename, `No script or library named "${filename}".`));
        const name = path.basename(found.fullPath);
        const displayName = (ScriptHeaderParser.parse(found.fullPath) as { name?: string | null }).name || name;

        const notes: string[] = [];
        const snap = await snapshotNote(found.fullPath, `mcp: snapshot before deleting ${name}`);
        if (snap) notes.push(snap);
        workerManager.stopScript(name, 'deleted');
        fs.unlinkSync(found.fullPath);
        workerManager.purgeWebhooksForScript(name);
        if (!found.isLibrary) cardManager.removeCard(found.fullPath);
        await depManager.prune();
        notes.push(await commitFile(found.fullPath, `mcp: delete ${name}`, true));
        deps.notifyStatusUpdate();
        deps.notifyContentChanged(name);
        return text(
          `Deleted ${found.isLibrary ? 'library' : 'script'} "${name}". ${notes.join('; ')}\nIt can be restored from the version history (Git) in the UI.` +
            (found.isLibrary ? '' : leftoverStoreNotice(displayName))
        );
      }),
  });
}
