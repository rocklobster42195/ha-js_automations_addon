const fs = require('fs');
const path = require('path');

class IntegrationManager {
    constructor(haConfigPath) {
        // Pfad innerhalb des Containers/Add-ons (Quelle)
        const config = require('./config');
        // ADDON_DIR ist 'addon/'. Wir gehen eine Ebene hoch zum Root, dann in 'integration'
        this.sourceDir = path.resolve(config.ADDON_DIR, '../integration/custom_components/js_automations');
        
        // Pfad im Home Assistant Config Ordner (Ziel)
        // Standardmäßig /config, kann aber über ENV oder Konstruktor angepasst werden
        this.targetDir = path.join(haConfigPath || '/config', 'custom_components', 'js_automations');
    }

    /**
     * Prüft Versionen und Installationsstatus.
     */
    async getStatus() {
        const internalManifest = this._readManifest(this.sourceDir);
        const installedManifest = this._readManifest(this.targetDir);

        // Wenn intern keine Integration liegt (z.B. im Dev-Mode ohne Build), Fehler melden
        if (!internalManifest) {
            return { installed: false, error: 'Internal integration source not found', version_available: '0.0.0', version_installed: '0.0.0' };
        }

        const versionAvailable = internalManifest.version;
        const versionInstalled = installedManifest ? installedManifest.version : null;
        const installed = !!versionInstalled;

        return {
            installed,
            version_installed: versionInstalled || '0.0.0',
            version_available: versionAvailable,
            needs_update: installed ? (versionInstalled !== versionAvailable) : true
        };
    }

    /**
     * Installiert oder aktualisiert die Integration.
     */
    async install() {
        if (!fs.existsSync(this.sourceDir)) {
            throw new Error("Source integration files not found in Add-on.");
        }

        try {
            // Zielordner erstellen
            if (!fs.existsSync(this.targetDir)) {
                fs.mkdirSync(this.targetDir, { recursive: true });
            }

            // Dateien rekursiv kopieren
            this._copyRecursive(this.sourceDir, this.targetDir);

            return await this.getStatus();
        } catch (e) {
            console.error("Integration Install Failed:", e);
            throw e;
        }
    }

    _readManifest(dir) {
        try {
            const p = path.join(dir, 'manifest.json');
            if (fs.existsSync(p)) {
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            }
        } catch (e) { }
        return null;
    }

    _copyRecursive(src, dest) {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        
        for (let entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                if (!fs.existsSync(destPath)) fs.mkdirSync(destPath);
                this._copyRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}

module.exports = IntegrationManager;