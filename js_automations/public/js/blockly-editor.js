/**
 * JS AUTOMATIONS - Blockly Editor
 * Workspace lifecycle for `.blocks` tabs: lazy injection, load/save state, dirty tracking.
 *
 * Unlike Monaco (one editor instance, one model per tab, models persist in memory), there is
 * a single shared Blockly workspace instance reused across all open `.blocks` tabs. Each tab
 * keeps its own serialized state (plain JSON) and the workspace is cleared + reloaded on every
 * tab switch. This means undo history does not survive switching away from a Blockly tab and
 * back — an accepted M2 simplification, not a bug.
 */
var blocklyWorkspace = null;
var _blocklyReady = false;

function isBlocklyReady() {
    return _blocklyReady;
}

// Maps each ha_* block's message/tooltip properties to their i18next key. Applied to a copy of
// HA_BLOCK_DEFINITIONS at editor-init time (not via Blockly's own %{BKY_...} message-reference
// resolution) so translated text is a plain string substitution we control end to end, with no
// dependency on how far jsonInit's reference resolution reaches (verified for message0/1/2/3,
// undocumented for tooltip). i18next's language is fixed for the page's lifetime (see i18n.js —
// a language change triggers a full reload), so a one-time substitution here is sufficient.
const BLOCKLY_MESSAGE_KEYS = {
    ha_trigger_on: { message0: 'blockly_trigger_on_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_trigger_on_tooltip' },
    ha_trigger_on_state: { message0: 'blockly_trigger_on_state_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_trigger_on_state_tooltip' },
    ha_schedule_interval: { message0: 'blockly_schedule_interval_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_schedule_interval_tooltip' },
    ha_schedule_daily: { message0: 'blockly_schedule_daily_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_schedule_daily_tooltip' },
    ha_schedule_cron: { message0: 'blockly_schedule_cron_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_schedule_cron_tooltip' },
    ha_call_service: { message0: 'blockly_call_service_msg0', tooltip: 'blockly_call_service_tooltip' },
    ha_log: { message0: 'blockly_log_msg0', tooltip: 'blockly_log_tooltip' },
    ha_stop: { message0: 'blockly_stop_msg0', tooltip: 'blockly_stop_tooltip' },
    ha_entity: { message0: 'blockly_entity_msg0', tooltip: 'blockly_entity_tooltip' },
    ha_get_state: { message0: 'blockly_get_state_msg0', tooltip: 'blockly_get_state_tooltip' },
    ha_get_attribute: { message0: 'blockly_get_attribute_msg0', tooltip: 'blockly_get_attribute_tooltip' },
    ha_wait: { message0: 'blockly_wait_msg0', tooltip: 'blockly_wait_tooltip' },
    ha_notify: { message0: 'blockly_notify_msg0', message1: 'blockly_notify_msg1', message2: 'blockly_notify_msg2', message3: 'blockly_notify_msg3', tooltip: 'blockly_notify_tooltip' },
    ha_register: { message0: 'blockly_register_msg0', tooltip: 'blockly_register_tooltip' },
    ha_update: { message0: 'blockly_update_msg0', tooltip: 'blockly_update_tooltip' },
    ha_store_get: { message0: 'blockly_store_get_msg0', tooltip: 'blockly_store_get_tooltip' },
    ha_store_set: { message0: 'blockly_store_set_msg0', message1: 'blockly_store_set_msg1', tooltip: 'blockly_store_set_tooltip' },
    ha_store_delete: { message0: 'blockly_store_delete_msg0', tooltip: 'blockly_store_delete_tooltip' },
    ha_store_on: { message0: 'blockly_store_on_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_store_on_tooltip' },
    ha_mqtt_subscribe: { message0: 'blockly_mqtt_subscribe_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_mqtt_subscribe_tooltip' },
    ha_mqtt_payload: { message0: 'blockly_mqtt_payload_msg0', tooltip: 'blockly_mqtt_payload_tooltip' },
    ha_mqtt_publish: { message0: 'blockly_mqtt_publish_msg0', message1: 'blockly_mqtt_publish_msg1', tooltip: 'blockly_mqtt_publish_tooltip' },
};

// blockly-toolbox.json's static category names, keyed by their literal English text as written
// there, mapped to the i18next key to render instead.
const BLOCKLY_CATEGORY_KEYS = {
    'Triggers': 'blockly_category_triggers',
    'Actions': 'blockly_category_actions',
    'State': 'blockly_category_state',
    'Wait': 'blockly_category_wait',
    'Register/Update': 'blockly_category_register',
    'Store': 'blockly_category_store',
    'Script Utilities': 'blockly_category_script',
};

/** Returns a translated copy of HA_BLOCK_DEFINITIONS; the original array is left untouched. */
function localizeBlockDefinitions(defs) {
    if (typeof i18next === 'undefined') return defs;
    return defs.map((def) => {
        let localized = def;
        const msgMap = BLOCKLY_MESSAGE_KEYS[def.type];
        if (msgMap) {
            localized = Object.assign({}, def);
            for (const prop in msgMap) {
                localized[prop] = i18next.t(msgMap[prop], { defaultValue: def[prop] });
            }
        }
        // Only translatable field_dropdown in the library: ha_schedule_interval's UNIT
        // (minutes/hours). The stored value stays the English literal the generator expects
        // (worker-wrapper.js's schedule() shorthand parser); only the displayed label changes.
        if (def.type === 'ha_schedule_interval') {
            localized = Object.assign({}, localized, {
                args0: def.args0.map((arg) => {
                    if (arg.name !== 'UNIT') return arg;
                    return Object.assign({}, arg, {
                        options: arg.options.map(([label, value]) => [
                            i18next.t(`blockly_schedule_interval_unit_${value}`, { defaultValue: label }),
                            value,
                        ]),
                    });
                }),
            });
        }
        return localized;
    });
}

