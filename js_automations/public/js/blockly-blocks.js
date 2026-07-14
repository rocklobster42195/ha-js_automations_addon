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
                { "type": "input_value", "name": "ENTITY" }
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
                { "type": "input_value", "name": "ENTITY" },
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
            "type": "ha_schedule_interval",
            "message0": "every %1 %2",
            "args0": [
                { "type": "field_number", "name": "N", "value": 15, "min": 1 },
                { "type": "field_dropdown", "name": "UNIT", "options": [["minutes", "minutes"], ["hours", "hours"]] }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Runs the attached actions repeatedly, on a fixed interval.",
            "helpUrl": ""
        },
        {
            "type": "ha_schedule_daily",
            "message0": "every day at %1 : %2",
            "args0": [
                { "type": "field_number", "name": "HOUR", "value": 7, "min": 0, "max": 23, "precision": 1 },
                { "type": "field_number", "name": "MINUTE", "value": 0, "min": 0, "max": 59, "precision": 1 }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Runs the attached actions once a day, at this time (24h clock).",
            "helpUrl": ""
        },
        {
            "type": "ha_schedule_cron",
            "message0": "on schedule %1",
            "args0": [
                { "type": "field_input", "name": "CRON", "text": "every day at 7:30" }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Advanced: enter a cron expression (e.g. \"0 8 * * *\") or shorthand (\"every 15m\", \"every weekday at 6:00\", \"every monday at 9:00\"). An online cron expression generator can help build the raw form.",
            "helpUrl": ""
        },
        {
            "type": "ha_call_service",
            "message0": "call service %1 for %2",
            "args0": [
                { "type": "field_service_dropdown", "name": "SERVICE", "service": "light.turn_on" },
                { "type": "input_value", "name": "ENTITY" }
            ],
            "inputsInline": true,
            "previousStatement": null,
            "nextStatement": null,
            "colour": 20,
            "mutator": "ha_extra_data_mutator",
            "tooltip": "Calls a Home Assistant service for the given entity. Click the gear icon to add extra data (brightness, temperature, ...); rename each field directly on the block.",
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
            "type": "ha_entity",
            "message0": "entity %1",
            "args0": [
                { "type": "field_entity_dropdown", "name": "ENTITY_ID", "entityId": "sensor.example" }
            ],
            "output": null,
            "colour": 45,
            "tooltip": "An entity ID, reusable in any of the sockets below. Picks from a live list of entities from Home Assistant.",
            "helpUrl": ""
        },
        {
            "type": "ha_get_state",
            "message0": "state of %1",
            "args0": [
                { "type": "input_value", "name": "ENTITY" }
            ],
            "output": null,
            "colour": 45,
            "tooltip": "The current state of an entity, as text (e.g. \"on\", \"off\", \"21.5\"). Plug this into a comparison or another block.",
            "helpUrl": ""
        },
        {
            "type": "ha_get_attribute",
            "message0": "attribute %1 of %2",
            "args0": [
                { "type": "field_input", "name": "ATTR_NAME", "text": "temperature" },
                { "type": "input_value", "name": "ENTITY" }
            ],
            "output": null,
            "colour": 45,
            "tooltip": "A specific attribute of an entity (e.g. \"temperature\" on a climate entity, \"brightness\" on a light).",
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
            "mutator": "ha_register_options_mutator",
            "tooltip": "Creates a new Home Assistant entity (or updates its config if it already exists). Click the gear icon to add more options (unit, device class, area, ...).",
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
            "mutator": "ha_extra_data_mutator",
            "tooltip": "Updates the state of an entity previously created with \"register entity\". Click the gear icon to also set extra attributes.",
            "helpUrl": ""
        },
        {
            "type": "ha_store_get",
            "message0": "store get %1",
            "args0": [
                { "type": "field_input", "name": "KEY", "text": "my_key" }
            ],
            "output": null,
            "colour": 260,
            "tooltip": "Reads a value from the global store (persists across restarts and is shared between scripts). Returns nothing (undefined) if the key was never set.",
            "helpUrl": ""
        },
        {
            "type": "ha_store_set",
            "message0": "store set %1 to %2",
            "args0": [
                { "type": "field_input", "name": "KEY", "text": "my_key" },
                { "type": "input_value", "name": "VALUE" }
            ],
            "message1": "secret (mask in UI) %1",
            "args1": [
                { "type": "field_checkbox", "name": "SECRET", "checked": false }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 260,
            "tooltip": "Writes a value to the global store. Persists across script/addon restarts and is visible to other scripts under the same key. Check \"secret\" to mask the value in the Store Explorer UI.",
            "helpUrl": ""
        },
        {
            "type": "ha_store_delete",
            "message0": "store delete %1",
            "args0": [
                { "type": "field_input", "name": "KEY", "text": "my_key" }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 260,
            "tooltip": "Removes a key from the global store.",
            "helpUrl": ""
        },
        {
            "type": "ha_store_on",
            "message0": "when store %1 changes",
            "args0": [
                { "type": "field_input", "name": "KEY", "text": "my_key" }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 260,
            "tooltip": "Runs the attached actions whenever this store key's value changes — useful for reacting to a value another script wrote.",
            "helpUrl": ""
        },
        {
            "type": "ha_mqtt_subscribe",
            "message0": "when MQTT message on %1",
            "args0": [
                { "type": "field_input", "name": "TOPIC", "text": "my/topic" }
            ],
            "message1": "do %1",
            "args1": [
                { "type": "input_statement", "name": "DO" }
            ],
            "colour": 210,
            "tooltip": "Runs the attached actions whenever a message arrives on this MQTT topic. Wildcards + (single level) and # (multi-level, must be last) are supported. The message payload is available as \"MQTT payload\" inside this block.",
            "helpUrl": ""
        },
        {
            "type": "ha_mqtt_payload",
            "message0": "MQTT payload",
            "output": null,
            "colour": 210,
            "tooltip": "The payload of the MQTT message that triggered this block — only valid inside a \"when MQTT message\" block. Automatically parsed as JSON when possible, otherwise a plain string.",
            "helpUrl": ""
        },
        {
            "type": "ha_mqtt_publish",
            "message0": "publish MQTT %1 to %2",
            "args0": [
                { "type": "input_value", "name": "PAYLOAD" },
                { "type": "field_input", "name": "TOPIC", "text": "my/topic" }
            ],
            "message1": "retain %1",
            "args1": [
                { "type": "field_checkbox", "name": "RETAIN", "checked": false }
            ],
            "previousStatement": null,
            "nextStatement": null,
            "colour": 20,
            "tooltip": "Publishes a message to an MQTT topic. Objects are automatically sent as JSON. Check \"retain\" so new subscribers immediately get the last published value.",
            "helpUrl": ""
        }
    ];
});
