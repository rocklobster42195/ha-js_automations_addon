/**
 * JS AUTOMATIONS - Log Viewer
 * Handles the log console at the bottom of the UI.
 */

var logEntries = [];
var knownSources = new Set(['System']);

// Cache Intl.DateTimeFormat instances for performance
let todayTimeFormatter;
let weekDayTimeFormatter;
let olderDateTimeFormatter;
let fullDateTimeFormatter;

/**
 * Initializes localized formatters for the given locale.
 * @param {string} locale Language code
 */
function initializeFormatters(locale) {
    todayTimeFormatter = new Intl.DateTimeFormat(locale, {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    weekDayTimeFormatter = new Intl.DateTimeFormat(locale, {
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
    olderDateTimeFormatter = new Intl.DateTimeFormat(locale, {
        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    });
    fullDateTimeFormatter = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

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
    else if (source === 'NPM') color = '#ff79c6';

    const ts = entry.ts || Date.now();
    const timeStr = formatLogTimestamp(ts); // Ensures formatters are initialized

    const fullTimeStr = fullDateTimeFormatter.format(new Date(ts));
    
    div.innerHTML = `<span class="log-time" title="${fullTimeStr}" style="color:#666; margin-right:8px;">[${timeStr}]</span>` +
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

/**
 * Formats a timestamp based on its age.
 * - Today: HH:mm:ss
 * - Within last 7 days: Mon 14:20
 * - Older: Oct 20, 14:20
 * @param {number} ts - Timestamp to format
 * @returns {string} Formatted localized string
 */
function formatLogTimestamp(ts) {
    const currentLocale = (typeof i18next !== 'undefined') ? i18next.language : navigator.language;

    // Initialize formatters if not already done or if locale changed
    if (!fullDateTimeFormatter || fullDateTimeFormatter.resolvedOptions().locale !== currentLocale) {
        initializeFormatters(currentLocale);
    }

    const date = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - (7 * 24 * 60 * 60 * 1000);

    if (ts >= startOfToday) {
        return todayTimeFormatter.format(date);
    } else if (ts >= sevenDaysAgo) {
        return weekDayTimeFormatter.format(date);
    } else {
        return olderDateTimeFormatter.format(date);
    }
}

// Make globally available
window.initLogs = initLogs;
window.clearLogView = clearLogView;
window.clearServerLogs = clearServerLogs;
window.appendLog = appendLog;
window.filterLogs = filterLogs;
window.scrollToBottom = scrollToBottom;
window.formatLogTimestamp = formatLogTimestamp;