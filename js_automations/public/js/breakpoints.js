/**
 * Developer Tools — Breakpoints & Variable Inspector
 * Renders paused breakpoints from ha.breakpoint(label, vars) and allows continuation.
 */

let _currentBreakpoint = null;

function initBreakpoints() {
    const panel = document.getElementById('dev-tab-breakpoints');
    if (!panel) return;
    _renderIdle(panel);
}

function _renderIdle(panel) {
    panel = panel || document.getElementById('dev-tab-breakpoints');
    if (!panel) return;
    _currentBreakpoint = null;
    const hint = (typeof i18next !== 'undefined')
        ? i18next.t('devtools.breakpoints_hint', { defaultValue: 'No active breakpoint. Use ha.breakpoint(\'label\', { vars }) in a script.' })
        : 'No active breakpoint. Use ha.breakpoint(\'label\', { vars }) in a script.';
    panel.innerHTML = `<div class="ei-hint">${hint}</div>`;
}

function onBreakpointHit(data) {
    _currentBreakpoint = data;

    // Switch to breakpoints tab
    const tabBtn = document.querySelector('.log-pane-tab[data-tab="breakpoints"]');
    if (tabBtn && !tabBtn.classList.contains('active')) tabBtn.click();

    const panel = document.getElementById('dev-tab-breakpoints');
    if (!panel) return;

    const vars = data.vars || {};
    const hasVars = Object.keys(vars).length > 0;

    const rows = hasVars
        ? Object.entries(vars).map(([k, v]) => {
            const valStr = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
            const typeLabel = Array.isArray(v) ? 'array' : typeof v;
            return `<tr>
                <td class="bp-var-key">${_esc(k)}</td>
                <td class="bp-var-type">${typeLabel}</td>
                <td class="bp-var-val"><pre>${_esc(valStr)}</pre></td>
            </tr>`;
          }).join('')
        : `<tr><td colspan="3" class="bp-var-empty">No variables passed.</td></tr>`;

    panel.innerHTML = `
        <div class="bp-wrap">
            <div class="bp-header">
                <div class="bp-meta">
                    <span class="bp-badge">⏸</span>
                    <span class="bp-label">${_esc(data.label)}</span>
                    <span class="bp-script">${_esc(data.name || data.filename || '')}</span>
                </div>
                <button class="bp-continue-btn" onclick="continueBreakpoint()">
                    <i class="mdi mdi-play"></i> Continue
                </button>
            </div>
            <div class="bp-vars">
                <table class="bp-var-table">
                    <thead><tr>
                        <th>Variable</th>
                        <th>Type</th>
                        <th>Value</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function onBreakpointContinued(data) {
    if (_currentBreakpoint && _currentBreakpoint.filename === data.filename) {
        _renderIdle();
    }
}

function continueBreakpoint() {
    if (!_currentBreakpoint) return;
    window.socket?.emit('debug_continue', _currentBreakpoint.filename);
    _renderIdle();
}

function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

window.initBreakpoints       = initBreakpoints;
window.onBreakpointHit       = onBreakpointHit;
window.onBreakpointContinued = onBreakpointContinued;
window.continueBreakpoint    = continueBreakpoint;
