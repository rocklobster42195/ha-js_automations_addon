const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const schema = require('./settings-schema');
const config = require('./config');
const SETTINGS_FILE = path.join(config.STORAGE_DIR, 'settings.json');

class SettingsManager extends EventEmitter {
    constructor() {
        super();
        this.settings = {};
        this.saveTimer = null;
        this.init();

        // Graceful Shutdown: Ensure pending changes are saved
        process.on('SIGTERM', () => this.save());
        process.on('SIGINT', () => this.save());
    }

    /**
     * Initializes the manager, loads existing settings or creates defaults.
     */
    init() {
        // Ensure the directory exists
        if (!fs.existsSync(config.STORAGE_DIR)) {
            try {
                fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
            } catch (e) {
                console.error('SettingsManager: Could not create storage folder:', e);
            }
        }

        const defaults = this._getDefaultsFromSchema();

        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
                const userSettings = JSON.parse(fileContent);
                
                // Merge: Defaults as basis, user settings overwrite them
                // This ensures that new schema fields also end up in the settings
                this.settings = this._deepMerge(defaults, userSettings);

                // Cleanup: Remove keys that are no longer in the schema
                this._validateAndCleanup();
                
                // Save back once to ensure the file contains all current keys (including new ones from the schema).
                this.save(); 
            } catch (error) {
                console.error('SettingsManager: Error reading settings.json. Using defaults.', error);
                this.settings = defaults;
            }
        } else {
            console.log('SettingsManager: No settings.json found. Creating new from schema.');
            this.settings = defaults;
            this.save();
        }
    }

    /**
     * Returns the current settings.
     */
    getSettings() {
        return this.settings;
    }

    /**
     * Returns the schema for the frontend.
     */
    getSchema() {
        return schema;
    }

    /**
     * Updates the settings (partially) and saves them.
     * @param {Object} updates - The object containing the changes.
     */
    updateSettings(updates) {
        this.settings = this._deepMerge(this.settings, updates);
        this._validateAndCleanup(); // Ensure no invalid keys are introduced during updates
        this.triggerSave();
        this.emit('settings_updated', this.settings);
        return this.settings;
    }

    /**
     * Starts the save timer (debounce).
     * Prevents frequent write access to the SD card (Raspberry Pi protection).
     */
    triggerSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        // Saves after 2 seconds of inactivity
        this.saveTimer = setTimeout(() => this.save(), 2000);
    }

    /**
     * Saves the current state to the file.
     */
    save() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            // Ensure directory exists before writing to prevent ENOENT
            if (!fs.existsSync(config.STORAGE_DIR)) {
                fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
            }
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('SettingsManager: Save error:', error);
        }
    }

    /**
     * Extracts default values from the schema.
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
     * Removes all settings that are not defined in the schema.
     * Prevents "orphans" or typos from remaining in the JSON.
     */
    _validateAndCleanup() {
        const validKeys = {};
        // 1. Create a map of all allowed keys per category
        schema.forEach(cat => {
            validKeys[cat.id] = new Set(cat.items.map(i => i.key));
        });

        // 2. Check settings
        for (const catId in this.settings) {
            // Delete if category is not in the schema
            if (!validKeys[catId]) {
                delete this.settings[catId];
                continue;
            }
            // Delete if key in category is not in the schema
            for (const key in this.settings[catId]) {
                if (!validKeys[catId].has(key)) {
                    delete this.settings[catId][key];
                }
            }
        }
    }

    /**
     * Helper function for deep merging of objects.
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