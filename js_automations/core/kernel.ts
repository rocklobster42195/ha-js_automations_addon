// core/kernel.ts
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { Server as SocketIOServer } from 'socket.io';
import config from './config';
import ScriptHeaderParser from './script-header-parser';

// Ensure base directories exist before any manager is initialized
config.ensureDirectories();

// Global error handling to prevent the addon from crashing on unhandled HA rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Manager Imports
import HAConnector from './ha-connection';
import DependencyManager from './dependency-manager';
import StateManager from './state-manager';
import StoreManager from './store-manager';
import LogManager from './log-manager';
import SettingsManager from './settings-manager'; // Static-like module
import workerManager from './worker-manager'; // Singleton module
import MqttManager from './mqtt-manager';
import WebhookManager from './webhook-manager';
import EntityManager from './entity-manager';
import CompilerManager from './compiler-manager';
import BlocklyCompiler from './blockly-compiler';
import CardManager from './card-manager';
import Bridge from './bridge';
import SystemService from '../services/system-service';

// settings-manager.ts and worker-manager.ts export a singleton instance (export = new X()),
// not the class itself, so the type has to be derived from the module's export value.
type SettingsManagerInstance = typeof SettingsManager;
type WorkerManagerInstance = typeof workerManager;

interface KernelSettings {
  mqtt?: { enabled?: boolean };
  system?: { log_level?: string; default_throttle?: number };
  general?: { ui_language?: string };
  danger?: {
    restart_count?: number;
    restart_time?: number;
    node_memory?: number;
    filesystem_enabled?: boolean;
    capability_enforcement?: boolean;
    quota_internal?: number;
    quota_shared?: number;
    quota_media?: number;
  };
}

interface WorkerManagerSettingsPatch {
  restart_protection_count?: number;
  restart_protection_time?: number;
  node_memory?: number;
  ui_language?: string;
  default_throttle?: number;
  filesystem_enabled?: boolean;
  capability_enforcement?: boolean;
  quota_internal?: number;
  quota_shared?: number;
  quota_media?: number;
}

/**
 * The Kernel is the central orchestrator of the application.
 * It's responsible for booting, starting, and shutting down all services and managers.
 */
class Kernel extends EventEmitter {
  systemOptions: { expert_mode: boolean };
  lastStats: Record<string, unknown> | null;
  _mqttEverConnected: boolean;
  _startupCompleted: boolean;
  _reconnectState: { attempts: number; startedAt: number } | null;

  // Manager instances are only ever used after boot() has run, which unconditionally
  // assigns every one of them (or exits the process on failure) - so they're declared
  // with definite assignment assertions instead of a nullable type, matching that
  // construct-then-boot lifecycle instead of forcing null checks everywhere they're used.
  io!: SocketIOServer;
  logManager!: LogManager;
  settingsManager!: SettingsManagerInstance;
  haConnector!: HAConnector;
  depManager!: DependencyManager;
  stateManager!: StateManager;
  storeManager!: StoreManager;
  workerManager!: WorkerManagerInstance;
  entityManager!: EntityManager;
  mqttManager!: MqttManager;
  webhookManager!: WebhookManager;
  compilerManager!: CompilerManager;
  blocklyCompiler!: BlocklyCompiler;
  cardManager!: CardManager;
  systemService!: SystemService;
  bridge!: Bridge;

  constructor() {
    super();
    this.systemOptions = { expert_mode: true }; // Default options
    this.lastStats = null; // Cache for the latest system metrics
    this._mqttEverConnected = false; // Tracks whether MQTT has connected at least once
    this._startupCompleted = false; // Post-connect startup (autostart etc.) has run
    this._reconnectState = null;
  }

