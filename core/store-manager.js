/**
 * JS AUTOMATIONS - Store Manager
 * Manages persistent global variables with usage tracking.
 */
const fs = require('fs');
const path = require('path');

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
            return true;
        }
        return false;
    }

    clear() {
        this.data = {};
        this.save();
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
        if (count > 0) this.save();
        return count;
    }
}

module.exports = StoreManager;