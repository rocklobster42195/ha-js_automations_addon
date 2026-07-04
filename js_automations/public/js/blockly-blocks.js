// public/js/blockly-blocks.js
//
// JSON shape definitions for all custom `ha_*` blocks (fields, connections, colours — no
// behavior). Loaded by both Node (BlocklyCompiler, so it can deserialize a saved workspace
// that references these types) and the browser (the actual editor). See
// blockly-blocks-shared.js for why this lives under public/js/ and uses the same UMD pattern.
//
// Each environment calls Blockly.common.defineBlocksWithJsonArray(HA_BLOCK_DEFINITIONS) itself
// against its own Blockly instance — this file only exports the plain JSON.
(function (global, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        global.HA_BLOCK_DEFINITIONS = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    return [
        {
            "type": "ha_trigger_on",
            "message0": "when %1 changes",
            "args0": [
                { "type": "field_input", "name": "ENTITY_ID", "text": "sensor.example" }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Runs the attached actions whenever the entity's state changes.",
            "helpUrl": ""
        },
        {
            "type": "ha_call_service",
            "message0": "call service %1 for %2",
            "args0": [
                { "type": "field_input", "name": "SERVICE", "text": "light.turn_on" },
                { "type": "field_input", "name": "ENTITY_ID", "text": "light.example" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 20,
            "tooltip": "Calls a Home Assistant service for the given entity.",
            "helpUrl": ""
        },
        {
            "type": "ha_log",
            "message0": "log %1",
            "args0": [
                { "type": "field_input", "name": "MESSAGE", "text": "message" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 120,
            "tooltip": "Writes a message to the script log.",
            "helpUrl": ""
        }
    ];
});
