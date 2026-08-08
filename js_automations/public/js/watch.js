/**
 * WATCH tab: live watch list (top) + inspect snapshots (bottom)
 */

// label → { mainTr, attrsTr, valueEl, iconEl, chevronEl, filename }
const _watchRows = new Map();
// filename → { row, continueBtn, iconEl }
const _activeBreakpoints = new Map();
let _watchList  = null;
let _watchTable = null; // <table> inside _watchList, only present when rows exist
let _inspectList = null;

const _DOMAIN_ICONS = {
    switch:         s => s === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off',
    light:          s => s === 'on' ? 'mdi:lightbulb' : 'mdi:lightbulb-outline',
    binary_sensor:  () => 'mdi:checkbox-marked-circle-outline',
    sensor:         () => 'mdi:eye',
    input_boolean:  s => s === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off',
    automation:     s => s === 'on' ? 'mdi:robot' : 'mdi:robot-off',
    cover:          () => 'mdi:garage',
    climate:        () => 'mdi:thermostat',
    media_player:   () => 'mdi:cast',
    person:         () => 'mdi:account',
    device_tracker: () => 'mdi:crosshairs-gps',
    input_select:   () => 'mdi:format-list-bulleted',
    select:         () => 'mdi:format-list-bulleted',
    input_number:   () => 'mdi:ray-vertex',
    number:         () => 'mdi:ray-vertex',
    button:         () => 'mdi:gesture-tap-button',
    scene:          () => 'mdi:palette',
    script:         () => 'mdi:script-text',
    fan:            s => s === 'on' ? 'mdi:fan' : 'mdi:fan-off',
    lock:           s => s === 'locked' ? 'mdi:lock' : 'mdi:lock-open',
    alarm_control_panel: () => 'mdi:shield-home',
    vacuum:         () => 'mdi:robot-vacuum',
    water_heater:   () => 'mdi:water-boiler',
    humidifier:     () => 'mdi:air-humidifier',
};

// HA's own entity_component icon translations (domain → device_class|"_" → {default, state, range}),
// fetched once from /api/ha/icons. Used instead of guessing icons for device_class entities.
let _haIcons = null;
let _haIconsLoadPromise = null;

function _loadHAIcons() {
    if (_haIcons || _haIconsLoadPromise) return _haIconsLoadPromise;
    _haIconsLoadPromise = apiFetch('api/ha/icons')
        .then(res => res.ok ? res.json() : {})
        .then(data => { _haIcons = data || {}; _refreshWatchIcons(); })
        .catch(() => { _haIcons = {}; });
    return _haIconsLoadPromise;
}

// Re-renders icons for already-visible watch rows once the HA icon catalog arrives late.
function _refreshWatchIcons() {
    for (const e of _watchRows.values()) {
        if (!e.iconEl || e.lastValue === undefined) continue;
        e.iconEl.className = _mdiClass(_getEntityIcon(e.lastValue));
        e.iconEl.style.color = _iconColor(e.lastValue);
    }
}

// Resolves an icon from HA's icon translations, mirroring the frontend's own precedence:
// exact state match > numeric range (highest threshold <= value) > domain/device_class default.
function _lookupHAIcon(domain, deviceClass, state) {
    if (!_haIcons) return null;
    const domainIcons = _haIcons[domain];
    if (!domainIcons) return null;
    const entry = (deviceClass && domainIcons[deviceClass]) || domainIcons._;
    if (!entry) return null;
    if (entry.state && Object.prototype.hasOwnProperty.call(entry.state, state)) {
        return entry.state[state];
    }
    if (entry.range) {
        const num = Number(state);
        if (!isNaN(num)) {
            const best = Object.keys(entry.range)
                .map(Number)
                .filter(t => t <= num)
                .sort((a, b) => b - a)[0];
            if (best !== undefined) return entry.range[String(best)];
        }
    }
    return entry.default || null;
}

function _isStateObject(v) {
    return v !== null && typeof v === 'object' && typeof v.entity_id === 'string' && 'state' in v;
}

function _getEntityIcon(v) {
    if (!_isStateObject(v)) return null;
    if (v.attributes?.icon) return v.attributes.icon;
    const domain = v.entity_id.split('.')[0];
    const deviceClass = v.attributes?.device_class;
    const haIcon = _lookupHAIcon(domain, deviceClass, v.state);
    if (haIcon) return haIcon;
    // Fallback while the HA icon catalog is still loading (or unreachable).
    const fn = _DOMAIN_ICONS[domain];
    return fn ? fn(v.state) : null;
}

