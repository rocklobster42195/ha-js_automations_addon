/**
 * Developer Tools — Event & State Inspector
 * Subscribes to the HA event stream and renders entries in the EVENTS tab.
 */

const EVENT_INSPECTOR_MAX = 200;

const EI_EVENT_TYPES = [
    'state_changed',
    'call_service',
    'automation_triggered',
    'script_started',
    'timer.finished',
    'zha_event',
    'homeassistant_start',
    'homeassistant_stop',
    'component_loaded',
    'tag_scanned',
];

let _inspectorActive = false;
let _eventBuffer = [];
let _filterType   = '';
let _filterDomain = '';
let _paused = true;

function initEventInspector() {
    const panel = document.getElementById('dev-tab-events');
    if (!panel) return;

    const firePlaceholder = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.fire_event_type', { defaultValue: 'Event type, e.g. my_event' })
        : 'Event type, e.g. my_event';
    const dataPlaceholder = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.fire_event_data', { defaultValue: 'Data (JSON), e.g. {"key":"value"}' })
        : 'Data (JSON), e.g. {"key":"value"}';
    const fireBtnLabel = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.fire_event', { defaultValue: 'Fire' })
        : 'Fire';

    panel.innerHTML = `
        <div class="ei-fire-panel">
            <div class="ei-fire-row">
                <input id="ei-fire-type" class="ei-fire-type" placeholder="${firePlaceholder}"
                    autocomplete="off" spellcheck="false"
                    onkeydown="if(event.key==='Enter') eiFireEvent()">
                <button class="ei-fire-btn" onclick="eiFireEvent()">${fireBtnLabel}</button>
            </div>
            <div class="ei-fire-row">
                <input id="ei-fire-data" class="ei-fire-data" placeholder="${dataPlaceholder}"
                    autocomplete="off" spellcheck="false"
                    onkeydown="if(event.key==='Enter') eiFireEvent()">
                <span id="ei-fire-err" class="ei-fire-err hidden"></span>
            </div>
        </div>
        <div class="dev-section-divider">Stream</div>
        <div class="ei-toolbar">
            <div class="ei-filter-wrap">
                <input id="ei-type-filter" class="ei-filter" placeholder="Event type..."
                    autocomplete="off"
                    oninput="setEiTypeFilter(this.value); renderEiTypeDropdown(this.value); updateEiTypeClearBtn()"
                    onfocus="renderEiTypeDropdown(this.value)"
                    onkeydown="handleEiTypeKey(event)">
                <button id="ei-type-clear-btn" class="ei-clear-btn hidden" onclick="clearEiTypeFilter()" title="Clear">
                    <i class="mdi mdi-close"></i>
                </button>
                <div id="ei-type-dropdown" class="ei-dropdown hidden"></div>
            </div>
            <div class="ei-filter-wrap">
                <input id="ei-filter" class="ei-filter" placeholder="Filter entity..."
                    autocomplete="off"
                    oninput="setEventInspectorFilter(this.value); renderEiDropdown(this.value); updateEiClearBtn()"
                    onfocus="renderEiDropdown(this.value)"
                    onkeydown="handleEiFilterKey(event)">
                <button id="ei-clear-btn" class="ei-clear-btn hidden" onclick="clearEiFilter()" title="Clear">
                    <i class="mdi mdi-close"></i>
                </button>
                <div id="ei-dropdown" class="ei-dropdown hidden"></div>
            </div>
            <button id="ei-pause-btn" onclick="toggleEventInspectorPause()" title="Resume">
                <i class="mdi mdi-play"></i>
            </button>
            <button onclick="clearEventInspector()" title="Clear">
                <i class="mdi mdi-trash-can-outline"></i>
            </button>
        </div>
        <div id="ei-list" class="ei-list">
            <div id="ei-hint" class="ei-hint"></div>
        </div>
    `;

    const hint = document.getElementById('ei-hint');
    if (hint) hint.textContent = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.event_inspector_hint', { defaultValue: 'Click Play to start the live event stream.' })
        : 'Click Play to start the live event stream.';

    _inspectorActive = !panel.classList.contains('hidden');

    window.onSocketReady = () => {
        if (_inspectorActive) window.socket.emit('subscribe_event_inspector');
    };
    if (window.socket?.connected) window.socket.emit('subscribe_event_inspector');

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ei-filter-wrap')) {
            closeEiDropdown();
            closeEiTypeDropdown();
        }
    }, true);

    observeTabVisibility(panel, (visible) => {
        _inspectorActive = visible;
        if (visible) {
            window.socket?.emit('subscribe_event_inspector');
        } else {
            window.socket?.emit('unsubscribe_event_inspector');
        }
    });
}

