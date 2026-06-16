/**
 * Developer Tools — Event & State Inspector
 * Subscribes to the HA event stream and renders entries in the EVENTS tab.
 */

const EVENT_INSPECTOR_MAX = 200;

let _inspectorActive = false;
let _eventBuffer = [];
let _filterDomain = '';
let _paused = true;

function initEventInspector() {
    const panel = document.getElementById('dev-tab-events');
    if (!panel) return;

    panel.innerHTML = `
        <div class="ei-toolbar">
            <div class="ei-filter-wrap">
                <input id="ei-filter" class="ei-filter" placeholder="Filter domain or entity..."
                    autocomplete="off"
                    oninput="setEventInspectorFilter(this.value); renderEiDropdown(this.value); updateEiClearBtn()"
                    onfocus="renderEiDropdown(this.value)"
                    onkeydown="handleEiFilterKey(event)">
                <button id="ei-clear-btn" class="ei-clear-btn hidden" onclick="clearEiFilter()" title="Clear filter">
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

    // Translate hint text after i18n is ready
    const hint = document.getElementById('ei-hint');
    if (hint) hint.textContent = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.event_inspector_hint', { defaultValue: 'Click Play to start the live event stream.' })
        : 'Click Play to start the live event stream.';

    // Set initial active state based on current visibility
    _inspectorActive = !panel.classList.contains('hidden');

    // Subscribe once socket is ready (socket may not exist yet during Monaco init)
    window.onSocketReady = () => {
        if (_inspectorActive) window.socket.emit('subscribe_event_inspector');
    };
    // Also try immediately in case socket is already connected
    if (window.socket?.connected) window.socket.emit('subscribe_event_inspector');

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ei-filter-wrap')) closeEiDropdown();
    }, true);

    // Subscribe when tab is activated, unsubscribe when hidden
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
    if (!_filterDomain) return true;
    const f = _filterDomain.toLowerCase();
    if (entry.type.toLowerCase().includes(f)) return true;
    const entityId = entry.data?.entity_id || entry.data?.new_state?.entity_id || '';
    return entityId.toLowerCase().includes(f);
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

    // Expand raw data on click
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

    // Trim rendered rows
    while (list.children.length > EVENT_INSPECTOR_MAX * 2) {
        list.removeChild(list.lastChild);
    }
}

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
            e.preventDefault(); // keep focus on input
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

window.initEventInspector        = initEventInspector;
window.onHaEventStream           = onHaEventStream;
window.setEventInspectorFilter   = setEventInspectorFilter;
window.toggleEventInspectorPause = toggleEventInspectorPause;
window.clearEventInspector       = clearEventInspector;
window.renderEiDropdown          = renderEiDropdown;
window.handleEiFilterKey         = handleEiFilterKey;
window.clearEiFilter             = clearEiFilter;
window.updateEiClearBtn          = updateEiClearBtn;