function _ensureWatchTable() {
    if (!_watchTable) {
        _watchList.querySelectorAll('.watch-hint').forEach(h => h.remove());
        _watchTable = document.createElement('table');
        _watchTable.className = 'watch-table';
        _watchList.appendChild(_watchTable);
    }
    return _watchTable;
}

function initWatch() {
    const panel = document.getElementById('dev-tab-watch');
    if (!panel) return;

    panel.innerHTML = `
        <div class="watch-wrap">
            <div class="watch-list-section">
                <div class="watch-section-label">${i18next.t('devtools.watch_section', { defaultValue: 'LIVE WATCH' })}</div>
                <div id="watch-list" class="watch-list">
                    <div id="watch-list-hint" class="watch-hint">
                        ${i18next.t('devtools.watch_hint', { defaultValue: 'No watch expressions active. Use ha.watch(\'label\', () => expr) in a script.' })}
                    </div>
                </div>
            </div>
            <div class="watch-inspect-section">
                <div class="watch-inspect-header">
                    <span class="watch-section-label">${i18next.t('devtools.inspect_section', { defaultValue: 'INSPECT' })}</span>
                    <button class="watch-clear-btn" onclick="clearInspectList()" title="Clear"><i class="mdi mdi-trash-can-outline"></i></button>
                </div>
                <div id="watch-inspect-list" class="watch-inspect-list">
                    <div id="watch-inspect-hint" class="watch-hint">
                        ${i18next.t('devtools.inspect_hint', { defaultValue: 'No entries yet. Use ha.inspect(\'label\', { vars }) in a script.' })}
                    </div>
                </div>
            </div>
        </div>`;

    _watchList   = document.getElementById('watch-list');
    _inspectList = document.getElementById('watch-inspect-list');
    _watchTable  = null;
    _watchRows.clear();
    _loadHAIcons();

    // Ask the backend to replay cached watch tiles / inspect snapshots now that the DOM
    // is ready. A blind replay at socket-connect time can fire before initWatch() runs
    // (e.g. while Monaco is still loading), silently dropping it since _watchList was
    // still null — leaving tiles missing until the owning script is restarted.
    if (window.socket?.connected) window.socket.emit('subscribe_watch');
    window.socket?.on('connect', () => window.socket.emit('subscribe_watch'));
}

function onWatchUpdate(data) {
    if (!_watchList) return;
    const { label, value, name, filename } = data;

    const icon     = _getEntityIcon(value);
    const valText  = _formatValue(value);
    const valClass = 'watch-col-value ' + _valueClass(value);
    const hasAttrs = _isStateObject(value) && Object.keys(value.attributes || {}).length > 0;

    if (_watchRows.has(label)) {
        const e = _watchRows.get(label);
        e.lastValue = value;
        e.valueEl.textContent = valText;
        e.valueEl.className = valClass;
        if (e.iconEl) {
            e.iconEl.className = _mdiClass(icon);
            e.iconEl.style.color = _iconColor(value);
        }
        if (e.attrsTr && !e.attrsTr.classList.contains('hidden')) {
            e.attrsTr.querySelector('td').innerHTML = _renderAttrs(value);
        }
        return;
    }

    const table = _ensureWatchTable();

    // Main row
    const mainTr = table.insertRow();
    mainTr.className = 'watch-main-row';

    const tdIcon = mainTr.insertCell();
    tdIcon.className = 'watch-col-icon';
    let iconEl = null;
    if (icon) {
        iconEl = document.createElement('i');
        iconEl.className = _mdiClass(icon);
        iconEl.style.color = _iconColor(value);
        tdIcon.appendChild(iconEl);
    }

    const tdLabel = mainTr.insertCell();
    tdLabel.className = 'watch-col-label';
    tdLabel.textContent = label;

    const tdValue = mainTr.insertCell();
    tdValue.className = valClass;
    tdValue.textContent = valText;

    const tdScript = mainTr.insertCell();
    tdScript.className = 'watch-col-script';
    tdScript.textContent = name || '';

    const tdChevron = mainTr.insertCell();
    tdChevron.className = 'watch-col-chevron';
    let chevronEl = null;
    let attrsTr   = null;

    if (hasAttrs) {
        chevronEl = document.createElement('i');
        chevronEl.className = 'mdi mdi-chevron-down';
        tdChevron.appendChild(chevronEl);

        // Attribute row
        attrsTr = table.insertRow();
        attrsTr.className = 'watch-attrs-row hidden';
        const tdAttrs = attrsTr.insertCell();
        tdAttrs.colSpan = 5;
        tdAttrs.innerHTML = _renderAttrs(value);

        mainTr.classList.add('watch-main-row--expandable');
        mainTr.addEventListener('click', () => {
            const isOpen = !attrsTr.classList.contains('hidden');
            attrsTr.classList.toggle('hidden', isOpen);
            chevronEl.className = `mdi ${isOpen ? 'mdi-chevron-down' : 'mdi-chevron-up'}`;
        });
    }

    _watchRows.set(label, { mainTr, attrsTr, valueEl: tdValue, iconEl, chevronEl, filename, lastValue: value });
}

