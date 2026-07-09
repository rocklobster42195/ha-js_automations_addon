// services/system-service.js
const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * The SystemService is responsible for monitoring system-level health,
 * including CPU/RAM usage, boot loop detection, and safe mode status.
 */
class SystemService extends EventEmitter {
    /**
     * @param {object} config The global application config.
     * @param {import('../core/worker-manager')} workerManager The worker manager to get script stats from.
     */
    constructor(config, workerManager) {
        super();
        this.config = config;
        this.workerManager = workerManager;
        this.CRASH_FILE = path.join(config.STORAGE_DIR, '.boot_crash_counter');
        this.isSafeMode = false;

        this.statsInterval = null;
        this.cpuStartTick = null;
        this.containerMemLimitMb = this._detectContainerMemLimit();
    }

    /**
     * Detects a cgroup memory limit (Docker/Home Assistant container), if any.
     * Returns null on hosts without cgroups (e.g. Windows dev machines) or when unlimited,
     * so callers can fall back to host-wide memory stats.
     * @returns {number|null} Limit in MB, or null if not detected.
     */
    _detectContainerMemLimit() {
        try {
            // cgroup v2
            const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
            if (raw && raw !== 'max') {
                const bytes = parseInt(raw, 10);
                if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1024 / 1024);
            }
        } catch (e) { /* not cgroup v2 */ }

        try {
            // cgroup v1 - unlimited is reported as a huge sentinel value, so ignore anything absurd.
            const raw = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
            const bytes = parseInt(raw, 10);
            if (Number.isFinite(bytes) && bytes > 0 && bytes < 64 * 1024 * 1024 * 1024) {
                return Math.round(bytes / 1024 / 1024);
            }
        } catch (e) { /* not cgroup v1 */ }

        return null;
    }

    /**
     * Starts the system monitoring services (CPU/RAM, etc.).
     */
    start() {
        this.detectBootloop();

        this.cpuStartTick = this._getCpuTick();
        this.statsInterval = setInterval(() => {
            this._collectAndEmitStats();
        }, 2000);

        console.log('✅ SystemService started. Monitoring CPU/RAM and Safe Mode status.');
    }

    /**
     * Stops the monitoring services.
     */
    stop() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
    }

    /**
     * Checks for a bootloop condition by reading a crash counter file.
     * If a bootloop is detected, it sets the isSafeMode flag and emits an event.
     */
    detectBootloop() {
        try {
            let crashData = { count: 0, lastBoot: 0 };
            if (fs.existsSync(this.CRASH_FILE)) {
                crashData = JSON.parse(fs.readFileSync(this.CRASH_FILE, 'utf8'));
            }
            const now = Date.now();
            if (now - crashData.lastBoot > 60000) { // 60-second window to reset counter
                crashData.count = 0;
            }
            crashData.count++;
            crashData.lastBoot = now;
            fs.writeFileSync(this.CRASH_FILE, JSON.stringify(crashData));

            if (crashData.count >= 3) {
                this.isSafeMode = true;
            }
            this.emit('safe_mode_changed', this.isSafeMode);
        } catch (e) {
            console.error("Bootloop check failed:", e);
        }
    }

    /**
     * Resolves the safe mode status by deleting the crash file and emitting an event.
     * @returns {boolean} True if successful, false otherwise.
     */
    resolveSafeMode() {
        try {
            if (fs.existsSync(this.CRASH_FILE)) {
                fs.unlinkSync(this.CRASH_FILE);
            }
            this.isSafeMode = false;
            this.emit('safe_mode_changed', false);
            return true;
        } catch (e) {
            console.error("Failed to resolve safe mode:", e);
            return false;
        }
    }

    _collectAndEmitStats() {
        const endTick = this._getCpuTick();
        const idleDiff = endTick.idle - this.cpuStartTick.idle;
        const totalDiff = endTick.total - this.cpuStartTick.total;
        const cpuPercent = totalDiff > 0 ? 100 - Math.floor(100 * idleDiff / totalDiff) : 0;
        this.cpuStartTick = endTick;

        const totalMem = Math.round(os.totalmem() / 1024 / 1024);
        const freeMem = Math.round(os.freemem() / 1024 / 1024);
        const appMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const appHeap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const workerCount = this.workerManager.workers.size;

        // Memory pressure, relative to whatever ceiling actually matters:
        // inside a memory-limited container, our own RSS vs. the cgroup limit is what
        // can trigger an OOM-kill; on an unconstrained host, host-wide usage is the signal.
        const ramUsedPct = this.containerMemLimitMb
            ? Math.round((appMem / this.containerMemLimitMb) * 100)
            : (totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0);

        // Also include script stats
        const scriptStats = {};
        this.workerManager.stats.forEach((v, k) => scriptStats[k] = v);

        const stats = {
            cpu: cpuPercent,
            ram_used: totalMem - freeMem,
            ram_total: totalMem,
            ram_used_pct: ramUsedPct,
            container_mem_limit: this.containerMemLimitMb,
            app_ram: appMem,
            app_heap: appHeap,
            worker_count: workerCount,
            script_stats: scriptStats
        };

        this.emit('system_stats_updated', stats);
    }

    _getCpuTick() {
        const cpus = os.cpus();
        let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
        for (const cpu of cpus) {
            user += cpu.times.user;
            nice += cpu.times.nice;
            sys += cpu.times.sys;
            idle += cpu.times.idle;
            irq += cpu.times.irq;
        }
        return { idle, total: user + nice + sys + idle + irq };
    }
}

module.exports = SystemService;
