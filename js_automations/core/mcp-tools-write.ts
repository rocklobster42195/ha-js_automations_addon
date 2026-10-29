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
import ScriptHeaderParser from './script-header-parser';
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
const CARD_PLACEHOLDER = /^\/\* card source: see the "Card source" section below \*\/\r?\n?/m;
const NEW_FILE_NAME = /^[a-z0-9_]+\.(js|ts)$/;

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

  /** Commits just this file; never throws (a Git problem must not undo or block the change). */
  const commitFile = async (fullPath: string, message: string, includeDeletions = false): Promise<string> => {
    try {
      const r = await gitManager.commit(message, { paths: [rel(fullPath)], includeDeletions });
      return r.hash ? `git commit ${r.hash}` : 'git: no commit needed (file is unchanged since the last commit)';
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

  protocol.registerTool({
    name: 'write_script',
    title: 'Write script',
    description:
      'Creates or replaces a script or library with the complete new source. Read the authoring guide first ' +
      '(get_api_reference topic "authoring") and read_script the file before changing it. The source is syntax-checked ' +
      '(errors block the write) and type-checked (TypeScript only; problems are returned as warnings). Every change is ' +
      'committed to Git, so it can be undone. The Lovelace card of an existing script is preserved (use write_card to change ' +
      'it). Does not start or restart the script. New file names: lowercase letters, digits and underscores, ".js" or ".ts"; ' +
      'prefix "libraries/" or set kind "library" for a library.',
    inputSchema: {
      filename: z.string().describe('e.g. "garage_watch.ts" or "libraries/helpers.ts"'),
      content: z.string().describe('The complete file content, starting with the JSDoc header'),
      kind: z.enum(['script', 'library']).optional().describe('Only for new files; default "script"'),
      message: z.string().max(120).optional().describe('Short description for the Git commit'),
    },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        let content = String(args.content ?? '');
        if (!isValidScriptName(filename)) {
          return fail(
            'Invalid file name. Use a plain ".js" or ".ts" name (optionally prefixed "libraries/"); Blockly files are not supported.'
          );
        }
        if (content.length > MAX_SOURCE_CHARS)
          return fail(`Source is too large (limit ${MAX_SOURCE_CHARS} characters).`);
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
        const commitMessage = `mcp: ${args.message ? String(args.message) : `${verb} ${name}`}`;
        const notes: string[] = [];
        if (existing) notes.push(`snapshot: ${await commitFile(fullPath, `mcp: snapshot before changing ${name}`)}`);
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
            `Type warnings (${check.typeIssues.length}) — the file was written anyway; fix them if they are real:\n${formatIssues(check.typeIssues)}`
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
        const text_ = lines.join('\n') + runningNote(name);
        return text(text_ + (isLibrary ? '\nScripts that @include this library need a restart to pick it up.' : ''));
      }),
  });

  protocol.registerTool({
    name: 'write_card',
    title: 'Write card',
    description:
      'Sets the Lovelace card of an existing script (a plain Web Component, see the "cards" topic of get_api_reference). ' +
      'Pass the card as plain JavaScript; JSA encodes and embeds it. The script header needs "@card" (or "@card dev") for ' +
      'the card to be installed. Committed to Git like write_script.',
    inputSchema: {
      filename: z.string().describe('The script that owns the card, e.g. "smart_watering.ts"'),
      source: z.string().describe('Card source as plain JavaScript'),
      message: z.string().max(120).optional().describe('Short description for the Git commit'),
    },
    handler: (args) =>
      serialized(async () => {
        const filename = String(args.filename ?? '');
        const source = String(args.source ?? '');
        const found = resolveScript(deps, filename);
        if (!found)
          return fail(
            missingScriptMessage(filename, `No script named "${filename}". Create it with write_script first.`)
          );
        if (found.isLibrary) return fail('Libraries cannot have a card.');
        if (!source.trim()) return fail('The card source is empty.');
        if (source.includes('__JSA_CARD') || source.length > MAX_SOURCE_CHARS) {
          return fail('Invalid card source (contains a __JSA_CARD marker or is too large).');
        }
        const syntax = checkSyntax(source, 'card.js');
        if (syntax.length) return fail(`Not written — syntax errors in the card:\n${formatIssues(syntax)}`);

        const name = path.basename(found.fullPath);
        const script = fs.readFileSync(found.fullPath, 'utf8');
        const block = `/* __JSA_CARD__\n${Buffer.from(source, 'utf8').toString('base64')}\n__JSA_CARD_END__ */`;
        const next = CARD_BLOCK.test(script)
          ? script.replace(CARD_BLOCK, () => block)
          : `${script.trimEnd()}\n\n${block}\n`;

        const notes = [
          `snapshot: ${await commitFile(found.fullPath, `mcp: snapshot before changing card of ${name}`)}`,
        ];
        writeAtomic(found.fullPath, next);
        notes.push(
          await commitFile(found.fullPath, `mcp: ${args.message ? String(args.message) : `update card of ${name}`}`)
        );
        deps.notifyStatusUpdate();
        deps.notifyContentChanged(name);

        const meta = ScriptHeaderParser.parse(found.fullPath) as { card?: boolean | string | null };
        const lines = [`Card of "${name}" updated.`];
        if (!meta.card)
          lines.push('Note: the header has no "@card" tag yet — add it with write_script so the card gets installed.');
        else if (meta.card === 'dev')
          lines.push('The header says "@card dev": the card is preview-only until you switch it to plain "@card".');
        lines.push(notes.join('; '));
        return text(lines.join('\n') + runningNote(name));
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

        const notes = [`snapshot: ${await commitFile(found.fullPath, `mcp: snapshot before deleting ${name}`)}`];
        workerManager.stopScript(name, 'deleted');
        fs.unlinkSync(found.fullPath);
        workerManager.purgeWebhooksForScript(name);
        if (!found.isLibrary) cardManager.removeCard(found.fullPath);
        await depManager.prune();
        notes.push(await commitFile(found.fullPath, `mcp: delete ${name}`, true));
        deps.notifyStatusUpdate();
        return text(
          `Deleted ${found.isLibrary ? 'library' : 'script'} "${name}". ${notes.join('; ')}\nIt can be restored from the version history (Git) in the UI.` +
            (found.isLibrary ? '' : leftoverStoreNotice(displayName))
        );
      }),
  });
}
