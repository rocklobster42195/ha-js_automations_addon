/**
 * WATCH tab: live watch tiles (top) + inspect snapshots (bottom)
 */

// label → { el, valueEl, iconEl }
const _watchTiles = new Map();
let _watchWrap = null;
let _inspectList = null;

// Default icons per HA domain (state-aware where useful)
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

function _isStateObject(v) {
    return v !== null && typeof v === 'object' && typeof v.entity_id === 'string' && 'state' in v;
}

function _getEntityIcon(v) {
    if (!_isStateObject(v)) return null;
    if (v.attributes?.icon) return v.attributes.icon;
    const domain = v.entity_id.split('.')[0];
    const fn = _DOMAIN_ICONS[domain];
    return fn ? fn(v.state) : null;
}

function initWatch() {
    const panel = document.getElementById('dev-tab-watch');
    if (!panel) return;

    panel.innerHTML = `
        <div class="watch-wrap">
            <div class="watch-tiles-section">
                <div class="watch-section-label">${i18next.t('devtools.watch_section', { defaultValue: 'LIVE WATCH' })}</div>
                <div id="watch-tiles" class="watch-tiles">
                    <div id="watch-tiles-hint" class="watch-hint">
                        ${i18next.t('devtools.watch_hint', { defaultValue: 'No watch expressions active. Use ha.watch(\'label\', () => expr) in a script.' })}
                    </div>
                </div>
            </div>
            <div class="watch-inspect-section">
                <div class="watch-section-label">${i18next.t('devtools.inspect_section', { defaultValue: 'INSPECT' })}</div>
                <div id="watch-inspect-list" class="watch-inspect-list">
                    <div id="watch-inspect-hint" class="watch-hint">
                        ${i18next.t('devtools.inspect_hint', { defaultValue: 'No entries yet. Use ha.inspect(\'label\', { vars }) in a script.' })}
                    </div>
                </div>
            </div>
        </div>`;

    _watchWrap = document.getElementById('watch-tiles');
    _inspectList = document.getElementById('watch-inspect-list');
}

function onWatchUpdate(data) {
    if (!_watchWrap) return;
    const { label, value, name } = data;

    const hint = document.getElementById('watch-tiles-hint');
    if (hint) hint.remove();

    const icon = _getEntityIcon(value);
    const valClass = 'watch-tile-value ' + _valueClass(value);
    const valText = _formatValue(value);

    if (_watchTiles.has(label)) {
        const entry = _watchTiles.get(label);
        entry.valueEl.textContent = valText;
        entry.valueEl.className = valClass;
        if (entry.iconEl) {
            entry.iconEl.className = _mdiClass(icon);
            entry.iconEl.style.color = _iconColor(value);
        }
    } else {
        const tile = document.createElement('div');
        tile.className = 'watch-tile';

        const labelEl = document.createElement('div');
        labelEl.className = 'watch-tile-label';
        labelEl.textContent = label;

        let iconEl = null;
        if (icon) {
            iconEl = document.createElement('i');
            iconEl.className = _mdiClass(icon);
            iconEl.style.color = _iconColor(value);
        }

        const valueEl = document.createElement('div');
        valueEl.className = valClass;
        valueEl.textContent = valText;

        const bodyEl = document.createElement('div');
        bodyEl.className = 'watch-tile-body';
        if (iconEl) bodyEl.appendChild(iconEl);
        bodyEl.appendChild(valueEl);

        const scriptEl = document.createElement('div');
        scriptEl.className = 'watch-tile-script';
        scriptEl.textContent = name || '';

        tile.appendChild(labelEl);
        tile.appendChild(bodyEl);
        tile.appendChild(scriptEl);
        _watchWrap.appendChild(tile);
        _watchTiles.set(label, { el: tile, valueEl, iconEl, scriptEl });
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
    return 'mdi ' + icon.replace(':', '-') + ' watch-tile-icon';
}

function _prettyVal(v) {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
    return String(v);
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