  /**
   * Gathers the current system status regarding HA and MQTT connectivity.
   * @returns A system status object.
   */
  async getSystemStatus() {
    const isConnected = this.haConnector.isReady;
    const mqttSettings = (this.settingsManager.getSettings() as KernelSettings)?.mqtt || {};
    const mqttStatus = {
      connected: this.mqttManager ? this.mqttManager.isConnected : false,
      enabled: mqttSettings.enabled || false,
    };

    return {
      // These flags are kept for UI compatibility
      installed: true,
      active: isConnected && mqttStatus.connected,
      is_connected: isConnected,
      display_version: config.VERSION,
      mqtt: mqttStatus,
      stats: this.lastStats, // Include stats for immediate status bar population
      // Lets clients that (re)connect after the boot-time 'safe_mode' event fired
      // still learn the current state, instead of only reacting to that one broadcast.
      safe_mode: this.systemService?.isSafeMode || false,
    };
  }

  /**
   * Boots the core systems.
   * Instantiates all managers and registers persistent event listeners.
   */
  boot(io: SocketIOServer): void {
    this.io = io;
    const { SCRIPTS_DIR, STORAGE_DIR, DIST_DIR } = config;

    // Instantiate managers
    try {
      this.logManager = new LogManager(STORAGE_DIR);
      this.settingsManager = SettingsManager;
      this.haConnector = new HAConnector(process.env.HA_URL || '', process.env.HA_TOKEN, STORAGE_DIR);
      this.depManager = new DependencyManager(SCRIPTS_DIR, STORAGE_DIR);
      this.stateManager = new StateManager(STORAGE_DIR);
      this.storeManager = new StoreManager(STORAGE_DIR);
      this.compilerManager = new CompilerManager(SCRIPTS_DIR, DIST_DIR, STORAGE_DIR);
      this.blocklyCompiler = new BlocklyCompiler(SCRIPTS_DIR, DIST_DIR);
      this.mqttManager = new MqttManager(this.settingsManager, this.logManager, this.haConnector);
      this.webhookManager = new WebhookManager(this.settingsManager, this.logManager, STORAGE_DIR);
      this.workerManager = workerManager;

      // Initialize WorkerManager paths immediately so other managers can use them.
      this.workerManager.setStorageDir(STORAGE_DIR);
      this.workerManager.setScriptsDir(SCRIPTS_DIR);
      this.workerManager.setStore(this.storeManager);
      this.workerManager.setMqttManager(this.mqttManager);
      this.workerManager.setWebhookManager(this.webhookManager);

      // CardManager — handles Script Pack card installation
      this.cardManager = new CardManager(STORAGE_DIR, config.WWW_CARDS_DIR, this.haConnector);
      this.workerManager.cardManager = this.cardManager;

      // Create SystemService before EntityManager so we can pass it
      this.systemService = new SystemService(config, this.workerManager);

      this.entityManager = new EntityManager(
        this.haConnector,
        this.workerManager,
        this.stateManager,
        this.depManager,
        this.systemService,
        this.mqttManager,
        this.compilerManager,
        this.blocklyCompiler
      );
    } catch (err) {
      console.error('❌ Critical error during Kernel boot:', err);
      process.exit(1); // Exit with error code so the supervisor can restart the container
    }

    // The bridge connects the kernel to the outside world (Socket.io)
    this.bridge = new Bridge(this);

    this.logManager.add('debug', 'System', 'Kernel boot completed. All managers initialized.');

    // Initial log level
    const currentSettings = this.settingsManager.getSettings() as KernelSettings;
    if (currentSettings.system && currentSettings.system.log_level) {
      this.logManager.setLevel(currentSettings.system.log_level);
    }

    // Register event listeners that should be active immediately after boot
    this._registerStaticEventListeners();
  }

