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
const ScriptHeaderParser = require('./script-header-parser');

const CARD_START = '__JSA_CARD__';
const CARD_END = '__JSA_CARD_END__';
const REGISTRY_FILE = 'card-registry.json';

// Injected before the card code at install time.
// Provides __jsa__.callAction() → HA Event Bus transport back to the addon.
// {{SCRIPT_ID}} is replaced with the script's base filename at install time.
const JSA_PREAMBLE = `/* __jsa__ v6 — injected by JS Automations */
let __jsa_hass__ = null;
const __jsa__ = (() => {
  let _conn = null;
  let _hass = null;
  let _cardCfg = {};
  let _heartbeatActive = false;
  let _heartbeatInterval = null;

  function _startHeartbeat() {
    if (_heartbeatActive || !_conn || !_hass || !_cardCfg.instanceId) return;
    _heartbeatActive = true;
    const send = () => {
      if (!_hass) return;
      __jsa__.callAction('heartbeat', {
        instanceId: _cardCfg.instanceId,
        entityId: _cardCfg.entityId,
        autoDelete: _cardCfg.autoDelete !== false,
      }).catch(() => {});
    };
    send();
    _heartbeatInterval = setInterval(send, 3600000);
  }

  return {
    scriptId: '{{SCRIPT_ID}}',
    connect(hass) {
      const conn = hass.connection;
      if (_conn !== conn) { _conn = conn; _hass = hass; __jsa_hass__ = hass; }
      _startHeartbeat();
    },
    updateConfig(config) {
      const prev = _cardCfg.instanceId;
      _cardCfg = config || {};
      if (_cardCfg.instanceId !== prev) {
        _heartbeatActive = false;
        if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
      }
      _startHeartbeat();
    },
    ready() { return Promise.resolve(); },
    callAction(name, payload = {}) {
      if (!_conn || !_hass) return Promise.reject(new Error('__jsa__ not connected — call connect(hass) first'));
      const conn = _conn;
      const hass = _hass;
      const scriptId = this.scriptId;
      const correlationId = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        let unsubscribe = null;
        let settled = false;
        let errorTimer = null;

        const settle = (fn) => {
          if (settled) return;
          settled = true;
          if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
          clearTimeout(timer);
          // Detach unsubscribe from current stack and swallow any rejection —
          // the HA WS library may reject with an internal error (e.g. event_type.startsWith)
          // when cleaning up subscriptions, which would otherwise crash as an unhandled rejection.
          if (unsubscribe) {
            const u = unsubscribe; unsubscribe = null;
            Promise.resolve().then(() => u()).catch(() => {});
          }
          fn();
        };

        const timer = setTimeout(() => {
          settle(() => reject(new Error(\`Action "\${name}" timed out after 20s\`)));
        }, 20000);

        // Per-call subscription created before firing the event to eliminate the
        // subscription-registration vs. result-delivery race condition.
        conn.subscribeMessage((event) => {
          const data = event.data ?? event?.event?.data;
          if (data?.correlation_id !== correlationId) return;
          if (data?.error) {
            // Don't reject immediately — a duplicate delivery carrying the success
            // result may follow within 1 s (caused by transient dual WS subscriptions).
            if (!errorTimer && !settled) {
              const msg = data.error;
              errorTimer = setTimeout(() => settle(() => reject(new Error(msg))), 1000);
            }
          } else {
            settle(() => resolve(data?.result ?? null));
          }
        }, { type: 'subscribe_events', event_type: 'jsa_action_result' })
        .then((unsub) => {
          unsubscribe = unsub;
          // Use hass.callWS for fire_event — it handles request/response lifecycle
          // correctly; conn.sendMessage leaves the response unhandled.
          hass.callWS({
            type: 'fire_event',
            event_type: 'jsa_action',
            event_data: { script: scriptId, action: name, payload, correlation_id: correlationId },
          }).catch(() => {});
        }, (err) => {
          settle(() => reject(new Error('subscription failed: ' + (err?.message || err))));
        });
      });
    },
    wizard(hostEl, opts) {
      const sr = hostEl.shadowRoot;
      if (!sr) return;
      const steps = opts.steps || [];
      let stepIdx = 0;
      const values = {};
      const cache = {};

      const CSS = '<style>:host{display:block}' +
        '.wiz{padding:16px;font-family:inherit}' +
        '.wiz-title{font-weight:600;margin-bottom:12px;font-size:.95em}' +
        'select,.wiz-inp{font-family:inherit;padding:8px 12px;border-radius:6px;border:1px solid var(--divider-color);' +
        'background:var(--card-background-color);color:var(--primary-text-color);width:100%;box-sizing:border-box;margin-bottom:10px;font-size:1em}' +
        '.wiz-btns{display:flex;gap:8px;margin-top:4px}' +
        '.btn-p{background:var(--primary-color);color:#fff;border:none;border-radius:8px;padding:10px 20px;cursor:pointer;font-weight:600;font-size:.95em}' +
        '.btn-s{background:transparent;border:1px solid var(--divider-color);border-radius:8px;padding:10px 16px;cursor:pointer;color:var(--primary-text-color);font-size:.95em}' +
        '.wiz-note{font-size:.82em;color:var(--secondary-text-color);margin-bottom:10px;display:flex;align-items:center;gap:6px}' +
        '.wiz-inp-sm{width:88px !important;display:inline-block !important;margin:0 !important}' +
        '.wiz-err{color:var(--error-color,#f44336);padding:16px}' +
        '.wiz-spin{padding:20px;text-align:center;color:var(--secondary-text-color)}</style>';

      const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const season0 = () => { const n = new Date(); return n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1; };
      const genUUID = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
          return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
      const show = (html) => { sr.innerHTML = CSS + html; };

      const loadStep = async () => {
        const step = steps[stepIdx];
        show('<div class="wiz"><div class="wiz-spin">Laden\u2026</div></div>');
        const depPayload = {};
        if (step.depends) {
          for (const [k, v] of Object.entries(step.depends)) depPayload[k] = values[v];
        }
        const cacheKey = step.action + JSON.stringify(depPayload);
        let data;
        if (cache[cacheKey]) {
          data = cache[cacheKey];
        } else {
          try {
            data = await __jsa__.callAction(step.action, depPayload);
            cache[cacheKey] = data;
          } catch (e) {
            show('<div class="wiz-err">\u26a0 ' + esc(e.message) + '<br><small>Skript gestartet?</small></div>');
            return;
          }
        }

        if (!data || data.length === 0) {
          show('<div class="wiz"><div class="wiz-err">\u26a0 Keine Eintr\u00e4ge gefunden. Saison oder Liga pr\u00fcfen.</div>' +
            (stepIdx > 0 ? '<div class="wiz-btns"><button class="btn-s" id="wiz-back">Zur\u00fcck</button></div>' : '') +
            '</div>');
          var backEl2 = sr.querySelector('#wiz-back');
          if (backEl2) backEl2.onclick = function() { stepIdx--; loadStep(); };
          return;
        }

        const isLast = stepIdx === steps.length - 1;
        const season = values.season != null ? values.season : season0();
        const optsHtml = (data || []).map(function(item) {
          return '<option value="' + esc(item[step.valueKey]) + '">' + esc(item[step.labelKey]) + '</option>';
        }).join('');
        const seasonHtml = step.seasonField
          ? '<div class="wiz-note">Saison <input class="wiz-inp wiz-inp-sm" id="wiz-season" type="number" value="' + season + '" min="2000" max="2100"></div>'
          : '';
        const freeInputHtml = step.freeInput
          ? '<div class="wiz-note">Eigene Liga-ID <input class="wiz-inp" id="wiz-free" type="text" placeholder="z.B. WM2026" autocomplete="off"></div>'
          : '';

        show('<div class="wiz">' +
          '<div class="wiz-title">Schritt ' + (stepIdx + 1) + ' / ' + steps.length + ': ' + esc(step.label) + '</div>' +
          '<select id="wiz-sel"><option value="">Bitte w\u00e4hlen\u2026</option>' + optsHtml + '</select>' +
          seasonHtml +
          freeInputHtml +
          '<div class="wiz-btns">' +
          '<button class="btn-p" id="wiz-next">' + (isLast ? 'Speichern' : 'Weiter') + '</button>' +
          (stepIdx > 0 ? '<button class="btn-s" id="wiz-back">Zur\u00fcck</button>' : '') +
          '</div></div>');

        // Mutual exclusion: typing in free-input clears select, and vice versa
        var freeEl = sr.querySelector('#wiz-free');
        var selEl  = sr.querySelector('#wiz-sel');
        if (freeEl) {
          freeEl.oninput = function() { if (freeEl.value) selEl.value = ''; };
          selEl.onchange = function() { if (selEl.value) freeEl.value = ''; };
        }

        sr.querySelector('#wiz-next').onclick = async function() {
          var freeVal = freeEl ? freeEl.value.trim() : '';
          var raw = freeVal || sr.querySelector('#wiz-sel').value;
          if (!raw) return;
          var item = freeVal ? null : (data || []).find(function(d) { return String(d[step.valueKey]) === raw; });
          values[step.id] = isNaN(raw) ? raw : Number(raw);
          values[step.id + '_item'] = item;
          var seasonEl = sr.querySelector('#wiz-season');
          if (seasonEl) values.season = parseInt(seasonEl.value, 10) || season0();
          if (!isLast) { stepIdx++; await loadStep(); } else { await finish(); }
        };
        var backEl = sr.querySelector('#wiz-back');
        if (backEl) backEl.onclick = function() { stepIdx--; loadStep(); };
      };

      const finish = async () => {
        show('<div class="wiz"><div class="wiz-spin">Speichern\u2026</div></div>');
        try {
          const instanceId = genUUID();
          const config = await Promise.resolve(opts.onComplete(values, instanceId));
          const baseType = (hostEl._cfg && hostEl._cfg.type) || ('custom:' + __jsa__.scriptId + '-card');
          hostEl.dispatchEvent(new CustomEvent('config-changed', {
            detail: { config: Object.assign({ type: baseType }, config) },
            bubbles: true, composed: true,
          }));
          hostEl.dispatchEvent(new CustomEvent('jsa-editor-close', { bubbles: true, composed: true }));
        } catch (e) {
          show('<div class="wiz-err">\u26a0 ' + esc(e.message) + '</div>');
        }
      };

      loadStep();
    },
  };
})();

// Error boundary — forwards card runtime errors to the JSA log stream via HA event bus.
(function() {
  const _sid = '{{SCRIPT_ID}}';
  const _tag = '/jsa-cards/' + _sid + '-card.js';
  window.addEventListener('error', function(e) {
    if (!e.filename || !e.filename.includes(_tag) || !__jsa_hass__) return;
    __jsa_hass__.callWS({ type: 'fire_event', event_type: 'jsa_card_error',
      event_data: { script: _sid, message: e.message || 'Unknown error', line: e.lineno || 0 },
    }).catch(function() {});
  });
  window.addEventListener('unhandledrejection', function(e) {
    var msg = String(e.reason && e.reason.message ? e.reason.message : e.reason || 'Unhandled rejection');
    var stack = (e.reason && e.reason.stack) || '';
    if ((!stack.includes(_tag) && !stack.includes(_sid + '-card')) || !__jsa_hass__) return;
    __jsa_hass__.callWS({ type: 'fire_event', event_type: 'jsa_card_error',
      event_data: { script: _sid, message: msg },
    }).catch(function() {});
  });
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
        const cardFilePath = path.join(this.wwwCardsDir, `${cardName}.js`);
        if (!options.force && existing?.hash === hash && fs.existsSync(cardFilePath)) {
            return existing.resourceUrl;
        }

        // Prepend __jsa__ preamble ({{SCRIPT_ID}} → scriptName)
        const preamble = JSA_PREAMBLE.replace('{{SCRIPT_ID}}', scriptName);

        // Wrap card code with config injection if config is provided
        const wrappedCode = options.config
            ? this._wrapWithConfig(cardCode, cardName, options.config)
            : cardCode;

        const scriptMeta = ScriptHeaderParser.parse(scriptFilePath);
        const pickerEntry =
            `window.customCards = window.customCards || [];\n` +
            `window.customCards.push({ type: '${cardName}', name: ${JSON.stringify(scriptMeta.name || scriptName)}, ` +
            `description: ${JSON.stringify(scriptMeta.description || '')}, preview: true });\n\n`;
        const finalCode = pickerEntry + preamble + wrappedCode;

        // Write card file
        this._ensureCardsDir();
        fs.writeFileSync(cardFilePath, finalCode, 'utf8');
        console.log(`[CardManager] Card file written: ${cardFilePath}`);

        // Register or update Lovelace resource
        const resourceId = await this._upsertLovelaceResource(resourceUrl, existing?.resourceId, cardName);

        if (resourceId) {
            console.log(`[CardManager] Lovelace resource registered: ${resourceUrl} (id=${resourceId})`);
        } else {
            console.warn(
                `[CardManager] Lovelace resource registration failed for "${resourceUrl}". ` +
                `If Lovelace is in YAML mode, add this to configuration.yaml:\n` +
                `  lovelace:\n    resources:\n      - url: ${resourceUrl}\n        type: module`
            );
        }

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
     * Removes orphaned card JS files and Lovelace resources that no longer correspond
     * to a known script with a @card header. Safe to call at startup and after installs.
     * @param {string[]} knownCardNames  e.g. ['openligadb-card', 'weather-card']
     */
    async performStartupCleanup(knownCardNames) {
        const known = new Set(knownCardNames);

        // 1. Remove orphaned JS files from www/jsa-cards/
        if (fs.existsSync(this.wwwCardsDir)) {
            for (const file of fs.readdirSync(this.wwwCardsDir)) {
                if (!file.endsWith('.js')) continue;
                const cardName = path.basename(file, '.js');
                if (!known.has(cardName)) {
                    try {
                        fs.unlinkSync(path.join(this.wwwCardsDir, file));
                        console.log(`[CardManager] Startup cleanup: deleted orphaned file ${file}`);
                    } catch (e) {
                        console.warn(`[CardManager] Startup cleanup: could not delete ${file}: ${e.message}`);
                    }
                }
            }
        }

        // 2. Remove orphaned Lovelace resources
        if (this.haConnector?.isReady) {
            try {
                const all = await this.haConnector.sendCommand('lovelace/resources');
                const resources = all?.resources ?? (Array.isArray(all) ? all : []);
                for (const r of resources) {
                    if (!r.url?.includes('/jsa-cards/')) continue;
                    const isKnown = knownCardNames.some(name => r.url.includes(`/jsa-cards/${name}.js`));
                    if (!isKnown) {
                        const rid = r.id ?? r.resource_id;
                        try {
                            await this.haConnector.sendCommand('lovelace/resources/delete', { resource_id: rid });
                            console.log(`[CardManager] Startup cleanup: deleted orphaned resource ${r.url} (id=${rid})`);
                        } catch (e) {
                            console.warn(`[CardManager] Startup cleanup: could not delete resource ${rid}: ${e.message}`);
                        }
                    }
                }
            } catch (e) {
                console.warn(`[CardManager] Startup cleanup: could not list Lovelace resources: ${e.message}`);
            }
        }

        // 3. Remove orphaned registry entries
        let dirty = false;
        for (const scriptName of Object.keys(this.registry)) {
            const entry = this.registry[scriptName];
            if (!known.has(entry.cardName)) {
                delete this.registry[scriptName];
                dirty = true;
            }
        }
        if (dirty) this._saveRegistry();
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

    async _upsertLovelaceResource(url, existingResourceId, cardName) {
        if (!this.haConnector?.isReady) {
            console.warn('[CardManager] HA not connected — skipping Lovelace resource registration.');
            return null;
        }

        // Always clean up stale registrations first to prevent duplicates in the picker
        let foundId = null;
        if (cardName) {
            try {
                const all = await this.haConnector.sendCommand('lovelace/resources');
                const resources = all?.resources ?? (Array.isArray(all) ? all : []);
                console.log(`[CardManager] Found ${resources.length} total Lovelace resources, existingId=${existingResourceId}`);
                for (const r of resources) {
                    if (!r.url?.includes(`/jsa-cards/${cardName}.js`)) continue;
                    const rid = r.id ?? r.resource_id;
                    if (rid === existingResourceId && !foundId) {
                        foundId = rid;
                    } else {
                        try {
                            await this.haConnector.sendCommand('lovelace/resources/delete', { resource_id: rid });
                            console.log(`[CardManager] Removed stale Lovelace resource: ${r.url} (id=${rid})`);
                        } catch (delErr) {
                            console.warn(`[CardManager] Failed to delete stale resource ${rid}: ${delErr.message}`);
                        }
                    }
                }
            } catch (listErr) {
                console.warn(`[CardManager] Failed to list Lovelace resources: ${listErr.message}`);
            }
        }

        if (foundId) {
            // Update the URL on the surviving resource (cache-bust)
            const result = await this.haConnector.sendCommand('lovelace/resources/update', {
                resource_id: foundId,
                res_type: 'module',
                url,
            });
            if (result?.success !== false) return foundId;
            console.warn(`[CardManager] Lovelace resource update failed (id=${foundId}), creating new entry.`);
        }

        // Create a fresh resource
        const result = await this.haConnector.sendCommand('lovelace/resources/create', {
            res_type: 'module',
            url,
        });
        if (result?.success === false) {
            console.warn(`[CardManager] lovelace/resources/create failed: ${result.error ?? 'unknown error'}`);
            return null;
        }
        return result?.id ?? result?.resource_id ?? null;
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
