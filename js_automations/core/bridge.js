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

        // Handle requests from the frontend
        this.io.on('connection', (socket) => {
            socket.on('get_integration_status', (callback) => {
                if (typeof callback === 'function') {
                    callback({ available: this.kernel.hasIntegration });
                }
            });
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

        // Relays integration status changes
        this.kernel.on('integration_status_changed', (available) => {
            this.io.emit('integration_status', { available });
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
