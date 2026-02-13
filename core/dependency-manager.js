/**
 * HA-JS-AUTOMATION: Dependency Manager (Add-on optimized)
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class DependencyManager {
    constructor(scriptsDir) {
        this.scriptsDir = scriptsDir; // Wir installieren JETZT hier!
    }

    async install(packages) {
        if (!packages || packages.length === 0) return;

        const missing = packages.filter(pkg => !this.isInstalled(pkg));
        if (missing.length === 0) return;

        console.log(`⬇️ Installing to ${this.scriptsDir}: ${missing.join(', ')}`);
        
        // WICHTIG: Wir führen npm install im /config/js-automation Ordner aus
        const cmd = `npm install ${missing.join(' ')} --no-save --no-audit --loglevel=error`;
        
        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: this.scriptsDir }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`❌ NPM Error: ${stderr}`);
                    reject(error);
                } else {
                    console.log(`✅ Packages ready in ${this.scriptsDir}`);
                    resolve();
                }
            });
        });
    }

    isInstalled(pkgName) {
        const cleanName = pkgName.split('@')[0];
        try {
            // Wir prüfen, ob das Paket im Scripts-Ordner existiert
            require.resolve(cleanName, { paths: [this.scriptsDir] });
            return true;
        } catch (e) {
            return false;
        }
    }
}

module.exports = DependencyManager;