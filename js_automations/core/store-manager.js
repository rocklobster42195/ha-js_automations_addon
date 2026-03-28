/**
 * JS AUTOMATIONS - Store Manager
 * Manages persistent global variables with usage tracking.
 */
const fs = require('fs');
const path = require('path');
const StoreTypeGenerator = require('./store-type-generator');

class StoreManager {
    constructor(rootDir) {
        this.storeFile = path.join(rootDir, 'store.json');
        this.data = {};
        this.load();
    }

    load() {
        if (fs.existsSync(this.storeFile)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
                // Typen beim Start einmalig generieren
                const keys = Object.keys(this.data);
                console.log(`[StoreManager] Debug: Loading ${keys.length} keys. First key structure:`, keys[0] ? { key: keys[0], data: this.data[keys[0]] } : 'empty');
                StoreTypeGenerator.generate(this.data);
            } catch (e) {
                console.error("❌ Failed to load store.json");
                this.data = {};
            }
        }
    }

    save() {
        fs.writeFileSync(this.storeFile, JSON.stringify(this.data, null, 2));
    }

    set(key, value, scriptName, isSecret = false) {
        this.data[key] = {
            value: value,
            owner: scriptName,
            isSecret: isSecret === true,
            updated: new Date().toISOString(),
            accessed: new Date().toISOString()
        };
        this.save();
        console.log(`[StoreManager] Debug: Key '${key}' set with value type: ${typeof value}`);
        StoreTypeGenerator.generate(this.data);
    }

    get(key) {
        if (this.data[key]) {
            this.data[key].accessed = new Date().toISOString();
            // Wir speichern nicht bei jedem Lesezugriff sofort (Performance), 
            // sondern lassen es im RAM. save() passiert beim nächsten Setzen.
            return this.data[key].value;
        }
        return null;
    }

    getAll() {
        return this.data;
    }

    delete(key) {
        if (this.data[key]) {
            delete this.data[key];
            this.save();
            StoreTypeGenerator.generate(this.data);
            return true;
        }
        return false;
    }

    clear() {
        this.data = {};
        this.save();
        StoreTypeGenerator.generate(this.data);
    }

    /** Löscht alle Variablen, die von einem bestimmten Skript erstellt wurden */
    pruneByOwner(scriptName) {
        let count = 0;
        for (let key in this.data) {
            if (this.data[key].owner === scriptName) {
                delete this.data[key];
                count++;
            }
        }
        if (count > 0) {
            this.save();
            StoreTypeGenerator.generate(this.data);
        }
        return count;
    }
}

module.exports = StoreManager;