function onWatchClear(data) {
    if (!_watchList) return;
    const toRemove = [..._watchRows.entries()].filter(([, e]) => e.filename === data.filename);
    for (const [label, entry] of toRemove) {
        entry.mainTr.remove();
        if (entry.attrsTr) entry.attrsTr.remove();
        _watchRows.delete(label);
    }
    if (_watchRows.size === 0) {
        if (_watchTable) { _watchTable.remove(); _watchTable = null; }
        _watchList.querySelectorAll('.watch-hint').forEach(h => h.remove());
        const hint = document.createElement('div');
        hint.id = 'watch-list-hint';
        hint.className = 'watch-hint';
        hint.textContent = i18next.t('devtools.watch_hint', { defaultValue: 'No watch expressions active. Use ha.watch(\'label\', () => expr) in a script.' });
        _watchList.appendChild(hint);
    }
}

function onInspectSnapshot(data) {
    if (!_inspectList) return;
    const { label, vars, name } = data;

    const hint = document.getElementById('watch-inspect-hint');
    if (hint) hint.remove();

    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const row = document.createElement('div');
    row.className = 'inspect-row';

    const header = document.createElement('div');
    header.className = 'inspect-header';
    header.innerHTML = `<span class="inspect-time">${now}</span>
                        <span class="inspect-label">${_esc(label)}</span>
                        <span class="inspect-script">${_esc(name || '')}</span>`;

    const entries = Object.entries(vars || {});
    let body = '';
    if (entries.length === 0) {
        body = `<div class="inspect-empty">${i18next.t('devtools.inspect_empty', { defaultValue: 'No variables.' })}</div>`;
    } else {
        body = `<table class="inspect-var-table">
            <thead><tr>
                <th>${i18next.t('devtools.col_variable', { defaultValue: 'Variable' })}</th>
                <th>${i18next.t('devtools.col_type', { defaultValue: 'Type' })}</th>
                <th>${i18next.t('devtools.col_value', { defaultValue: 'Value' })}</th>
            </tr></thead>
            <tbody>${entries.map(([k, v]) => `
                <tr>
                    <td class="inspect-var-key">${_esc(k)}</td>
                    <td class="inspect-var-type">${_esc(typeof v)}</td>
                    <td class="inspect-var-val"><pre>${_esc(_prettyVal(v))}</pre></td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    }

    row.appendChild(header);
    row.insertAdjacentHTML('beforeend', body);
    _inspectList.insertBefore(row, _inspectList.firstChild);
}

function _setWatchTabBadge(count) {
    const watchTab = document.querySelector('.log-pane-tab[data-tab="watch"]');
    if (!watchTab) return;
    let badge = watchTab.querySelector('.tab-bp-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'tab-bp-badge';
            watchTab.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        if (badge) badge.remove();
    }
}