  /**
   * Updates worker settings based on the main settings file.
   * @private
   */
  _updateWorkerManagerSettings(settings: KernelSettings): void {
    const workerSettings: WorkerManagerSettingsPatch = {};
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
    if (settings.danger?.filesystem_enabled !== undefined) {
      workerSettings.filesystem_enabled = settings.danger.filesystem_enabled;
    }
    if (settings.danger?.capability_enforcement !== undefined) {
      workerSettings.capability_enforcement = settings.danger.capability_enforcement;
    }
    if (settings.danger?.quota_internal !== undefined) {
      workerSettings.quota_internal = settings.danger.quota_internal;
    }
    if (settings.danger?.quota_shared !== undefined) {
      workerSettings.quota_shared = settings.danger.quota_shared;
    }
    if (settings.danger?.quota_media !== undefined) {
      workerSettings.quota_media = settings.danger.quota_media;
    }
    if (Object.keys(workerSettings).length > 0) {
      this.workerManager.setSettings(workerSettings);
    }
  }

  /**
   * Registers event listeners that persist through the application's lifecycle.
   * @private
   */
  _registerStaticEventListeners(): void {
    // Settings changes
    this.settingsManager.on('settings_updated', (newSettings: KernelSettings) => {
      if (newSettings.system && newSettings.system.log_level) {
        this.logManager.setLevel(newSettings.system.log_level);
      }
      this._updateWorkerManagerSettings(newSettings);
    });

    // Forward NPM logs to the LogManager
    this.depManager.on('log', ({ level, message }: { level: string; message: string }) => {
      this.logManager.add(level, 'System', message);
    });

    // Forward human-readable Compiler logs
    this.compilerManager.on('log', ({ level, message }: { level: string; message: string }) => {
      this.logManager.add(level, 'System', message);
    });

    // Forward technical Compiler signals (for Editor markers) via Socket only
    this.compilerManager.on('compiler_signal', (data: unknown) => {
      if (this.io) this.io.emit('compiler_signal', data);
    });

    // Same forwarding for the Blockly compiler
    this.blocklyCompiler.on('log', ({ level, message }: { level: string; message: string }) => {
      this.logManager.add(level, 'System', message);
    });
    this.blocklyCompiler.on('compiler_signal', (data: unknown) => {
      if (this.io) this.io.emit('compiler_signal', data);
    });

    // Forward MQTT status to UI
    this.mqttManager.on('status_change', async (status: { connected: boolean }) => {
      if (this.io) {
        this.io.emit('mqtt_status_changed', status);
        // UX: Push full system status update so banners and indicators can react immediately
        const fullStatus = await this.getSystemStatus();
        this.emit('integration_status_changed', fullStatus);
      }
      // On MQTT reconnect (not the first connect — kernel.start() handles that),
      // republish entity discovery payloads so HA picks them up again.
      if (status.connected && this._mqttEverConnected && this.entityManager) {
        try {
          await this.entityManager.createExposedEntities();
          await this.workerManager.republishNativeEntities(false);
        } catch (e) {
          this.logManager?.add(
            'warn',
            'System',
            `[Kernel] Entity republish after MQTT reconnect failed: ${(e as Error).message}`
          );
        }
      }
      if (status.connected) this._mqttEverConnected = true;
    });

    // Forward webhook registry/call events to the UI (Webhook Panel)
    this.webhookManager.on('registry_changed', () => {
      if (this.io) this.io.emit('webhook_registry_changed', this.webhookManager.listWebhooks());
    });
    this.webhookManager.on('call_logged', (data: unknown) => {
      if (this.io) this.io.emit('webhook_call_logged', data);
    });
    this.webhookManager.on('config_changed', (webhookConfig: unknown) => {
      if (this.io) this.io.emit('webhook_config_changed', webhookConfig);
    });
  }

