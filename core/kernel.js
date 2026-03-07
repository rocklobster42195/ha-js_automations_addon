// core/kernel.js
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ScriptHeaderParser = require('./script-header-parser');

// Manager Imports
const HAConnector = require('./ha-connection');
const DependencyManager =require('./dependency-manager');
const StateManager = require('./state-manager');
const StoreManager = require('./store-manager');
const LogManager = require('./log-manager');
const IntegrationManager = require('./integration-manager');
const SettingsManager = require('./settings-manager'); // Static-like module
const workerManager = require('./worker-manager'); // Singleton module
const EntityManager = require('./entity-manager');
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
        this.hasIntegration = false;
        this.systemOptions = { expert_mode: true }; // Default options

        // Manager instances
        this.logManager = null;
        this.settingsManager = null;
        this.haConnector = null;
        this.depManager = null;
        this.stateManager = null;
        this.storeManager = null;
        this.integrationManager = null;
        this.workerManager = null;
        this.entityManager = null;
        this.bridge = null;
        this.systemService = null;
    }

    /**
     * Boots the core systems.
     * Instantiates all managers and registers persistent event listeners.
     */
    boot(io) {
        this.io = io;
        const { SCRIPTS_DIR, STORAGE_DIR, HA_CONFIG_DIR } = config;

        // Instantiate managers
        this.logManager = new LogManager(STORAGE_DIR);
        this.settingsManager = SettingsManager;
        this.haConnector = new HAConnector(process.env.HA_URL, process.env.HA_TOKEN, STORAGE_DIR);
        this.depManager = new DependencyManager(SCRIPTS_DIR, STORAGE_DIR);
        this.stateManager = new StateManager(STORAGE_DIR);
        this.storeManager = new StoreManager(STORAGE_DIR);
        this.integrationManager = new IntegrationManager(HA_CONFIG_DIR);
        this.workerManager = workerManager;
        this.entityManager = new EntityManager(this.haConnector, this.workerManager, this.stateManager, this.depManager);

        // The bridge connects the kernel to the outside world (sockets)
        this.bridge = new Bridge(this);

        // System service for health monitoring
        this.systemService = new SystemService(config, this.workerManager);

        console.log('✅ Kernel booted successfully. All managers instantiated.');
        
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
        if (settings.danger?.restart_protection_count) {
            workerSettings.restart_protection_count = settings.danger.restart_protection_count;
        }
        if (settings.danger?.restart_protection_time) {
            workerSettings.restart_protection_time = settings.danger.restart_protection_time * 1000;
        }
        if (settings.danger?.node_memory) {
            workerSettings.node_memory = settings.danger.node_memory;
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
    }

    /**
     * Starts the main application logic.
     */
    async start() {
        this.bridge.connect();
        this.systemService.start();

        console.log('🚀 Kernel starting application...');

        const { VERSION, SCRIPTS_DIR } = config;

        let startMsg = `Addon started (v${VERSION})...`;
        if (this.systemOptions.expert_mode) {
            startMsg += " (Expert Mode)";
        }
        this.logManager.add('info', 'System', startMsg);
        
        try {
            if (this.systemService.isSafeMode) {
                this.logManager.add('error', 'System', '🚨 SAFE MODE ACTIVATED: Excessive restarts detected. Scripts are disabled.');
            }

            await this.haConnector.connect();
            
            this.hasIntegration = await this.haConnector.checkIntegrationAvailable();
            const intMsg = this.hasIntegration 
                ? "✅ Native Integration (js_automations) detected." 
                : "⚠️ Native Integration not found. Using Legacy Mode (HTTP).";
            this.logManager.add(this.hasIntegration ? 'info' : 'warn', 'System', intMsg);

            this.workerManager.setConnector(this.haConnector);
            this.workerManager.setStore(this.storeManager);
            this.workerManager.setStorageDir(config.STORAGE_DIR);
            this.workerManager.setScriptsDir(config.SCRIPTS_DIR);

            const currentSettings = this.settingsManager.getSettings();
            this._updateWorkerManagerSettings(currentSettings);

            await this.entityManager.createExposedEntities(this.hasIntegration);
            
            this._setupSystemEventListeners();

            // Autostart scripts
            if (!this.systemService.isSafeMode) {
                const enabled = this.stateManager.getEnabledScripts();
                for (const file of enabled) {
                    const fullPath = path.join(SCRIPTS_DIR, file);
                    if (fs.existsSync(fullPath)) {
                        const meta = ScriptHeaderParser.parse(fullPath);
                        if (meta.dependencies.length > 0) await this.depManager.install(meta.dependencies, false);
                        this.workerManager.startScript(file);
                    }
                }
            }
            
            this.depManager.prune();

        } catch (err) {
            console.error(err);
            this.logManager.add('error', 'System', `Kernel start failed: ${err.message}`);
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

        // Worker lifecycle events
        this.workerManager.on('script_start', this._onScriptStart.bind(this));
        this.workerManager.on('script_exit', this._onScriptExit.bind(this));
        this.workerManager.on('log', this._onWorkerLog.bind(this));
    }
    
    _onScriptStart({ filename, meta }) {
        if (!meta || meta.expose !== 'button') {
            this.stateManager.saveScriptStarted(filename);
        }
        if (!meta || meta.expose !== 'switch') return;
        
        const scriptName = path.basename(filename, '.js');
        const entityId = `switch.js_automations_${scriptName}`.toLowerCase();
        const uniqueId = `js_automations_switch_${scriptName}`.toLowerCase();
        this.stateManager.set(entityId, 'on');
        
        const payload = { unique_id: uniqueId, state: 'on', icon: 'mdi:stop' };
        if (this.hasIntegration) {
            this.logManager.add('debug', 'System', `Updating system switch state via service: ${JSON.stringify(payload)}`);
            this.haConnector.callService('js_automations', 'update_entity', payload);
        } else {
            this.haConnector.updateState(entityId, 'on', { icon: 'mdi:stop' });
        }
        this.emit('status_update');
    }

    _onScriptExit(d) {
        if (!d.meta || d.meta.expose !== 'button') {
            const isPermanentStop = d.type === 'error' || d.reason === 'finished' || d.reason === 'by user' || d.reason.includes('stopped by user');
            if (isPermanentStop) {
                this.stateManager.saveScriptStopped(d.filename);
            }
        }

        if (d.meta && d.meta.expose === 'switch') {
            const scriptName = path.basename(d.filename, '.js');
            const entityId = `switch.js_automations_${scriptName}`.toLowerCase();
            const uniqueId = `js_automations_switch_${scriptName}`.toLowerCase();
            this.stateManager.set(entityId, 'off');
            
            const payload = { unique_id: uniqueId, state: 'off', icon: 'mdi:play' };
            if (this.hasIntegration) {
                this.logManager.add('debug', 'System', `Updating system switch state via service: ${JSON.stringify(payload)}`);
                this.haConnector.callService('js_automations', 'update_entity', payload);
            } else {
                this.haConnector.updateState(entityId, 'off', { icon: 'mdi:play' });
            }
        }
        
        this.logManager.add(d.type || 'info', 'System', `${path.basename(d.filename)} ${d.reason}`);
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
                
                // Re-Check Integration & Re-Register Entities
                this.hasIntegration = await this.haConnector.checkIntegrationAvailable();
                await this.entityManager.createExposedEntities(this.hasIntegration);
                await this.workerManager.republishNativeEntities();
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