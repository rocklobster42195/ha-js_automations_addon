/**
 * JS AUTOMATIONS - Socket Client
 * Handles real-time communication with the backend.
 */

window.socket = null;
var overlayTimeout = null;

// Cache for the last known integration status to prevent UI flickering/reset
window._lastIntegrationStatus = undefined;

/**
 * Global function to update HA Integration Status UI.
 */
window.updateIntegrationStatusUI = function() {
    // Legacy wrapper to maintain compatibility with other scripts.
    if (typeof window.updateSystemNotifications === 'function') {
        window.updateSystemNotifications();
    }
};

/**
 * Injects the sidebar footer if it doesn't exist.
 * This fixes the ReferenceError: injectSidebarFooter is not defined.
 */
window.injectSidebarFooter = function() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('sidebar-footer')) return;
    
    const footer = document.createElement('div');
    footer.id = 'sidebar-footer';
    footer.className = 'sidebar-footer';
    sidebar.appendChild(footer);
    console.debug('UI: Sidebar footer injected.');
};

function initSocket() {
    // BASE_PATH is global from api.js.
    window.socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    
    // Helper: Central control for Heartbeat UI and Connection Overlay.
    const updateConnectionUI = (isConnected) => {
        const hb = document.getElementById('heartbeat-icon');
        const overlay = document.getElementById('connection-lost-overlay');
        
        // 1. Heartbeat Icon
        if (hb) {
            const hbParent = hb.parentElement;
            if (hbParent) hbParent.title = isConnected ? i18next.t('statusbar.ha_connected') : i18next.t('statusbar.ha_disconnected');
            hb.className = `mdi ${isConnected ? 'mdi-circle-slice-8' : 'mdi-circle-outline'} heartbeat-icon`;
            hb.style.color = isConnected ? '#fff' : 'var(--danger)';
            hb.style.opacity = '1';
            hb.dataset.status = isConnected ? 'connected' : 'disconnected';
            // Reset rotation on connection success.
            if (isConnected) hb.style.transform = '';
        }

        // 2. Overlay
        if (overlay) {
            if (isConnected) {
                if (overlayTimeout) {
                    clearTimeout(overlayTimeout);
                    overlayTimeout = null;
                }
                overlay.classList.add('hidden');
                document.body.classList.remove('offline-mode');
            } else {
                if (!overlayTimeout && overlay.classList.contains('hidden')) {
                    overlayTimeout = setTimeout(() => {
                        overlay.classList.remove('hidden');
                        document.body.classList.add('offline-mode');
                        overlayTimeout = null;
                    }, 2000);
                }
            }
        }
    };

    const handleConnectionEstablished = () => {
        updateConnectionUI(true);
        if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();

        // Request latest status explicitly to avoid race conditions.
        requestIntegrationStatus();
        if (typeof loadScripts === 'function') loadScripts();
        // Re-fetch log history on every (re)connect to catch logs emitted before
        // the socket was established (e.g. during addon startup ingress delay).
        if (typeof initLogs === 'function') initLogs();
    };

    window.socket.on('connect', handleConnectionEstablished);

    window.socket.on('disconnect', () => {
        updateConnectionUI(false);
        if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();
    });

    window.socket.on('log', d => { if(typeof appendLog === 'function') appendLog(d); });
    window.socket.on('status_update', () => { if(typeof loadScripts === 'function') loadScripts(); });
    
    window.socket.on('system_stats', (data) => {
        const hb = document.getElementById('heartbeat-icon');
        if (hb) {
            // If we receive data but UI shows disconnected, handle as silent reconnect.
            if (hb.dataset.status === 'disconnected') {
                handleConnectionEstablished();
            }
        }

        // Update status bar slots if the function is available.
        if (typeof window.updateStatusBarUI === 'function') {
            window.updateStatusBarUI(data);
        }

        if (data.script_stats && typeof updateScriptStats === 'function') {
            updateScriptStats(data.script_stats);
        }
    });

    window.socket.on('integration_status', (data) => {
        console.log('Socket: Received integration_status update:', data);

        window._lastIntegrationStatus = data;
        // Update global status used by app.js logic
        window.currentIntegrationStatus = data;

        const available = (data && typeof data === 'object') ? (data.is_running || data.available) : data;

        window.updateIntegrationStatusUI(true, available);

        // Sync MQTT indicator with current connection state (fixes race condition on page reload)
        if (data?.mqtt && typeof statusBar !== 'undefined') {
            statusBar.updateMqttIndicator(data.mqtt);
        }

        // Immediately update status bar slots if stats are included in the status.
        if (data.stats && typeof window.updateStatusBarUI === 'function') {
            window.updateStatusBarUI(data.stats);
        }

        // Global notification update (updates banner and settings categories).
        if (typeof window.updateSystemNotifications === 'function') {
            window.updateSystemNotifications();
        }
    });

    /**
     * Requests current integration status from backend.
     * Called after socket connection to ensure UI synchronization.
     */
    function requestIntegrationStatus() {
        if (!window.socket || !window.socket.connected) return;
        window.socket.emit('get_integration_status', (response) => {
            if (response && response.error) {
                console.error("Socket: Error requesting integration status:", response.error);
                if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();
            } else {
                window.currentIntegrationStatus = response;
                // Update MQTT indicator in status bar
                if (response?.mqtt && typeof statusBar !== 'undefined') statusBar.updateMqttIndicator(response.mqtt);
                // Update integration banner
                if (typeof window.handleIntegrationStatus === 'function') window.handleIntegrationStatus(response);
                if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();
            }
        });
    }

    // Wake-Up / Focus Handler.
    // Refreshes MQTT indicator and banner when the tab becomes visible again.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (window.socket && !window.socket.connected) {
                updateConnectionUI(false);
                window.socket.connect();
            } else {
                // Socket still connected: pull fresh integration status to update
                // the MQTT indicator and banner without waiting for a server-push event.
                requestIntegrationStatus();
            }
        }
    });
}

// Global helper for the overlay button
window.manualReload = function() {
    window.location.reload();
};

/**
 * Fetches all HA States via WebSocket.
 * Waits for connection if not already established.
 */
window.getHAStates = function() {
    return new Promise((resolve, reject) => {
        if (!window.socket) return reject(new Error("Socket not initialized"));
        
        const request = () => {
            window.socket.emit('get_ha_states', (response) => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        };

        if (window.socket.connected) request();
        else window.socket.once('connect', request);
        
        // Timeout after 10s.
        setTimeout(() => reject(new Error("Socket timeout (get_ha_states)")), 10000);
    });
};

window.initSocket = initSocket;