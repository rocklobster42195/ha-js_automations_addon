/**
 * Developer Tools — MQTT Monitor
 * Shows a live IN/OUT feed of all MQTT messages and provides an ad-hoc publish form.
 */

const MQTT_MONITOR_MAX = 200;

let _mmActive = false;
let _mmPaused = false;
let _mmBuffer = [];
let _mmFilter = '';
let _mmRowId  = 0;

function initMqttMonitor() {
    const panel = document.getElementById('dev-tab-mqtt');
    if (!panel) return;

    const t = (key, def) => (typeof i18next !== 'undefined')
        ? i18next.t(key, { defaultValue: def })
        : def;

    panel.innerHTML = `
        <div class="mm-publish-panel">
            <div class="mm-publish-row">
                <input id="mm-topic-input" class="mm-topic-input" placeholder="${t('devtools.mqtt_topic', 'Topic')}..." autocomplete="off" spellcheck="false">
                <label class="mm-retain-label">
                    <input id="mm-retain-chk" type="checkbox">
                    ${t('devtools.mqtt_retain', 'Retain')}
                </label>
                <button id="mm-publish-btn" class="mm-publish-btn" onclick="mmPublish()">
                    ${t('devtools.mqtt_publish', 'Publish')}
                </button>
            </div>
            <div class="mm-publish-row">
                <textarea id="mm-payload-input" class="mm-payload-input" rows="2" placeholder="${t('devtools.mqtt_payload', 'Payload')} (JSON or plain text)..." spellcheck="false"></textarea>
            </div>
        </div>
        <div class="dev-section-divider">Stream</div>
        <div class="mm-toolbar">
            <input id="mm-filter" class="mm-filter" placeholder="${t('devtools.mqtt_filter', 'Filter topic...')}"
                autocomplete="off" oninput="mmSetFilter(this.value)">
            <button id="mm-pause-btn" onclick="mmTogglePause()" title="${t('devtools.mqtt_pause', 'Pause')}">
                <i class="mdi mdi-pause"></i>
            </button>
            <button onclick="mmClear()" title="${t('devtools.mqtt_clear', 'Clear')}">
                <i class="mdi mdi-trash-can-outline"></i>
            </button>
        </div>
        <div id="mm-list" class="mm-list">
            <div id="mm-hint" class="mm-hint">${t('devtools.mqtt_no_filter', 'Enter a topic in the filter field, e.g. jsa/# or shellies/+/status')}</div>
        </div>
    `;

    _mmActive = !panel.classList.contains('hidden');

    if (window.socket?.connected && _mmActive) window.socket.emit('subscribe_mqtt_monitor');

    // Re-subscribe after socket reconnect (new socket.id — old one is gone from server set)
    window.socket?.on('connect', () => {
        if (_mmActive) window.socket.emit('subscribe_mqtt_monitor');
    });

    // Reuse observeTabVisibility from event-inspector.js (loaded before this file)
    observeTabVisibility(panel, (visible) => {
        _mmActive = visible;
        if (visible) {
            window.socket?.emit('subscribe_mqtt_monitor');
        } else {
            window.socket?.emit('unsubscribe_mqtt_monitor');
        }
    });
}

function _mmTopicMatches(filter, topic) {
    if (!filter) return false;
    const fp = filter.split('/');
    const tp = topic.split('/');
    for (let i = 0; i < fp.length; i++) {
        if (fp[i] === '#') return true;
        if (i >= tp.length) return false;
        if (fp[i] !== '+' && fp[i] !== tp[i]) return false;
    }
    return fp.length === tp.length;
}

function onMqttMessage(data) {
    if (!_mmActive) return;

    const { topic, payload, direction, ts } = data;
    const entry = { topic, payload, direction, ts, id: ++_mmRowId };
    _mmBuffer.unshift(entry);
    if (_mmBuffer.length > MQTT_MONITOR_MAX) _mmBuffer.pop();

    if (!_mmPaused && _mmTopicMatches(_mmFilter, topic)) renderMmEntry(entry);
}

