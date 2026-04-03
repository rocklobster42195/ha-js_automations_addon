// core/kernel.js
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ScriptHeaderParser = require('./script-header-parser');

// Ensure base directories exist before any manager is initialized
config.ensureDirectories();

// Global error handling to prevent the addon from crashing on unhandled HA rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Manager Imports
const HAConnector = require('./ha-connection');
const DependencyManager =require('./dependency-manager');
const StateManager = require('./state-manager');
const StoreManager = require('./store-manager');
const LogManager = require('./log-manager');
const SettingsManager = require('./settings-manager'); // Static-like module
const workerManager = require('./worker-manager'); // Singleton module
const MqttManager = require('./mqtt-manager');
const EntityManager = require('./entity-manager');
const CompilerManager = require('./compiler-manager');
const Bridge = require('./bridge');
const SystemService = require('../services/system-service');

/**
 * The Kernel is the central orchestrator of the application.
 * It's responsible for booting, starting, and shutting down all services and managers.
 */
class Kernel extends EventEmitter {
    constructor() {
        super();
        // Core properties
        this.io = null;
        this.systemOptions = { expert_mode: true }; // Default options

        // Manager instances
        this.logManager = null;
        this.settingsManager = null;
        this.haConnector = null;
        this.depManager = null;
        this.stateManager = null;
        this.storeManager = null;
        this.workerManager = null;
        this.entityManager = null;
        this.mqttManager = null;
        this.compilerManager = null;
        this.bridge = null;
        this.systemService = null;
        this.lastStats = null; // Cache for the latest system metrics
    }

    /**
     * Gathers the current system status regarding HA and MQTT connectivity.
     * @returns {Promise<object>} A system status object.
     */
    async getSystemStatus() {
        const isConnected = this.haConnector.isReady;
        const mqttSettings = this.settingsManager.getSettings()?.mqtt || {};
        const mqttStatus = {
            connected: this.mqttManager ? this.mqttManager.isConnected : false,
            enabled: mqttSettings.enabled || false
        };

        return {
            // These flags are kept for UI compatibility
            installed: true,
            active: isConnected && mqttStatus.connected,
            is_connected: isConnected,
            display_version: config.VERSION,
            mqtt: mqttStatus,
            stats: this.lastStats // Include stats for immediate status bar population
        };
    }

    /**
     * Boots the core systems.
     * Instantiates all managers and registers persistent event listeners.
     */
    boot(io) {
        this.io = io;
        const { SCRIPTS_DIR, STORAGE_DIR, DIST_DIR } = config;

        // Instantiate managers
        try {
            this.logManager = new LogManager(STORAGE_DIR);
            this.settingsManager = SettingsManager;
            this.haConnector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, STORAGE_DIR);
            this.depManager = new DependencyManager(SCRIPTS_DIR, STORAGE_DIR);
            this.stateManager = new StateManager(STORAGE_DIR);
            this.storeManager = new StoreManager(STORAGE_DIR);
            this.compilerManager = new CompilerManager(SCRIPTS_DIR, DIST_DIR, STORAGE_DIR);
            this.mqttManager = new MqttManager(this.settingsManager, this.logManager, this.haConnector);
            this.workerManager = workerManager;

            // Initialize WorkerManager paths immediately so other managers can use them.
            this.workerManager.setStorageDir(STORAGE_DIR);
            this.workerManager.setScriptsDir(SCRIPTS_DIR);
            this.workerManager.setStore(this.storeManager);
            this.workerManager.setMqttManager(this.mqttManager);

            // Create SystemService before EntityManager so we can pass it
            this.systemService = new SystemService(config, this.workerManager);
            
            this.entityManager = new EntityManager(
                this.haConnector, 
                this.workerManager, 
                this.stateManager, 
                this.depManager,
                this.systemService,
                this.mqttManager,
                this.compilerManager
            );
        } catch (err) {
            console.error('❌ Critical error during Kernel boot:', err);
            process.exit(1); // Exit with error code so the supervisor can restart the container
        }

        // The bridge connects the kernel to the outside world (Socket.io)
        this.bridge = new Bridge(this);

        this.logManager.add('debug', 'System', 'Kernel boot completed. All managers initialized.');
        
        // Initial log level
        const currentSettings = this.settingsManager.getSettings();
        if (currentSettings.system && currentSettings.system.log_level) {
            this.logManager.setLevel(currentSettings.system.log_level);
        }

