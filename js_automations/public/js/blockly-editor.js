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
  ha_trigger_on: {
    message0: 'blockly_trigger_on_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_trigger_on_tooltip',
  },
  ha_trigger_on_state: {
    message0: 'blockly_trigger_on_state_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_trigger_on_state_tooltip',
  },
  ha_on_webhook: {
    message0: 'blockly_on_webhook_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_on_webhook_tooltip',
  },
  ha_webhook_data: { message0: 'blockly_webhook_data_msg0', tooltip: 'blockly_webhook_data_tooltip' },
  ha_webhook_respond: { message0: 'blockly_webhook_respond_msg0', tooltip: 'blockly_webhook_respond_tooltip' },
  ha_schedule_interval: {
    message0: 'blockly_schedule_interval_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_schedule_interval_tooltip',
  },
  ha_schedule_daily: {
    message0: 'blockly_schedule_daily_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_schedule_daily_tooltip',
  },
  ha_schedule_cron: {
    message0: 'blockly_schedule_cron_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_schedule_cron_tooltip',
  },
  ha_call_service: { message0: 'blockly_call_service_msg0', tooltip: 'blockly_call_service_tooltip' },
  ha_log: { message0: 'blockly_log_msg0', tooltip: 'blockly_log_tooltip' },
  ha_stop: { message0: 'blockly_stop_msg0', tooltip: 'blockly_stop_tooltip' },
  ha_entity: { message0: 'blockly_entity_msg0', tooltip: 'blockly_entity_tooltip' },
  ha_get_state: { message0: 'blockly_get_state_msg0', tooltip: 'blockly_get_state_tooltip' },
  ha_get_attribute: { message0: 'blockly_get_attribute_msg0', tooltip: 'blockly_get_attribute_tooltip' },
  ha_time_since: { message0: 'blockly_time_since_msg0', tooltip: 'blockly_time_since_tooltip' },
  ha_trend: { message0: 'blockly_trend_msg0', tooltip: 'blockly_trend_tooltip' },
  ha_get_calendar_events: {
    message0: 'blockly_get_calendar_events_msg0',
    tooltip: 'blockly_get_calendar_events_tooltip',
  },
  ha_get_todo_items: { message0: 'blockly_get_todo_items_msg0', tooltip: 'blockly_get_todo_items_tooltip' },
  ha_get_entities_in_area: {
    message0: 'blockly_get_entities_in_area_msg0',
    tooltip: 'blockly_get_entities_in_area_tooltip',
  },
  ha_get_entities_with_label: {
    message0: 'blockly_get_entities_with_label_msg0',
    tooltip: 'blockly_get_entities_with_label_tooltip',
  },
  ha_get_areas: { message0: 'blockly_get_areas_msg0', tooltip: 'blockly_get_areas_tooltip' },
  ha_get_labels: { message0: 'blockly_get_labels_msg0', tooltip: 'blockly_get_labels_tooltip' },
  ha_wait: { message0: 'blockly_wait_msg0', tooltip: 'blockly_wait_tooltip' },
  ha_wait_for_state: {
    message0: 'blockly_wait_for_state_msg0',
    message1: 'blockly_wait_for_state_msg1',
    tooltip: 'blockly_wait_for_state_tooltip',
  },
  ha_notify: {
    message0: 'blockly_notify_msg0',
    message1: 'blockly_notify_msg1',
    message2: 'blockly_notify_msg2',
    tooltip: 'blockly_notify_tooltip',
  },
  ha_ask: {
    message0: 'blockly_ask_msg0',
    message1: 'blockly_ask_msg1',
    message2: 'blockly_ask_msg2',
    tooltip: 'blockly_ask_tooltip',
  },
  ha_register: { message0: 'blockly_register_msg0', tooltip: 'blockly_register_tooltip' },
  ha_update: { message0: 'blockly_update_msg0', tooltip: 'blockly_update_tooltip' },
  ha_store_get: { message0: 'blockly_store_get_msg0', tooltip: 'blockly_store_get_tooltip' },
  ha_store_set: {
    message0: 'blockly_store_set_msg0',
    message1: 'blockly_store_set_msg1',
    tooltip: 'blockly_store_set_tooltip',
  },
  ha_store_delete: { message0: 'blockly_store_delete_msg0', tooltip: 'blockly_store_delete_tooltip' },
  ha_store_on: { message0: 'blockly_store_on_msg0', message1: 'blockly_do_msg', tooltip: 'blockly_store_on_tooltip' },
  ha_mqtt_subscribe: {
    message0: 'blockly_mqtt_subscribe_msg0',
    message1: 'blockly_do_msg',
    tooltip: 'blockly_mqtt_subscribe_tooltip',
  },
  ha_mqtt_payload: { message0: 'blockly_mqtt_payload_msg0', tooltip: 'blockly_mqtt_payload_tooltip' },
  ha_mqtt_publish: {
    message0: 'blockly_mqtt_publish_msg0',
    message1: 'blockly_mqtt_publish_msg1',
    tooltip: 'blockly_mqtt_publish_tooltip',
  },
};

