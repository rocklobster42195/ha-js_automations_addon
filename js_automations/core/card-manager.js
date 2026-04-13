/**
 * JS AUTOMATIONS - Card Manager
 * Handles Script Pack card installation:
 *   - Parsing __JSA_CARD__ blocks from script files
 *   - Hash-based change detection
 *   - Writing card JS to config/www/jsa-cards/
 *   - Registering / updating Lovelace resources via HA WebSocket
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CARD_START = '__JSA_CARD__';
const CARD_END = '__JSA_CARD_END__';
const REGISTRY_FILE = 'card-registry.json';

// Injected before the card code at install time.
// Provides __jsa__.callAction() → HA Event Bus transport back to the addon.
// {{SCRIPT_ID}} is replaced with the script's base filename at install time.
const JSA_PREAMBLE = `/* __jsa__ v1 — injected by JS Automations */
const __jsa__ = (() => {
  let _conn = null;
  const _pending = new Map();
  function _subscribe(conn) {
    if (_conn === conn) return;
    _conn = conn;
    conn.subscribeEvents((event) => {
      const p = _pending.get(event.data.correlation_id);
      if (!p) return;
      _pending.delete(event.data.correlation_id);
      if (event.data.error) p.reject(new Error(event.data.error));
      else p.resolve(event.data.result ?? null);
    }, 'jsa_action_result');
  }
  return {
    scriptId: '{{SCRIPT_ID}}',
    connect(hass) { _subscribe(hass.connection); },
    callAction(name, payload = {}) {
      if (!_conn) return Promise.reject(new Error('__jsa__ not connected — call connect(hass) first'));
      const correlationId = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          _pending.delete(correlationId);
          reject(new Error(\`Action "\${name}" timed out after 10s\`));
        }, 10000);
        _pending.set(correlationId, {
          resolve: (r) => { clearTimeout(timer); resolve(r); },
          reject:  (e) => { clearTimeout(timer); reject(e); },
        });
        _conn.sendMessage({
          type: 'fire_event',
          event_type: 'jsa_action',
          event_data: { script: this.scriptId, action: name, payload, correlation_id: correlationId },
        });
      });
    },
  };
})();
`;

class CardManager {
    /**
     * @param {string} storageDir  - Addon storage dir (for registry JSON)
     * @param {string} wwwCardsDir - config/www/jsa-cards/
     * @param {object} haConnector - HAConnector instance (may be null until connected)
     */
    constructor(storageDir, wwwCardsDir, haConnector) {
        this.storageDir = storageDir;
        this.wwwCardsDir = wwwCardsDir;
        this.haConnector = haConnector;
        this.registryPath = path.join(storageDir, REGISTRY_FILE);
        this.registry = this._loadRegistry();
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Installs the card embedded in a script file.
     * Called from WorkerManager when a worker sends an 'install_card' message.
     *
     * @param {string} scriptFilePath - Absolute path to the .js script file
     * @param {object} options
     * @param {object} [options.config]  - Passed to setConfig() via wrapper injection
     * @param {boolean} [options.force]  - Overwrite even if hash matches
     * @param {boolean} [options.devMode] - @card dev — skip file write and Lovelace registration
     * @returns {Promise<string>} Resource URL, e.g. /local/jsa-cards/openligadb-card.js?v=a3f8c21b
     */
    async installCard(scriptFilePath, options = {}) {
        const cardCode = this._extractCardBlock(scriptFilePath);
        if (!cardCode) throw new Error('No __JSA_CARD__ block found in script.');

        const scriptName = path.basename(scriptFilePath, path.extname(scriptFilePath));
        const cardName = `${scriptName}-card`;
        const hash = this._hash(cardCode);
        const shortHash = hash.slice(0, 8);
        const resourceUrl = `/local/jsa-cards/${cardName}.js?v=${shortHash}`;

        if (options.devMode) {
            // Dev mode: no file write, no Lovelace registration — preview uses live card code
            return resourceUrl;
        }

        const existing = this.registry[scriptName];
        if (!options.force && existing?.hash === hash) {
            return existing.resourceUrl;
        }

        // Prepend __jsa__ preamble ({{SCRIPT_ID}} → scriptName)
        const preamble = JSA_PREAMBLE.replace('{{SCRIPT_ID}}', scriptName);

        // Wrap card code with config injection if config is provided
        const wrappedCode = options.config
            ? this._wrapWithConfig(cardCode, cardName, options.config)
            : cardCode;

        const finalCode = preamble + wrappedCode;

        // Write card file
        this._ensureCardsDir();
        const cardFilePath = path.join(this.wwwCardsDir, `${cardName}.js`);
        fs.writeFileSync(cardFilePath, finalCode, 'utf8');

        // Register or update Lovelace resource
        const resourceId = await this._upsertLovelaceResource(resourceUrl, existing?.resourceId);

        // Persist to registry
        this.registry[scriptName] = { hash, resourceUrl, resourceId, cardName };
        this._saveRegistry();

        return resourceUrl;
    }

    /**
     * Removes a script's installed card: deletes the card JS file from www/jsa-cards/,
     * removes the Lovelace resource, and clears the registry entry.
     * Called when a Script Pack script is deleted.
     * @param {string} scriptFilePath - Absolute path to the (now deleted) script file
     */
    removeCard(scriptFilePath) {
        const scriptName = path.basename(scriptFilePath, path.extname(scriptFilePath));
        const entry = this.registry[scriptName];
        if (!entry) return;

        // Delete the card file if it exists
        const cardFilePath = path.join(this.wwwCardsDir, `${entry.cardName}.js`);
        if (fs.existsSync(cardFilePath)) {
            try { fs.unlinkSync(cardFilePath); } catch (e) {
                console.error(`[CardManager] Failed to delete card file ${cardFilePath}:`, e.message);
            }
        }

        // Remove Lovelace resource (fire-and-forget — HA may be unavailable)
        if (entry.resourceId && this.haConnector?.isReady) {
            this.haConnector.sendCommand('lovelace/resources/delete', { resource_id: entry.resourceId })
                .catch(e => console.warn('[CardManager] Lovelace resource removal failed:', e.message));
        }

        delete this.registry[scriptName];
        this._saveRegistry();
    }

    /**
     * Returns the raw decoded card source for a script (used by dev-mode preview).
     * @param {string} scriptFilePath
     * @returns {string|null}
     */
    getCardSource(scriptFilePath) {
        return this._extractCardBlock(scriptFilePath);
    }

    // ---------------------------------------------------------------------------
    // Private: Block Parsing
    // ---------------------------------------------------------------------------

    _extractCardBlock(scriptFilePath) {
        let raw;
        try {
            raw = fs.readFileSync(scriptFilePath, 'utf8');
        } catch {
            return null;
        }

        // Search for the block-comment form to avoid matching inline comments
        // that mention __JSA_CARD__ (e.g. "// Decodes the __JSA_CARD__ block...")
        const startIdx = raw.indexOf(`/* ${CARD_START}`);
        if (startIdx === -1) return null;

        // Skip the CARD_START line — the next line is the Base64 content
        const afterStart = raw.indexOf('\n', startIdx);
        if (afterStart === -1) return null;

        const endIdx = raw.indexOf(CARD_END, afterStart);
        if (endIdx === -1) return null;

        const base64 = raw.slice(afterStart + 1, endIdx).trim();
        if (!base64) return null;

        try {
            return Buffer.from(base64, 'base64').toString('utf8');
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------------------
    // Private: Config Injection Wrapper
    // ---------------------------------------------------------------------------

    _wrapWithConfig(cardCode, cardName, config) {
        const configJson = JSON.stringify(config);
        return `(function(){
const __jsa_config__ = ${configJson};
const __orig_define__ = customElements.define.bind(customElements);
customElements.define = (name, cls) => {
  class WrappedCard extends cls {
    connectedCallback() {
      super.connectedCallback?.();
      if (__jsa_config__ && this.setConfig) this.setConfig(__jsa_config__);
    }
  }
  __orig_define__(name, WrappedCard);
  customElements.define = __orig_define__;
};
${cardCode}
})();`;
    }

    // ---------------------------------------------------------------------------
    // Private: Lovelace Resource Management
    // ---------------------------------------------------------------------------

    async _upsertLovelaceResource(url, existingResourceId) {
        if (!this.haConnector?.isReady) return null;

        if (existingResourceId) {
            // Update existing resource URL (triggers cache-bust in all HA browser sessions)
            const result = await this.haConnector.sendCommand('lovelace/resources/update', {
                resource_id: existingResourceId,
                res_type: 'module',
                url,
            });
            if (result?.success !== false) return existingResourceId;
        }

        // Create new resource
        const result = await this.haConnector.sendCommand('lovelace/resources/create', {
            res_type: 'module',
            url,
        });
        return result?.resource_id ?? null;
    }

    // ---------------------------------------------------------------------------
    // Private: Hash & Registry
    // ---------------------------------------------------------------------------

    _hash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    _loadRegistry() {
        try {
            return JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
        } catch {
            return {};
        }
    }

    _saveRegistry() {
        try {
            fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
        } catch (e) {
            console.error('[CardManager] Failed to save registry:', e.message);
        }
    }

    _ensureCardsDir() {
        if (!fs.existsSync(this.wwwCardsDir)) {
            fs.mkdirSync(this.wwwCardsDir, { recursive: true });
        }
    }
}

module.exports = CardManager;
