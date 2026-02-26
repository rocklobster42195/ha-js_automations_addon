/**
 * JS AUTOMATIONS - Socket Client
 * Handles real-time communication with the backend.
 */

var socket = null;
var cpuHistory = new Array(10).fill(0);
var ramHistory = new Array(10).fill(0);
var overlayTimeout = null;

function initSocket() {
    // BASE_PATH is global from api.js
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    
    // Helper: UI Update für Herz & Overlay zentral steuern
    const updateConnectionUI = (isConnected) => {
        const hb = document.getElementById('heartbeat-icon');
        const overlay = document.getElementById('connection-lost-overlay');
        
        // 1. Heartbeat Icon
        if (hb) {
            hb.parentElement.title = isConnected ? 'Connected' : 'Disconnected';
            hb.style.color = isConnected ? '#999' : 'var(--danger)';
            hb.style.opacity = '1';
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

    socket.on('connect', () => {
        updateConnectionUI(true);
    });

    socket.on('disconnect', () => {
        updateConnectionUI(false);
    });

    socket.on('log', d => { if(typeof appendLog === 'function') appendLog(d); });
    socket.on('status_update', () => { if(typeof loadScripts === 'function') loadScripts(); });
    
    socket.on('system_stats', (data) => {
        const hb = document.getElementById('heartbeat-icon');
        if (hb) {
            // Falls Verbindung wieder da ist (Daten kommen), aber Icon noch rot war: Reset
            if (hb.style.color === 'var(--danger)') {
                updateConnectionUI(true);
            }
        }

        const cpuEl = document.getElementById('stat-cpu');
        const ramEl = document.getElementById('stat-ram');
        if (cpuEl) {
            cpuEl.textContent = `${data.cpu}%`;
            if (data.cpu >= 90) cpuEl.style.color = '#ff5555';      // Red
            else if (data.cpu >= 70) cpuEl.style.color = '#ffb86c'; // Orange
            else if (data.cpu >= 50) cpuEl.style.color = '#f1fa8c'; // Yellow
            else cpuEl.style.color = '';                            // Default
            
            drawSparkline('cpu-sparkline', cpuHistory, data.cpu, (v) => v >= 90 ? '#ff5555' : (v >= 70 ? '#ffb86c' : (v >= 50 ? '#f1fa8c' : '#666666')), 100);
        }
        
        if (ramEl) {
            const sysUsed = data.ram_used > 1024 ? (data.ram_used / 1024).toFixed(1) + ' GB' : data.ram_used + ' MB';
            
            // Platz sparen: Nur Node-RAM anzeigen
            ramEl.textContent = `${data.app_ram} MB`;
            
            // Tooltip erweitert um System-Werte (da hier Platz ist)
            ramEl.parentElement.title = `Node Heap: ${data.app_heap} MB (Scripts)\nNode RSS: ${data.app_ram} MB (Total)\nSystem: ${sysUsed}`;
            
            // RAM Sparkline (Fixe Skala: 512MB = 100%. Ermöglicht bessere visuelle Einschätzung.)
            drawSparkline('ram-sparkline', ramHistory, data.app_ram, (v) => v >= 1024 ? '#ff5555' : (v >= 512 ? '#ffb86c' : (v >= 256 ? '#f1fa8c' : '#666666')), 512);
        }

        if (data.script_stats && typeof updateScriptStats === 'function') {
            updateScriptStats(data.script_stats);
        }
    });

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

function drawSparkline(id, history, val, colorFn, maxVal) {
    history.push(val);
    if (history.length > 10) history.shift();
    
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const barW = (w / history.length) - 1;
    history.forEach((v, i) => {
        ctx.fillStyle = colorFn(v);
        const barH = Math.max(2, (v / maxVal) * h); // Mindestens 2px hoch
        ctx.fillRect(i * (barW + 1), h - barH, barW, barH);
    });
}

// Global helper for the overlay button
window.manualReload = function() {
    window.location.reload();
};

window.initSocket = initSocket;