// blockly-toolbox.json's static category names, keyed by their literal English text as written
// there, mapped to the i18next key to render instead.
const BLOCKLY_CATEGORY_KEYS = {
  Triggers: 'blockly_category_triggers',
  Actions: 'blockly_category_actions',
  State: 'blockly_category_state',
  'Areas & Labels': 'blockly_category_areas',
  'Calendar & Todo': 'blockly_category_calendar',
  Wait: 'blockly_category_wait',
  'Register/Update': 'blockly_category_register',
  Store: 'blockly_category_store',
  'Script Utilities': 'blockly_category_script',
};

// blockly-toolbox.json's shadow-block placeholder texts (the greyed-out default text a value
// socket shows before the user types over it) — keyed the same way as BLOCKLY_CATEGORY_KEYS.
// Never localized before now (found while translating ha_ask's "Question text"); every other
// shadow default in the file had the same gap.
const BLOCKLY_SHADOW_TEXT_KEYS = {
  'Message text': 'blockly_shadow_message_text',
  'Question text': 'blockly_shadow_question_text',
  value: 'blockly_shadow_value',
  message: 'blockly_shadow_message',
  ok: 'blockly_shadow_ok',
};

/** Recursively walks a toolbox JSON node, translating any `text` shadow block's TEXT field
 * whose current value matches a known key in BLOCKLY_SHADOW_TEXT_KEYS. Mutates in place. */
function localizeToolboxShadowTexts(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'text' && node.fields && typeof node.fields.TEXT === 'string') {
    const key = BLOCKLY_SHADOW_TEXT_KEYS[node.fields.TEXT];
    if (key) node.fields.TEXT = i18next.t(key, { defaultValue: node.fields.TEXT });
  }
  for (const k in node) {
    if (k === 'fields') continue; // fields objects hold plain strings, not nested nodes
    const v = node[k];
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) v.forEach(localizeToolboxShadowTexts);
    else localizeToolboxShadowTexts(v);
  }
}

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
    // Dismisses a block-level error highlight the moment you actually start editing again —
    // "you're addressing it" is a more useful signal than making the user hunt for an
    // explicit clear button. Safe from self-triggering: verified against the compiled
    // Blockly bundle that neither setWarningText() nor highlightBlock()/setHighlighted()
    // fire any event at all (both are pure rendering-icon/pathObject operations), so this
    // listener only ever reacts to genuine user edits, never to the highlight being applied.
    if (typeof window.clearBlocklyErrorHighlight === 'function') window.clearBlocklyErrorHighlight();
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
    const base = typeof BASE_PATH !== 'undefined' ? BASE_PATH : '/';
    const res = await fetch(`${base}js/blockly-toolbox.json`);
    window._blocklyToolbox = await res.json();
    if (typeof i18next !== 'undefined' && window._blocklyToolbox.contents) {
      for (const category of window._blocklyToolbox.contents) {
        const key = BLOCKLY_CATEGORY_KEYS[category.name];
        if (key) category.name = i18next.t(key, { defaultValue: category.name });
        localizeToolboxShadowTexts(category);
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
    // clear() disposes whatever block _highlightedErrorBlockId pointed at — reset the
    // tracking variable directly rather than via clearBlocklyErrorHighlight() (which would
    // just try to mutate an about-to-be-destroyed block); events are disabled in this whole
    // block anyway, so the change-listener-driven auto-clear wouldn't fire here regardless.
    _highlightedErrorBlockId = null;
    if (parsedFile && parsedFile.blocks) {
      Blockly.serialization.workspaces.load(parsedFile, blocklyWorkspace);
    }
  } finally {
    Blockly.Events.enable();
  }
  Blockly.svgResize(blocklyWorkspace);
}

// scriptId -> { blockId, message } for the most recent error a *background* .blocks script hit
// while its tab wasn't the one on screen — e.g. a store/MQTT/webhook-triggered script, where
// actually causing the error means navigating away to Store Explorer/etc. first, so the tab is
// essentially never still active at the exact moment the error fires. Found live: an error that
// worked correctly for a bare triggerless script (already on-screen when it ran at script start)
// silently did nothing for the exact same error once the code moved inside a store trigger,
// because setting the store key requires leaving the Blockly tab first. Consumed (and cleared)
// by reapplyBlocklyError() the next time that script's tab is loaded — a one-time "you missed
// this" surfacing, not a persistent banner, so it doesn't resurface as a stale ghost days later.
const _pendingBlocklyErrors = {};

/**
 * Block-level error visualization (docs/blockly_concept.md M5, should-have). Called from
 * log-viewer.js's appendLog() whenever a log entry carries a blockId — traced back to the exact
 * block that threw via BlocklyCompiler's scrub_() instrumentation (blockly-compiler.js) and
 * threaded through worker-wrapper.js -> worker-manager.js -> kernel.js -> log-manager.js ->
 * bridge.js's socket 'log' event. Always records the error for reapplyBlocklyError() to pick up
 * later; also applies it immediately if that script's tab already happens to be the active one.
 */
