// core/blockly-blocks-shared.js  (platform-agnostic: required from Node for BlocklyCompiler,
// and imported in the browser for the "Show Code" panel's generator instance)
//
// Registers all custom `ha_*` block code generators on whichever javascriptGenerator instance
// is passed in. Empty for now — M1 proves the compile pipeline using Blockly's built-in blocks
// only. Custom HA blocks are added starting M2.
module.exports = function registerHaBlocks(generator) {
    // generator.forBlock['ha_call_service'] = (block, gen) => { ... };
    // generator.forBlock['ha_trigger_on']   = (block, gen) => { ... };
};
