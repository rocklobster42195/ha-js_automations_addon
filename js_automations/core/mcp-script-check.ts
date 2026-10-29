// core/mcp-script-check.ts
// Pre-write validation for scripts an AI client sends over MCP.
//  - Syntax errors are reliable and block the write.
//  - Type problems (TypeScript only, against ha-api.d.ts and the generated entity/service typings)
//    are best-effort: they are reported as warnings, never block, because a missing Node typing
//    or an exotic construct can produce false positives.
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface CheckIssue {
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface CheckResult {
  syntaxErrors: CheckIssue[];
  typeIssues: CheckIssue[];
}

export interface CheckOptions {
  /** Where ha-api.d.ts, entities.d.ts and services.d.ts live (STORAGE_DIR). */
  storageDir: string;
  /** Fallback location of the static ha-api.d.ts when it was not copied to storage yet. */
  typesDir: string;
  /** Directory the file will live in; used to resolve relative imports. */
  targetDir: string;
}

const MAX_ISSUES = 15;

// Names the add-on provides at runtime but that are not declared when no Node typings are loaded.
const NODE_GLOBALS =
  /'(process|require|module|exports|__dirname|__filename|Buffer|global|crypto)'|type definitions for node/;

function toIssue(d: ts.Diagnostic): CheckIssue {
  let line = 0;
  let col = 0;
  if (d.file && d.start !== undefined) {
    const pos = ts.getLineAndCharacterOfPosition(d.file, d.start);
    line = pos.line + 1;
    col = pos.character + 1;
  }
  return { line, col, code: `TS${d.code}`, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
}

export function checkSyntax(source: string, filename: string): CheckIssue[] {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, allowJs: true },
    fileName: filename,
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).map(toIssue);
}

export function checkTypes(source: string, filename: string, opts: CheckOptions): CheckIssue[] {
  const virtualPath = path.join(opts.targetDir, filename);
  // The bundled ha-api.d.ts is always current. The copy in the storage folder is created once and never
  // refreshed, so it is only a fallback. It is mapped to the storage path, where its triple-slash references
  // to the generated entities.d.ts / services.d.ts resolve; missing generated files get empty stand-ins.
  const apiPath = path.join(opts.storageDir, 'ha-api.d.ts');
  const read = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const apiSource = read(path.join(opts.typesDir, 'ha-api.d.ts')) ?? read(apiPath);
  if (apiSource === null) return [];
  const virtualFiles = new Map<string, string>([
    [path.resolve(virtualPath), source],
    [path.resolve(apiPath), apiSource],
  ]);
  const standIns: Record<string, string> = {
    'entities.d.ts': 'interface HAEntities {}\ninterface GlobalStoreSchema {}\n',
    'services.d.ts': 'interface ServiceMap {}\n',
  };
  const roots = [virtualPath, apiPath];
  for (const [file, standIn] of Object.entries(standIns)) {
    const p = path.join(opts.storageDir, file);
    if (!fs.existsSync(p)) virtualFiles.set(path.resolve(p), standIn);
    roots.push(p);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const virtualSource = (f: string): string | undefined => virtualFiles.get(path.resolve(f));
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, languageVersion, ...rest) => {
    const text = virtualSource(f);
    return text !== undefined
      ? ts.createSourceFile(f, text, languageVersion, true)
      : baseGetSourceFile(f, languageVersion, ...rest);
  };
  const baseFileExists = host.fileExists.bind(host);
  host.fileExists = (f) => virtualSource(f) !== undefined || baseFileExists(f);
  const baseReadFile = host.readFile.bind(host);
  host.readFile = (f) => virtualSource(f) ?? baseReadFile(f);

  const program = ts.createProgram(roots, options, host);
  const sourceFile = program.getSourceFile(virtualPath);
  if (!sourceFile) return [];
  return program
    .getSemanticDiagnostics(sourceFile)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map(toIssue)
    .filter((i) => !NODE_GLOBALS.test(i.message));
}

export function checkScript(source: string, filename: string, opts: CheckOptions): CheckResult {
  const syntaxErrors = checkSyntax(source, filename).slice(0, MAX_ISSUES);
  if (syntaxErrors.length || !filename.endsWith('.ts')) return { syntaxErrors, typeIssues: [] };
  let typeIssues: CheckIssue[] = [];
  try {
    typeIssues = checkTypes(source, filename, opts).slice(0, MAX_ISSUES);
  } catch {
    // Type checking is a best-effort extra; a failure inside it must never block a write.
  }
  return { syntaxErrors, typeIssues };
}

export function formatIssues(issues: CheckIssue[]): string {
  return issues.map((i) => `  line ${i.line}:${i.col} ${i.code}: ${i.message}`).join('\n');
}
