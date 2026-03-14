const fs = require('fs');
const path = require('path');
const config = require('./config');

class IntegrationManager {
    constructor(haConfigPath) {
        // Die Integration muss im addon-Ordner liegen, damit sie im Docker-Image landet
        this.sourceDir = path.resolve(config.ADDON_DIR, 'integration', 'custom_components', 'js_automations');
        
        // Pfad im Home Assistant Config Ordner (Ziel)
        this.targetDir = path.join(haConfigPath || config.HA_CONFIG_DIR, 'custom_components', 'js_automations');
    }

    /**
     * Prüft Versionen und Installationsstatus.
     */
    async getStatus() {
        const internalManifest = this._readManifest(this.sourceDir);
        const installedManifest = this._readManifest(this.targetDir);

        const devMode = !config.IS_ADDON;

        // Wenn intern keine Integration liegt (z.B. im Dev-Mode ohne Build), Fehler melden
        if (!internalManifest) {
            return { 
                installed: !!installedManifest, 
                error: devMode ? null : 'Internal integration source not found', 
                version_available: '0.0.0', 
                version_installed: installedManifest ? installedManifest.version : '0.0.0',
                dev_mode: devMode,
                target_path: this.targetDir
            };
        }

        const versionAvailable = internalManifest.version;
        const versionInstalled = installedManifest ? installedManifest.version : null;
        const installed = !!versionInstalled;

        return {
            installed,
            version_installed: versionInstalled || '0.0.0',
            version_available: versionAvailable,
            needs_update: installed ? (versionInstalled !== versionAvailable) : true,
            dev_mode: devMode,
            target_path: this.targetDir
        };
    }

    /**
     * Installiert oder aktualisiert die Integration.
     */
    async install() {
        if (!config.IS_ADDON) {
            throw new Error("Installation is disabled in Developer Mode to prevent overwriting local files.");
        }

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