/**
 * JS AUTOMATIONS - Store Manager
 * Manages persistent global variables with usage tracking.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class StoreManager extends EventEmitter {
    constructor(rootDir) {
        super();
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
        this.emit('changed', { key, value });
    }

    get(key) {
        if (this.data[key]) {
            this.data[key].accessed = new Date().toISOString();
            // We don't save immediately on read for performance reasons.
            // Data stays in RAM and save() is triggered on the next write operation.
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
            this.emit('changed', { key, deleted: true });
            return true;
        }
        return false;
    }

    clear() {
        this.data = {};
        this.save();
    }

    /** Deletes all variables created by a specific script. */
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
        }
        return count;
    }
}

module.exports = StoreManager;