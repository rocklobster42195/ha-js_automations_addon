/**
 * JS AUTOMATIONS - Socket Client
 * Handles real-time communication with the backend.
 */

window.socket = null;
var overlayTimeout = null;

// Cache for the last known integration status to prevent UI flickering/reset
window._lastIntegrationStatus = undefined;

// Global function to update HA Integration Status UI
window.updateIntegrationStatusUI = function() {
    // Legacy wrapper to maintain compatibility with other scripts
    if (typeof window.updateSystemNotifications === 'function') {
        window.updateSystemNotifications();
    }
};

function initSocket() {
    // BASE_PATH is global from api.js
    window.socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    
    // Helper: UI Update für Herz & Overlay zentral steuern
    const updateConnectionUI = (isConnected) => {
        const hb = document.getElementById('heartbeat-icon');
        const overlay = document.getElementById('connection-lost-overlay');
        
        // 1. Heartbeat Icon
        if (hb) {
            const hbParent = hb.parentElement;
            if (hbParent) hbParent.title = `HA API: ${isConnected ? 'Connected' : 'Disconnected'}`; // Tooltip aktualisieren
            hb.className = `mdi ${isConnected ? 'mdi-circle-slice-8' : 'mdi-circle-outline'} heartbeat-icon`;
            hb.style.color = isConnected ? '#fff' : 'var(--danger)';
            hb.style.opacity = '1';
            hb.dataset.status = isConnected ? 'connected' : 'disconnected';
            // Rotation nur bei Connected zurücksetzen (falls es mal gespinnt hat)
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
        // Don't reset UI to gray here, rely on existing status from fetch
        requestIntegrationStatus(); // Explizit den Status anfordern
        if (typeof loadScripts === 'function') loadScripts();
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
            // Falls wir Daten empfangen, die UI aber "getrennt" anzeigt, war es ein stiller Reconnect.
            if (hb.dataset.status === 'disconnected') {
                handleConnectionEstablished();
            }
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

        // Global notification update (updates banner and settings categories)
        if (typeof window.updateSystemNotifications === 'function') {
            window.updateSystemNotifications();
        }
    });

    /**
     * Fordert den aktuellen Integrationsstatus vom Backend an.
     * Wird nach dem Socket-Connect aufgerufen, um Race Conditions zu vermeiden.
     */
    function requestIntegrationStatus() {
        if (!window.socket || !window.socket.connected) return;
        window.socket.emit('get_integration_status', (response) => {
            if (response && response.error) {
                console.error("Socket: Error requesting integration status:", response.error);
                if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();
            } else {
                console.log("Socket: Received integration status response:", response);
                
                window.currentIntegrationStatus = response;
                
                // Trigger global UI update
                if (typeof window.updateSystemNotifications === 'function') window.updateSystemNotifications();
            }
        });
    }

    // Mobile Wake-Up Handler
    // Prüft beim Aufwecken des Handys sofort den Status
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('📱 App active: Checking connection...');
            if (window.socket && !window.socket.connected) {
                console.log('🔌 Socket disconnected. Forcing reconnect...');
                updateConnectionUI(false);
                window.socket.connect();
            }
        }
    });
}

// Global helper for the overlay button
window.manualReload = function() {
    window.location.reload();
};

/**
 * Ruft alle HA States über den WebSocket ab.
 * Wartet auf Verbindung, falls noch nicht verbunden.
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
        
        // Timeout nach 10s (falls Server nicht antwortet)
        setTimeout(() => reject(new Error("Socket timeout (get_ha_states)")), 10000);
    });
};

window.initSocket = initSocket;