  /**
   * Starts the main application logic.
   */
  async start(): Promise<void> {
    this.bridge.connect();
    this.systemService.start();

    console.log('🚀 Kernel starting application...');

    const { VERSION, SCRIPTS_DIR } = config;

    const startMsg = `Addon started (v${VERSION})...`;
    this.logManager.add('info', 'System', startMsg);

    try {
      this.compilerManager.ensureTsConfig();

      // Clean up orphaned files in dist before starting
      await this.compilerManager.pruneDist();

      // Perform initial full compilation pass for all TypeScript files
      this.logManager.add('debug', 'System', 'Starting initial TypeScript compilation pass...');
      const tsFiles: string[] = [];
      const scanForTs = (dir: string): void => {
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
      for (const tsFile of tsFiles) {
        await this.compilerManager.transpile(tsFile);
      }
      if (tsFiles.length > 0)
        this.logManager.add('debug', 'System', `Initial compilation pass completed. Checked ${tsFiles.length} files.`);

      // Same initial pass for .blocks files, so dist/*.js exists for enabled Blockly
      // scripts after a restart, not just after the next save.
      const blocksFiles: string[] = [];
      const scanForBlocks = (dir: string): void => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '.storage' && entry.name !== 'node_modules') scanForBlocks(fullPath);
          } else if (entry.name.endsWith('.blocks')) {
            blocksFiles.push(fullPath);
          }
        }
      };
      scanForBlocks(SCRIPTS_DIR);
      for (const blocksFile of blocksFiles) {
        await this.blocklyCompiler.compile(blocksFile);
      }
      if (blocksFiles.length > 0)
        this.logManager.add(
          'debug',
          'System',
          `Initial Blockly compilation pass completed. Checked ${blocksFiles.length} files.`
        );

      if (this.systemService.isSafeMode) {
        this.logManager.add(
          'error',
          'System',
          '🚨 SAFE MODE ACTIVATED: Excessive restarts detected. Scripts are disabled.'
        );
      }

      // If HA is not reachable yet (e.g. the addon boots alongside HA and
      // the Supervisor proxy answers 502), don't abort the whole startup —
      // the reconnect loop calls _finishStartup() once HA comes up, so
      // event subscriptions and script autostart still happen.
      try {
        await this.haConnector.connect();
      } catch (err) {
        console.error('⚠️ Initial HA connection failed:', (err as Error).message);
        this.logManager.add(
          'warn',
          'System',
          `Initial HA connection failed: ${(err as Error).message} — startup will complete once HA is reachable.`
        );
        return;
      }

      await this._finishStartup();
    } catch (err) {
      console.error(err);
      this.logManager.add('error', 'System', `Kernel start failed: ${(err as Error).message}`);
    }
  }

  /**
   * Completes the startup once a HA connection exists: MQTT, entities, event
   * listeners, and script autostart. Runs exactly once — either directly from
   * start(), or from handleReconnection() if the initial connect failed.
   * @private
   */
  async _finishStartup(): Promise<void> {
    if (this._startupCompleted) return;
    this._startupCompleted = true;

    const { SCRIPTS_DIR } = config;

    try {
      await this.mqttManager.connect();

      // Update System Language from HA Config
      const haConfig = await this.haConnector.getHAConfig();
      if (haConfig && haConfig.language) {
        this.workerManager.setSystemLanguage(haConfig.language as string);
      }

      const status = await this.getSystemStatus();
      this.emit('integration_status_changed', status);

      this.workerManager.setConnector(this.haConnector);

      const currentSettings = this.settingsManager.getSettings() as KernelSettings;
      this._updateWorkerManagerSettings(currentSettings);

      await this.entityManager.createExposedEntities();

      this._setupSystemEventListeners();

      // Autostart scripts
      if (!this.systemService.isSafeMode) {
        const enabled = this.stateManager.getEnabledScripts();
        // Stagger starts: with many scripts, firing every ha.register() (MQTT
        // discovery) and HA service call in the same tick can overwhelm HA's own
        // boot, causing ACK timeouts and "Service Call Timeout" errors across the
        // board. A small gap spreads the burst out instead of front-loading it all.
        const AUTOSTART_STAGGER_MS = 300;
        for (const file of enabled) {
          const fullPath = path.join(SCRIPTS_DIR, file);

          if (fs.existsSync(fullPath)) {
            const meta = ScriptHeaderParser.parse(fullPath);
            const dependencies = 'dependencies' in meta ? meta.dependencies : [];
            if (dependencies.length > 0) await this.depManager.install(dependencies, false);
            this.workerManager.startScript(file);
            await new Promise((r) => setTimeout(r, AUTOSTART_STAGGER_MS));
          }
        }
      }

      this.depManager.prune();

      // Run an initial cleanup immediately to remove leftovers from offline time
      await this.performGlobalCleanup();

      // Start periodic cleanup (every hour)
      setInterval(() => this.performGlobalCleanup(), 3600000);
      this.logManager.add('debug', 'System', 'Kernel background maintenance loops started.');

      // Card startup cleanup: remove orphaned Lovelace resources and card files
      // for scripts that no longer exist or no longer carry a @card header.
      // Deliberately not awaited and delayed a few seconds — this is pure
      // housekeeping, not required for scripts to run. Awaiting it inline used to
      // block script autostart behind slow Lovelace WebSocket round-trips (up to
      // their full 15s timeout) during the busiest window of the boot, when the
      // event loop is also handling the initial state flood and MQTT discovery.
      setTimeout(() => {
        const knownCardNames = this.workerManager
          .getScripts()
          .map((p) => {
            const meta: any = ScriptHeaderParser.parse(p);
            if (!meta.card) return null;
            return path.basename(p, path.extname(p)) + '-card';
          })
          .filter((name): name is string => Boolean(name));
        this.cardManager
          .performStartupCleanup(knownCardNames)
          .catch((e) => console.warn('[Kernel] Card startup cleanup failed:', e.message));
      }, 10000);
    } catch (err) {
      console.error(err);
      this.logManager.add('error', 'System', `Kernel start failed: ${(err as Error).message}`);
    }
  }

  /**
   * Compares entities in Home Assistant with existing script files
   * and removes orphaned entries. Triggered hourly.
   */
  async performGlobalCleanup(): Promise<void> {
    if (!this.haConnector.isReady || !this.mqttManager.isConnected) {
      this.logManager.add('debug', 'System', '[Kernel] Skipping cleanup: HA or MQTT not connected.');
      return;
    }

    this.logManager.add('debug', 'System', '[Kernel] Running hourly entity and device cleanup check...');

    // 1. Get all script names (without extension) from disk and slugify them
    // This ensures they match the slugified identifiers used for Home Assistant entities.
    const scripts = this.workerManager.getScripts().map((p) => {
      const name = path.basename(p, path.extname(p));
      return name
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
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
  _setupSystemEventListeners(): void {
    // Deduplicate jsa_action events — on WS reconnect a second global subscription can
    // briefly overlap the first, causing the same event to be delivered twice.
    const _seenCorrIds = new Set<string>();

    // HA state changes + jsa_action routing
    this.haConnector.subscribeToEvents((event) => {
      if (event.event_type === 'state_changed') {
        const { entity_id, new_state, old_state } = event.data;
        this.workerManager.dispatchStateChange(entity_id, new_state, old_state);
        // Forward to UI for Status Bar and card preview live data
        this.emit('ha_state_changed', { entity_id, new_state });
      }
      // Forward all events to the Event Inspector (opt-in via bridge)
      this.emit('ha_event', event);

      // Forward non-state events to workers subscribed via ha.onEvent()
      if (event.event_type !== 'state_changed') {
        this.workerManager.dispatchCustomEvent(event);
      }

      // Forward card runtime errors (caught by the __jsa__ error boundary) to the script log
      if (event.event_type === 'jsa_card_error') {
        const { script, message, line } = event.data ?? {};
        if (script && message) {
          this.logManager.add('error', script, '[Card] ' + message + (line ? ' (line ' + line + ')' : ''));
        }
      }

      // Route card-side __jsa__.callAction() calls back to the running script
      if (event.event_type === 'jsa_action') {
        const { script, action, payload, correlation_id } = event.data ?? {};
        if (!script || !action || !correlation_id) return;
        if (_seenCorrIds.has(correlation_id)) return;
        _seenCorrIds.add(correlation_id);
        setTimeout(() => _seenCorrIds.delete(correlation_id), 30000);

        const filename = script.replace(/\.(js|ts)$/, '');
        this.workerManager
          .callAction(filename, action, payload ?? {})
          .then((result) => this.haConnector.fireEvent('jsa_action_result', { correlation_id, result }))
          .catch((err) => this.haConnector.fireEvent('jsa_action_result', { correlation_id, error: err.message }));
      }
    });

    this.systemService.on('system_stats_updated', (stats) => {
      this.lastStats = stats;
    });

    // Worker lifecycle events
    this.workerManager.on('script_start', this._onScriptStart.bind(this));
    this.workerManager.on('script_exit', this._onScriptExit.bind(this));
    this.workerManager.on('log', this._onWorkerLog.bind(this));

    // Developer tools: breakpoint / watch / inspect events
    this.workerManager.on('breakpoint_hit', (data: unknown) => this.emit('breakpoint_hit', data));
    this.workerManager.on('breakpoint_continued', (data: unknown) => this.emit('breakpoint_continued', data));
    this.workerManager.on('watch_update', (data: unknown) => this.emit('watch_update', data));
    this.workerManager.on('inspect_snapshot', (data: unknown) => this.emit('inspect_snapshot', data));
    this.workerManager.on('watch_clear', (data: unknown) => this.emit('watch_clear', data));

    // Developer tools: MQTT traffic monitor
    if (this.mqttManager) {
      this.mqttManager.on('raw_message', (data: unknown) => this.emit('mqtt_traffic', data));
    }

    // Notify frontend when type definitions are updated
    this.workerManager.on('typings_generated', () => {
      if (this.io) this.io.emit('typings_updated');
    });
  }

  _onScriptStart({ filename, meta }: { filename: string; meta: any }): void {
    if (!meta || meta.expose !== 'button') {
      // StateManager still tracks by filename for persistence,
      // but EntityManager now handles the HA state via events.
      this.stateManager.saveScriptStarted(filename);
    }
    this.emit('status_update');
  }

  _onScriptExit(d: { filename: string; reason: string; type: string; meta: any }): void {
    if (!d.meta || d.meta.expose !== 'button') {
      // Any exit is a permanent stop (removes the script from autostart on next boot),
      // except reasons that are inherently transient: the script keeps running under a
      // new worker (restart/hot-reload/rename/dependency update) or the whole addon is
      // going down and should resume the script on its next start.
      const transientReasons = [
        'restarting',
        'restarted by script',
        'hot-reload',
        'renaming/moving',
        'library update',
        'system shutdown',
      ];

      if (d.type === 'error') {
        // Crashed (uncaught exception), not an explicit stop — most crashes are
        // transient (e.g. an unhandled HA call failure during a HA/Supervisor
        // restart), so try to recover automatically instead of giving up right
        // away. startScript()'s own restart-rate safeguard (Settings > Danger
        // Zone) caps how many times this can happen in a row, so a script that's
        // actually broken still ends up stopped instead of looping forever.
        const restarted = this.workerManager.startScript(d.filename);
        if (!restarted) {
          this.stateManager.saveScriptStopped(d.filename);
        }
      } else if (!transientReasons.includes(d.reason)) {
        this.stateManager.saveScriptStopped(d.filename);
      }
    }

    // UX: Log normal exits as DEBUG to keep the System log clean.
    const level = d.type === 'success' ? 'debug' : d.type || 'info';
    this.logManager.add(level, 'System', `${path.basename(d.filename)} ${d.reason}`);
    this.emit('status_update');
  }

  /**
   * Tells running scripts that the HA connection was lost or restored, so scripts
   * that care can react (e.g. pause their own logic) via ha.onConnectionChange().
   */
  _notifyConnectionChange(connected: boolean): void {
    if (this.workerManager) {
      this.workerManager.broadcastToWorkers({ type: 'ha_connection_changed', connected });
    }
  }

  _onWorkerLog(data: { level?: string; source: string; message: string; blockId?: string; scriptId?: string }): void {
    this.logManager.add(data.level || 'info', data.source, data.message, {
      blockId: data.blockId,
      scriptId: data.scriptId,
    });
  }

  /**
   * Handles the auto-reconnection logic for Home Assistant.
   *
   * Called on a fixed poll interval (see server.js). During a longer HA/HAOS
   * restart this can fire many times before the connection comes back, so
   * "lost"/"failed" are only logged on the first attempt and then every
   * RECONNECT_LOG_EVERY attempts, instead of once per tick, to avoid
   * flooding the System log with identical lines.
   */
  async handleReconnection(): Promise<void> {
    const RECONNECT_LOG_EVERY = 6; // ~30s at the current 5s poll interval

    if (!this.haConnector.isReady) {
      if (!this._reconnectState) {
        this._reconnectState = { attempts: 0, startedAt: Date.now() };
        console.log('⚠️ HA Connection lost. Attempting to reconnect...');
        this.logManager.add('warn', 'System', 'HA Connection lost. Attempting to reconnect...');
        this._notifyConnectionChange(false);
      }
      const state = this._reconnectState;
      state.attempts++;

      try {
        await this.haConnector.connect();
        const downtimeSec = Math.round((Date.now() - state.startedAt) / 1000);
        console.log(`✅ HA Reconnected! (after ${state.attempts} attempt(s), ${downtimeSec}s downtime)`);
        this.logManager.add(
          'info',
          'System',
          `HA Reconnected! (after ${state.attempts} attempt(s), ${downtimeSec}s downtime)`
        );
        this._reconnectState = null;
        this._notifyConnectionChange(true);

        // If the initial connect during start() failed, the whole
        // post-connect startup (event subscriptions, autostart, MQTT)
        // is still pending — run it now instead of the plain
        // reconnect refresh below.
        if (!this._startupCompleted) {
          this.logManager.add('info', 'System', 'Completing deferred startup after first successful HA connection...');
          await this._finishStartup();
          return;
        }

        // Update System Language
        const haConfig = await this.haConnector.getHAConfig();
        if (haConfig && haConfig.language) {
          this.workerManager.setSystemLanguage(haConfig.language as string);
        }

        // Notify UI
        const status = await this.getSystemStatus();
        this.emit('integration_status_changed', status);

        await this.entityManager.createExposedEntities();
        await this.workerManager.republishNativeEntities(false);

        // Defense-in-depth: a HAOS/HA-core restart is also the window where the
        // MQTT broker can be briefly down, which can leave the one-shot connect()
        // from kernel.start() stuck. Force a fresh MQTT attempt if still not connected.
        if (this.mqttManager) this.mqttManager.ensureConnected();
      } catch (e) {
        console.error(`❌ Reconnection failed (attempt ${state.attempts}):`, (e as Error).message);
        if (state.attempts === 1 || state.attempts % RECONNECT_LOG_EVERY === 0) {
          this.logManager.add(
            'error',
            'System',
            `Reconnection failed (attempt ${state.attempts}): ${(e as Error).message}`
          );
        }
      }
    }
  }

  /**
   * Shuts down the application gracefully.
   */
  shutdown(): void {
    console.log('🛑 Kernel shutting down...');
    // A graceful shutdown (SIGTERM/SIGINT) shouldn't count toward the bootloop
    // window — only unexpected crashes/kills should be able to trip Safe Mode.
    if (this.systemService) this.systemService.markCleanShutdown();
    if (this.workerManager) this.workerManager.shutdown();
    // HAConnector has no disconnect() method — close the raw WebSocket
    if (this.haConnector?.ws) {
      try {
        this.haConnector.ws.close();
      } catch {
        /* already closed */
      }
    }
    this.emit('shutdown');
  }
}

export = new Kernel();