function onBreakpointHit(data) {
    if (!_inspectList) return;
    const { filename, name, label, vars } = data;

    const hint = document.getElementById('watch-inspect-hint');
    if (hint) hint.remove();

    // Auto-switch to WATCH tab
    const watchTab = document.querySelector('.log-pane-tab[data-tab="watch"]');
    if (watchTab && !watchTab.classList.contains('active')) watchTab.click();

    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const row = document.createElement('div');
    row.className = 'inspect-row inspect-row--breakpoint';

    const iconEl = document.createElement('i');
    iconEl.className = 'mdi mdi-pause inspect-bp-icon';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'inspect-bp-continue';
    continueBtn.textContent = 'Continue';
    continueBtn.onclick = () => continueBreakpoint(filename);

    const header = document.createElement('div');
    header.className = 'inspect-header';
    header.appendChild(iconEl);
    header.insertAdjacentHTML('beforeend',
        `<span class="inspect-time">${now}</span>
         <span class="inspect-label">${_esc(label)}</span>
         <span class="inspect-script">${_esc(name || '')}</span>`);
    header.appendChild(continueBtn);

    const entries = Object.entries(vars || {});
    let body = '';
    if (entries.length > 0) {
        body = `<table class="inspect-var-table">
            <thead><tr>
                <th>${i18next.t('devtools.col_variable', { defaultValue: 'Variable' })}</th>
                <th>${i18next.t('devtools.col_type', { defaultValue: 'Type' })}</th>
                <th>${i18next.t('devtools.col_value', { defaultValue: 'Value' })}</th>
            </tr></thead>
            <tbody>${entries.map(([k, v]) => `
                <tr>
                    <td class="inspect-var-key">${_esc(k)}</td>
                    <td class="inspect-var-type">${_esc(typeof v)}</td>
                    <td class="inspect-var-val"><pre>${_esc(_prettyVal(v))}</pre></td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    }

    row.appendChild(header);
    row.insertAdjacentHTML('beforeend', body);
    _inspectList.insertBefore(row, _inspectList.firstChild);
    _activeBreakpoints.set(filename, { row, continueBtn, iconEl });
    _setWatchTabBadge(_activeBreakpoints.size);
    _inspectList.scrollTop = 0;
}

function onBreakpointContinued(data) {
    const entry = _activeBreakpoints.get(data.filename);
    if (!entry) return;
    entry.row.classList.remove('inspect-row--breakpoint');
    entry.row.classList.add('inspect-row--breakpoint-done');
    entry.iconEl.className = 'mdi mdi-play inspect-bp-icon-done';
    entry.continueBtn.remove();
    _activeBreakpoints.delete(data.filename);
    _setWatchTabBadge(_activeBreakpoints.size);
}

function continueBreakpoint(filename) {
    if (window.socket) window.socket.emit('debug_continue', filename);
}

function clearInspectList() {
    if (!_inspectList) return;
    _inspectList.innerHTML = '';
    _activeBreakpoints.clear();
    _setWatchTabBadge(0);
    const hint = document.createElement('div');
    hint.id = 'watch-inspect-hint';
    hint.className = 'watch-hint';
    hint.textContent = i18next.t('devtools.inspect_hint', { defaultValue: 'No entries yet. Use ha.inspect(\'label\', { vars }) in a script.' });
    _inspectList.appendChild(hint);
}

function _renderAttrs(v) {
    if (!_isStateObject(v)) return '';
    const entries = Object.entries(v.attributes || {});
    if (entries.length === 0) return '';
    return `<table class="watch-attr-table">
        ${entries.map(([k, val]) => `
        <tr>
            <td class="watch-attr-key">${_esc(k)}</td>
            <td class="watch-attr-val"><pre>${_esc(_prettyVal(val))}</pre></td>
        </tr>`).join('')}
    </table>`;
}

function _formatValue(v) {
    if (v === undefined || v === null) return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (_isStateObject(v)) return v.state;
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

function _valueClass(v) {
    if (typeof v === 'boolean') return v ? 'watch-val-bool-true' : 'watch-val-bool-false';
    if (typeof v === 'number') return 'watch-val-number';
    if (v === null || v === undefined) return 'watch-val-null';
    if (_isStateObject(v)) {
        const s = v.state;
        if (s === 'on' || s === 'locked' || s === 'home') return 'watch-val-bool-true';
        if (s === 'off' || s === 'unlocked' || s === 'not_home') return 'watch-val-bool-false';
        const num = Number(s);
        if (!isNaN(num) && String(s).trim() !== '') return 'watch-val-number';
        return '';
    }
    if (typeof v === 'object') return 'watch-val-object';
    return '';
}

function _iconColor(v) {
    const cls = _valueClass(v);
    if (cls === 'watch-val-bool-true')  return '#4caf50';
    if (cls === 'watch-val-bool-false') return '#555';
    if (cls === 'watch-val-number')     return '#4fc3f7';
    return 'var(--accent)';
}

function _mdiClass(icon) {
    if (!icon) return '';
    return 'mdi ' + icon.replace(':', '-');
}

function _prettyVal(v) {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
    return String(v);
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