function highlightBlocklyError(scriptId, blockId, message) {
  _pendingBlocklyErrors[scriptId] = { blockId, message };
  _applyBlocklyErrorHighlight(scriptId, blockId, message);
}

/**
 * Re-shows the most recent background error for `scriptId`, if any — call after loading a
 * Blockly tab's workspace (tab-manager.js's switchToTab()) so an error that happened while this
 * script's canvas wasn't on screen still gets surfaced once you come back to look at it. Clears
 * the pending entry either way: shown once, not re-shown on every future visit to this tab.
 */
function reapplyBlocklyError(scriptId) {
  const pending = _pendingBlocklyErrors[scriptId];
  if (!pending) return;
  delete _pendingBlocklyErrors[scriptId];
  _applyBlocklyErrorHighlight(scriptId, pending.blockId, pending.message);
}

// Tracks the block currently showing an error highlight (if any), so clearBlocklyErrorHighlight()
// knows what to undo. Also gets a fresh, implicit clear "for free" whenever the workspace is
// torn down and rebuilt (any tab switch, including away-and-back to the same tab) — loadBlocklyWorkspace()'s
// workspace.clear() disposes the old block instance the warning/highlight was attached to
// entirely, but doesn't reset this tracking variable itself, so it's reset explicitly there too.
let _highlightedErrorBlockId = null;

/**
 * The actual workspace mutation — safe to call speculatively (from either of the two functions
 * above); no-ops unless `scriptId` is the tab currently on screen. Silently mutating a workspace
 * that isn't even the active one would be confusing if the user later switches to it expecting a
 * fresh, unannotated canvas.
 */
function _applyBlocklyErrorHighlight(scriptId, blockId, message) {
  if (!blocklyWorkspace) return;
  if (typeof activeTabFilename === 'undefined' || activeTabFilename !== scriptId) return;
  const block = blocklyWorkspace.getBlockById(blockId);
  // The block may no longer exist — the script could have been edited (and the dist
  // recompiled from a newer workspace) since the error was thrown from an older run.
  if (!block) return;
  block.setWarningText(message || 'Runtime error');
  // WorkspaceSvg.prototype.highlightBlock(id) — found by grepping the compiled Blockly bundle
  // rather than assumed: it's the real, complete API (also clears any *previously* highlighted
  // block first when called, verified against the bundle's own implementation), not something
  // hand-rolled from a bare Block.prototype.setHighlighted() call.
  if (typeof blocklyWorkspace.highlightBlock === 'function') blocklyWorkspace.highlightBlock(blockId);
  if (typeof blocklyWorkspace.centerOnBlock === 'function') blocklyWorkspace.centerOnBlock(blockId);
  _highlightedErrorBlockId = blockId;
}

/**
 * Dismisses the currently-shown error highlight, if any — called automatically the moment the
 * user makes a real edit (see the workspace change listener in initBlocklyEditor()) rather than
 * needing a dedicated button; also called by loadBlocklyWorkspace() since a full workspace
 * rebuild there already discards the old block instance the warning was attached to, so the
 * tracking variable needs to follow suit. Safe to call with nothing currently highlighted.
 */
function clearBlocklyErrorHighlight() {
  if (!_highlightedErrorBlockId) return;
  if (blocklyWorkspace) {
    const block = blocklyWorkspace.getBlockById(_highlightedErrorBlockId);
    if (block) block.setWarningText(null);
    if (typeof blocklyWorkspace.highlightBlock === 'function') blocklyWorkspace.highlightBlock(null);
  }
  _highlightedErrorBlockId = null;
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

/**
 * Live-generates the same JS BlocklyCompiler would produce server-side, straight from the
 * current (possibly unsaved) workspace — no round-trip to the server needed. Same generator
 * object (`Blockly.JavaScript`, registered in ensureBlocklyReady() above) and the same
 * wrapGeneratedCode() (blockly-blocks-shared.js — only wraps in an async IIFE if the code
 * actually needs it) BlocklyCompiler.compile() uses, so "Show Code" always matches what actually
 * runs once saved, not just a visually-similar approximation of it.
 */
function getBlocklyGeneratedCode() {
  if (!blocklyWorkspace) return '';
  const code = Blockly.JavaScript.workspaceToCode(blocklyWorkspace);
  return window.registerHaBlocks.wrapGeneratedCode(code);
}

window.ensureBlocklyReady = ensureBlocklyReady;
window.isBlocklyReady = isBlocklyReady;
window.loadBlocklyWorkspace = loadBlocklyWorkspace;
window.highlightBlocklyError = highlightBlocklyError;
window.reapplyBlocklyError = reapplyBlocklyError;
window.clearBlocklyErrorHighlight = clearBlocklyErrorHighlight;
window.getBlocklyWorkspaceState = getBlocklyWorkspaceState;
window.getBlocklyGeneratedCode = getBlocklyGeneratedCode;