function observeTabVisibility(el, cb) {
    new MutationObserver(() => {
        cb(!el.classList.contains('hidden'));
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
}

function onHaEventStream(payload) {
    if (!_inspectorActive || _paused) return;

    const { t, type, data } = payload;
    const entry = { t, type, data };

    if (!matchesFilter(entry)) return;

    _eventBuffer.unshift(entry);
    if (_eventBuffer.length > EVENT_INSPECTOR_MAX) _eventBuffer.pop();

    renderEventInspectorEntry(entry);
}

function matchesFilter(entry) {
    if (_filterType) {
        const ft = _filterType.toLowerCase();
        if (!entry.type.toLowerCase().includes(ft)) return false;
    }
    if (_filterDomain) {
        const fd = _filterDomain.toLowerCase();
        const entityId = entry.data?.entity_id || entry.data?.new_state?.entity_id || '';
        if (!entityId.toLowerCase().includes(fd) && !entry.type.toLowerCase().includes(fd)) return false;
    }
    return true;
}

function renderEventInspectorEntry(entry) {
    const list = document.getElementById('ei-list');
    if (!list) return;
    const hint = document.getElementById('ei-hint');
    if (hint) hint.remove();

    const { t, type, data } = entry;
    const time = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let detail = '';
    if (type === 'state_changed') {
        const id   = data.entity_id || '';
        const oldS = data.old_state?.state ?? '—';
        const newS = data.new_state?.state ?? '—';
        detail = `<span class="ei-entity">${id}</span><span class="ei-arrow">${oldS} → ${newS}</span>`;
    } else {
        const entityId = data.entity_id || data.domain || '';
        const preview  = entityId || JSON.stringify(data).slice(0, 60);
        detail = `<span class="ei-entity">${preview}</span>`;
    }

    const row = document.createElement('div');
    row.className = 'ei-row';
    row.innerHTML = `
        <span class="ei-time">${time}</span>
        <span class="ei-type ei-type-${type === 'state_changed' ? 'state' : 'event'}">${type}</span>
        <span class="ei-detail">${detail}</span>
    `;

    row.addEventListener('click', () => {
        const existing = row.nextSibling;
        if (existing?.classList?.contains('ei-raw')) {
            existing.remove();
            return;
        }
        const raw = document.createElement('pre');
        raw.className = 'ei-raw';
        raw.textContent = JSON.stringify(data, null, 2);
        row.after(raw);
    });

    list.prepend(row);

    while (list.children.length > EVENT_INSPECTOR_MAX * 2) {
        list.removeChild(list.lastChild);
    }
}

// --- Type filter ---

function setEiTypeFilter(val) {
    _filterType = val;
    rerenderEiBuffer();
}

function renderEiTypeDropdown(term) {
    const dropdown = document.getElementById('ei-type-dropdown');
    if (!dropdown) return;
    const t = (term || '').toLowerCase().trim();
    const matches = t
        ? EI_EVENT_TYPES.filter(e => e.toLowerCase().includes(t))
        : EI_EVENT_TYPES;

    if (matches.length === 0) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = '';
    matches.forEach(evtType => {
        const row = document.createElement('div');
        row.className = 'ei-dropdown-row';
        row.textContent = evtType;
        row.onmousedown = (e) => {
            e.preventDefault();
            const input = document.getElementById('ei-type-filter');
            if (input) input.value = evtType;
            setEiTypeFilter(evtType);
            updateEiTypeClearBtn();
            closeEiTypeDropdown();
        };
        dropdown.appendChild(row);
    });

    dropdown.classList.remove('hidden');
}

function closeEiTypeDropdown() {
    const dropdown = document.getElementById('ei-type-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

function clearEiTypeFilter() {
    const input = document.getElementById('ei-type-filter');
    if (input) { input.value = ''; input.focus(); }
    setEiTypeFilter('');
    closeEiTypeDropdown();
    updateEiTypeClearBtn();
}

function updateEiTypeClearBtn() {
    const input = document.getElementById('ei-type-filter');
    const btn   = document.getElementById('ei-type-clear-btn');
    if (btn) btn.classList.toggle('hidden', !input?.value);
}

function handleEiTypeKey(e) {
    if (e.key === 'Escape') { clearEiTypeFilter(); closeEiTypeDropdown(); e.target.blur(); }
    if (e.key === 'Enter')  { closeEiTypeDropdown(); e.target.blur(); }
}

// --- Entity filter ---

function setEventInspectorFilter(val) {
    _filterDomain = val;
    rerenderEiBuffer();
}

function rerenderEiBuffer() {
    const list = document.getElementById('ei-list');
    if (!list) return;
    list.innerHTML = '';
    _eventBuffer
        .filter(matchesFilter)
        .forEach(renderEventInspectorEntry);
}

function toggleEventInspectorPause() {
    _paused = !_paused;
    const btn = document.getElementById('ei-pause-btn');
    if (btn) {
        btn.innerHTML = _paused ? '<i class="mdi mdi-play"></i>' : '<i class="mdi mdi-pause"></i>';
        btn.title = _paused ? 'Resume' : 'Pause';
    }
    if (!_paused) {
        const hint = document.getElementById('ei-hint');
        if (hint) hint.remove();
    }
}

function clearEventInspector() {
    _eventBuffer = [];
    const list = document.getElementById('ei-list');
    if (list) list.innerHTML = '';
}

function renderEiDropdown(term) {
    const dropdown = document.getElementById('ei-dropdown');
    if (!dropdown) return;

    const entities = (typeof allEntities !== 'undefined' && Array.isArray(allEntities)) ? allEntities : [];
    const t = (term || '').toLowerCase().trim();
    const matches = t
        ? entities.filter(e => e.toLowerCase().includes(t)).slice(0, 80)
        : entities.slice(0, 80);

    if (matches.length === 0) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = '';
    matches.forEach(entityId => {
        const row = document.createElement('div');
        row.className = 'ei-dropdown-row';
        row.textContent = entityId;
        row.onmousedown = (e) => {
            e.preventDefault();
            const input = document.getElementById('ei-filter');
            if (input) input.value = entityId;
            setEventInspectorFilter(entityId);
            closeEiDropdown();
        };
        dropdown.appendChild(row);
    });

    dropdown.classList.remove('hidden');
}

function closeEiDropdown() {
    const dropdown = document.getElementById('ei-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

function clearEiFilter() {
    const input = document.getElementById('ei-filter');
    if (input) { input.value = ''; input.focus(); }
    setEventInspectorFilter('');
    closeEiDropdown();
    updateEiClearBtn();
}

function updateEiClearBtn() {
    const input = document.getElementById('ei-filter');
    const btn   = document.getElementById('ei-clear-btn');
    if (btn) btn.classList.toggle('hidden', !input?.value);
}

function handleEiFilterKey(e) {
    if (e.key === 'Escape') { clearEiFilter(); closeEiDropdown(); e.target.blur(); }
    if (e.key === 'Enter')  { closeEiDropdown(); e.target.blur(); }
}

function eiFireEvent() {
    const typeInput = document.getElementById('ei-fire-type');
    const dataInput = document.getElementById('ei-fire-data');
    const errEl     = document.getElementById('ei-fire-err');
    const event_type = typeInput?.value.trim();
    if (!event_type) { typeInput?.focus(); return; }

    let data = {};
    const raw = dataInput?.value.trim();
    if (raw) {
        try { data = JSON.parse(raw); }
        catch (e) {
            if (errEl) { errEl.textContent = 'Invalid JSON'; errEl.classList.remove('hidden'); }
            return;
        }
    }
    if (errEl) errEl.classList.add('hidden');
    window.socket?.emit('fire_ha_event', { event_type, data });
}

window.initEventInspector        = initEventInspector;
window.onHaEventStream           = onHaEventStream;
window.eiFireEvent               = eiFireEvent;
window.setEventInspectorFilter   = setEventInspectorFilter;
window.setEiTypeFilter           = setEiTypeFilter;
window.toggleEventInspectorPause = toggleEventInspectorPause;
window.clearEventInspector       = clearEventInspector;
window.renderEiDropdown          = renderEiDropdown;
window.renderEiTypeDropdown      = renderEiTypeDropdown;
window.handleEiFilterKey         = handleEiFilterKey;
window.handleEiTypeKey           = handleEiTypeKey;
window.clearEiFilter             = clearEiFilter;
window.clearEiTypeFilter         = clearEiTypeFilter;
window.updateEiClearBtn          = updateEiClearBtn;
window.updateEiTypeClearBtn      = updateEiTypeClearBtn;
