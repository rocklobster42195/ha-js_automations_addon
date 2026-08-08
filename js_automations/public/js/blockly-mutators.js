// public/js/blockly-mutators.js
//
// Two custom mutators (gear-icon popups, Blockly's Mutator UI):
//
// 1. ha_extra_data_mutator — attaches extra, freely user-named data fields (e.g. brightness,
//    color_temp) beyond a block's fixed arguments. Originally built for ha_call_service, now
//    also used by ha_update (both take an open-ended key/value bag — service call data,
//    entity attributes — so the exact same mixin/container/item blocks are reused unchanged,
//    only the generator reading the result differs per block). Mirrors Blockly's own built-in
//    text_join/lists_create_with mutator pattern (decompose/compose/saveConnections/
//    updateShape_) — verified against the actual compiled Blockly 11 bundle (grepped for
//    `registerMutator`/`reconnect`/`saveConnections` in blockly.min.js) rather than assumed
//    from older docs, since this is the fussiest corner of the Blockly API.
//
// 2. ha_register_options_mutator — a fixed checklist of ha_register's known optional config
//    keys (unit, device_class, area, ...), not a free-form list: no drag/reorder/reconnect
//    logic needed, so no saveConnections hook (verified it's only called if the block defines
//    it — `this.sourceBlock.saveConnections && ...` in the compiled bundle — an optional hook).
//    Ticking a box in the popup adds/removes a single named input on the main block; the actual
//    typed value in that input is plain Blockly field serialization, no custom state needed for
//    it — only *which* boxes are ticked needs saveExtraState/loadExtraState.
//
// Shared UMD file (see blockly-blocks-shared.js's header for why it's under public/js/, not
// core/): the interactive decompose/compose methods only ever run in the browser — Node's
// BlocklyCompiler never opens the mutator popup — but saveExtraState/loadExtraState/
// updateShape_ are plain data functions Node needs too, to reconstruct a saved workspace's
// dynamic inputs before it can plug in whatever's connected to (or typed into) them.
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.registerHaMutators = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  return function registerHaMutators(Blockly) {
    const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray) || Blockly.defineBlocksWithJsonArray;
    define([
      {
        type: 'ha_extra_data_container',
        message0: 'extra data',
        message1: '%1',
        args1: [{ type: 'input_statement', name: 'STACK' }],
        colour: 20,
      },
      {
        type: 'ha_extra_data_item',
        message0: 'field',
        previousStatement: null,
        nextStatement: null,
        colour: 20,
      },
    ]);

    // Renaming a field happens directly on the main block (its NAME<i> field is a real
    // text input); the popup is only for adding/removing/reordering slots. So item blocks
    // don't need their own editable name field — saveConnections() snapshots the main
    // block's current names onto each item block's `.name_` before the popup opens, and
    // that plain JS property rides along with the block object through any reordering.
    const EXTRA_DATA_MUTATOR_MIXIN = {
      itemCount_: 0,

      saveExtraState: function () {
        const names = [];
        for (let i = 0; i < this.itemCount_; i++) {
          const f = this.getField('NAME' + i);
          names.push(f ? f.getValue() : '');
        }
        return { itemCount: this.itemCount_, names: names };
      },

      loadExtraState: function (state) {
        this.updateShape_(state['itemCount'] || 0);
        const names = state['names'] || [];
        for (let i = 0; i < this.itemCount_; i++) {
          const f = this.getField('NAME' + i);
          if (f && names[i] !== undefined) f.setValue(names[i]);
        }
      },

      decompose: function (workspace) {
        const containerBlock = workspace.newBlock('ha_extra_data_container');
        containerBlock.initSvg();
        let connection = containerBlock.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const itemBlock = workspace.newBlock('ha_extra_data_item');
          itemBlock.initSvg();
          connection.connect(itemBlock.previousConnection);
          connection = itemBlock.nextConnection;
        }
        return containerBlock;
      },

      saveConnections: function (containerBlock) {
        let itemBlock = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (itemBlock) {
          const input = this.getInput('ADD' + i);
          const nameField = this.getField('NAME' + i);
          itemBlock.valueConnection_ = input ? input.connection.targetConnection : null;
          itemBlock.name_ = nameField ? nameField.getValue() : '';
          itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
          i++;
        }
      },

      compose: function (containerBlock) {
        let itemBlock = containerBlock.getInputTargetBlock('STACK');
        const connections = [];
        const names = [];
        while (itemBlock && !itemBlock.isInsertionMarker()) {
          connections.push(itemBlock.valueConnection_ || null);
          names.push(itemBlock.name_ || '');
          itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
        }
        // Disconnect anything whose connection didn't survive into the new list
        // (its item block was deleted in the popup).
        for (let i = 0; i < this.itemCount_; i++) {
          const input = this.getInput('ADD' + i);
          const conn = input && input.connection.targetConnection;
          if (conn && connections.indexOf(conn) === -1) conn.disconnect();
        }
        this.updateShape_(connections.length);
        for (let i = 0; i < connections.length; i++) {
          // Always set explicitly — every index must reflect the *current* popup order,
          // never a leftover from before. Reordering/inserting in the middle (not just
          // appending at the end) shifts indices, so skipping "empty" names here let a
          // stale name from the old layout bleed into the wrong slot. Empty name (a
          // freshly-dragged-in item) becomes the "field_name" placeholder, not blank.
          const field = this.getField('NAME' + i);
          if (field) field.setValue(names[i] || 'field_name');
          if (connections[i]) connections[i].reconnect(this, 'ADD' + i);
        }
      },

      updateShape_: function (targetCount) {
        while (this.itemCount_ < targetCount) {
          // ha_call_service is inputsInline:true so its base "call service X for Y"
          // row stays compact — but that also pulls these mutator-added fields onto
          // the same row by default (ha_update isn't inputsInline, so this is a no-op
          // there). appendEndRowInput() forces the *next* input onto a fresh row
          // regardless of inputsInline (verified against the renderer's
          // shouldStartNewRow_() in the compiled Blockly bundle: EndRowInput always
          // breaks, plain value inputs only break when inputsInline is false).
          this.appendEndRowInput('BREAK' + this.itemCount_);
          // Default text is deliberately longer than "name" — FieldTextInput sizes
          // itself to its initial content, and a 4-character placeholder rendered
          // narrow enough to look like a checkbox rather than a text field.
          this.appendValueInput('ADD' + this.itemCount_)
            .appendField(new Blockly.FieldTextInput('field_name'), 'NAME' + this.itemCount_)
            .appendField(':');
          this.itemCount_++;
        }
        while (this.itemCount_ > targetCount) {
          this.itemCount_--;
          this.removeInput('ADD' + this.itemCount_);
          this.removeInput('BREAK' + this.itemCount_);
        }
      },
    };

    Blockly.Extensions.registerMutator('ha_extra_data_mutator', EXTRA_DATA_MUTATOR_MIXIN, null, ['ha_extra_data_item']);

    // --- ha_register_options_mutator ---------------------------------------------------
    // Fixed checklist of ha_register's known optional ha.register() config keys. The full
    // config object has ~20 optional keys (entity_category, mode, suggested_display_precision,
    // options, device, ...) — this is a curated subset of the most commonly used ones for a
    // first cut; more can be added the same way later.
    const OPTION_DEFS = [
      { key: 'unit', input: 'OPT_UNIT', field: 'UNIT', label: 'unit', type: 'text' },
      { key: 'device_class', input: 'OPT_DEVICE_CLASS', field: 'DEVICE_CLASS', label: 'device class', type: 'text' },
      {
        key: 'state_class',
        input: 'OPT_STATE_CLASS',
        field: 'STATE_CLASS',
        label: 'state class',
        type: 'state_class_dropdown',
      },
      { key: 'area', input: 'OPT_AREA', field: 'AREA', label: 'area', type: 'text' },
      { key: 'labels', input: 'OPT_LABELS', field: 'LABELS', label: 'labels (comma-separated)', type: 'text' },
      { key: 'min', input: 'OPT_MIN', field: 'MIN', label: 'min', type: 'number' },
      { key: 'max', input: 'OPT_MAX', field: 'MAX', label: 'max', type: 'number' },
      { key: 'step', input: 'OPT_STEP', field: 'STEP', label: 'step', type: 'number' },
      {
        key: 'enabled_by_default',
        input: 'OPT_ENABLED_BY_DEFAULT',
        field: 'ENABLED_BY_DEFAULT',
        label: 'enabled by default',
        type: 'checkbox',
      },
      {
        key: 'expire_after',
        input: 'OPT_EXPIRE_AFTER',
        field: 'EXPIRE_AFTER',
        label: 'expire after (s)',
        type: 'number',
      },
    ];

    // A blank FieldTextInput renders razor-thin (Blockly sizes it to its content) — easy to
    // mistake for a checkbox next to the real ones above it. Unlike ha_extra_data_mutator's
    // NAME<i> field (padded via a long non-empty *default value*, e.g. "field_name"), these
    // fields hold real user data — a fake-looking default like "°C" risks silently shipping
    // as a real value if the user forgets to clear it. Pad the rendered width only, via the
    // getText_ developer hook (display text), leaving the actual stored value untouched —
    // a regular space would be collapsed by SVG text layout, so a non-breaking space is used.
    class PaddedFieldTextInput extends Blockly.FieldTextInput {
      getText_() {
        const t = this.getValue() || '';
        return t.length < 8 ? t + ' '.repeat(8 - t.length) : t;
      }
    }

    // Adds the single named input for one option (used by both compose() when a box is
    // freshly ticked, and loadExtraState() when reconstructing a saved workspace).
    function addRegisterOptionInput(block, opt) {
      const input = block.appendDummyInput(opt.input).appendField(opt.label + ':');
      if (opt.type === 'text') {
        input.appendField(new PaddedFieldTextInput(''), opt.field);
      } else if (opt.type === 'number') {
        input.appendField(new Blockly.FieldNumber(0), opt.field);
      } else if (opt.type === 'checkbox') {
        input.appendField(new Blockly.FieldCheckbox('FALSE'), opt.field);
      } else if (opt.type === 'state_class_dropdown') {
        // Small fixed 3-value enum — a plain static dropdown is safe here, unlike the
        // live entity/service data fields (see blockly-fields.js for why those aren't
        // FieldDropdown-based).
        input.appendField(
          new Blockly.FieldDropdown([
            ['measurement', 'measurement'],
            ['total', 'total'],
            ['total_increasing', 'total_increasing'],
          ]),
          opt.field
        );
      }
    }

    define([
      {
        type: 'ha_register_options_container',
        message0: '%1 unit',
        message1: '%1 device class',
        message2: '%1 state class',
        message3: '%1 area',
        message4: '%1 labels',
        message5: '%1 min',
        message6: '%1 max',
        message7: '%1 step',
        message8: '%1 enabled by default',
        message9: '%1 expire after',
        args0: [{ type: 'field_checkbox', name: 'CB_unit', checked: false }],
        args1: [{ type: 'field_checkbox', name: 'CB_device_class', checked: false }],
        args2: [{ type: 'field_checkbox', name: 'CB_state_class', checked: false }],
        args3: [{ type: 'field_checkbox', name: 'CB_area', checked: false }],
        args4: [{ type: 'field_checkbox', name: 'CB_labels', checked: false }],
        args5: [{ type: 'field_checkbox', name: 'CB_min', checked: false }],
        args6: [{ type: 'field_checkbox', name: 'CB_max', checked: false }],
        args7: [{ type: 'field_checkbox', name: 'CB_step', checked: false }],
        args8: [{ type: 'field_checkbox', name: 'CB_enabled_by_default', checked: false }],
        args9: [{ type: 'field_checkbox', name: 'CB_expire_after', checked: false }],
        colour: 65,
      },
    ]);

    const REGISTER_OPTIONS_MIXIN = {
      saveExtraState: function () {
        return { options: OPTION_DEFS.filter((o) => !!this.getInput(o.input)).map((o) => o.key) };
      },

      loadExtraState: function (state) {
        const enabled = new Set((state && state['options']) || []);
        OPTION_DEFS.forEach((opt) => {
          const has = !!this.getInput(opt.input);
          if (enabled.has(opt.key) && !has) addRegisterOptionInput(this, opt);
          if (!enabled.has(opt.key) && has) this.removeInput(opt.input);
        });
      },

      decompose: function (workspace) {
        const containerBlock = workspace.newBlock('ha_register_options_container');
        containerBlock.initSvg();
        OPTION_DEFS.forEach((opt) => {
          containerBlock.setFieldValue(this.getInput(opt.input) ? 'TRUE' : 'FALSE', 'CB_' + opt.key);
        });
        return containerBlock;
      },

      compose: function (containerBlock) {
        OPTION_DEFS.forEach((opt) => {
          const wanted = containerBlock.getFieldValue('CB_' + opt.key) === 'TRUE';
          const has = !!this.getInput(opt.input);
          if (wanted && !has) addRegisterOptionInput(this, opt);
          if (!wanted && has) this.removeInput(opt.input);
        });
      },
    };

    // No opt_blockList (4th arg) — there's no flyout item block type to restrict, unlike
    // ha_extra_data_mutator's draggable field list.
    Blockly.Extensions.registerMutator('ha_register_options_mutator', REGISTER_OPTIONS_MIXIN, null, []);

    // --- ha_wait_timeout_mutator / ha_wait_timeout_toggle --------------------------------
    // ha_wait_for_state's USE_TIMEOUT checkbox drives two things at once: (1) TIMEOUT_MS
    // field visibility (plain UI state, no serialization needed — same technique as the
    // simple toggle this replaced) and (2) two whole statement inputs, SUCCESS/TIMEOUT_BRANCH
    // ("on success" / "on timeout" branches, generated as a try/catch — see
    // blockly-blocks-shared.js), which — being real inputs a user can plug blocks into — do
    // need saveExtraState/loadExtraState so a reload recreates them before the deserializer
    // tries to attach whatever's connected inside.
    //
    // No gear icon: the checkbox lives on the main block already, so there's no decompose/
    // compose popup — verified in Node that Extensions.registerMutator() tolerates their
    // absence (no gear icon appears; every other mutator in this file has a popup, so this
    // combination had no precedent here before).
    //
    // Why two separate registrations (registerMutator + register) instead of one: Blockly
    // refuses to let saveExtraState/loadExtraState be introduced by a plain, non-mutator
    // extension — verified in Node, throws "Error when applying extension ...: mutation
    // properties changed when applying a non-mutator extension" even via
    // Extensions.registerMixin(). Only the dedicated "mutator" JSON key + registerMutator()
    // is allowed to add them; the second, ordinary extension (which only wires the checkbox's
    // validator and touches the field, not the mutator properties) is layered on top via the
    // block's "extensions" array and is fine.
    //
    // Also verified in Node: Input.setVisible() — the obvious alternative to adding/removing
    // SUCCESS/TIMEOUT_BRANCH — throws "c.stopTrackingAll is not a function" on a plain
    // (non-rendered) Connection; that tracking machinery only exists on a real browser
    // RenderedConnection, unlike Field.setVisible() (used for TIMEOUT_MS), which works
    // headless. That's the actual reason this uses add/remove instead of show/hide for the
    // branches, not just consistency with the other mutators above.
    const WAIT_TIMEOUT_MIXIN = {
      saveExtraState: function () {
        return { useTimeout: !!this.getInput('SUCCESS') };
      },
      loadExtraState: function (state) {
        this.updateShape_(!!(state && state.useTimeout));
      },
      updateShape_: function (useTimeout) {
        // Dynamically-added mutator labels aren't covered by localizeBlockDefinitions()
        // (that only rewrites the static message0/1/2/3 properties before the block type
        // is defined) — translated here directly instead, same i18next.t(key, {
        // defaultValue }) pattern, guarded for Node (no i18next global there; Node only
        // ever reads back already-serialized values, never renders these labels).
        const t = (key, defaultValue) =>
          typeof i18next !== 'undefined' ? i18next.t(key, { defaultValue }) : defaultValue;
        const has = !!this.getInput('SUCCESS');
        if (useTimeout && !has) {
          this.appendStatementInput('SUCCESS').appendField(t('blockly_wait_on_success', 'on success'));
          this.appendStatementInput('TIMEOUT_BRANCH').appendField(t('blockly_wait_on_timeout', 'on timeout'));
        } else if (!useTimeout && has) {
          this.removeInput('SUCCESS');
          this.removeInput('TIMEOUT_BRANCH');
        }
      },
    };
    Blockly.Extensions.registerMutator('ha_wait_timeout_mutator', WAIT_TIMEOUT_MIXIN, null, []);

    // Verified in Node (full round-trip: fresh block starts with TIMEOUT_MS hidden and no
    // branches; checking the box shows the field and adds both branches; a block saved with
    // USE_TIMEOUT checked, TIMEOUT_MS=5000, and content in both branches restores all of it —
    // including the branch contents — correctly after a save/load round-trip; a fresh
    // unchecked block round-trips with no branches too).
    Blockly.Extensions.register('ha_wait_timeout_toggle', function () {
      const checkbox = this.getField('USE_TIMEOUT');
      const timeoutField = this.getField('TIMEOUT_MS');
      const block = this;
      const sync = (checked) => {
        timeoutField.setVisible(checked);
        block.updateShape_(checked);
        if (block.rendered) block.render();
      };
      sync(checkbox.getValue() === 'TRUE');
      checkbox.setValidator((newValue) => {
        sync(newValue === 'TRUE');
        return newValue;
      });
    });

    // --- ha_ask_timeout_toggle ------------------------------------------------------------
    // ha.ask() always has *some* timeout (API default 60000ms — there's no "wait forever"
    // option), so USE_TIMEOUT only decides whether to send a custom value or omit `timeout`
    // (letting the default apply) — unlike ha_wait_timeout_mutator above, TIMEOUT_MS itself
    // never needed shape changes, just Field.setVisible(). The "if no answer" branch, though,
    // is shown/hidden together with it (user call, not a technical requirement — see
    // updateShapeNoAnswer_() in ha_ask_actions_mutator below for the reasoning) via
    // block.updateShapeNoAnswer_(), which the *mutator* attaches to the block. Relies on
    // "mutator" being applied before "extensions" during jsonInit() — verified in Node
    // (updateShapeNoAnswer_ is already callable the moment this extension's init function
    // runs); if that Blockly-internal ordering ever changed, this would throw immediately on
    // every ha_ask block creation, not fail silently.
    Blockly.Extensions.register('ha_ask_timeout_toggle', function () {
      const checkbox = this.getField('USE_TIMEOUT');
      const timeoutField = this.getField('TIMEOUT_MS');
      const block = this;
      const sync = (checked) => {
        timeoutField.setVisible(checked);
        block.updateShapeNoAnswer_(checked);
        if (block.rendered) block.render();
      };
      sync(checkbox.getValue() === 'TRUE');
      checkbox.setValidator((newValue) => {
        sync(newValue === 'TRUE');
        return newValue;
      });
    });

    // --- ha_ask_actions_mutator -------------------------------------------------------------
    // A free-form list mutator like ha_extra_data_mutator above, but each item contributes
    // two fields (ACTION<i> id, TITLE<i> button text) plus a whole STATEMENT branch (DO<i>)
    // instead of one field + one value input — the "if answer is X, run this" behavior the
    // Ask block is built around. A trailing NO_ANSWER statement branch (timeout / no tap)
    // is always kept last: not tracked by itemCount_ at all, just unconditionally removed and
    // re-appended at the very end on every updateShape_() call, so it never needs to be
    // spliced into the middle of inputList (Blockly's appendStatementInput() only appends at
    // the end) regardless of how many action rows currently exist above it.
    define([
      {
        type: 'ha_ask_actions_container',
        message0: 'buttons',
        message1: '%1',
        args1: [{ type: 'input_statement', name: 'STACK' }],
        colour: 20,
      },
      {
        type: 'ha_ask_actions_item',
        message0: 'button',
        previousStatement: null,
        nextStatement: null,
        colour: 20,
      },
    ]);

    const ASK_ACTIONS_MUTATOR_MIXIN = {
      itemCount_: 0,

      saveExtraState: function () {
        const titles = [];
        for (let i = 0; i < this.itemCount_; i++) {
          const tf = this.getField('TITLE' + i);
          titles.push(tf ? tf.getValue() : '');
        }
        return { itemCount: this.itemCount_, titles: titles };
      },

      loadExtraState: function (state) {
        this.updateShape_(state['itemCount'] || 0);
        const titles = state['titles'] || [];
        for (let i = 0; i < this.itemCount_; i++) {
          const tf = this.getField('TITLE' + i);
          if (tf && titles[i] !== undefined) tf.setValue(titles[i]);
        }
      },

      decompose: function (workspace) {
        const containerBlock = workspace.newBlock('ha_ask_actions_container');
        containerBlock.initSvg();
        let connection = containerBlock.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const itemBlock = workspace.newBlock('ha_ask_actions_item');
          itemBlock.initSvg();
          connection.connect(itemBlock.previousConnection);
          connection = itemBlock.nextConnection;
        }
        return containerBlock;
      },

      saveConnections: function (containerBlock) {
        let itemBlock = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (itemBlock) {
          const input = this.getInput('DO' + i);
          const tf = this.getField('TITLE' + i);
          itemBlock.statementConnection_ = input ? input.connection.targetConnection : null;
          itemBlock.buttonTitle_ = tf ? tf.getValue() : '';
          itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
          i++;
        }
      },

      compose: function (containerBlock) {
        let itemBlock = containerBlock.getInputTargetBlock('STACK');
        const connections = [];
        const titles = [];
        while (itemBlock && !itemBlock.isInsertionMarker()) {
          connections.push(itemBlock.statementConnection_ || null);
          titles.push(itemBlock.buttonTitle_ || '');
          itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
        }
        for (let i = 0; i < this.itemCount_; i++) {
          const input = this.getInput('DO' + i);
          const conn = input && input.connection.targetConnection;
          if (conn && connections.indexOf(conn) === -1) conn.disconnect();
        }
        this.updateShape_(connections.length);
        for (let i = 0; i < connections.length; i++) {
          // Always set explicitly, same reasoning as ha_extra_data_mutator above — every
          // index must reflect the *current* popup order, never a leftover from before.
          const tf = this.getField('TITLE' + i);
          if (tf) tf.setValue(titles[i] || 'Button');
          if (connections[i]) connections[i].reconnect(this, 'DO' + i);
        }
      },

      updateShape_: function (targetCount) {
        // Dynamically-added labels aren't covered by localizeBlockDefinitions() (only the
        // static message0/1/2 properties) — translated here directly, same pattern as
        // ha_wait_timeout_mutator's "on success"/"on timeout" above.
        const t = (key, defaultValue) =>
          typeof i18next !== 'undefined' ? i18next.t(key, { defaultValue }) : defaultValue;

        // Drop the trailing NO_ANSWER branch first (if present) so action rows are only
        // ever added or removed at the true end of inputList — re-appended below only if
        // it existed before, i.e. only updateShapeNoAnswer_() (driven by the USE_TIMEOUT
        // checkbox, not this button-count mutator) ever adds it in the first place.
        // Whatever's connected inside it must survive the remove+re-add, though — found
        // via a real Node round-trip test: removeInput() disconnects the child block
        // rather than disposing it, so without capturing+reconnecting its connection here,
        // that block doesn't disappear, it becomes an orphaned free-floating top-level
        // block in the workspace (silently generated as a stray statement outside the
        // ha_ask block entirely, instead of inside its "else" branch).
        const noAnswerInput = this.getInput('NO_ANSWER');
        const hadNoAnswer = !!noAnswerInput;
        const noAnswerConnection = noAnswerInput ? noAnswerInput.connection.targetConnection : null;
        if (hadNoAnswer) this.removeInput('NO_ANSWER');

        // No separate action-id field — ha.ask()'s `action` string is purely an internal
        // identifier the generated code compares against, never shown to the user, so the
        // generator derives it from TITLE<i> instead (see slugifyAskActionId() in
        // blockly-blocks-shared.js) rather than making beginners fill in two fields per
        // button for one visible piece of information.
        while (this.itemCount_ < targetCount) {
          const i = this.itemCount_;
          this.appendDummyInput('LABEL' + i)
            .appendField(t('blockly_ask_button', 'button'))
            .appendField(new Blockly.FieldTextInput('Button'), 'TITLE' + i);
          this.appendStatementInput('DO' + i).appendField(t('blockly_ask_do', 'do'));
          this.itemCount_++;
        }
        while (this.itemCount_ > targetCount) {
          this.itemCount_--;
          const i = this.itemCount_;
          this.removeInput('DO' + i);
          this.removeInput('LABEL' + i);
        }

        if (hadNoAnswer) {
          this.appendStatementInput('NO_ANSWER').appendField(t('blockly_ask_no_answer', 'if no answer (timeout)'));
          if (noAnswerConnection) noAnswerConnection.reconnect(this, 'NO_ANSWER');
        }
      },

      // Adds/removes the trailing "if no answer (timeout)" branch — separate from
      // updateShape_() above (which only manages button rows) because this is driven by the
      // USE_TIMEOUT checkbox (see ha_ask_timeout_toggle below), not the gear-icon popup.
      // ha.ask() always has *some* timeout (API default 60000ms — there's no "wait forever"
      // option), so unchecking USE_TIMEOUT doesn't mean "never times out", just "don't
      // bother handling it specially" — user call, not a technical requirement.
      updateShapeNoAnswer_: function (show) {
        const t = (key, defaultValue) =>
          typeof i18next !== 'undefined' ? i18next.t(key, { defaultValue }) : defaultValue;
        const has = !!this.getInput('NO_ANSWER');
        if (show && !has)
          this.appendStatementInput('NO_ANSWER').appendField(t('blockly_ask_no_answer', 'if no answer (timeout)'));
        else if (!show && has) this.removeInput('NO_ANSWER');
      },
    };

    Blockly.Extensions.registerMutator('ha_ask_actions_mutator', ASK_ACTIONS_MUTATOR_MIXIN, null, [
      'ha_ask_actions_item',
    ]);
  };
});
