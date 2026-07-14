// public/js/blockly-fields.js
//
// Custom Blockly fields for entity/service pickers backed by live Home Assistant data.
// Same UMD cross-environment pattern as blockly-blocks-shared.js/blockly-mutators.js: the
// browser has live data (allEntities/haData.services, the same globals Monaco's own
// autocomplete already uses), Node (BlocklyCompiler) has none and only needs to *read*
// whatever was serialized.
//
// Built as a FieldTextInput (not FieldDropdown) with a custom filtered suggestion list attached
// to its editor's <input> — a searchable combobox rather than a click-to-scroll menu, since a
// plain dropdown gets unusable with a large number of entities. This also sidesteps
// FieldDropdown's validation problems entirely (verified against blockly@11.2.2, not assumed,
// while this was still FieldDropdown-based): FieldTextInput's default validation already accepts
// any string, so there's no "must be a listed option" check to work around, and no "menu must
// be non-empty" constructor requirement either.
//
// First attempt used a native HTML <datalist> (list="..." attribute) instead of the custom list
// below — simpler, but verified live in the browser to render its popup offset from the field
// (and with leftover overlapping text after picking a value). Root cause: Blockly's workspace is
// panned/zoomed via a CSS `transform` on an SVG ancestor, and a `transform` anywhere in an
// element's ancestor chain changes the containing block for natively-positioned popups (native
// <select>/<datalist> dropdowns, `position: fixed`) to that ancestor instead of the viewport —
// a well-known browser quirk, not something CSS on the popup itself can fix. The suggestion list
// below is a plain `<div>` appended directly to `document.body` (not inside the transformed
// workspace), positioned with `getBoundingClientRect()` math instead of native popup
// positioning — the standard workaround for building floating UI over a transformed/canvas
// container (the same reason libraries like Popper/Floating UI exist).
//
// widgetCreate_ etc. only ever run in the browser (Node's BlocklyCompiler never opens a field
// editor), so none of this ever touches Node's code path.
(function (global, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        global.registerHaFields = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    return function registerHaFields(Blockly) {
        const MAX_SUGGESTIONS = 50; // keep filtering cheap and the list scrollable, not a 1000-row DOM dump

        class FieldHaCombobox extends Blockly.FieldTextInput {
            constructor(value, getLiveOptions) {
                super(value);
                this.getLiveOptions_ = getLiveOptions;
                this.suggestionsEl_ = null;
            }

            widgetCreate_() {
                const input = super.widgetCreate_();
                const getLiveOptions = this.getLiveOptions_;
                if (!getLiveOptions) return input;

                // Light, not dark: Blockly's own field editor <input> always renders with a
                // light background/dark text regardless of workspace theme (standard Blockly
                // behavior, not something this project's dark theme overrides) — the dark list
                // from the first pass clashed with the field it's attached to.
                const list = document.createElement('div');
                Object.assign(list.style, {
                    position: 'fixed', zIndex: '10000', display: 'none',
                    background: '#fff', color: '#1e1e1e', border: '1px solid #bbb',
                    maxHeight: '240px', overflowY: 'auto', overflowX: 'hidden',
                    whiteSpace: 'nowrap', font: '13px sans-serif',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                });
                document.body.appendChild(list);
                this.suggestionsEl_ = list;

                const render = () => {
                    const term = input.value.toLowerCase();
                    const all = getLiveOptions() || [];
                    const matches = (term ? all.filter(([, v]) => v.toLowerCase().includes(term)) : all)
                        .slice(0, MAX_SUGGESTIONS);
                    list.innerHTML = '';
                    if (matches.length === 0) {
                        list.style.display = 'none';
                        return;
                    }
                    matches.forEach(([, value]) => {
                        const item = document.createElement('div');
                        item.textContent = value;
                        Object.assign(item.style, {
                            padding: '4px 8px', cursor: 'pointer',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                        });
                        item.addEventListener('mouseenter', () => { item.style.background = '#e8f0fe'; });
                        item.addEventListener('mouseleave', () => { item.style.background = ''; });
                        // mousedown (not click) + preventDefault: fires before the input's blur,
                        // and keeps focus on the input so selecting an item doesn't close the editor.
                        item.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                            input.value = value;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            list.style.display = 'none';
                        });
                        list.appendChild(item);
                    });
                    // Deferred to the next frame: on the very first open of a field, Blockly's
                    // WidgetDiv hasn't necessarily finished positioning the <input> yet at the
                    // instant 'focus' fires — reading getBoundingClientRect() synchronously here
                    // could catch it mid-move (still at its stale/previous position), which is
                    // what made the list jump to the top-left corner on some opens. By the next
                    // animation frame Blockly's own positioning has always settled.
                    requestAnimationFrame(() => {
                        // Blockly's field <input> is often narrow (just wide enough for the
                        // current text) — sizing the list to match it clips longer entity/service
                        // IDs. Auto-size to content instead, only using the field's width as a
                        // lower bound.
                        const rect = input.getBoundingClientRect();
                        Object.assign(list.style, {
                            left: rect.left + 'px', top: rect.bottom + 'px',
                            width: 'auto', minWidth: Math.max(rect.width, 240) + 'px', maxWidth: '420px',
                            display: 'block',
                        });
                    });
                };

                input.addEventListener('input', render);
                input.addEventListener('focus', render);
                input.addEventListener('blur', () => { list.style.display = 'none'; });
                return input;
            }

            widgetDispose_() {
                super.widgetDispose_();
                if (this.suggestionsEl_) {
                    this.suggestionsEl_.remove();
                    this.suggestionsEl_ = null;
                }
            }
        }

        class FieldEntityDropdown extends FieldHaCombobox {
            constructor(value) {
                super(value, () => this.getFilteredEntities_());
            }

            // Domain awareness: an `ha_entity` block plugged into `ha_call_service`'s ENTITY
            // socket can infer a domain filter from that same block's SERVICE field (e.g.
            // "light.turn_on" implies light.* entities) — no separate mechanism needed, just a
            // refinement on top of the existing picker (per the concept doc's open item). Only
            // wired up for `ha_call_service` since it's the only block where both the domain hint
            // (SERVICE) and the entity picker live on the same parent block; other sockets
            // (ha_trigger_on, ha_get_state, ...) have no such hint and fall through to the
            // unfiltered list below.
            getFilteredEntities_() {
                if (typeof allEntities === 'undefined' || !allEntities || allEntities.length === 0) return null;
                const domain = this.inferDomainFromContext_();
                if (!domain) return allEntities.map(id => [id, id]);
                const filtered = allEntities.filter(id => id.startsWith(domain + '.'));
                // Falls back to the unfiltered list rather than an empty suggestion list when the
                // guess doesn't pan out (e.g. a cross-domain service like homeassistant.turn_on).
                const list = filtered.length > 0 ? filtered : allEntities;
                return list.map(id => [id, id]);
            }

            inferDomainFromContext_() {
                const sourceBlock = this.getSourceBlock && this.getSourceBlock();
                const parentConn = sourceBlock && sourceBlock.outputConnection && sourceBlock.outputConnection.targetConnection;
                const parentBlock = parentConn && parentConn.getSourceBlock();
                if (!parentBlock || parentBlock.type !== 'ha_call_service') return null;
                const service = parentBlock.getFieldValue('SERVICE');
                return service && service.includes('.') ? service.split('.')[0] : null;
            }

            static fromJson(options) {
                return new FieldEntityDropdown(options['entityId']);
            }
        }

        class FieldServiceDropdown extends FieldHaCombobox {
            constructor(value) {
                super(value, () => {
                    if (typeof haData === 'undefined' || !haData.services) return null;
                    const opts = [];
                    for (const domain in haData.services) {
                        for (const service in haData.services[domain]) {
                            const id = `${domain}.${service}`;
                            opts.push([id, id]);
                        }
                    }
                    if (opts.length === 0) return null;
                    return opts.sort((a, b) => a[0].localeCompare(b[0]));
                });
            }
            static fromJson(options) {
                return new FieldServiceDropdown(options['service']);
            }
        }

        Blockly.fieldRegistry.register('field_entity_dropdown', FieldEntityDropdown);
        Blockly.fieldRegistry.register('field_service_dropdown', FieldServiceDropdown);
    };
});
