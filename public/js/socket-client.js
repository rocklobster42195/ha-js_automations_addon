/**
 * JS AUTOMATIONS - Socket Client
 * Handles real-time communication with the backend.
 */

var socket = null;
var overlayTimeout = null;

// Global function to update HA Integration Status UI
window.updateIntegrationStatusUI = function(isConnected, isIntegrationAvailable = null) { // isConnected: Socket zum Backend, isIntegrationAvailable: Backend zu HA-Integration
    const el = document.getElementById('integration-status-item');
    const icon = document.getElementById('integration-status-icon');
    if (!el || !icon) return;

    if (!isConnected) {
        el.title = 'HA Integration: Disconnected (Socket)';
        icon.style.backgroundColor = 'var(--danger)'; // Rot
        icon.style.opacity = '1';
    } else if (isIntegrationAvailable === null) {
        el.title = 'HA Integration: Checking...';
        icon.style.backgroundColor = '#999'; // Grau
        icon.style.opacity = '0.3'; // Gedimmt
    } else if (isIntegrationAvailable) {
        el.title = 'HA Integration: Available';
        icon.style.backgroundColor = '#fff'; // Weiß
        icon.style.opacity = '1';
    } else {
        el.title = 'HA Integration: Not available (Legacy Mode)';
        icon.style.backgroundColor = 'var(--warn)'; // Orange (Warnfarbe für Legacy)
        icon.style.opacity = '1';
    }
};

function initSocket() {
    // BASE_PATH is global from api.js
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    
    // Helper: UI Update für Herz & Overlay zentral steuern
    const updateConnectionUI = (isConnected) => {
        const hb = document.getElementById('heartbeat-icon');
        const overlay = document.getElementById('connection-lost-overlay');
        
        // 1. Heartbeat Icon
        if (hb) {
            const hbParent = hb.parentElement;
            if (hbParent) hbParent.title = `Backend Heartbeat: ${isConnected ? 'Connected' : 'Disconnected'}`; // Tooltip aktualisieren
            hb.style.backgroundColor = isConnected ? '#fff' : 'var(--danger)';
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
        // Initial status for integration is unknown on connect
        requestIntegrationStatus(); // Explizit den Status anfordern
        window.updateIntegrationStatusUI(true, null);
        if (typeof loadScripts === 'function') loadScripts();
    };

    socket.on('connect', handleConnectionEstablished);

    socket.on('disconnect', () => {
        updateConnectionUI(false);
        // Integration is definitely not available if socket is disconnected
        window.updateIntegrationStatusUI(false, false);
    });

    socket.on('log', d => { if(typeof appendLog === 'function') appendLog(d); });
    socket.on('status_update', () => { if(typeof loadScripts === 'function') loadScripts(); });
    
    socket.on('system_stats', (data) => {
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

    socket.on('integration_status', (data) => {
        console.log('Socket: Received integration_status event:', data);
        window.updateIntegrationStatusUI(true, data.available);
    });

    /**
     * Fordert den aktuellen Integrationsstatus vom Backend an.
     * Wird nach dem Socket-Connect aufgerufen, um Race Conditions zu vermeiden.
     */
    function requestIntegrationStatus() {
        if (!socket || !socket.connected) return;
        socket.emit('get_integration_status', (response) => {
            if (response && response.error) {
                console.error("Socket: Error requesting integration status:", response.error);
                console.error("Socket: Error requesting integration status:", response.error);
                window.updateIntegrationStatusUI(true, false); // Annahme: Fehler bedeutet nicht verfügbar
            } else {
                console.log("Socket: Received integration status response:", response);
                window.updateIntegrationStatusUI(true, response.available);
            }
        });
    }

    // Mobile Wake-Up Handler
    // Prüft beim Aufwecken des Handys sofort den Status
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('📱 App active: Checking connection...');
            if (!socket.connected) {
                console.log('🔌 Socket disconnected. Forcing reconnect...');
                updateConnectionUI(false);
                socket.connect();
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
        if (!socket) return reject(new Error("Socket not initialized"));
        
        const request = () => {
            socket.emit('get_ha_states', (response) => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        };

        if (socket.connected) request();
        else socket.once('connect', request);
        
        // Timeout nach 10s (falls Server nicht antwortet)
        setTimeout(() => reject(new Error("Socket timeout (get_ha_states)")), 10000);
    });
};

window.initSocket = initSocket;