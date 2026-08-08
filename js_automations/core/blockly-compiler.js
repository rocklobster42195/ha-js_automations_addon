// core/blockly-compiler.js
// Server-side ".blocks" -> JS compilation. `blockly` is required via its root entry point,
// which is already the Node/CJS build with all built-in blocks pre-registered (there is no
// './node' subpath export in blockly@11).
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Blockly = require('blockly');
const { javascriptGenerator } = require('blockly/javascript');

// Both physically under public/js/ so the browser can also load them via plain <script> tags
// (no bundler in this project) — see blockly-blocks-shared.js's header comment for why.
Blockly.common.defineBlocksWithJsonArray(require('../public/js/blockly-blocks'));
const registerHaBlocks = require('../public/js/blockly-blocks-shared');
registerHaBlocks(javascriptGenerator);

// Block-level error visualization (docs/blockly_concept.md M5, should-have): wraps every
// individual statement block's own generated code in a try/catch that tags a thrown error with
// `.blockId` before rethrowing, so a runtime error can be traced back to the exact block that
// caused it (not just "somewhere in this script") — surfaced to the editor via
// worker-manager.js/bridge.js and highlighted in blockly-editor.js if that .blocks tab is open.
//
// Implemented via scrub_(), Blockly's own per-block code-generation hook (called once for every
// block in a statement chain — top-level or nested inside any DO/ELSE/etc. input — with just
// that block's own code fragment; the default implementation handles appending the next
// chained block's code, which is preserved here by delegating to it after wrapping). This
// applies uniformly to every block type, built-in or custom, without touching individual
// forBlock generator functions.
//
// Deliberately only overridden on THIS (Node-side) javascriptGenerator instance, used solely by
// BlocklyCompiler for the real runtime dist output — the browser's own separate Blockly.JavaScript
// instance (loaded via CDN for "Show Code") is never touched, so Show Code stays clean and
// readable, without try/catch noise the user never asked to see.
//
// `if (!__e.blockId)` only sets it once: an error from a deeply-nested block (e.g. inside a
// loop, itself inside a trigger's DO stack) passes through several of these wrappers as it
// propagates up — the innermost (most specific) block's id must win, not get overwritten by a
// less-specific outer one.
//
// Verified in Node (not just node --check on the syntax): a real thrown error is caught with
// exactly the id of the block that threw, propagation still correctly aborts the rest of the
// statement chain, and — the actual risk with wrapping arbitrary generated code in try/catch —
// `break`/`continue` inside a wrapped loop body (Blockly's own controls_flow_statements block)
// still terminates the loop after the expected number of iterations, not looping forever, so
// bare `break`/`continue` remains valid *and* semantically correct when it ends up inside a
// try block like this.
const _origScrub = javascriptGenerator.scrub_.bind(javascriptGenerator);
javascriptGenerator.scrub_ = function (block, code, opt_thisOnly) {
  let wrapped = code;
  if (code && code.trim() && block.previousConnection) {
    wrapped = `try {\n${code}} catch (__e) { if (!__e.blockId) __e.blockId = ${JSON.stringify(block.id)}; throw __e; }\n`;
  }
  return _origScrub(block, wrapped, opt_thisOnly);
};
// Registers ha_call_service's mutator (see blockly-mutators.js). Only its saveExtraState/
// loadExtraState/updateShape_ matter here — Node never opens the interactive popup, but it
// still needs those to reconstruct a saved workspace's dynamic ADD0/ADD1/... inputs.
require('../public/js/blockly-mutators')(Blockly);
// Registers the entity/service dropdown fields (see blockly-fields.js). Node has no live HA
// data to populate the menu with — it only needs to read back whatever value was serialized.
require('../public/js/blockly-fields')(Blockly);

// Block-type -> permission derivation (docs/blockly_concept.md "Permissions" section). Every
// capability-using construct in a .blocks script is one of our own known block types, so
// "declared" can always be computed exactly from "used" — unlike free-form JS/TS, there's no way
// to reach a capability through an untracked code path. HTTP blocks are cut from scope entirely
// (see the concept doc's "Out of Scope"), so 'network' has no entry here — only add one if an
// HTTP block is ever actually built.
const BLOCK_PERMISSION_MAP = {
  ha_on_webhook: 'webhook',
};

