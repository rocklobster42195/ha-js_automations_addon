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
    function registerHaBlocks(generator) {
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

        generator.forBlock['ha_on_webhook'] = function (block, gen) {
            const id = block.getFieldValue('ID');
            const body = gen.statementToCode(block, 'DO');
            // async — same reasoning as ha_store_on/ha_mqtt_subscribe above (the DO stack can
            // contain awaiting blocks, e.g. ha_call_service). Default auth, POST only — the
            // 3-arg options-object overload (noAuth/allowlist/method) is out of scope, see the
            // block's own tooltip.
            return `ha.onWebhook(${JSON.stringify(id)}, async (req, res) => {\n${body}});\n`;
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

        // First value blocks in the library backed by an async API — `await` is valid anywhere
        // inside an expression within an async function, so this works inline exactly like the
        // synchronous getters above; wrapGeneratedCode() (blockly-blocks-shared.js's own
        // top-level export) still correctly detects and wraps the rare bare-top-level-use case.
        generator.forBlock['ha_time_since'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const state = block.getFieldValue('STATE');
            const stateArg = state ? `, ${JSON.stringify(state)}` : '';
            return [`await ha.history.timeSince(${entityCode}${stateArg})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_trend'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const period = block.getFieldValue('PERIOD');
            const optsArg = period ? `, { period: ${JSON.stringify(period)} }` : '';
            return [`await ha.history.trend(${entityCode}${optsArg})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_entities_in_area'] = function (block, gen) {
            const areaId = block.getFieldValue('AREA_ID');
            return [`ha.getEntitiesInArea(${JSON.stringify(areaId)})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_entities_with_label'] = function (block, gen) {
            const labelName = block.getFieldValue('LABEL_NAME');
            return [`ha.getEntitiesWithLabel(${JSON.stringify(labelName)})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_areas'] = function (block, gen) {
            return ['ha.getAreas()', gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_labels'] = function (block, gen) {
            return ['ha.getLabels()', gen.ORDER_NONE];
        };

        generator.forBlock['ha_wait'] = function (block) {
            const seconds = block.getFieldValue('SECONDS');
            return `await sleep(${seconds * 1000});\n`;
        };

        generator.forBlock['ha_wait_for_state'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            const toState = block.getFieldValue('TO_STATE');
            // 'eq' is ha.waitFor()'s ChangeFilter for exact-match — matches ha_trigger_on_state's
            // own "when X changes to Y" semantics, so the two Wait/Trigger blocks read consistently.
            const waitCall = (opts) => `ha.waitFor(${entityCode}, 'eq', ${JSON.stringify(toState)}${opts})`;

            const useTimeout = block.getFieldValue('USE_TIMEOUT') === 'TRUE';
            if (!useTimeout) {
                return `await ${waitCall('')};\n`;
            }

            // With a timeout, SUCCESS/TIMEOUT_BRANCH (added by ha_wait_timeout_mutator in
            // blockly-mutators.js) become a real try/catch — the exact pattern already used by
            // hand-written TS/JS in this project (examples/sequential_logic.js), not a new
            // convention invented for Blockly. A bare `catch {` (no binding) matches that example;
            // there's no ha_wait_timeout_error value block to expose the caught error to blocks.
            const timeoutMs = block.getFieldValue('TIMEOUT_MS');
            const successBody = gen.statementToCode(block, 'SUCCESS');
            const timeoutBody = gen.statementToCode(block, 'TIMEOUT_BRANCH');
            return `try {\n  await ${waitCall(`, { timeout: ${timeoutMs} }`)};\n${successBody}} catch {\n${timeoutBody}}\n`;
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

        // ha.ask()'s `action` string is purely an internal identifier the generated code compares
        // against — never shown to the user — so it's derived from the button's TITLE instead of
        // making beginners fill in a second field with no visible purpose. Uppercase + non-
        // alphanumeric runs collapsed to underscores; falls back to 'BUTTON' for an empty title.
        function slugifyAskActionId(title) {
            const slug = (title || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            return slug || 'BUTTON';
        }

        generator.forBlock['ha_ask'] = function (block, gen) {
            const message = gen.valueToCode(block, 'MESSAGE', gen.ORDER_NONE) || '""';
            const title = gen.valueToCode(block, 'TITLE', gen.ORDER_NONE);
            const target = gen.valueToCode(block, 'TARGET', gen.ORDER_NONE);
            const useTimeout = block.getFieldValue('USE_TIMEOUT') === 'TRUE';
            const timeoutMs = block.getFieldValue('TIMEOUT_MS');

            // itemCount_ is set by loadExtraState()/updateShape_() (ha_ask_actions_mutator in
            // blockly-mutators.js) when the workspace is deserialized — populated correctly by
            // the time code generation runs, not just interactively (same as ha_call_service's
            // mutator-added fields above).
            const itemCount = block.itemCount_ || 0;
            const buttonTitles = [];
            for (let i = 0; i < itemCount; i++) {
                const buttonTitleField = block.getField('TITLE' + i);
                buttonTitles.push(buttonTitleField ? buttonTitleField.getValue() : '');
            }
            // Two buttons titled the same would otherwise derive the same id, making the second
            // if/else-if branch unreachable — de-duplicated with a numeric suffix so every button
            // still gets its own working branch even if the user reuses a title.
            const usedIds = new Set();
            const actionIds = buttonTitles.map((buttonTitle) => {
                const base = slugifyAskActionId(buttonTitle);
                let id = base;
                let suffix = 2;
                while (usedIds.has(id)) id = `${base}_${suffix++}`;
                usedIds.add(id);
                return id;
            });

            const actionEntries = buttonTitles.map((buttonTitle, i) => `{ action: ${JSON.stringify(actionIds[i])}, title: ${JSON.stringify(buttonTitle)} }`);

            const optsParts = [];
            if (title) optsParts.push(`title: ${title}`);
            if (target) optsParts.push(`target: ${target}`);
            if (useTimeout) optsParts.push(`timeout: ${timeoutMs}`);
            if (actionEntries.length > 0) optsParts.push(`actions: [${actionEntries.join(', ')}]`);
            const optsStr = optsParts.length > 0 ? `, { ${optsParts.join(', ')} }` : '';

            // NO_ANSWER only exists when USE_TIMEOUT is checked (see updateShapeNoAnswer_() in
            // blockly-mutators.js) — gen.statementToCode() throws if the named input doesn't
            // exist on the block at all, unlike valueToCode()'s graceful '' for an unplugged
            // socket, so this has to check first (found via a real Node compile-pipeline test:
            // an unchecked ha_ask threw "Input \"NO_ANSWER\" doesn't exist on \"ha_ask\"").
            const noAnswerBody = block.getInput('NO_ANSWER') ? gen.statementToCode(block, 'NO_ANSWER') : '';

            // Wrapped in a bare { } block (not a function) purely to scope `const answer` — two
            // ha_ask blocks in the same surrounding scope would otherwise collide on the same
            // const name. No buttons configured -> nothing to branch on, so just await and run
            // the "no answer" body unconditionally (mirrors ha.ask() resolving to `defaultAction`
            // when nothing was tapped, with no action string to compare against).
            if (itemCount === 0) {
                return `{\n  await ha.ask(${message}${optsStr});\n${noAnswerBody}}\n`;
            }

            let code = `{\n  const answer = await ha.ask(${message}${optsStr});\n`;
            for (let i = 0; i < itemCount; i++) {
                const body = gen.statementToCode(block, 'DO' + i);
                const kw = i === 0 ? '  if' : '  } else if';
                code += `${kw} (answer === ${JSON.stringify(actionIds[i])}) {\n${body}`;
            }
            code += `  } else {\n${noAnswerBody}  }\n}\n`;
            return code;
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

        generator.forBlock['ha_store_get'] = function (block, gen) {
            const key = block.getFieldValue('KEY');
            return [`ha.store.get(${JSON.stringify(key)})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_store_set'] = function (block, gen) {
            const key = block.getFieldValue('KEY');
            const value = gen.valueToCode(block, 'VALUE', gen.ORDER_NONE) || 'undefined';
            const secret = block.getFieldValue('SECRET') === 'TRUE';
            const secretArg = secret ? ', true' : '';
            return `ha.store.set(${JSON.stringify(key)}, ${value}${secretArg});\n`;
        };

        generator.forBlock['ha_store_delete'] = function (block) {
            const key = block.getFieldValue('KEY');
            return `ha.store.delete(${JSON.stringify(key)});\n`;
        };

        generator.forBlock['ha_store_on'] = function (block, gen) {
            const key = block.getFieldValue('KEY');
            const body = gen.statementToCode(block, 'DO');
            // async, matching ha_trigger_on/ha_trigger_on_state above — DO can contain awaiting
            // blocks (ha_notify, ha_wait, ha_call_service, ...), a plain arrow function would
            // make those `await`s a syntax error in the compiled output.
            return `ha.store.on(${JSON.stringify(key)}, async (newValue, oldValue) => {\n${body}});\n`;
        };

        generator.forBlock['ha_mqtt_subscribe'] = function (block, gen) {
            const topic = block.getFieldValue('TOPIC');
            const body = gen.statementToCode(block, 'DO');
            // async — see ha_store_on above for why.
            return `ha.mqtt.subscribe(${JSON.stringify(topic)}, async (topic, payload) => {\n${body}});\n`;
        };

        // Only meaningful nested inside ha_mqtt_subscribe's DO stack, where the generated
        // callback's own `payload` parameter (see above) is in scope — mirrors ha_trigger_on's
        // callback parameter `e`, which similarly has no matching value block today.
        generator.forBlock['ha_mqtt_payload'] = function (block, gen) {
            return ['payload', gen.ORDER_ATOMIC];
        };

        generator.forBlock['ha_mqtt_publish'] = function (block, gen) {
            const topic = block.getFieldValue('TOPIC');
            const payload = gen.valueToCode(block, 'PAYLOAD', gen.ORDER_NONE) || '""';
            const retain = block.getFieldValue('RETAIN') === 'TRUE';
            const optsArg = retain ? ', { retain: true }' : '';
            return `ha.mqtt.publish(${JSON.stringify(topic)}, ${payload}${optsArg});\n`;
        };

        // Only meaningful nested inside ha_on_webhook's DO stack, where the generated callback's
        // own `req` parameter (see above) is in scope — mirrors ha_mqtt_payload's own reasoning.
        generator.forBlock['ha_webhook_data'] = function (block, gen) {
            return ['req.body', gen.ORDER_MEMBER];
        };

        generator.forBlock['ha_webhook_respond'] = function (block, gen) {
            const value = gen.valueToCode(block, 'VALUE', gen.ORDER_NONE) || '{}';
            return `res.json(${value});\n`;
        };

        generator.forBlock['ha_get_calendar_events'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            return [`await ha.getCalendarEvents(${entityCode})`, gen.ORDER_NONE];
        };

        generator.forBlock['ha_get_todo_items'] = function (block, gen) {
            const entityCode = gen.valueToCode(block, 'ENTITY', gen.ORDER_NONE) || '""';
            return [`await ha.getTodoItems(${entityCode})`, gen.ORDER_NONE];
        };
    }

    /**
     * Wraps compiled top-level code in an async IIFE only if it actually needs one — a bare
     * top-level `await` (e.g. a triggerless action-only workspace, or the pre-M5 default of
     * always wrapping unconditionally) is invalid inside the plain CommonJS module the dist
     * output gets require()'d as, but most real workspaces don't have one: every trigger-shaped
     * block's DO stack already runs inside its own `async (e) => {...}` callback (ha_trigger_on,
     * ha_store_on, ha_mqtt_subscribe, ...), so the *top level* is just a sequence of `ha.on(...)`/
     * `schedule(...)`/etc. registration calls with nothing to await.
     *
     * Detected via `new Function(code)`: a plain (non-async) function body syntactically rejects
     * a bare top-level `await` — exactly the condition that needs wrapping — while well-formed
     * generated code (no top-level await) parses there without throwing.
     *
     * Shared here rather than duplicated per caller so the server compiler
     * (core/blockly-compiler.js — the actual runtime dist output), the browser's live "Show Code"
     * panel (blockly-editor.js), and "Convert to JavaScript" (which reuses the compiled dist
     * verbatim) can never disagree about whether a given workspace needs wrapping.
     */
    function wrapGeneratedCode(code) {
        let needsWrap = false;
        try {
            new Function(code);
        } catch (e) {
            needsWrap = true;
        }
        return needsWrap ? `(async () => {\n${code}\n})();\n` : code;
    }

    registerHaBlocks.wrapGeneratedCode = wrapGeneratedCode;
    return registerHaBlocks;
});
