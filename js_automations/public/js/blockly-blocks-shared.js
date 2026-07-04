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
            const entityId = block.getFieldValue('ENTITY_ID');
            const body = gen.statementToCode(block, 'DO');
            return `ha.on(${JSON.stringify(entityId)}, async (e) => {\n${body}});\n`;
        };

        generator.forBlock['ha_call_service'] = function (block) {
            const service = block.getFieldValue('SERVICE');
            const entityId = block.getFieldValue('ENTITY_ID');
            return `await ha.call(${JSON.stringify(service)}, { entity_id: ${JSON.stringify(entityId)} });\n`;
        };

        generator.forBlock['ha_log'] = function (block) {
            const message = block.getFieldValue('MESSAGE');
            return `ha.log(${JSON.stringify(message)});\n`;
        };
    };
});
