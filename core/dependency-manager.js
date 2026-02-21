/**
 * JS AUTOMATIONS - Dependency Manager (v1.8.1)
 * Fix: Physical file check to bypass Node.js require cache
 */
const { exec } = require('child_process');
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

    async install(packages) {
        const cleanPackages = (packages || []).map(p => p.trim()).filter(p => p.length > 0);
        if (cleanPackages.length === 0) return;

        this.ensurePackageJson();
        
        // Prüfe physisch auf der Platte, ob das Paket fehlt
        const missing = cleanPackages.filter(pkg => !this.isInstalled(pkg));
        
        if (missing.length === 0) {
            // console.log("📦 All packages already present on disk.");
            return;
        }

        this.log(`⬇️ NPM Install: ${missing.join(', ')}`);
        return this.runNpm(`install ${missing.join(' ')} --save`);
    }

    async prune() {
        this.ensurePackageJson();
        const files = fs.readdirSync(this.scriptsDir).filter(f => f.endsWith('.js'));
        const requiredSet = new Set();

        files.forEach(file => {
            const meta = ScriptParser.parse(path.join(this.scriptsDir, file));
            meta.dependencies.forEach(dep => requiredSet.add(dep.split('@')[0]));
        });

        if (!fs.existsSync(this.packageJsonPath)) return;
        const pkg = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
        const installed = Object.keys(pkg.dependencies || {});
        const toRemove = installed.filter(p => !requiredSet.has(p));

        if (toRemove.length > 0) {
            this.log(`🧹 NPM Prune: Removing ${toRemove.join(', ')}`);
            await this.runNpm(`uninstall ${toRemove.join(' ')}`);
        }
    }

    runNpm(command) {
        return new Promise((resolve) => {
            const cmd = `npm ${command} --prefix "${this.storageDir}" --no-audit --loglevel=error`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) this.log(`NPM Error: ${stderr}`, 'error');
                resolve();
            });
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
        const cleanName = pkgName.split('@')[0];
        // Wir schauen direkt in den Ordner auf der Festplatte
        const pkgFolder = path.join(this.storageDir, 'node_modules', cleanName);
        return fs.existsSync(pkgFolder);
    }
}
module.exports = DependencyManager;