function renderMmEntry(entry) {
    const list = document.getElementById('mm-list');
    if (!list) return;
    const hint = document.getElementById('mm-hint');
    if (hint) hint.remove();

    const { topic, payload, direction, ts, id } = entry;
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        + '.' + String(d.getMilliseconds()).padStart(3, '0');
    const isIn = direction === 'in';
    const dirClass = isIn ? 'mm-dir-in' : 'mm-dir-out';
    const dirLabel = isIn ? '▶ IN' : '◀ OUT';

    const short = (payload.length > 80) ? payload.slice(0, 80) + '…' : payload;

    const row = document.createElement('div');
    row.className = 'mm-row';
    row.dataset.id = id;
    row.innerHTML = `
        <span class="mm-time">${time}</span>
        <span class="mm-dir ${dirClass}">${dirLabel}</span>
        <span class="mm-topic" title="${_mmEsc(topic)}">${_mmEsc(topic)}</span>
        <span class="mm-payload" title="${_mmEsc(payload)}">${_mmEsc(short)}</span>
    `;

    row.addEventListener('click', () => {
        const existing = row.nextSibling;
        if (existing?.classList?.contains('mm-raw')) { existing.remove(); return; }
        const pre = document.createElement('pre');
        pre.className = 'mm-raw';
        try { pre.textContent = JSON.stringify(JSON.parse(payload), null, 2); }
        catch { pre.textContent = payload; }
        row.after(pre);
    });

    list.prepend(row);

    while (list.children.length > MQTT_MONITOR_MAX * 2) list.removeChild(list.lastChild);
}

function mmPublish() {
    const topic   = document.getElementById('mm-topic-input')?.value.trim();
    const payload = document.getElementById('mm-payload-input')?.value ?? '';
    const retain  = document.getElementById('mm-retain-chk')?.checked ?? false;
    if (!topic) {
        document.getElementById('mm-topic-input')?.focus();
        return;
    }
    window.socket?.emit('mqtt_ui_publish', { topic, payload, retain });
}

function mmSetFilter(val) {
    _mmFilter = val.trim();
    mmRerender();
}

function mmTogglePause() {
    _mmPaused = !_mmPaused;
    const btn = document.getElementById('mm-pause-btn');
    const t = (key, def) => (typeof i18next !== 'undefined') ? i18next.t(key, { defaultValue: def }) : def;
    if (btn) {
        btn.innerHTML = _mmPaused ? '<i class="mdi mdi-play"></i>' : '<i class="mdi mdi-pause"></i>';
        btn.title = _mmPaused ? t('devtools.mqtt_resume', 'Resume') : t('devtools.mqtt_pause', 'Pause');
    }
    const list = document.getElementById('mm-list');
    if (list) {
        let banner = document.getElementById('mm-paused-banner');
        if (_mmPaused) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'mm-paused-banner';
                banner.className = 'mm-paused-banner';
                banner.textContent = t('devtools.mqtt_paused_hint', 'Stream paused — new messages are buffered');
                list.prepend(banner);
            }
        } else {
            banner?.remove();
            mmRerender();
        }
    }
}

function mmClear() {
    _mmBuffer = [];
    const list = document.getElementById('mm-list');
    if (!list) return;
    list.innerHTML = '';
    const hint = document.createElement('div');
    hint.id = 'mm-hint';
    hint.className = 'mm-hint';
    hint.textContent = _mmHintText();
    list.appendChild(hint);
}

function _mmHintText() {
    if (!_mmFilter) {
        return (typeof i18next !== 'undefined')
            ? i18next.t('devtools.mqtt_no_filter', { defaultValue: 'Enter a topic in the filter field, e.g. jsa/# or shellies/+/status' })
            : 'Enter a topic in the filter field, e.g. jsa/# or shellies/+/status';
    }
    return (typeof i18next !== 'undefined')
        ? i18next.t('devtools.mqtt_hint', { defaultValue: 'Waiting for MQTT messages...' })
        : 'Waiting for MQTT messages...';
}

function mmRerender() {
    const list = document.getElementById('mm-list');
    if (!list) return;
    list.innerHTML = '';
    const filtered = _mmBuffer.filter(e => _mmTopicMatches(_mmFilter, e.topic));
    filtered.forEach(renderMmEntry);
    if (filtered.length === 0) {
        const hint = document.createElement('div');
        hint.id = 'mm-hint';
        hint.className = 'mm-hint';
        hint.textContent = _mmHintText();
        list.appendChild(hint);
    }
}

function _mmEsc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.initMqttMonitor = initMqttMonitor;
window.onMqttMessage   = onMqttMessage;
window.mmPublish       = mmPublish;
window.mmSetFilter     = mmSetFilter;
window.mmTogglePause   = mmTogglePause;
window.mmClear         = mmClear;
