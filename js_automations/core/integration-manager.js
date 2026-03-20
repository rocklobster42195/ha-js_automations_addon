const fs = require('fs');
const path = require('path');
const config = require('./config');
const axios = require('axios');

class IntegrationManager {
    constructor(haConfigPath) {
        // Die Integration muss im addon-Ordner liegen, damit sie im Docker-Image landet
        this.sourceDir = path.resolve(config.ADDON_DIR, 'integration', 'custom_components', 'js_automations');
        
        // Pfad im Home Assistant Config Ordner (Ziel)
        this.targetDir = path.join(haConfigPath || config.HA_CONFIG_DIR, 'custom_components', 'js_automations');
    }

    /**
     * Prüft Versionen und Installationsstatus.
     * @param {string[]} [loadedComponents] Liste der in HA geladenen Komponenten (aus hass.config.components)
     * @param {string} [runningVersion] Die tatsächlich in HA laufende Version der Integration
     */
    async getStatus(loadedComponents = [], runningVersion = null) {
        const internalManifest = this._readManifest(this.sourceDir);
        const installedManifest = this._readManifest(this.targetDir);

        const devMode = !config.IS_ADDON;
        const versionAvailable = internalManifest ? internalManifest.version : '0.0.0';
        const versionInstalled = installedManifest ? installedManifest.version : null;

        // In HA geladen?
        const isLoaded = loadedComponents.includes('js_automations');

        // Installiert ist sie, wenn Dateien da sind ODER HA sie bereits geladen hat
        const installed = !!versionInstalled || isLoaded;
                
        // Im Dev-Mode vergleichen wir die laufende Version mit dem lokalen Quellcode (Source)
        const referenceVersion = devMode ? versionAvailable : (versionInstalled || '0.0.0');
        // Mismatch wenn:
        // 1. Integration geladen, aber liefert keine Version (zu alt)
        // 2. Version geliefert, aber weicht von der Referenz ab
        const versionMismatch = (isLoaded && !runningVersion) || 
                               !!(runningVersion && referenceVersion !== '0.0.0' && runningVersion !== referenceVersion);

        const active = isLoaded && !versionMismatch;

        // Im Dev-Mode ignorieren wir den Mock-Ordner für den Update-Banner.
        const needsUpdate = devMode ? false : (installed ? (versionInstalled !== versionAvailable) : true);

        return {
            installed,
            active,
            is_loaded: isLoaded,
            version_installed: versionInstalled || '0.0.0',
            version_available: versionAvailable,
            version_running: runningVersion || '0.0.0',
            needs_update: needsUpdate,
            // Neustart fällig, wenn Dateien da, aber nicht geladen ODER falsche Version aktiv
            needs_restart: installed && (!isLoaded || versionMismatch),
            dev_mode: devMode,
            target_path: this.targetDir,
            error: (!internalManifest && !devMode) ? 'Internal integration source not found' : null
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

    /**
     * Startet Home Assistant über die Supervisor API neu.
     */
    async restartHomeAssistant() {
        if (!process.env.SUPERVISOR_TOKEN) {
            throw new Error("Supervisor Token not found. Cannot restart Home Assistant.");
        }
        try {
            await axios.post('http://supervisor/core/restart', {}, {
                headers: { 'Authorization': `Bearer ${process.env.SUPERVISOR_TOKEN}` }
            });
            return true;
        } catch (e) {
            console.error("IntegrationManager: Failed to restart Home Assistant:", e.message);
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