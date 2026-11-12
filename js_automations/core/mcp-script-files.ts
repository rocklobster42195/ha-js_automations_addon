// core/mcp-script-files.ts
// Maps file names given by an MCP client to script/library paths. Shared by all tool groups.
import * as fs from 'fs';
import * as path from 'path';

export interface ScriptDirs {
  scriptsDir: string;
  librariesDir: string;
}

export interface ResolvedScript {
  fullPath: string;
  isLibrary: boolean;
}

/** True for a plain file name MCP may touch: .js/.ts without any path part (Blockly and .d.ts are excluded). */
export function isValidScriptName(name: string): boolean {
  const clean = name.replace(/^libraries[/\\]/, '');
  return path.basename(clean) === clean && /^[\w.\- ]+\.(js|ts)$/.test(clean) && !clean.endsWith('.d.ts');
}

/** The part of the proposal store the error texts need. */
export interface OpenProposalLookup {
  findOpen(kind: 'script', filename: string): { id: number } | undefined;
}

/** Text for a file that exists only as an open proposal (access level "propose"), so it is not on disk yet. */
export function pendingProposalMessage(filename: string, proposalId: number): string {
  return `"${filename}" exists only as an open proposal (#${proposalId}) and has not been applied yet, so it is not on disk and cannot run. The user has to apply the proposal in JSA first; read_script shows the proposed text.`;
}

/**
 * Error text for a name that did not resolve: tells an invalid name (path parts, odd extension) from a missing file,
 * and a file that is only proposed from one that does not exist at all.
 */
export function missingScriptMessage(filename: string, fallback: string, proposals?: OpenProposalLookup): string {
  const pending = isValidScriptName(filename) ? proposals?.findOpen('script', filename) : undefined;
  if (pending) return pendingProposalMessage(filename, pending.id);
  if (isValidScriptName(filename)) return fallback;
  return `Invalid file name "${filename}". Use a plain ".js" or ".ts" name without path parts, as shown by list_scripts (libraries: "libraries/name.ts").`;
}

/**
 * Resolves a script/library file name to its existing path. Only plain .js/.ts files directly
 * in the scripts or libraries folder are allowed. A "libraries/" prefix selects the library.
 */
export function resolveScript(dirs: ScriptDirs, filename: string): ResolvedScript | null {
  if (!isValidScriptName(filename)) return null;
  const clean = filename.replace(/^libraries[/\\]/, '');
  const inScripts = path.join(dirs.scriptsDir, clean);
  if (!/^libraries[/\\]/.test(filename) && fs.existsSync(inScripts)) return { fullPath: inScripts, isLibrary: false };
  const inLibs = path.join(dirs.librariesDir, clean);
  if (fs.existsSync(inLibs)) return { fullPath: inLibs, isLibrary: true };
  return null;
}