/** Lazily injects the Blockly workspace into #blockly-container. Idempotent. */
function initBlocklyEditor() {
    if (blocklyWorkspace || typeof Blockly === 'undefined') return;

    if (typeof HA_BLOCK_DEFINITIONS !== 'undefined') {
        // The UMD browser bundle exposes this both flattened (Blockly.defineBlocksWithJsonArray)
        // and namespaced (Blockly.common...); the Node package only has the namespaced form.
        const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray) || Blockly.defineBlocksWithJsonArray;
        if (define) define(localizeBlockDefinitions(HA_BLOCK_DEFINITIONS));
    }
    if (typeof window.registerHaBlocks === 'function') {
        window.registerHaBlocks(Blockly.JavaScript);
    }
    if (typeof window.registerHaMutators === 'function') {
        window.registerHaMutators(Blockly);
    }
    if (typeof window.registerHaFields === 'function') {
        window.registerHaFields(Blockly);
    }

    const container = document.getElementById('blockly-container');
    if (!container) return;

    // The rest of the app is dark-only (Monaco always runs 'vs-dark', no light mode exists
    // anywhere else) — Blockly's default light theme reads as broken next to it, so give it a
    // matching dark theme now instead of waiting for M5 "UX Polish".
    let theme;
    if (Blockly.Theme && Blockly.Theme.defineTheme) {
        theme = Blockly.Theme.defineTheme('ha_dark', {
            base: Blockly.Themes ? Blockly.Themes.Classic : undefined,
            componentStyles: {
                workspaceBackgroundColour: '#1e1e1e',
                toolboxBackgroundColour: '#252526',
                toolboxForegroundColour: '#ccc',
                flyoutBackgroundColour: '#2d2d30',
                flyoutForegroundColour: '#ccc',
                flyoutOpacity: 1,
                scrollbarColour: '#5a5a5a',
                insertionMarkerColour: '#fff',
                insertionMarkerOpacity: 0.3,
                scrollbarOpacity: 0.6,
                cursorColour: '#d0d0d0',
            },
        });
    }

    blocklyWorkspace = Blockly.inject(container, {
        toolbox: window._blocklyToolbox || undefined,
        theme,
        trashcan: true,
        zoom: { controls: true, wheel: true },
    });

    blocklyWorkspace.addChangeListener((event) => {
        // isUiEvent is an instance property (set in the Abstract event base class), not a
        // static Blockly.Events.isUiEvent(type) function — calling it as one throws, which
        // silently broke dirty-tracking entirely (every change listener call failed before
        // reaching onBlocklyWorkspaceChanged, so the save button never lit up).
        if (event.isUiEvent) return;
        if (typeof window.onBlocklyWorkspaceChanged === 'function') {
            window.onBlocklyWorkspaceChanged();
        }
    });

    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            if (blocklyWorkspace) Blockly.svgResize(blocklyWorkspace);
        }).observe(container);
    }

    _blocklyReady = true;
}

/**
 * Loads Blockly's toolbox config once, then injects the workspace. Call before the first
 * `.blocks` tab is opened; safe to call repeatedly (no-ops once ready).
 */
async function ensureBlocklyReady() {
    if (_blocklyReady) return;
    if (!window._blocklyToolbox) {
        const base = (typeof BASE_PATH !== 'undefined' ? BASE_PATH : '/');
        const res = await fetch(`${base}js/blockly-toolbox.json`);
        window._blocklyToolbox = await res.json();
        if (typeof i18next !== 'undefined' && window._blocklyToolbox.contents) {
            for (const category of window._blocklyToolbox.contents) {
                const key = BLOCKLY_CATEGORY_KEYS[category.name];
                if (key) category.name = i18next.t(key, { defaultValue: category.name });
            }
        }
    }
    initBlocklyEditor();
}

/**
 * Replaces the workspace contents with the given `.blocks` file object ({ jsa, blocks }).
 * Suppresses change events during the load so it doesn't get flagged as a user edit.
 */
function loadBlocklyWorkspace(parsedFile) {
    if (!blocklyWorkspace) return;
    Blockly.Events.disable();
    try {
        blocklyWorkspace.clear();
        if (parsedFile && parsedFile.blocks) {
            Blockly.serialization.workspaces.load(parsedFile, blocklyWorkspace);
        }
    } finally {
        Blockly.Events.enable();
    }
    Blockly.svgResize(blocklyWorkspace);
}

/**
 * Returns the current workspace state as { blocks, variables } — the same two top-level keys a
 * .blocks file stores alongside `jsa`. Both are required: a variable block (Variables toolbox
 * category) only serializes its variable's *ID* into `blocks`, not its name — the name lives
 * solely in the separate `variables` array. Dropping `variables` here (an earlier version of
 * this function returned only `saved.blocks`) doesn't crash on reload, but every variable's
 * displayed name silently reverts to Blockly's generic fallback ("i") since the loader can't
 * find a name for an unrecognized ID and invents one — verified in Node by round-tripping a
 * `counter` variable through exactly this save-without-variables/load path.
 */
function getBlocklyWorkspaceState() {
    const empty = { blocks: { languageVersion: 0, blocks: [] }, variables: [] };
    if (!blocklyWorkspace) return empty;
    const saved = Blockly.serialization.workspaces.save(blocklyWorkspace);
    return {
        blocks: (saved && saved.blocks) || empty.blocks,
        variables: (saved && saved.variables) || [],
    };
}

window.ensureBlocklyReady = ensureBlocklyReady;
window.isBlocklyReady = isBlocklyReady;
window.loadBlocklyWorkspace = loadBlocklyWorkspace;
window.getBlocklyWorkspaceState = getBlocklyWorkspaceState;
