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
            "tooltip": "Runs the attached actions whenever the entity's state changes, no matter what it changes to.",
            "helpUrl": ""
        },
        {
            "type": "ha_trigger_on_state",
            "message0": "when %1 changes to %2",
            "args0": [
                { "type": "field_input", "name": "ENTITY_ID", "text": "sensor.example" },
                { "type": "field_input", "name": "TO_STATE", "text": "on" }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Runs the attached actions only when the entity changes to this specific state.",
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
            "message0": "log %1 %2",
            "args0": [
                { "type": "field_dropdown", "name": "LEVEL", "options": [
                    ["info", "info"], ["debug", "debug"], ["warn", "warn"], ["error", "error"]
                ] },
                { "type": "input_value", "name": "MESSAGE" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 0,
            "tooltip": "Writes a message to the script log at the chosen level. Plug in text, or something like \"state of\" to log a value.",
            "helpUrl": ""
        },
        {
            "type": "ha_stop",
            "message0": "stop script %1",
            "args0": [
                { "type": "field_input", "name": "REASON", "text": "" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 0,
            "tooltip": "Stops the current script. The reason (optional, can be left blank) shows up in the logs.",
            "helpUrl": ""
        },
        {
            "type": "ha_get_state",
            "message0": "state of %1",
            "args0": [
                { "type": "field_input", "name": "ENTITY_ID", "text": "sensor.example" }
            ],
            "output": null,
            "colour": 45,
            "tooltip": "The current state of an entity, as text (e.g. \"on\", \"off\", \"21.5\"). Plug this into a comparison or another block.",
            "helpUrl": ""
        },
        {
            "type": "ha_wait",
            "message0": "wait %1 seconds",
            "args0": [
                { "type": "field_number", "name": "SECONDS", "value": 1, "min": 0 }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 300,
            "tooltip": "Pauses the script for the given number of seconds before continuing.",
            "helpUrl": ""
        },
        {
            "type": "ha_notify",
            "message0": "notify %1",
            "args0": [
                { "type": "input_value", "name": "MESSAGE" }
            ],
            "message1": "title (optional) %1",
            "args1": [
                { "type": "input_value", "name": "TITLE" }
            ],
            "message2": "target (optional) %1",
            "args2": [
                { "type": "input_value", "name": "TARGET" }
            ],
            "message3": "show in Home Assistant %1",
            "args3": [
                { "type": "field_checkbox", "name": "PERSISTENT", "checked": false }
            ],
            "inputsInline": false,
            "previousStatement": null,
            "nextStatement": null,
            "colour": 20,
            "tooltip": "Sends a notification to your Home Assistant companion app. Title and target are optional (leave blank for the default). Check \"show in Home Assistant\" to show it in HA's own notification bell instead — works without a companion app, handy for testing.",
            "helpUrl": ""
        },
        {
            "type": "ha_register",
            "message0": "register entity %1 named %2 with icon %3",
            "args0": [
                { "type": "field_input", "name": "ENTITY_ID", "text": "sensor.my_value" },
                { "type": "field_input", "name": "NAME", "text": "My Value" },
                { "type": "field_input", "name": "ICON", "text": "mdi:flash" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 65,
            "tooltip": "Creates a new Home Assistant entity (or updates its config if it already exists). More options (unit, device class, area, ...) coming later.",
            "helpUrl": ""
        },
        {
            "type": "ha_update",
            "message0": "update %1 to %2",
            "args0": [
                { "type": "field_input", "name": "ENTITY_ID", "text": "sensor.my_value" },
                { "type": "input_value", "name": "STATE" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 65,
            "tooltip": "Updates the state of an entity previously created with \"register entity\".",
            "helpUrl": ""
        }
    ];
});
