/**
 * JS AUTOMATIONS - Compiler Manager (v1.0.0)
 * Handles TypeScript transpilation.
 */
const ts = require('typescript');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class CompilerManager extends EventEmitter {
    constructor(scriptsDir, distDir, storageDir) {
        super();
        this.scriptsDir = scriptsDir;
        this.distDir = distDir;
        this.storageDir = storageDir;
        this.tsconfigPath = path.join(this.storageDir, 'tsconfig.json');
        
        this.options = {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            outDir: this.distDir,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            sourceMap: true,
            inlineSourceMap: true,
            inlineSources: true,
            baseUrl: this.scriptsDir
        };
    }

    /**
     * Ensures a basic tsconfig.json exists for the IDE/Monaco.
     */
    ensureTsConfig() {
        // 1. Ensure ha-api.d.ts is present in storage for the compiler
        const sourceApi = path.join(__dirname, 'types', 'ha-api.d.ts');
        const targetApi = path.join(this.storageDir, 'ha-api.d.ts');
        if (fs.existsSync(sourceApi) && !fs.existsSync(targetApi)) {
            fs.copyFileSync(sourceApi, targetApi);
        }

        // 2. Create/Update tsconfig.json
        if (!fs.existsSync(this.tsconfigPath)) {
            const config = {
                compilerOptions: {
                    ...this.options,
                    target: "ES2020",
                    module: "CommonJS",
                    moduleResolution: "node",
                    sourceMap: true,
                    inlineSourceMap: true,
                    inlineSources: true,
                    outDir: "./dist",
                    baseUrl: "../",
                    typeRoots: ["./node_modules/@types"],
                    paths: {
                        "*": ["node_modules/*"]
                    }
                },
                include: ["../**/*.ts", "./*.d.ts"],
                exclude: ["node_modules"]
            };
            fs.writeFileSync(this.tsconfigPath, JSON.stringify(config, null, 2));
        }
    }

    /**
     * Removes all .js files in the dist folder that don't have a corresponding .ts source file.
     */
    async pruneDist() {
        const scanAndPrune = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanAndPrune(fullPath);
                    if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
                } else if (entry.name.endsWith('.js')) {
                    const relativePath = path.relative(this.distDir, fullPath);
                    const sourcePath = path.join(this.scriptsDir, relativePath.replace(/\.js$/, '.ts'));
                    
                    if (!fs.existsSync(sourcePath)) {
                        fs.unlinkSync(fullPath);
                        this.emit('log', { level: 'debug', message: `Deleted orphaned compiled file: ${relativePath}` });
                    }
                }
            }
        };
        try {
            scanAndPrune(this.distDir);
        } catch (e) {
            this.emit('log', { level: 'error', message: `Failed to prune dist directory: ${e.message}` });
        }
    }

    /**
     * Transpiles a single TypeScript file to JavaScript in the dist folder.
     * @param {string} sourcePath Absolute path to the .ts file.
     */
    async transpile(sourcePath) {
        if (!sourcePath.endsWith('.ts')) return;

        this.emit('log', { level: 'debug', message: `Transpiling ${path.basename(sourcePath)}...` });

        const relativePath = path.relative(this.scriptsDir, sourcePath);
        const targetPath = path.join(this.distDir, relativePath.replace(/\.ts$/, '.js'));

        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        try {
            const sourceCode = fs.readFileSync(sourcePath, 'utf8');
            const result = ts.transpileModule(sourceCode, {
                compilerOptions: this.options,
                fileName: sourcePath
            });

            const diagnostics = result.diagnostics || [];
            const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);

            if (diagnostics.length > 0) {
                diagnostics.forEach(d => {
                    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
                    let line = 0, col = 0;
                    if (d.file && d.start !== undefined) {
                        const pos = ts.getLineAndCharacterOfPosition(d.file, d.start);
                        line = pos.line + 1;
                        col = pos.character + 1;
                    }
                    // Mapping der TS-Kategorien auf interne Typen und Log-Level
                    const isError = d.category === ts.DiagnosticCategory.Error;
                    const isWarning = d.category === ts.DiagnosticCategory.Warning;
                    
                    const type = isError ? 'TS_ERR' : (isWarning ? 'TS_WARN' : 'TS_INFO');
                    
                    const logMapping = {
                        [ts.DiagnosticCategory.Error]: 'error',
                        [ts.DiagnosticCategory.Warning]: 'warn',
                        [ts.DiagnosticCategory.Message]: 'info',
                        [ts.DiagnosticCategory.Suggestion]: 'debug'
                    };
                    const level = logMapping[d.category] || 'info';
                    
                    // Send protocol signal for Monaco markers
                    this.emit('compiler_signal', { type, filename: path.basename(sourcePath), line, col, code: `TS${d.code}`, text: message });
                    
                    // Human-readable Log mit Dateinamen für bessere Zuordnung im System-Log
                    this.emit('log', { level, message: `[${path.basename(sourcePath)}] TypeScript ${type.replace('TS_', '')}: ${message} (Line ${line})` });
                });

                if (errors.length > 0) return false;
            }

            fs.writeFileSync(targetPath, result.outputText);
            
            // Send success signal to clear markers
            this.emit('compiler_signal', { type: 'TS_OK', filename: path.basename(sourcePath) });
            return true;
        } catch (e) {
            this.emit('log', { level: 'error', message: `Transpilation failed for ${path.basename(sourcePath)}: ${e.message}` });
            return false;
        }
    }

    /**
     * Removes the compiled JS file when a TS file is deleted.
     */
    cleanup(sourcePath) {
        const relativePath = path.relative(this.scriptsDir, sourcePath);
        const targetPath = path.join(this.distDir, relativePath.replace(/\.ts$/, '.js'));
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }
    }
}

module.exports = CompilerManager;