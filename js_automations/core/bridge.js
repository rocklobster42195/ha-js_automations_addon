/**
 * The Bridge service acts as a mediator between internal application events
 * and the external world, specifically the Socket.io server. It listens to
 * events emitted by the various managers and translates them into socket events
 * for the frontend, thus decoupling the core logic from the transport layer.
 */
class Bridge {
    /**
     * @param {import('./kernel')} kernel The application kernel.
     */
    constructor(kernel) {
        this.kernel = kernel;
        this.io = kernel.io;
    }

    /**
     * Connects the internal manager events to the external socket.io events.
     * This is where all the event relaying logic resides.
     */
    connect() {
        const { logManager } = this.kernel;

        // Tracks which sockets have the Event Inspector open
        const eventInspectorClients = new Set();

        // Tracks which sockets have the MQTT Monitor open
        const mqttMonitorClients = new Set();

        // Ring buffer of recent MQTT messages — replayed to clients on re-subscribe
        const mqttMessageCache = [];
        const MQTT_CACHE_MAX = 100;

        // Cache for watch tiles and inspect snapshots so reconnecting clients get current state.
        // watch tiles: filename::label → data; inspect snapshots: per-filename array (capped at 50)
        const watchTileCache = new Map();
        const inspectSnapshotCache = new Map(); // filename → data[]

        // --- Socket Lifecycle ---
        // Sync current system status whenever a client connects (e.g. after a restart or reload)
        this.io.on('connection', async (socket) => {
            const status = await this.kernel.getSystemStatus();
            socket.emit('integration_status', status);

            // Replay current watch state so the WATCH tab isn't empty after reconnect
            watchTileCache.forEach((data) => socket.emit('watch_update', data));
            inspectSnapshotCache.forEach((snapshots) => {
                // Replay oldest-first so the UI (which inserts at top) ends up newest-at-top
                snapshots.slice().reverse().forEach((data) => socket.emit('inspect_snapshot', data));
            });

            socket.on('subscribe_event_inspector', () => eventInspectorClients.add(socket.id));
            socket.on('unsubscribe_event_inspector', () => eventInspectorClients.delete(socket.id));

            socket.on('subscribe_mqtt_monitor', () => {
                mqttMonitorClients.add(socket.id);
                if (mqttMonitorClients.size === 1) this.kernel.mqttManager?.startMonitoring();
                mqttMessageCache.forEach(d => socket.emit('mqtt_message_stream', d));
            });
            socket.on('unsubscribe_mqtt_monitor', () => {
                mqttMonitorClients.delete(socket.id);
                if (mqttMonitorClients.size === 0) this.kernel.mqttManager?.stopMonitoring();
            });

            socket.on('disconnect', () => {
                eventInspectorClients.delete(socket.id);
                mqttMonitorClients.delete(socket.id);
                if (mqttMonitorClients.size === 0) this.kernel.mqttManager?.stopMonitoring();
            });

            socket.on('debug_continue', (filename) => {
                this.kernel.workerManager.continueBreakpoint(filename);
            });

            socket.on('mqtt_ui_publish', ({ topic, payload, retain }) => {
                if (typeof topic === 'string' && topic.trim() && this.kernel.mqttManager?.isConnected) {
                    this.kernel.mqttManager.publish(topic.trim(), payload ?? '', { retain: !!retain });
                }
            });

            socket.on('fire_ha_event', ({ event_type, data }) => {
                if (typeof event_type === 'string' && event_type.trim()) {
                    try { this.kernel.haConnector.fireEvent(event_type.trim(), data ?? {}); } catch (e) {}
                }
            });
        });

        // Breakpoint / watch / inspect events → all connected clients
        this.kernel.on('breakpoint_hit', (data) => this.io.emit('breakpoint_hit', data));
        this.kernel.on('breakpoint_continued', (data) => this.io.emit('breakpoint_continued', data));
        this.kernel.on('watch_update', (data) => {
            watchTileCache.set(`${data.filename}::${data.label}`, data);
            this.io.emit('watch_update', data);
        });
        this.kernel.on('inspect_snapshot', (data) => {
            if (!inspectSnapshotCache.has(data.filename)) inspectSnapshotCache.set(data.filename, []);
            const list = inspectSnapshotCache.get(data.filename);
            list.unshift(data);
            if (list.length > 50) list.length = 50;
            this.io.emit('inspect_snapshot', data);
        });
        this.kernel.on('watch_clear', (data) => {
            const prefix = `${data.filename}::`;
            for (const key of Array.from(watchTileCache.keys())) {
                if (key.startsWith(prefix)) watchTileCache.delete(key);
            }
            inspectSnapshotCache.delete(data.filename);
            this.io.emit('watch_clear', data);
        });

        // Store changes (ha.store / Store Explorer) → all connected clients
        this.kernel.storeManager?.on('changed', (data) => this.io.emit('store_changed', data));

        // MQTT traffic → ring buffer + subscribed MQTT Monitor clients only
        this.kernel.on('mqtt_traffic', (data) => {
            mqttMessageCache.push(data);
            if (mqttMessageCache.length > MQTT_CACHE_MAX) mqttMessageCache.shift();
            if (mqttMonitorClients.size === 0) return;
            mqttMonitorClients.forEach(id => this.io.to(id).emit('mqtt_message_stream', data));
        });

        // --- Log Events ---
        // Forwards any log added by managers to the frontend.
        logManager.on('log_added', (entry) => {
            if (entry) {
                this.io.emit('log', entry);
            }
        });

        // --- HA Events ---
        // Relays Home Assistant state changes to the UI for the status bar.
        this.kernel.on('ha_state_changed', (data) => {
            this.io.emit('ha_state_changed', data);
        });

        // Relays all HA events to subscribed Event Inspector clients only
        this.kernel.on('ha_event', (event) => {
            if (eventInspectorClients.size === 0) return;
            const payload = {
                t: Date.now(),
                type: event.event_type,
                data: event.data ?? {}
            };
            eventInspectorClients.forEach(id => this.io.to(id).emit('ha_event_stream', payload));
        });

        // Relays integration status changes
        this.kernel.on('integration_status_changed', (status) => {
            // Relay full status object to the frontend
            this.io.emit('integration_status', status);
        });

        // --- System Status Events ---
        // Relays script status changes to the UI.
        this.kernel.on('status_update', () => {
            this.io.emit('status_update');
        });

        // Listen for events from the SystemService
        const { systemService } = this.kernel;
        systemService.on('system_stats_updated', (stats) => {
            this.io.emit('system_stats', stats);
        });
        
        systemService.on('safe_mode_changed', (isSafeMode) => {
            this.io.emit('safe_mode', isSafeMode);
        });

        console.log('✅ Bridge connected. Ready to relay application events to the frontend.');
    }
}

module.exports = Bridge;