        // Register event listeners that should be active immediately after boot
        this._registerStaticEventListeners();
    }
    
    /**
     * Updates worker settings based on the main settings file.
     * @param {object} settings The main settings object.
     * @private
     */
    _updateWorkerManagerSettings(settings) {
        const workerSettings = {};
        if (settings.danger?.restart_count) {
            workerSettings.restart_protection_count = settings.danger.restart_count;
        }
        if (settings.danger?.restart_time) {
            workerSettings.restart_protection_time = settings.danger.restart_time * 1000;
        }
        if (settings.danger?.node_memory) {
            workerSettings.node_memory = settings.danger.node_memory;
        }
        if (settings.general?.ui_language) {
            workerSettings.ui_language = settings.general.ui_language;
        }
        if (settings.system?.default_throttle !== undefined) {
            workerSettings.default_throttle = settings.system.default_throttle;
        }
        if (Object.keys(workerSettings).length > 0) {
            this.workerManager.setSettings(workerSettings);
        }
    }

    /**
     * Registers event listeners that persist through the application's lifecycle.
     * @private
     */
    _registerStaticEventListeners() {
        // Settings changes
        this.settingsManager.on('settings_updated', (newSettings) => {
            if (newSettings.system && newSettings.system.log_level) {
                this.logManager.setLevel(newSettings.system.log_level);
            }
            this._updateWorkerManagerSettings(newSettings);
        });

        // Forward NPM logs to the LogManager
        this.depManager.on('log', ({ level, message }) => {
            this.logManager.add(level, 'System', message);
        });

        // Forward human-readable Compiler logs
        this.compilerManager.on('log', ({ level, message }) => {
            this.logManager.add(level, 'System', message);
        });

        // Forward technical Compiler signals (for Editor markers) via Socket only
        this.compilerManager.on('compiler_signal', (data) => {
            if (this.io) this.io.emit('compiler_signal', data);
        });

        // Forward MQTT status to UI
        this.mqttManager.on('status_change', async (status) => {
            if (this.io) {
                this.io.emit('mqtt_status_changed', status);
                // UX: Push full system status update so banners and indicators can react immediately
                const fullStatus = await this.getSystemStatus();
                this.emit('integration_status_changed', fullStatus);
            }
        });
    }

    /**
     * Starts the main application logic.
     */
    async start() {
        this.bridge.connect();
        this.systemService.start();

        console.log('🚀 Kernel starting application...');

        const { VERSION, SCRIPTS_DIR, DIST_DIR } = config;

        let startMsg = `Addon started (v${VERSION})...`;
        this.logManager.add('info', 'System', startMsg);
        
        try {
            this.compilerManager.ensureTsConfig();

            // Clean up orphaned files in dist before starting
            await this.compilerManager.pruneDist();

            // Perform initial full compilation pass for all TypeScript files
            this.logManager.add('debug', 'System', 'Starting initial TypeScript compilation pass...');
            const tsFiles = [];
            const scanForTs = (dir) => {
                if (!fs.existsSync(dir)) return;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name !== '.storage' && entry.name !== 'node_modules') scanForTs(fullPath);
                    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                        tsFiles.push(fullPath);
                    }
                }
            };
            scanForTs(SCRIPTS_DIR);
            for (const tsFile of tsFiles) { await this.compilerManager.transpile(tsFile); }
            if (tsFiles.length > 0) this.logManager.add('debug', 'System', `Initial compilation pass completed. Checked ${tsFiles.length} files.`);

            if (this.systemService.isSafeMode) {
                this.logManager.add('error', 'System', '🚨 SAFE MODE ACTIVATED: Excessive restarts detected. Scripts are disabled.');
            }

            await this.haConnector.connect();
            await this.mqttManager.connect();

            // Update System Language from HA Config
            const haConfig = await this.haConnector.getHAConfig();
            if (haConfig && haConfig.language) {
                this.workerManager.setSystemLanguage(haConfig.language);
            }

            const status = await this.getSystemStatus();
            this.emit('integration_status_changed', status);

            this.workerManager.setConnector(this.haConnector);

            const currentSettings = this.settingsManager.getSettings();
            this._updateWorkerManagerSettings(currentSettings);

            await this.entityManager.createExposedEntities();
            
            this._setupSystemEventListeners();

            // Autostart scripts
            if (!this.systemService.isSafeMode) {
                const enabled = this.stateManager.getEnabledScripts();
                for (const file of enabled) {
                    let fullPath = path.join(SCRIPTS_DIR, file);
                    
                    if (fs.existsSync(fullPath)) {
                        const meta = ScriptHeaderParser.parse(fullPath);
                        if (meta.dependencies.length > 0) await this.depManager.install(meta.dependencies, false);
                        this.workerManager.startScript(file);
                    }
                }
            }
            
            this.depManager.prune();

            // Run an initial cleanup immediately to remove leftovers from offline time
            await this.performGlobalCleanup();

            // Start periodic cleanup (every hour)
            setInterval(() => this.performGlobalCleanup(), 3600000);
            this.logManager.add('debug', 'System', 'Kernel background maintenance loops started.');
        } catch (err) {
            console.error(err);
            this.logManager.add('error', 'System', `Kernel start failed: ${err.message}`);
        }
    }

    /**
     * Compares entities in Home Assistant with existing script files
     * and removes orphaned entries. Triggered hourly.
     */
    async performGlobalCleanup() {
        if (!this.haConnector.isReady || !this.mqttManager.isConnected) {
            this.logManager.add('debug', 'System', '[Kernel] Skipping cleanup: HA or MQTT not connected.');
            return;
        }

        this.logManager.add('debug', 'System', '[Kernel] Running hourly entity and device cleanup check...');
        
        // 1. Get all script names (without extension) from disk and slugify them
        // This ensures they match the slugified identifiers used for Home Assistant entities.
        const scripts = this.workerManager.getScripts().map(p => {
            const name = path.basename(p, path.extname(p));
            return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        });
        
        // 2. Clean up exposed entities and orphans using the slugified names
        if (this.entityManager) {
            await this.entityManager.cleanupOrphanedEntities(scripts);
        }

        // 3. Republish dynamic entities (ha.register) from running scripts
        // This ensures they are recreated if manually deleted in HA.
        if (this.workerManager) {
            await this.workerManager.republishNativeEntities(true);
        }
    }

    /**
     * Sets up event listeners for core system events (HA, workers).
     * @private
     */
    _setupSystemEventListeners() {
        // HA state changes
        this.haConnector.subscribeToEvents((event) => {
            if (event.event_type === 'state_changed') {
                const { entity_id, new_state, old_state } = event.data;
                this.workerManager.dispatchStateChange(entity_id, new_state, old_state);
                // Forward to UI for Status Bar
                this.emit('ha_state_changed', { entity_id, new_state });
            }
        });

        this.systemService.on('system_stats_updated', (stats) => {
            this.lastStats = stats;
        });

        // Worker lifecycle events
        this.workerManager.on('script_start', this._onScriptStart.bind(this));
        this.workerManager.on('script_exit', this._onScriptExit.bind(this));
        this.workerManager.on('log', this._onWorkerLog.bind(this));

        // Notify frontend when type definitions are updated
        this.workerManager.on('typings_generated', () => {
            if (this.io) this.io.emit('typings_updated');
        });
    }
    
    _onScriptStart({ filename, meta }) {
        if (!meta || meta.expose !== 'button') {
            // StateManager still tracks by filename for persistence, 
            // but EntityManager now handles the HA state via events.
            this.stateManager.saveScriptStarted(filename);
        }
    }

    _onScriptExit(d) {
        if (!d.meta || d.meta.expose !== 'button') {
            const isPermanentStop = d.type === 'error' || d.reason === 'finished' || d.reason === 'by user' || d.reason.includes('stopped by user');
            if (isPermanentStop) {
                this.stateManager.saveScriptStopped(d.filename);
            }
        }
        
        // UX: Log normal exits as DEBUG to keep the System log clean.
        const level = d.type === 'success' ? 'debug' : (d.type || 'info');
        this.logManager.add(level, 'System', `${path.basename(d.filename)} ${d.reason}`);
        this.emit('status_update');
    }

    _onWorkerLog(data) {
        this.logManager.add(data.level || 'info', data.source, data.message);
    }
    
    /**
     * Handles the auto-reconnection logic for Home Assistant.
     */
    async handleReconnection() {
        if (!this.haConnector.isReady) {
            console.log("⚠️ HA Connection lost. Attempting to reconnect...");
            this.logManager.add('warn', 'System', 'HA Connection lost. Attempting to reconnect...');
            try {
                await this.haConnector.connect();
                console.log("✅ HA Reconnected!");
                this.logManager.add('info', 'System', 'HA Reconnected!');
                
                // Update System Language
                const haConfig = await this.haConnector.getHAConfig();
                if (haConfig && haConfig.language) {
                    this.workerManager.setSystemLanguage(haConfig.language);
                }

                // Notify UI
                const status = await this.getSystemStatus();
                this.emit('integration_status_changed', status);

                await this.entityManager.createExposedEntities(true);
                await this.workerManager.republishNativeEntities(false);
            } catch (e) {
                console.error("❌ Reconnection failed:", e.message);
                this.logManager.add('error', 'System', `Reconnection failed: ${e.message}`);
            }
        }
    }

    /**
     * Shuts down the application gracefully.
     */
    shutdown() {
        console.log('🛑 Kernel shutting down...');
        if (this.workerManager) this.workerManager.shutdown();
        if (this.haConnector) this.haConnector.disconnect();
        this.emit('shutdown');
    }
}

module.exports = new Kernel();
