// public/js/blockly-mutators.js
//
// Custom mutator for ha_call_service: a gear-icon popup (Blockly's Mutator UI) to attach extra
// named data fields to a service call (e.g. brightness, color_temp, temperature) beyond the
// fixed entity_id. Mirrors Blockly's own built-in text_join/lists_create_with mutator pattern
// (decompose/compose/saveConnections/updateShape_) — verified against the actual compiled
// Blockly 11 bundle (grepped for `registerMutator`/`reconnect`/`saveConnections` in
// blockly.min.js) rather than assumed from older docs, since this is the fussiest corner of
// the Blockly API.
//
// Shared UMD file (see blockly-blocks-shared.js's header for why it's under public/js/, not
// core/): the interactive decompose/compose methods only ever run in the browser — Node's
// BlocklyCompiler never opens the mutator popup — but saveExtraState/loadExtraState/
// updateShape_ are plain data functions Node needs too, to reconstruct a saved workspace's
// dynamic ADD0/ADD1/... inputs before it can plug in whatever's connected to them.
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
                "type": "ha_call_service_data_container",
                "message0": "extra data",
                "message1": "%1",
                "args1": [
                    { "type": "input_statement", "name": "STACK" }
                ],
                "colour": 20
            },
            {
                "type": "ha_call_service_data_item",
                "message0": "field",
                "previousStatement": null,
                "nextStatement": null,
                "colour": 20
            }
        ]);

        // Renaming a field happens directly on the main block (its NAME<i> field is a real
        // text input); the popup is only for adding/removing/reordering slots. So item blocks
        // don't need their own editable name field — saveConnections() snapshots the main
        // block's current names onto each item block's `.name_` before the popup opens, and
        // that plain JS property rides along with the block object through any reordering.
        const MUTATOR_MIXIN = {
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
                const containerBlock = workspace.newBlock('ha_call_service_data_container');
                containerBlock.initSvg();
                let connection = containerBlock.getInput('STACK').connection;
                for (let i = 0; i < this.itemCount_; i++) {
                    const itemBlock = workspace.newBlock('ha_call_service_data_item');
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
                    // the same row by default. appendEndRowInput() forces the *next* input onto
                    // a fresh row regardless of inputsInline (verified against the renderer's
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
            }
        };

        Blockly.Extensions.registerMutator(
            'ha_call_service_data_mutator',
            MUTATOR_MIXIN,
            null,
            ['ha_call_service_data_item']
        );
    };
});
