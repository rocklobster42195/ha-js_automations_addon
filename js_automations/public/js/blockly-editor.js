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

/** Lazily injects the Blockly workspace into #blockly-container. Idempotent. */
function initBlocklyEditor() {
    if (blocklyWorkspace || typeof Blockly === 'undefined') return;

    if (typeof HA_BLOCK_DEFINITIONS !== 'undefined') {
        // The UMD browser bundle exposes this both flattened (Blockly.defineBlocksWithJsonArray)
        // and namespaced (Blockly.common...); the Node package only has the namespaced form.
        const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray) || Blockly.defineBlocksWithJsonArray;
        if (define) define(HA_BLOCK_DEFINITIONS);
    }
    if (typeof window.registerHaBlocks === 'function') {
        window.registerHaBlocks(Blockly.JavaScript);
    }
    if (typeof window.registerHaMutators === 'function') {
        window.registerHaMutators(Blockly);
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

/** Returns the current workspace state in the same shape a .blocks file's `blocks` key uses. */
function getBlocklyWorkspaceState() {
    const empty = { languageVersion: 0, blocks: [] };
    if (!blocklyWorkspace) return empty;
    // workspaces.save() returns a full state wrapper — { blocks: { languageVersion, blocks: [...] } }
    // (verified: it's the mirror image of what workspaces.load() expects as input). Callers of
    // this function want just the inner part, matching the .blocks file's own "blocks" key.
    const saved = Blockly.serialization.workspaces.save(blocklyWorkspace);
    return (saved && saved.blocks) || empty;
}

window.ensureBlocklyReady = ensureBlocklyReady;
window.isBlocklyReady = isBlocklyReady;
window.loadBlocklyWorkspace = loadBlocklyWorkspace;
window.getBlocklyWorkspaceState = getBlocklyWorkspaceState;