class BlocklyCompiler extends EventEmitter {
  constructor(scriptsDir, distDir) {
    super();
    this.scriptsDir = scriptsDir;
    this.distDir = distDir;
  }

  _getDistPath(blocksPath) {
    const relativePath = path.relative(this.scriptsDir, blocksPath);
    return path.join(this.distDir, relativePath.replace(/\.blocks$/, '.js'));
  }

  /**
   * Compiles a .blocks file to its dist/*.js counterpart.
   * @param {string} blocksPath Absolute path to the .blocks file.
   * @returns {Promise<boolean>} true on success.
   */
  async compile(blocksPath) {
    if (!blocksPath.endsWith('.blocks')) return false;

    this.emit('log', { level: 'debug', message: `Compiling ${path.basename(blocksPath)}...` });

    let parsed;
    try {
      const rawFile = fs.readFileSync(blocksPath, 'utf8');
      const raw = rawFile.charCodeAt(0) === 0xfeff ? rawFile.slice(1) : rawFile;
      parsed = JSON.parse(raw);
    } catch (e) {
      this.emit('compiler_signal', {
        type: 'BLOCKLY_ERR',
        filename: path.basename(blocksPath),
        text: `Invalid JSON: ${e.message}`,
      });
      this.emit('log', {
        level: 'error',
        message: `[${path.basename(blocksPath)}] Invalid .blocks JSON: ${e.message}`,
      });
      return false;
    }

    const workspace = new Blockly.Workspace();
    let code;
    let derivedPermissions;
    try {
      // Pass the whole parsed file, not parsed.blocks — workspaces.load() reads its own
      // top-level `blocks` key internally; unrelated keys like `jsa` are ignored.
      Blockly.serialization.workspaces.load(parsed, workspace);
      code = javascriptGenerator.workspaceToCode(workspace);
      const usedTypes = new Set(workspace.getAllBlocks(false).map((b) => b.type));
      const permSet = new Set();
      for (const type of usedTypes) {
        if (BLOCK_PERMISSION_MAP[type]) permSet.add(BLOCK_PERMISSION_MAP[type]);
      }
      derivedPermissions = [...permSet].sort();
    } catch (e) {
      this.emit('compiler_signal', { type: 'BLOCKLY_ERR', filename: path.basename(blocksPath), text: e.message });
      this.emit('log', {
        level: 'error',
        message: `[${path.basename(blocksPath)}] Blockly compile failed: ${e.message}`,
      });
      return false;
    } finally {
      workspace.dispose();
    }

    // Write the derived permissions back into the .blocks source (not just used internally)
    // so ScriptHeaderParser/CapabilityAnalyzer see it exactly like a hand-written @permission
    // tag would for .js/.ts. Only writes when it actually changed: this file write itself
    // re-triggers ScriptWatcher's .blocks change handler, which calls compile() again — an
    // unconditional write would loop forever (each write triggering another identical write);
    // guarded like this, the second pass finds nothing left to change and the loop ends there.
    const currentPermissions = [...((parsed.jsa && parsed.jsa.permission) || [])].sort();
    if (JSON.stringify(currentPermissions) !== JSON.stringify(derivedPermissions)) {
      parsed.jsa = parsed.jsa || {};
      parsed.jsa.permission = derivedPermissions;
      fs.writeFileSync(blocksPath, JSON.stringify(parsed, null, 2), 'utf8');
    }

    const distPath = this._getDistPath(blocksPath);
    const targetDir = path.dirname(distPath);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // Wrapped in an async IIFE only if actually needed — see wrapGeneratedCode() in
    // blockly-blocks-shared.js for why (and why it's shared rather than duplicated here).
    fs.writeFileSync(distPath, registerHaBlocks.wrapGeneratedCode(code), 'utf8');

    this.emit('compiler_signal', { type: 'BLOCKLY_OK', filename: path.basename(blocksPath) });
    return true;
  }

  /**
   * Removes the compiled JS file when a .blocks file is deleted.
   */
  cleanup(blocksPath) {
    const distPath = this._getDistPath(blocksPath);
    if (fs.existsSync(distPath)) fs.unlinkSync(distPath);
  }
}

module.exports = BlocklyCompiler;
