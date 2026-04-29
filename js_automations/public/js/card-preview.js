/**
 * JS AUTOMATIONS — Card Preview Panel
 *
 * Floating panel that renders a Script Pack card inside a sandboxed iframe.
 * Features: width presets, mock hass entity injection, error log, drag & position persistence.
 */

'use strict';

const CardPreview = (() => {
    let panel         = null;
    let iframe        = null;
    let currentScript = null;
    let mockStates    = {};  // { entityId: { state, attributes } }
    let cardConfig    = {};  // passed to setConfig() on the mounted card
    let _errors       = [];
    // Translation helper
    const _t = (key, fallback) => (typeof window.t === 'function') ? window.t(key) : fallback;

    let _socketListener = null;
    let _discoveryPromise = Promise.resolve(); // resolves when _autoDiscoverEntities() finishes

    // ── Public API ────────────────────────────────────────────────────────────

    function open(scriptFilename) {
        if (!scriptFilename) return;
        if (!panel) _create();
        _loadScript(scriptFilename);
        panel.classList.remove('hidden');
        _restorePosition();
        _syncPreviewBtn(true);
    }

    function close() {
        if (panel) panel.classList.add('hidden');
        _syncPreviewBtn(false);
    }

    function _syncPreviewBtn(active) {
        const btn = document.getElementById('btn-card-menu');
        if (btn) btn.classList.toggle('preview-active', active);
    }

    function toggle(scriptFilename) {
        if (!scriptFilename) return;
        if (!panel || panel.classList.contains('hidden')) {
            open(scriptFilename);
        } else if (currentScript !== scriptFilename) {
            _loadScript(scriptFilename);  // switch to different script
        } else {
            close();
        }
    }

    /** Reload the iframe — called after card save */
    function reload() {
        if (!iframe || !currentScript) return;
        _clearErrors();
        iframe.src = _previewUrl(currentScript);
    }

    function isOpen() {
        return panel && !panel.classList.contains('hidden');
    }

    // ── Private: Panel lifecycle ──────────────────────────────────────────────

    function _previewUrl(filename) {
        const base = (typeof BASE_PATH !== 'undefined' ? BASE_PATH : '/');
        return `${base}api/scripts/${filename}/card/preview-html?t=${Date.now()}`;
    }

    function _loadScript(filename) {
        if (!filename) return;
        currentScript = filename;

        const titleEl = panel.querySelector('.preview-title');
        if (titleEl) titleEl.textContent = filename.replace(/\.[^.]+$/, '') + ' — card';

        _clearErrors();

        const stored = localStorage.getItem(`jsa_preview_states_${filename}`);
        mockStates = stored ? _tryParse(stored, {}) : {};
        _renderMockStates();

        // Load (or generate a smart default) card config
        const storedCfg = localStorage.getItem(`jsa_preview_config_${filename}`);
        if (storedCfg) {
            cardConfig = _tryParse(storedCfg, {});
        } else {
            const scriptName = filename.replace(/\.[^.]+$/, '').replace(/-/g, '_');
            cardConfig = { entity_id: `sensor.${scriptName}` };
        }
        _renderCardConfig();

        iframe.src = _previewUrl(filename);

        // Auto-discover refreshes mockStates from HA before jsa-card-loaded fires
        _discoveryPromise = _autoDiscoverEntities(filename);
    }

    function _autoDiscoverEntities(filename) {
        if (!filename) return Promise.resolve();
        const scriptName = filename.replace(/\.[^.]+$/, '').replace(/-/g, '_');
        const storedCfg = localStorage.getItem(`jsa_preview_config_${filename}`);
        
        if (typeof window.getHAStates !== 'function') return Promise.resolve();

        return window.getHAStates()
            .then(statesArr => {
                if (!Array.isArray(statesArr)) return;
                let changed = false;
                for (const s of statesArr) {
                    if (!s.entity_id.includes(scriptName)) continue;
                    // Skip transient re-registration states (unknown + no attributes)
                    // when we already have meaningful data for this entity in mockStates.
                    const incoming = s.attributes ?? {};
                    const current  = (mockStates[s.entity_id] || {}).attributes ?? {};
                    if (s.state === 'unknown' && !incoming.datetime && current.datetime) continue;
                    mockStates[s.entity_id] = { state: s.state, attributes: incoming };
                    changed = true;
                    // If config was auto-generated (no stored config), update entity_id to match the real entity
                    if (!storedCfg && !cardConfig.entity_id?.includes(s.entity_id.split('.')[0])) {
                        cardConfig = { entity_id: s.entity_id };
                        _renderCardConfig();
                    }
                }
                if (changed) {
                    _saveMockStates();
                    _renderMockStates();
                }
            })
            .catch(() => { /* HA not reachable — user can add entities manually */ });
    }

    function _create() {
        panel = document.createElement('div');
        panel.id  = 'card-preview-panel';
        panel.className = 'card-preview-panel hidden';

        panel.innerHTML = `
            <div class="preview-titlebar" id="preview-drag-handle">
                <i class="mdi mdi-view-dashboard-outline" style="margin-right:6px;opacity:.7;"></i>
                <span class="preview-title">Card Preview</span>
                <div class="preview-titlebar-actions">
                    <button class="preview-action-btn" id="preview-configure-btn" title="Configure card"><i class="mdi mdi-cog-outline"></i></button>
                    <button class="preview-action-btn" id="preview-reload-btn" title="Reload preview"><i class="mdi mdi-refresh"></i></button>
                    <button class="preview-action-btn" id="preview-close-btn" title="Close preview"><i class="mdi mdi-close"></i></button>
                </div>
            </div>

            <div class="preview-width-bar">
                <span class="preview-width-label">Width:</span>
                <button class="preview-width-btn" data-width="180" title="1col — Narrow column (~180px)">1col</button>
                <button class="preview-width-btn active" data-width="380" title="2col — Standard card (~380px)">2col</button>
                <button class="preview-width-btn" data-width="760" title="4col — Full-width card (~760px)">4col</button>
                <button class="preview-width-btn" data-width="free" title="Free — drag to resize">↔ free</button>
            </div>

            <div class="preview-iframe-wrap">
                <iframe id="card-preview-iframe"
                    class="preview-iframe"
                    frameborder="0"
                    sandbox="allow-scripts allow-same-origin">
                </iframe>
            </div>

            <details class="preview-section" id="preview-config-section" open>
                <summary>
                    <i class="mdi mdi-cog-outline"></i>
                    ${_t('preview.card_config', 'Card Config')} <small>(setConfig)</small>
                </summary>
                <div class="preview-config-body">
                    <textarea id="preview-config-input" class="preview-config-textarea" rows="3" spellcheck="false"></textarea>
                    <div class="preview-config-hint" id="preview-config-hint"></div>
                </div>
            </details>

            <details class="preview-section" id="preview-hass-section">
                <summary>
                    <i class="mdi mdi-code-braces"></i>
                    ${_t('preview.entity_states', 'Entity States')} <small>(mock hass)</small>
                </summary>
                <div class="preview-hass-body">
                    <div id="preview-hass-list"></div>
                    <div class="preview-hass-add-row">
                        <input id="preview-hass-entity-input" type="text" class="preview-input" placeholder="entity_id">
                        <input id="preview-hass-state-input"  type="text" class="preview-input" placeholder="state">
                        <button class="preview-add-btn" id="preview-hass-add-btn" title="Add entity">
                            <i class="mdi mdi-plus"></i>
                        </button>
                    </div>
                </div>
            </details>

            <details class="preview-section" id="preview-errors-section">
                <summary>
                    <i class="mdi mdi-alert-circle-outline"></i>
                    ${_t('preview.errors', 'Errors')} <span id="preview-error-badge"></span>
                </summary>
                <div id="preview-errors-body" class="preview-errors-body"></div>
            </details>
        `;

        document.body.appendChild(panel);

        iframe = panel.querySelector('#card-preview-iframe');

        // Width presets
        panel.querySelectorAll('.preview-width-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _setWidth(btn.dataset.width);
                panel.querySelectorAll('.preview-width-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                localStorage.setItem('jsa_preview_width', btn.dataset.width);
            });
        });

        // Restore saved width
        const savedWidth = localStorage.getItem('jsa_preview_width') || '380';
        _setWidth(savedWidth);

        const savedWidthBtn = panel.querySelector(`[data-width="${savedWidth}"]`);
        if (savedWidthBtn) {
            panel.querySelectorAll('.preview-width-btn').forEach(b => b.classList.remove('active'));
            savedWidthBtn.classList.add('active');
        }

        // Buttons
        panel.querySelector('#preview-configure-btn').addEventListener('click', () => {
            if (iframe?.contentWindow) iframe.contentWindow.postMessage({ type: 'jsa-open-editor' }, '*');
        });
        panel.querySelector('#preview-reload-btn').addEventListener('click', reload);
        panel.querySelector('#preview-close-btn').addEventListener('click', close);
        panel.querySelector('#preview-hass-add-btn').addEventListener('click', _addMockStateFromInputs);

        // Enter key in inputs
        panel.querySelector('#preview-hass-state-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') _addMockStateFromInputs();
        });
        panel.querySelector('#preview-hass-entity-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') panel.querySelector('#preview-hass-state-input').focus();
        });

        // Listen for iframe messages — registered early so nothing above can prevent it
        window.addEventListener('message', _onIframeMessage);

        // Card config textarea
        const _cfgInput = panel.querySelector('#preview-config-input');
        if (_cfgInput) _cfgInput.addEventListener('input', _onCardConfigInput);

        // Drag
        _makeDraggable(panel.querySelector('#preview-drag-handle'), panel);

        // Forward live HA state changes
        _initSocketListener();

        // Fallback: poll tracked states every 30s in case socket events are missed
        setInterval(() => {
            if (!panel || panel.classList.contains('hidden')) return;
            _refreshTrackedStates();
        }, 30000);

        _renderMockStates();
        _renderErrors();
    }

    function _initSocketListener() {
        if (!window.socket) return;
        if (_socketListener) window.socket.off('ha_state_changed', _socketListener);
        
        _socketListener = ({ entity_id, new_state }) => {
            if (!new_state) return;
            if (!panel || panel.classList.contains('hidden')) return;
            if (!Object.prototype.hasOwnProperty.call(mockStates, entity_id)) return;
            // Ignore transient re-registration states: "unknown" with no attributes
            // while the current mock already has meaningful data (e.g. datetime).
            const incoming = new_state.attributes ?? {};
            const current  = mockStates[entity_id].attributes ?? {};
            if (new_state.state === 'unknown' && !incoming.datetime && current.datetime) return;
            mockStates[entity_id].state = new_state.state;
            mockStates[entity_id].attributes = incoming;
            _renderMockStates();
            _pushHassToIframe();
        };
        window.socket.on('ha_state_changed', _socketListener);
    }

    // ── Private: Width ────────────────────────────────────────────────────────

    function _setWidth(width) {
        const wrap = panel.querySelector('.preview-iframe-wrap');
        if (width === 'free') {
            // keep current pixel width so it's resizable from here
            const current = wrap.getBoundingClientRect().width || 380;
            wrap.style.width   = current + 'px';
            wrap.style.resize  = 'horizontal';
            wrap.style.overflow = 'hidden';
        } else {
            wrap.style.width   = width + 'px';
            wrap.style.resize  = 'none';
            wrap.style.overflow = '';
        }
    }

    // ── Private: Mock Hass ────────────────────────────────────────────────────

    function _addMockStateFromInputs() {
        const entityEl = panel.querySelector('#preview-hass-entity-input');
        const stateEl  = panel.querySelector('#preview-hass-state-input');
        const entityId = entityEl.value.trim();
        const state    = stateEl.value.trim();
        if (!entityId) { entityEl.focus(); return; }

        mockStates[entityId] = {
            state: state || 'unknown',
            attributes: mockStates[entityId]?.attributes ?? { friendly_name: entityId },
        };

        entityEl.value = '';
        stateEl.value  = '';
        entityEl.focus();

        _saveMockStates();
        _renderMockStates();
        _pushHassToIframe();
    }

    function _deleteMockState(entityId) {
        delete mockStates[entityId];
        _saveMockStates();
        _renderMockStates();
        _pushHassToIframe();
    }

    function _renderMockStates() {
        const list = panel && panel.querySelector('#preview-hass-list');
        if (!list) return;

        if (Object.keys(mockStates).length === 0) {
            list.innerHTML = `<div class="preview-empty-hint">${_t('preview.no_entities', 'No entities. Add one below to inject into mock hass.')}</div>`;
            return;
        }

        list.innerHTML = Object.entries(mockStates).map(([id, s]) => `
            <div class="preview-hass-row">
                <span class="preview-hass-id">${_escHtml(id)}</span>
                <span class="preview-hass-state-val">${_escHtml(s.state)}</span>
                <button class="preview-hass-del-btn" data-entity="${_escHtml(id)}" title="Remove">
                    <i class="mdi mdi-close-circle-outline"></i>
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.preview-hass-del-btn').forEach(btn => {
            btn.addEventListener('click', () => _deleteMockState(btn.dataset.entity));
        });
    }

    function _saveMockStates() {
        if (currentScript) {
            localStorage.setItem(`jsa_preview_states_${currentScript}`, JSON.stringify(mockStates));
        }
    }

    // ── Private: Card Config ──────────────────────────────────────────────────

    function _renderCardConfig() {
        const ta   = panel && panel.querySelector('#preview-config-input');
        const hint = panel && panel.querySelector('#preview-config-hint');
        if (!ta) return;
        ta.value = JSON.stringify(cardConfig, null, 2);
        if (hint) hint.textContent = '';
    }

    function _onCardConfigInput() {
        const ta   = panel.querySelector('#preview-config-input');
        const hint = panel.querySelector('#preview-config-hint');
        const raw  = ta.value.trim();
        if (!raw) {
            cardConfig = {};
            hint.textContent = '';
        } else {
            try {
                cardConfig = JSON.parse(raw);
                hint.textContent = '';
                hint.className = 'preview-config-hint';
            } catch {
                hint.textContent = _t('preview.invalid_json', 'Invalid JSON');
                hint.className = 'preview-config-hint preview-config-hint-error';
                return; // don't push invalid config
            }
        }
        if (currentScript) {
            localStorage.setItem(`jsa_preview_config_${currentScript}`, JSON.stringify(cardConfig));
        }
        _pushConfigToIframe();
    }

    function _pushConfigToIframe() {
        if (!iframe?.contentWindow) return;
        // _stub:true tells cards to show demo data when no real entity state exists.
        // The real HA dashboard never sends this flag, so production behavior is unaffected.
        iframe.contentWindow.postMessage({ type: 'jsa-set-config', config: { _stub: true, ...cardConfig } }, '*');
    }

    function _pushHassToIframe() {
        if (!iframe?.contentWindow) return;
        const states = {};
        for (const [id, s] of Object.entries(mockStates)) {
            states[id] = {
                entity_id: id,
                state: s.state,
                attributes: s.attributes ?? { friendly_name: id },
                last_changed: new Date().toISOString(),
                last_updated: new Date().toISOString(),
            };
        }
        iframe.contentWindow.postMessage({ type: 'jsa-set-hass', states }, '*');
    }

    // ── Private: Errors ───────────────────────────────────────────────────────

    function _addError(message, lineno) {
        _errors.push({ message, lineno, time: new Date().toLocaleTimeString() });
        _renderErrors();
    }

    function _clearErrors() {
        _errors = [];
        _renderErrors();
    }

    function _renderErrors() {
        if (!panel) return;
        const body  = panel.querySelector('#preview-errors-body');
        const badge = panel.querySelector('#preview-error-badge');
        const sec   = panel.querySelector('#preview-errors-section');
        if (!body) return;

        if (_errors.length === 0) {
            badge.textContent = '';
            badge.className = '';
            sec.classList.remove('has-errors');
            body.innerHTML = `<div class="preview-empty-hint">${_t('preview.no_errors', 'No errors.')}</div>`;
        } else {
            badge.textContent = `(${_errors.length})`;
            badge.className = 'preview-error-badge';
            sec.classList.add('has-errors');
            sec.open = true;
            body.innerHTML = _errors.map(e => `
                <div class="preview-error-row">
                    <span class="preview-error-time">${e.time}</span>
                    <span class="preview-error-msg">${_escHtml(e.message)}${e.lineno ? ` <span class="preview-error-line">${_t('preview.line', 'line')} ${e.lineno}</span>` : ''}</span>
                </div>
            `).join('');
        }
    }

    // ── Private: iframe messages ──────────────────────────────────────────────

    function _onIframeMessage(e) {
        if (!e.data) return;
        if (e.data.type === 'jsa-card-error') {
            _addError(e.data.message, e.data.lineno);
            // Also surface in the main JSA log panel so errors are visible without the preview open
            if (typeof appendLog === 'function') {
                const src = e.data.scriptName ?? currentScript ?? _t('preview.card_source', 'Card');
                // Log card errors to the main log panel for better observability
                appendLog({ ts: Date.now(), level: 'error', source: src, message: `[Card Preview] ${e.data.message}` });
            }
        }
        if (e.data.type === 'jsa-card-loaded') {
            // Push stored config immediately so the card uses the right entityId from the start.
            _pushConfigToIframe();
            // Push whatever mockStates we already have (from localStorage) so the card renders
            // immediately rather than waiting for discovery (which requires a socket round-trip).
            _pushHassToIframe();
            // Then let discovery refresh from live HA and push again once complete.
            _discoveryPromise.then(_pushHassToIframe);
        }
        if (e.data.type === 'jsa-action-done') {
            if (e.data.config && e.data.config.entityId) {
                cardConfig = { entityId: e.data.config.entityId };
                if (currentScript) {
                    localStorage.setItem(`jsa_preview_config_${currentScript}`, JSON.stringify(cardConfig));
                }
                _renderCardConfig();
                _pushConfigToIframe();
                // Poll until the new entity has real match data (ha.update is fire-and-forget).
                _pollEntityReady(e.data.config.entityId);
            } else {
                // Non-config action (e.g. refresh) — rediscover and push once.
                _autoDiscoverEntities(currentScript).then(() => _pushHassToIframe());
                setTimeout(() => _autoDiscoverEntities(currentScript).then(() => _pushHassToIframe()), 2000);
            }
        }
    }

    function _pollEntityReady(entityId, attempt) {
        attempt = attempt || 0;
        if (attempt > 12) {
            // Give up active polling — the 5s interval will keep the card in sync from here
            _refreshTrackedStates();
            return;
        }
        if (typeof window.getHAStates !== 'function') return;
        window.getHAStates().then(statesArr => {
            if (!Array.isArray(statesArr)) return;
            const match = statesArr.find(s => s.entity_id === entityId);
            if (attempt === 0) {
                const logFn = typeof appendLog === 'function' ? appendLog : null;
                if (match) {
                    const msg = `[Preview] Poll #0 — ${entityId}: state="${match.state}", attrs=${JSON.stringify(match.attributes)}`;
                    console.log(msg);
                    if (logFn) logFn({ ts: Date.now(), level: 'info', source: 'card-preview', message: msg });
                } else {
                    const msg = `[Preview] Poll #0 — ${entityId}: entity NOT found in HA states (${statesArr.length} total)`;
                    console.warn(msg);
                    if (logFn) logFn({ ts: Date.now(), level: 'info', source: 'card-preview', message: msg });
                }
            }
            if (match) {
                mockStates[entityId] = { state: match.state, attributes: match.attributes ?? {} };
                _saveMockStates();
                _renderMockStates();
                _pushHassToIframe();
                // Keep polling until datetime attribute arrives (ha.update may still be in flight)
                if (!match.attributes || !match.attributes.datetime) {
                    setTimeout(() => _pollEntityReady(entityId, attempt + 1), 1200);
                }
            } else {
                setTimeout(() => _pollEntityReady(entityId, attempt + 1), 1200);
            }
        }).catch(() => {
            setTimeout(() => _pollEntityReady(entityId, attempt + 1), 1500);
        });
    }

    function _refreshTrackedStates() {
        const tracked = Object.keys(mockStates);
        if (tracked.length === 0) return;
        const base = (typeof BASE_PATH !== 'undefined' ? BASE_PATH : '/');
        fetch(base + 'api/ha/states')
            .then(r => r.json())
            .then(statesArr => {
                // getStates() returns an array; build a map for O(1) lookup
                const stateMap = {};
                for (const s of statesArr) stateMap[s.entity_id] = s;
                let changed = false;
                for (const id of tracked) {
                    const s = stateMap[id];
                    if (!s) continue;
                    // Skip transient re-registration states (unknown + no attributes)
                    // when we already have meaningful data for this entity.
                    const incoming = s.attributes ?? {};
                    const current  = mockStates[id].attributes ?? {};
                    if (s.state === 'unknown' && !incoming.datetime && current.datetime) continue;
                    mockStates[id].state      = s.state;
                    mockStates[id].attributes = incoming;
                    changed = true;
                }
                if (changed) {
                    _renderMockStates();
                    _pushHassToIframe();
                }
            })
            .catch(() => { /* silent — socket update will still arrive */ });
    }

    // ── Private: Drag ─────────────────────────────────────────────────────────

    function _makeDraggable(handle, target) {
        let sx, sy, sl, st;

        handle.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return; // don't drag on button click
            e.preventDefault();
            sx = e.clientX;
            sy = e.clientY;
            const r = target.getBoundingClientRect();
            sl = r.left;
            st = r.top;

            const onMove = e => {
                target.style.left   = `${sl + e.clientX - sx}px`;
                target.style.top    = `${st + e.clientY - sy}px`;
                target.style.right  = 'auto';
                target.style.bottom = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                _savePosition();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function _savePosition() {
        if (!panel) return;
        const r = panel.getBoundingClientRect();
        localStorage.setItem('jsa_preview_pos', JSON.stringify({ left: r.left, top: r.top }));
    }

    function _restorePosition() {
        if (!panel) return;
        const stored = localStorage.getItem('jsa_preview_pos');
        if (stored) {
            const { left, top } = _tryParse(stored, {});
            if (left !== undefined) {
                // Clamp: top must be at least 60px (nav bar), left must keep panel partially on screen
                const minTop  = 60;
                const maxLeft = window.innerWidth - 100;
                panel.style.left   = `${Math.min(Math.max(0, left), maxLeft)}px`;
                panel.style.top    = `${Math.max(minTop, top)}px`;
                panel.style.right  = 'auto';
                panel.style.bottom = 'auto';
            }
        } else {
            // Default position if nothing is saved yet
            panel.style.right  = '20px';
            panel.style.top    = '80px';
            panel.style.left   = 'auto';
            panel.style.bottom = 'auto';
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _tryParse(str, fallback) {
        try { return JSON.parse(str); } catch { return fallback; }
    }

    return { open, close, toggle, reload, isOpen, _deleteMockState };
})();

window.CardPreview = CardPreview;

// ── Initialization ────────────────────────────────────────────────────────────

// Attach toggle handler to button on load
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-card-menu');
    if (btn) btn.onclick = _toggleCardPreview;
});

// ── Preview toggle button ─────────────────────────────────────────────────────

function _toggleCardPreview() {
    CardPreview.toggle(window._activeCardParentScript);
}

window._toggleCardPreview = _toggleCardPreview;
