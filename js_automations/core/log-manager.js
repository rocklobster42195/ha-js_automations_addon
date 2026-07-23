/**
 * JS AUTOMATIONS - Log Manager
 * Handles persistent logging with memory buffering and periodic flushing.
 * Implements memory protection and persistence logic.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

class LogManager extends EventEmitter {
    /**
     * @param {string} storageDir - Path to the .storage directory
     */
    constructor(storageDir) {
        super();
        this.logFile = path.join(storageDir, 'logs.json');
        this.buffer = [];
        this.maxEntries = 1000; // Keep last 1000 lines
        this.flushIntervalMs = 60000; // Flush every 60s
        this.isDirty = false;
        this.systemLogLevel = 'info'; // Global log level for system messages
        this.urgentFlushTimer = null; // Debounce timer for error/warn entries

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

    setLevel(level) {
        if (LOG_LEVELS[level.toLowerCase()] !== undefined) {
            this.systemLogLevel = level.toLowerCase();
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
        const lvl = (level || 'info').toLowerCase();
        
        // Apply global system log level filter only to 'System' messages
        // Script messages are already filtered by their own @loglevel in the worker
        if (source === 'System') {
            if (LOG_LEVELS[lvl] > LOG_LEVELS[this.systemLogLevel]) return null;
        }
        // For script logs, we assume the worker has already applied the script's @loglevel filter.

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
        this.emit('log_added', entry);

        // error/warn entries are often the last thing logged before a crash or a hard
        // container kill (e.g. mid HA-Supervisor-update). Waiting for the regular 60s
        // flush would lose them, so get them to disk promptly instead. Debounced briefly
        // to coalesce bursts (e.g. an exception storm) into a single write.
        if (lvl === 'error' || lvl === 'warn') this._scheduleUrgentFlush();

        return entry;
    }

    /**
     * Schedules a near-immediate flush for critical log entries, debounced to avoid
     * hammering disk during a burst of errors/warnings.
     * @private
     */
    _scheduleUrgentFlush() {
        if (this.urgentFlushTimer) return;
        this.urgentFlushTimer = setTimeout(() => {
            this.urgentFlushTimer = null;
            this.flush();
        }, 200);
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