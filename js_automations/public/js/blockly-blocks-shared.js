// public/js/blockly-blocks-shared.js
//
// Registers all custom `ha_*` block code generators on whichever javascriptGenerator instance
// is passed in. This file is loaded two different ways:
//   - Node (BlocklyCompiler): require('../public/js/blockly-blocks-shared') — this directory
//     lives under public/ purely so the *same* file can also be served to the browser; there is
//     no bundler in this project, so a literal `<script src="js/blockly-blocks-shared.js">` is
//     the only way to reuse it client-side without duplicating the generator logic.
//   - Browser (Blockly editor / "Show Code" panel): plain <script> tag, no `module` global.
// The UMD-style wrapper below picks the right export style for each.
(function (global, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        global.registerHaBlocks = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    return function registerHaBlocks(generator) {
        generator.forBlock['ha_trigger_on'] = function (block, gen) {
            // valueToCode() returns already-quoted code (e.g. `"sensor.temp"` from ha_entity's
            // own JSON.stringify), so it's used as-is here, not re-wrapped in JSON.stringify.
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const body = gen.statementToCode(block, 'DO');
            return `ha.on(${entityCode}, async (e) => {\n${body}});\n`;
        };

        generator.forBlock['ha_trigger_on_state'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const toState = block.getFieldValue('TO_STATE');
            const body = gen.statementToCode(block, 'DO');
            return `ha.on(${entityCode}, e => e.state === ${JSON.stringify(toState)}, async (e) => {\n${body}});\n`;
        };

        generator.forBlock['ha_schedule_interval'] = function (block, gen) {
            const n = block.getFieldValue('N');
            const unit = block.getFieldValue('UNIT');
            const body = gen.statementToCode(block, 'DO');
            return `schedule(${JSON.stringify(`every ${n} ${unit}`)}, async () => {\n${body}});\n`;
        };

        generator.forBlock['ha_schedule_daily'] = function (block, gen) {
            const hour = block.getFieldValue('HOUR');
            // Zero-pad the minute only ("every day at 7:5" is ambiguous/wrong; "7:05" isn't).
            const minute = String(block.getFieldValue('MINUTE')).padStart(2, '0');
            const body = gen.statementToCode(block, 'DO');
            return `schedule(${JSON.stringify(`every day at ${hour}:${minute}`)}, async () => {\n${body}});\n`;
        };

        generator.forBlock['ha_schedule_cron'] = function (block, gen) {
            const cron = block.getFieldValue('CRON');
            const body = gen.statementToCode(block, 'DO');
            return `schedule(${JSON.stringify(cron)}, async () => {\n${body}});\n`;
        };

        generator.forBlock['ha_call_service'] = function (block, gen) {
            const service = block.getFieldValue('SERVICE');
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const dataParts = [`entity_id: ${entityCode}`];

            // Mutator-added extra fields (see blockly-mutators.js) — itemCount_ is set by
            // loadExtraState()/updateShape_() when the workspace is deserialized, so this is
            // populated correctly by the time code generation runs, not just interactively.
            const itemCount = block.itemCount_ || 0;
            for (let i = 0; i < itemCount; i++) {
                const nameField = block.getField('NAME' + i);
                const name = nameField ? nameField.getValue() : '';
                if (!name) continue; // unnamed slot — skip rather than emit an invalid key
                const value = gen.valueToCode(block, 'ADD' + i, gen.ORDER_NONE) || 'null';
                dataParts.push(`${JSON.stringify(name)}: ${value}`);
            }

            return `await ha.call(${JSON.stringify(service)}, { ${dataParts.join(', ')} });\n`;
        };

        generator.forBlock['ha_log'] = function (block, gen) {
            const level = block.getFieldValue('LEVEL');
            const message = gen.valueToCode(block, 'MESSAGE', gen.ORDER_NONE) || '""';
            // 'info' is written via ha.log(), not ha.info() — there is no such function.
            const fn = level === 'info' ? 'log' : level;
            return `ha.${fn}(${message});\n`;
        };

        generator.forBlock['ha_stop'] = function (block) {
            const reason = block.getFieldValue('REASON');
            return reason ? `ha.stop(${JSON.stringify(reason)});\n` : `ha.stop();\n`;
        };

        generator.forBlock['ha_entity'] = function (block, gen) {
            const entityId = block.getFieldValue('ENTITY_ID');
            // Deliberately NOT ha.entity(id) — that fluent handle's .state getter returns the
            // raw, unconverted state string, which would reopen the "on"/"off" is-always-truthy
            // footgun that ha.getStateValue() was specifically chosen to avoid (see ha_get_state
            // below). This block is just a reusable, pluggable carrier for the entity ID string.
            return [JSON.stringify(entityId), gen.ORDER_ATOMIC];
        };

        generator.forBlock['ha_get_state'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            // ha.getStateValue() (not ha.getState()) — returns the converted primitive
            // ("off", 21.5, true) matching what this block's "state of X" tooltip promises.
            // ha.getState() returns the full state object (entity_id/attributes/context/...),
            // which is correct API behavior but a confusing default for the target beginner
            // audience — logging "state of X" should print "off", not a JSON dump.
            return [`ha.getStateValue(${entityCode})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_attribute'] = function (block, gen) {
            const attrName = block.getFieldValue('ATTR_NAME');
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            return [`ha.getAttr(${entityCode}, ${JSON.stringify(attrName)})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_wait'] = function (block) {
            const seconds = block.getFieldValue('SECONDS');
            return `await sleep(${seconds * 1000});\n`;
        };

        generator.forBlock['ha_notify'] = function (block, gen) {
            const message = gen.valueToCode(block, 'MESSAGE', gen.ORDER_NONE) || '""';
            // TITLE/TARGET are optional value sockets, left unplugged by default (no shadow) —
            // valueToCode() returns '' when nothing is connected, which is how we detect "not set".
            // Unlike MESSAGE, these are raw generated-code snippets (e.g. `ha.getStateValue(...)`),
            // not plain values, so they get embedded directly into the object literal below rather
            // than JSON.stringify()'d (which would just re-quote the code as a string).
            const title = gen.valueToCode(block, 'TITLE', gen.ORDER_NONE);
            const target = gen.valueToCode(block, 'TARGET', gen.ORDER_NONE);
            // field_checkbox reports its value as the string 'TRUE'/'FALSE', not a JS boolean.
            const persistent = block.getFieldValue('PERSISTENT') === 'TRUE';

            const optsParts = [];
            if (title) optsParts.push(`title: ${title}`);
            if (target) optsParts.push(`target: ${target}`);
            if (persistent) optsParts.push('persistent: true');
            const optsStr = optsParts.length > 0 ? `, { ${optsParts.join(', ')} }` : '';

            return `await ha.notify(${message}${optsStr});\n`;
        };

        generator.forBlock['ha_register'] = function (block) {
            const entityId = block.getFieldValue('ENTITY_ID');
            const configParts = [
                `name: ${JSON.stringify(block.getFieldValue('NAME'))}`,
                `icon: ${JSON.stringify(block.getFieldValue('ICON'))}`,
            ];

            // Mutator-added optional fields (see blockly-mutators.js's ha_register_options_mutator)
            // — only present on the block when their checkbox was ticked, so a plain getField()
            // presence check doubles as "was this option enabled". For free-text fields, a
            // ticked-but-never-filled-in box (blank field) is treated as "not set" rather than
            // emitting an empty string — skipEmpty avoids e.g. `unit: ""` on every entity that
            // only ticked the box out of curiosity. Not applied to MIN/MAX/STEP/ENABLED_BY_DEFAULT,
            // where a falsy value (0/false) is meaningful, or STATE_CLASS, whose dropdown always
            // has a real selected value.
            const push = (fieldName, key, transform, opts) => {
                const f = block.getField(fieldName);
                if (!f) return;
                const value = f.getValue();
                if (opts && opts.skipEmpty && (typeof value !== 'string' || value.trim() === '')) return;
                configParts.push(`${key}: ${transform(value)}`);
            };
            push('UNIT', 'unit', (v) => JSON.stringify(v), { skipEmpty: true });
            push('DEVICE_CLASS', 'device_class', (v) => JSON.stringify(v), { skipEmpty: true });
            push('STATE_CLASS', 'state_class', (v) => JSON.stringify(v));
            push('AREA', 'area', (v) => JSON.stringify(v), { skipEmpty: true });
            push('LABELS', 'labels', (v) => JSON.stringify(v.split(',').map((s) => s.trim()).filter(Boolean)));
            // FieldNumber.getValue() is already a number — verified against field_number.d.ts
            // (extends FieldInput<number>), no JSON.stringify needed (that would re-quote it).
            push('MIN', 'min', (v) => v);
            push('MAX', 'max', (v) => v);
            push('STEP', 'step', (v) => v);
            push('EXPIRE_AFTER', 'expire_after', (v) => v);
            // field_checkbox reports its value as the string 'TRUE'/'FALSE', not a JS boolean —
            // same gotcha already handled for ha_notify's PERSISTENT field above.
            push('ENABLED_BY_DEFAULT', 'enabled_by_default', (v) => v === 'TRUE');

            // ha.register() is synchronous (returns void) — no await needed.
            return `ha.register(${JSON.stringify(entityId)}, { ${configParts.join(', ')} });\n`;
        };

        generator.forBlock['ha_update'] = function (block, gen) {
            const entityId = block.getFieldValue('ENTITY_ID');
            const state = gen.valueToCode(block, 'STATE', gen.ORDER_NONE) || '""';

            // Mutator-added extra attribute fields (see blockly-mutators.js's
            // ha_extra_data_mutator, shared with ha_call_service) — itemCount_ is set by
            // loadExtraState()/updateShape_() when the workspace is deserialized, so this is
            // populated correctly by the time code generation runs, not just interactively.
            const itemCount = block.itemCount_ || 0;
            const dataParts = [];
            for (let i = 0; i < itemCount; i++) {
                const nameField = block.getField('NAME' + i);
                const name = nameField ? nameField.getValue() : '';
                if (!name) continue; // unnamed slot — skip rather than emit an invalid key
                const value = gen.valueToCode(block, 'ADD' + i, gen.ORDER_NONE) || 'null';
                dataParts.push(`${JSON.stringify(name)}: ${value}`);
            }
            const attrsArg = dataParts.length > 0 ? `, { ${dataParts.join(', ')} }` : '';

            // ha.update() is synchronous (returns void) — no await needed.
            return `ha.update(${JSON.stringify(entityId)}, ${state}${attrsArg});\n`;
        };
    };
});
