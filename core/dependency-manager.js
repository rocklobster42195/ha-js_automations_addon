/**
 * JS AUTOMATIONS - Dependency Manager (v1.8.1)
 * Fix: Physical file check to bypass Node.js require cache
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const ScriptParser = require('./parser');

class DependencyManager extends EventEmitter {
    constructor(scriptsDir, storageDir) {
        super();
        this.scriptsDir = scriptsDir;
        this.storageDir = storageDir;
        this.packageJsonPath = path.join(this.storageDir, 'package.json');
    }

    ensurePackageJson() {
        if (!fs.existsSync(this.packageJsonPath)) {
            const minimalPkg = { name: "js-automations-runtime", version: "1.0.0", dependencies: {} };
            fs.writeFileSync(this.packageJsonPath, JSON.stringify(minimalPkg, null, 2));
        }
    }

    async install(packages, autoPrune = true, verbose = true) {
        const cleanPackages = (packages || [])
            .join(',') // Array zu String, um gemischte Formate abzufangen
            .split(/[\s,]+/) // Split by comma OR space
            .map(p => p.trim()).filter(p => p.length > 0);

        this.ensurePackageJson();
        
        // Prüfe physisch auf der Platte, ob das Paket fehlt
        const missing = cleanPackages.filter(pkg => !this.isInstalled(pkg));
        const existing = [...new Set(cleanPackages.filter(pkg => this.isInstalled(pkg)))];
        
        if (missing.length > 0) {
            this.log(`⬇️ NPM Install: ${missing.join(', ')}`);
            await this.runNpm(`install ${missing.join(' ')} --save`);
        }

        if (existing.length > 0 && verbose) {
            this.log(`📦 Using existing packages: ${existing.join(', ')}`);
        }

        if (autoPrune) await this.prune(cleanPackages);
    }

    async prune(currentScriptDeps = []) {
        this.ensurePackageJson();
        const files = fs.readdirSync(this.scriptsDir).filter(f => f.endsWith('.js'));
        const requiredSet = new Set();

        files.forEach(file => {
            const meta = ScriptParser.parse(path.join(this.scriptsDir, file));
            meta.dependencies.forEach(dep => {
                dep.split(/[\s,]+/).forEach(d => {
                    requiredSet.add(this.getPackageName(d));
                });
            });
        });

        if (!fs.existsSync(this.packageJsonPath)) return;
        const pkg = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
        const installed = Object.keys(pkg.dependencies || {});
        const toRemove = installed.filter(p => !requiredSet.has(p));

        // Info-Log für Pakete, die im aktuellen Skript nicht (mehr) drin sind, 
        // aber wegen anderen Skripten behalten werden.
        const currentSet = new Set(currentScriptDeps.map(d => this.getPackageName(d)));
        const kept = installed.filter(p => !currentSet.has(p) && requiredSet.has(p));
        
        if (kept.length > 0) {
            this.log(`ℹ️ Shared packages retained: ${kept.join(', ')}`);
        }

        if (toRemove.length > 0) {
            this.log(`🗑️ NPM Uninstall: Removing unused packages: ${toRemove.join(', ')}`);
            await this.runNpm(`uninstall ${toRemove.join(' ')}`);
        }
    }

    runNpm(command) {
        return new Promise((resolve) => {
            const cmd = `npm ${command} --prefix "${this.storageDir}" --no-audit --loglevel=error`;
            try {
                // Use execSync to ensure installation completes before the script is restarted (Hot-Reload)
                execSync(cmd, { stdio: 'pipe' });
                const isUninstall = command.startsWith('uninstall');
                this.log(isUninstall ? "✅ NPM Uninstall finished." : "✅ NPM Install finished.");
            } catch (error) {
                const stderr = error.stderr ? error.stderr.toString() : error.message;
                this.log(`NPM Error: ${stderr}`, 'error');
            }
            resolve();
        });
    }

    log(message, level = 'info') {
        console.log(level === 'error' ? `❌ ${message}` : message);
        this.emit('log', { level, message });
    }

    /**
     * Echter Dateisystem-Check statt require.resolve
     */
    isInstalled(pkgName) {
        const cleanName = this.getPackageName(pkgName);
        // Wir schauen direkt in den Ordner auf der Festplatte
        const pkgFolder = path.join(this.storageDir, 'node_modules', cleanName);
        const exists = fs.existsSync(pkgFolder);
        return exists;
    }

    getPackageName(raw) {
        let name = raw.trim();
        if (name.startsWith('@')) {
            const atIndex = name.indexOf('@', 1);
            if (atIndex > 0) name = name.substring(0, atIndex);
        } else {
            name = name.split('@')[0];
        }
        return name;
    }
}
module.exports = DependencyManager;