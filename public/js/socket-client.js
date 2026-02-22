/**
 * JS AUTOMATIONS - Socket Client
 * Handles real-time communication with the backend.
 */

var socket = null;

function initSocket() {
    // BASE_PATH is global from api.js
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    
    socket.on('log', d => { if(typeof appendLog === 'function') appendLog(d); });
    socket.on('status_update', () => { if(typeof loadScripts === 'function') loadScripts(); });
}

window.initSocket = initSocket;