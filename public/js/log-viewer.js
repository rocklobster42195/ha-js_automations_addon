/**
 * JS AUTOMATIONS - Log Viewer
 * Handles the log console at the bottom of the UI.
 */

var logEntries = [];
var knownSources = new Set(['System']);

async function initLogs() {
    try {
        // apiFetch is global from app.js
        const res = await apiFetch('api/logs');
        if (res.ok) {
            const history = await res.json();
            const container = document.getElementById('console-output');
            if (container) container.innerHTML = '';
            logEntries = [];
            
            // Reset sources
            knownSources = new Set(['System']);
            const select = document.getElementById('logFilter');
            if (select) {
                select.innerHTML = `<option value="ALL">${i18next.t('log_filter_all')}</option><option value="System">System</option>`;
            }
            
            history.forEach(entry => appendLog(entry, false));
            scrollToBottom();
        }
    } catch (e) { console.error("Log load failed", e); }
}

function clearLogView() {
    const container = document.getElementById('console-output');
    if (container) container.innerHTML = '';
}

async function clearServerLogs() {
    if (!confirm(i18next.t('confirm_clear_logs', { defaultValue: 'Do you really want to delete the entire server log?' }))) return;
    await apiFetch('api/logs', { method: 'DELETE' });
    clearLogView();
    logEntries = [];

    // Reset sources and filter dropdown
    knownSources = new Set(['System']);
    const select = document.getElementById('logFilter');
    if (select) {
        select.innerHTML = `<option value="ALL">${i18next.t('log_filter_all')}</option><option value="System">System</option>`;
    }
}

function appendLog(entry, autoScroll = true) {
    if (typeof entry === 'string') {
        entry = { ts: Date.now(), level: 'info', source: 'System', message: entry };
    }
    logEntries.push(entry);

    const source = entry.source || 'System';
    if (!knownSources.has(source)) {
        knownSources.add(source);
        const select = document.getElementById('logFilter');
        if (select) {
            const opt = document.createElement('option');
            opt.value = source;
            opt.textContent = source;
            select.appendChild(opt);
        }
    }

    const out = document.getElementById('console-output');
    if (!out) return;

    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.source = source;

    // Colors
    let color = '#ddd'; 
    if (entry.level === 'error' || (entry.message && entry.message.includes('❌'))) color = '#ff5555'; 
    else if (entry.level === 'warn') color = '#ffb86c'; 
    else if (entry.level === 'debug') color = '#6272a4'; 
    else if (source === 'System') color = '#8be9fd'; 

    const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    div.innerHTML = `<span class="log-time" style="color:#666; margin-right:8px;">[${timeStr}]</span>` +
                    `<span style="color:#bd93f9; font-weight:bold; margin-right:8px;">[${source}]</span>` +
                    `<span style="color:${color}">${entry.message}</span>`;

    const currentFilter = document.getElementById('logFilter')?.value || 'ALL';
    if (currentFilter !== 'ALL' && source !== currentFilter) {
        div.style.display = 'none';
    }

    out.appendChild(div);
    if (autoScroll) scrollToBottom();
}

function filterLogs() {
    const filter = document.getElementById('logFilter').value;
    const container = document.getElementById('console-output');
    if (!container) return;
    
    Array.from(container.children).forEach(el => {
        if (filter === 'ALL' || el.dataset.source === filter) {
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    });
    scrollToBottom();
}

function scrollToBottom() {
    const c = document.getElementById('console-output');
    if (c) c.scrollTop = c.scrollHeight;
}

// Make globally available
window.initLogs = initLogs;
window.clearLogView = clearLogView;
window.clearServerLogs = clearServerLogs;
window.appendLog = appendLog;
window.filterLogs = filterLogs;
window.scrollToBottom = scrollToBottom;