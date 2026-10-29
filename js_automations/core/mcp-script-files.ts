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

/** Error text for a name that did not resolve: tells an invalid name (path parts, odd extension) from a missing file. */
export function missingScriptMessage(filename: string, fallback: string): string {
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
