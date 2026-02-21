/**
 * JS AUTOMATIONS - Log Manager
 * Handles persistent logging with memory buffering and periodic flushing.
 * Implements the "Backend: Persistenz & Speicherschutz" concept.
 */
const fs = require('fs');
const path = require('path');

class LogManager {
    /**
     * @param {string} storageDir - Path to the .storage directory
     */
    constructor(storageDir) {
        this.logFile = path.join(storageDir, 'logs.json');
        this.buffer = [];
        this.maxEntries = 1000; // Keep last 1000 lines
        this.flushIntervalMs = 60000; // Flush every 60s
        this.isDirty = false;

        // Load existing logs on startup
        this.load();

        // Start periodic flush
        this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);

        // Graceful shutdown hooks (SIGTERM/SIGINT)
        process.on('SIGTERM', () => this.flushSync());
        process.on('SIGINT', () => this.flushSync());
    }

    load() {
        if (fs.existsSync(this.logFile)) {
            try {
                const data = fs.readFileSync(this.logFile, 'utf8');
                this.buffer = JSON.parse(data);
            } catch (e) {
                console.error("❌ Failed to load logs.json", e);
                this.buffer = [];
            }
        }
    }

    /**
     * Adds a new log entry to the buffer.
     * @param {string} level - 'info', 'warn', 'error', 'debug'
     * @param {string} source - 'System' or script name
     * @param {string} message - The log message
     * @returns {object} The created log entry
     */
    add(level, source, message) {
        const entry = {
            ts: Date.now(),
            level: level,
            source: source,
            message: message
        };

        this.buffer.push(entry);

        // Trim buffer if it exceeds max entries
        if (this.buffer.length > this.maxEntries) {
            this.buffer = this.buffer.slice(-this.maxEntries);
        }

        this.isDirty = true;
        return entry;
    }

    /**
     * Asynchronously writes the buffer to disk if changes exist.
     */
    flush() {
        if (!this.isDirty) return;

        // Create a snapshot of the current buffer to write
        const data = JSON.stringify(this.buffer, null, 2);
        
        fs.writeFile(this.logFile, data, (err) => {
            if (err) {
                console.error("❌ Failed to write logs.json", err);
            } else {
                this.isDirty = false;
            }
        });
    }

    /**
     * Synchronously writes to disk (for shutdown).
     */
    flushSync() {
        if (!this.isDirty) return;
        try {
            fs.writeFileSync(this.logFile, JSON.stringify(this.buffer, null, 2));
            this.isDirty = false;
            console.log("💾 Logs saved (Sync).");
        } catch (e) {
            console.error("❌ Failed to write logs.json (Sync)", e);
        }
    }

    /**
     * Returns the current log history.
     */
    getHistory() {
        return this.buffer;
    }

    /**
     * Clears the log history.
     */
    clear() {
        this.buffer = [];
        this.isDirty = true;
        this.flush();
    }
}

module.exports = LogManager;