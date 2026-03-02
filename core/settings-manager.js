const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const schema = require('./settings-schema');

// Pfad zum Speicherort der Einstellungen
// Wir nutzen scripts/.storage/settings.json, damit es persistent ist
const STORAGE_DIR = path.join(__dirname, '../scripts/.storage');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');

class SettingsManager extends EventEmitter {
    constructor() {
        super();
        this.settings = {};
        this.saveTimer = null;
        this.init();

        // Graceful Shutdown: Sicherstellen, dass ausstehende Änderungen gespeichert werden
        process.on('SIGTERM', () => this.save());
        process.on('SIGINT', () => this.save());
    }

    /**
     * Initialisiert den Manager, lädt existierende Settings oder erstellt Defaults.
     */
    init() {
        // Sicherstellen, dass das Verzeichnis existiert
        if (!fs.existsSync(STORAGE_DIR)) {
            try {
                fs.mkdirSync(STORAGE_DIR, { recursive: true });
            } catch (e) {
                console.error('SettingsManager: Konnte Storage-Ordner nicht erstellen:', e);
            }
        }

        const defaults = this._getDefaultsFromSchema();

        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
                const userSettings = JSON.parse(fileContent);
                
                // Merge: Defaults als Basis, User-Settings überschreiben diese
                // Das stellt sicher, dass neue Schema-Felder auch in den Settings landen
                this.settings = this._deepMerge(defaults, userSettings);
                
                // Wir speichern einmal zurück, um sicherzustellen, dass die Datei 
                // alle aktuellen Keys (auch neue aus dem Schema) enthält.
                this.save(); 
            } catch (error) {
                console.error('SettingsManager: Fehler beim Lesen der settings.json. Nutze Defaults.', error);
                this.settings = defaults;
            }
        } else {
            console.log('SettingsManager: Keine settings.json gefunden. Erstelle neu aus Schema.');
            this.settings = defaults;
            this.save();
        }
    }

    /**
     * Gibt die aktuellen Einstellungen zurück.
     */
    getSettings() {
        return this.settings;
    }

    /**
     * Gibt das Schema für das Frontend zurück.
     */
    getSchema() {
        return schema;
    }

    /**
     * Aktualisiert die Einstellungen (partiell) und speichert sie.
     * @param {Object} updates - Das Objekt mit den Änderungen
     */
    updateSettings(updates) {
        this.settings = this._deepMerge(this.settings, updates);
        this.triggerSave();
        this.emit('settings_updated', this.settings);
        return this.settings;
    }

    /**
     * Startet den Timer für das Speichern (Debounce).
     * Verhindert zu häufige Schreibzugriffe auf die SD-Karte (Raspi-Schutz).
     */
    triggerSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        // Speichert erst nach 2 Sekunden Ruhe
        this.saveTimer = setTimeout(() => this.save(), 2000);
    }

    /**
     * Speichert den aktuellen Zustand in die Datei.
     */
    save() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('SettingsManager: Fehler beim Speichern:', error);
        }
    }

    /**
     * Extrahiert die Default-Werte aus dem Schema.
     */
    _getDefaultsFromSchema() {
        const defaults = {};
        schema.forEach(category => {
            defaults[category.id] = {};
            category.items.forEach(item => {
                defaults[category.id][item.key] = item.default !== undefined ? item.default : null;
            });
        });
        return defaults;
    }

    /**
     * Hilfsfunktion für Deep Merge von Objekten.
     */
    _deepMerge(target, source) {
        const output = Object.assign({}, target);
        if (target && typeof target === 'object' && !Array.isArray(target) &&
            source && typeof source === 'object' && !Array.isArray(source)) {
            Object.keys(source).forEach(key => {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!(key in target)) Object.assign(output, { [key]: source[key] });
                    else output[key] = this._deepMerge(target[key], source[key]);
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        return output;
    }
}

// Singleton Export
module.exports = new SettingsManager();