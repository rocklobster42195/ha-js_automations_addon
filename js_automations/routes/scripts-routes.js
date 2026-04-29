const express = require('express');
const fs = require('fs');
const path = require('path');
const ScriptHeaderParser = require('../core/script-header-parser');
const CapabilityAnalyzer = require('../core/capability-analyzer');
const axios = require('axios');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

module.exports = (workerManager, depManager, stateManager, io, SCRIPTS_DIR, STORAGE_DIR, LIBRARIES_DIR, mqttManager, cardManager) => {
    const router = express.Router();

    // Helper: Findet Datei in Scripts ODER Libraries Ordner
    const getFilePath = (filename) => {
        const p1 = path.join(SCRIPTS_DIR, filename);
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(LIBRARIES_DIR, filename);
        if (fs.existsSync(p2)) return p2;
        return null;
    };

    // GET List
    router.get('/', (req, res) => {
        const results = [];
        const conflicts = workerManager.getEntityConflicts();

        // Use centralized getScripts for consistency (handles TS/JS filtering)
        const scripts = workerManager.getScripts();
        scripts.forEach(fullPath => {
            const filename = path.basename(fullPath);
            const isLibrary = path.basename(path.dirname(fullPath)) === 'libraries';

            const m = ScriptHeaderParser.parse(fullPath);
            if (!m.name) m.name = filename;

            try {
                const source = fs.readFileSync(fullPath, 'utf8');
                const { detected } = CapabilityAnalyzer.analyze(source);
                const declared = m.permissions || [];
                const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
                m.capabilities = { detected, declared, undeclared, unused };
            } catch (e) {
                m.capabilities = { detected: [], declared: m.permissions || [], undeclared: [], unused: [] };
            }

            if (isLibrary) {
                m.status = 'stopped';
                m.running = false;
            } else {
                m.status = workerManager.workers.has(filename) ? 'running' : (workerManager.lastExitState.get(filename) === 'error' ? 'error' : 'stopped');
                m.running = m.status === 'running';
                if (m.running) {
                    const stats = workerManager.getScriptStats(filename);
                    if (stats) m.ram_usage = stats.ram_usage;
                    if (workerManager.startTimes.has(filename)) m.last_started = workerManager.startTimes.get(filename);
                }
            }
            m.entity_conflicts = conflicts[filename] || null;

            // Card installation status: check registry + actual file presence
            if (m.card && cardManager) {
                const scriptName = filename.replace(/\.[^.]+$/, '');
                const entry = cardManager.registry[scriptName];
                m.cardInstalled = !!(entry && fs.existsSync(
                    path.join(cardManager.wwwCardsDir, `${entry.cardName}.js`)
                ));
            }

            results.push(m);
        });

        res.json(results);
    });

    // POST Control (Toggle/Restart)
    router.post('/control', async (req, res) => {
        const { filename, action } = req.body;
        const fullPath = getFilePath(filename);

        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        if (action === 'toggle') {
            if (workerManager.workers.has(filename)) {
                workerManager.stopScript(filename, 'stopped by user');
            } else {
                if (fs.existsSync(fullPath)) {
                    const meta = ScriptHeaderParser.parse(fullPath);
                    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                }
                // Wir übergeben den vollen Pfad, damit WorkerManager ihn sicher findet
                workerManager.startScript(fullPath);
                stateManager.saveScriptStarted(filename);
            }
        } else if (action === 'restart') {
            workerManager.stopScript(filename, 'restarting');
            setTimeout(async () => {
                if (fs.existsSync(fullPath)) {
                    const meta = ScriptHeaderParser.parse(fullPath);
                    if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
                }
                workerManager.startScript(fullPath);
                io.emit('status_update');
            }, 500);
        } else if (action === 'dismiss') {
            workerManager.clearErrorState(filename);
        }
        io.emit('status_update');
        res.json({ ok: true });
    });

    // DELETE Script
    router.delete('/:filename', async (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        workerManager.stopScript(filename, 'deleted');
        fs.unlinkSync(fullPath);
        if (cardManager) cardManager.removeCard(fullPath);
        await depManager.prune();
        io.emit('status_update');
        res.json({ ok: true });
    });

    // GET All Typings (Bundle for Monaco)
    router.get('/typings', (req, res) => {
        const typings = [];

        // 1. Static HA API Definition
        const haApiPath = path.join(__dirname, '../core/types/ha-api.d.ts');
        if (fs.existsSync(haApiPath)) {
            typings.push({
                filename: 'ha-api.d.ts',
                content: fs.readFileSync(haApiPath, 'utf8')
            });
        }

        // 2. Dynamic Entity Definitions (generated from HA states)
        const entitiesPath = path.join(STORAGE_DIR, 'entities.d.ts');
        if (fs.existsSync(entitiesPath)) {
            typings.push({
                filename: 'entities.d.ts',
                content: fs.readFileSync(entitiesPath, 'utf8')
            });
        }

        // 3. Dynamic Service Definitions
        const servicesPath = path.join(STORAGE_DIR, 'services.d.ts');
        if (fs.existsSync(servicesPath)) {
            typings.push({
                filename: 'services.d.ts',
                content: fs.readFileSync(servicesPath, 'utf8')
            });
        }

        // 4. NPM @types (axios, lodash, etc.)
        const typesDir = path.join(STORAGE_DIR, 'node_modules/@types');
        if (fs.existsSync(typesDir)) {
            const scanTypes = (dir, base = '') => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.join(base, entry.name);
                    if (entry.isDirectory()) {
                        scanTypes(fullPath, relativePath);
                    } else if (entry.name.endsWith('.d.ts')) {
                        typings.push({
                            filename: `node_modules/@types/${relativePath.replace(/\\/g, '/')}`,
                            content: fs.readFileSync(fullPath, 'utf8')
                        });
                    }
                }
            };
            try {
                scanTypes(typesDir);
            } catch (e) {
                console.warn("[API] Failed to scan @types directory:", e.message);
            }
        }

        res.json(typings);
    });

    // GET Content
    router.get('/:filename/content', (req, res) => {
        const filename = req.params.filename;
        let fullPath;

        // Typdefinitionen (.d.ts) können im .storage Ordner (für dynamische Typen)
        // oder im core/types Ordner (für statische ha-api.d.ts) liegen.
        if (filename.endsWith('.d.ts')) {
            let storagePath = path.join(STORAGE_DIR, filename);
            if (fs.existsSync(storagePath)) {
                fullPath = storagePath;
            } else {
                // Check core/types for static ha-api.d.ts
                let coreTypesPath = path.join(__dirname, '../core/types', filename);
                if (fs.existsSync(coreTypesPath)) {
                    fullPath = coreTypesPath;
                }
            }
        } else {
            fullPath = getFilePath(filename);
        }
        
        if (!fullPath) return res.status(404).json({error: "File not found"});
        
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            res.json({ content });
        } catch (e) {
            console.error(`[API] File not found: ${fullPath}`);
            res.status(404).json({error: "File not found"});
        }
    });

    // GET Card Preview HTML (renders card in a sandboxed page with mock hass)
    router.get('/:filename/card/preview-html', (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).send('<h1>Script not found</h1>');

        const cardSource = cardManager ? cardManager.getCardSource(fullPath) : null;
        if (!cardSource) return res.status(404).send('<h1>No __JSA_CARD__ block found in this script</h1>');

        const scriptName = filename.replace(/\.[^.]+$/, '');
        const safeCardSource = cardSource.replace(/<\/script>/gi, '<\\/script>');
        const safeScriptName = JSON.stringify(scriptName);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview — ${scriptName}</title>
  <style>
    :root {
      --primary-color: #03a9f4;
      --accent-color: #ff9800;
      --primary-text-color: #e0e0e0;
      --secondary-text-color: #9e9e9e;
      --card-background-color: #2c2c2c;
      --ha-card-background: var(--card-background-color);
      --divider-color: #383838;
      --error-color: #db4437;
      --success-color: #43a047;
      --primary-background-color: #181818;
      --secondary-background-color: #252535;
      --state-icon-color: var(--primary-text-color);
    }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 12px; background: var(--primary-background-color); color: var(--primary-text-color); font-family: Roboto, 'Helvetica Neue', sans-serif; min-height: 100%; }
    #card-container { max-width: 100%; width: 100%; }
    ha-card { display: block; }
  </style>
</head>
<body>
  <div id="card-container"></div>
  <script>
    // ── HA web component stubs ──────────────────────────────────────────────
    ['ha-card', 'state-badge', 'ha-state-icon'].forEach(tag => {
      if (!customElements.get(tag)) {
        customElements.define(tag, class extends HTMLElement {
          connectedCallback() {
            if (tag === 'ha-card')
              this.style.cssText = 'display:block;border-radius:12px;overflow:hidden;background:var(--card-background-color,#2c2c2c);box-shadow:0 2px 8px rgba(0,0,0,.5);';
          }
          set header(v) { this.setAttribute('header', v); }
        });
      }
    });
    if (!customElements.get('ha-icon')) {
      customElements.define('ha-icon', class extends HTMLElement {
        // Observe both 'icon' and 'style' so _r() fires when the HTML parser sets the
        // style attribute after icon (avoiding a render with wrong defaults).
        static get observedAttributes() { return ['icon', 'style']; }
        set icon(v) { this.setAttribute('icon', v); }
        get icon() { return this.getAttribute('icon'); }
        attributeChangedCallback() { this._r(); }
        connectedCallback() { this._r(); }
        _r() {
          // Guard prevents re-entrancy: this.style.X assignments trigger attributeChangedCallback
          // for 'style', which would call _r() again while we're still inside it.
          if (this._rg) return;
          this._rg = true;
          try {
            const s = this.getAttribute('style') || '';
            const sm = s.match(/width\s*:\s*(\d+)/) || s.match(/--mdi-icon-size\s*:\s*(\d+)/);
            const sz = sm ? parseInt(sm[1]) : 40;
            const cm = s.match(/--icon-primary-color\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[^;]*)/) ||
                       s.match(/(?<![a-z-])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[^;]*)/);
            const col = cm ? cm[1].trim() : '#607d8b';
            const abbr = (this.getAttribute('icon') || '').replace(/^mdi:/, '').replace(/-/g, ' ')
              .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
            this.style.display = 'inline-flex';
            this.style.alignItems = 'center';
            this.style.justifyContent = 'center';
            this.style.width = sz + 'px';
            this.style.height = sz + 'px';
            this.style.borderRadius = '50%';
            this.style.background = col;
            this.style.flexShrink = '0';
            this.style.boxSizing = 'border-box';
            this.innerHTML = '<span style="color:#fff;font-size:' + Math.round(sz * 0.42) + 'px;' +
              'font-weight:700;line-height:1;pointer-events:none">' + abbr + '</span>';
          } finally {
            this._rg = false;
          }
        }
      });
    }

    // ── Intercept customElements.define to capture the card tag ────────────
    let _registeredTag = null;
    const _origDefine = customElements.define.bind(customElements);
    customElements.define = function(name, cls, opts) {
      if (!_registeredTag) _registeredTag = name; // first definition = the card
      _origDefine(name, cls, opts);
    };

    // ── Mock hass ───────────────────────────────────────────────────────────
    let _mockStates = {};
    const mockHass = {
      get states() { return _mockStates; },
      locale: { language: 'en', number_format: 'language', time_format: '24' },
      config: { unit_system: { temperature: '°C', length: 'km', mass: 'kg', pressure: 'hPa', volume: 'L' }, language: 'en' },
      themes: { darkMode: true },
      user: { is_admin: true, name: 'Developer' },
      callService: (domain, service, data) => { console.log('[preview] callService', domain, service, data); },
      callWS: () => Promise.resolve({}),
      connection: {
        subscribeMessage: () => () => {},
        sendMessagePromise: () => Promise.resolve({}),
      },
      formatEntityState: (s) => s?.state ?? '',
      formatEntityAttributeName: (a) => a,
      formatEntityAttributeValue: (v) => String(v ?? ''),
    };

    // ── Error forwarding ────────────────────────────────────────────────────
    window.onerror = (message, source, lineno, colno, error) => {
      parent.postMessage({ type: 'jsa-card-error', scriptName: ${safeScriptName}, message, lineno }, '*');
      return false;
    };
    window.addEventListener('unhandledrejection', e => {
      parent.postMessage({ type: 'jsa-card-error', scriptName: ${safeScriptName}, message: e.reason?.message ?? String(e.reason) }, '*');
    });

    // ── hass injection from preview panel ───────────────────────────────────
    function _updateCardHass() {
      const el = document.querySelector('#card-container > *');
      if (el && 'hass' in el) el.hass = { ...mockHass };
    }

    // ── Editor modal (opened via jsa-open-editor postMessage) ───────────────
    let _editorModal = null;
    function _openEditorModal() {
      const editorTag = (_registeredTag || (${safeScriptName} + '-card')) + '-editor';
      if (!customElements.get(editorTag)) {
        parent.postMessage({ type: 'jsa-card-error', scriptName: ${safeScriptName}, message: 'No card editor element registered (' + editorTag + '). Does the card define a *-editor custom element?', lineno: 0 }, '*');
        return;
      }
      // Tear down previous modal so _init() runs fresh (picks up latest config)
      if (_editorModal) { _editorModal.remove(); _editorModal = null; }

      _editorModal = document.createElement('div');
      _editorModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;';

      const box = document.createElement('div');
      box.style.cssText = 'background:var(--card-background-color,#2c2c2c);border-radius:12px;min-width:300px;max-width:460px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--divider-color,#383838);display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:.95em;';
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--primary-text-color,#e0e0e0);font-size:1.1em;padding:0 4px;';
      closeBtn.onclick = () => { _editorModal.remove(); _editorModal = null; };
      hdr.appendChild(Object.assign(document.createElement('span'), { textContent: 'Configure Card' }));
      hdr.appendChild(closeBtn);

      const editorEl = document.createElement(editorTag);
      editorEl.style.display = 'block';
      editorEl.hass = mockHass;
      editorEl.addEventListener('config-changed', (e) => {
        const cfg = e.detail?.config ?? {};
        if (cfg.entityId) {
          const el = document.querySelector('#card-container > *');
          if (el && typeof el.setConfig === 'function') {
            try { el.setConfig(cfg); } catch(_) {}
          }
        }
        _updateCardHass();
        parent.postMessage({ type: 'jsa-action-done', scriptId: ${safeScriptName}, config: cfg }, '*');
      });
      editorEl.addEventListener('jsa-editor-close', () => {
        if (_editorModal) { _editorModal.remove(); _editorModal = null; }
        parent.postMessage({ type: 'jsa-action-done', scriptId: ${safeScriptName} }, '*');
      });

      box.appendChild(hdr);
      box.appendChild(editorEl);
      _editorModal.appendChild(box);
      document.body.appendChild(_editorModal);
      _editorModal.addEventListener('click', e => { if (e.target === _editorModal) { _editorModal.remove(); _editorModal = null; } });
    }

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'jsa-set-hass') {
        _mockStates = e.data.states ?? {};
        _updateCardHass();
      }
      if (e.data?.type === 'jsa-set-config') {
        const el = document.querySelector('#card-container > *');
        if (el && typeof el.setConfig === 'function') {
          try { el.setConfig(e.data.config ?? {}); } catch(err) {
            parent.postMessage({ type: 'jsa-card-error', scriptName: ${safeScriptName}, message: err.message, lineno: 0 }, '*');
          }
        }
      }
      if (e.data?.type === 'jsa-open-editor') _openEditorModal();
    });

    // ── Mock __jsa__ (preview: routes callAction via JSA HTTP API, no HA event bus needed) ──
    const _jsaApiBase = window.location.pathname.split('/api/scripts')[0] + '/';
    const __jsa__ = {
      scriptId: ${safeScriptName},
      connect(hass) { /* preview: no-op */ },
      updateConfig(config) { /* preview: no-op */ },
      ready() { return Promise.resolve(); },
      wizard(hostEl, opts) {
        const sr = hostEl.shadowRoot;
        if (!sr) return;
        const steps = opts.steps || [];
        let stepIdx = 0;
        const values = {};
        const cache = {};
        const CSS = '<style>:host{display:block}.wiz{padding:16px;font-family:inherit}.wiz-title{font-weight:600;margin-bottom:12px;font-size:.95em}select,.wiz-inp{font-family:inherit;padding:8px 12px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);width:100%;box-sizing:border-box;margin-bottom:10px;font-size:1em}.wiz-btns{display:flex;gap:8px;margin-top:4px}.btn-p{background:var(--primary-color);color:#fff;border:none;border-radius:8px;padding:10px 20px;cursor:pointer;font-weight:600;font-size:.95em}.btn-s{background:transparent;border:1px solid var(--divider-color);border-radius:8px;padding:10px 16px;cursor:pointer;color:var(--primary-text-color);font-size:.95em}.wiz-note{font-size:.82em;color:var(--secondary-text-color);margin-bottom:10px;display:flex;align-items:center;gap:6px}.wiz-inp-sm{width:88px !important;display:inline-block !important;margin:0 !important}.wiz-err{color:var(--error-color,#f44336);padding:16px}.wiz-spin{padding:20px;text-align:center;color:var(--secondary-text-color)}</style>';
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
          if (step.depends) { for (const [k, v] of Object.entries(step.depends)) depPayload[k] = values[v]; }
          const cacheKey = step.action + JSON.stringify(depPayload);
          let data;
          if (cache[cacheKey]) { data = cache[cacheKey]; } else {
            try { data = await __jsa__.callAction(step.action, depPayload); cache[cacheKey] = data; }
            catch (e) { show('<div class="wiz-err">\u26a0 ' + esc(e.message) + '<br><small>Skript gestartet?</small></div>'); return; }
          }
          if (!data || data.length === 0) {
            show('<div class="wiz"><div class="wiz-err">\u26a0 Keine Eintr\u00e4ge gefunden. Saison oder Liga pr\u00fcfen.</div>' +
              (stepIdx > 0 ? '<div class="wiz-btns"><button class="btn-s" id="wiz-back">Zur\u00fcck</button></div>' : '') + '</div>');
            var backEl2 = sr.querySelector('#wiz-back');
            if (backEl2) backEl2.onclick = function() { stepIdx--; loadStep(); };
            return;
          }
          const isLast = stepIdx === steps.length - 1;
          const season = values.season != null ? values.season : season0();
          const optsHtml = (data || []).map(function(item) { return '<option value="' + esc(item[step.valueKey]) + '">' + esc(item[step.labelKey]) + '</option>'; }).join('');
          const seasonHtml = step.seasonField ? '<div class="wiz-note">Saison <input class="wiz-inp wiz-inp-sm" id="wiz-season" type="number" value="' + season + '" min="2000" max="2100"></div>' : '';
          const freeInputHtml = step.freeInput ? '<div class="wiz-note">Eigene Liga-ID <input class="wiz-inp" id="wiz-free" type="text" placeholder="z.B. WM2026" autocomplete="off"></div>' : '';
          show('<div class="wiz"><div class="wiz-title">Schritt ' + (stepIdx + 1) + ' / ' + steps.length + ': ' + esc(step.label) + '</div>' +
            '<select id="wiz-sel"><option value="">Bitte w\u00e4hlen\u2026</option>' + optsHtml + '</select>' +
            seasonHtml + freeInputHtml +
            '<div class="wiz-btns"><button class="btn-p" id="wiz-next">' + (isLast ? 'Speichern' : 'Weiter') + '</button>' +
            (stepIdx > 0 ? '<button class="btn-s" id="wiz-back">Zur\u00fcck</button>' : '') + '</div></div>');
          var freeEl = sr.querySelector('#wiz-free');
          var selEl  = sr.querySelector('#wiz-sel');
          if (freeEl) { freeEl.oninput = function() { if (freeEl.value) selEl.value = ''; }; selEl.onchange = function() { if (selEl.value) freeEl.value = ''; }; }
          sr.querySelector('#wiz-next').onclick = async function() {
            var freeVal = freeEl ? freeEl.value.trim() : '';
            var raw = freeVal || selEl.value;
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
            hostEl.dispatchEvent(new CustomEvent('config-changed', { detail: { config: Object.assign({ type: baseType }, config) }, bubbles: true, composed: true }));
            hostEl.dispatchEvent(new CustomEvent('jsa-editor-close', { bubbles: true, composed: true }));
          } catch (e) { show('<div class="wiz-err">\u26a0 ' + esc(e.message) + '</div>'); }
        };
        loadStep();
      },
      callAction(name, payload = {}) {
        const url = _jsaApiBase + 'api/scripts/' + this.scriptId + '/actions/' + encodeURIComponent(name);
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        .then(r => r.json())
        .then(data => {
          if (!data.ok) throw new Error(data.error ?? 'Action failed');
          // Signal the parent to push a fresh hass snapshot so the card re-renders
          parent.postMessage({ type: 'jsa-action-done', scriptId: ${safeScriptName} }, '*');
          return data.result;
        });
      },
    };

    // ── Inject and mount card ───────────────────────────────────────────────
    try {
      ${safeCardSource}
    } catch (err) {
      parent.postMessage({ type: 'jsa-card-error', scriptName: ${safeScriptName}, message: err.message, lineno: 0 }, '*');
    }

    (function mountCard() {
      const tagName = _registeredTag || (${safeScriptName} + '-card');
      const container = document.getElementById('card-container');

      // Default config — card receives entity_id from the start, no postMessage needed
      const _defaultConfig = { entity_id: 'sensor.' + ${safeScriptName}.replace(/-/g, '_') };

      const tryMount = () => {
        if (!customElements.get(tagName)) return false;
        const el = document.createElement(tagName);
        try { if (typeof el.setConfig === 'function') el.setConfig(_defaultConfig); } catch(e) {}
        container.appendChild(el);
        el.hass = mockHass;
        parent.postMessage({ type: 'jsa-card-loaded', scriptName: ${safeScriptName} }, '*');
        return true;
      };

      if (!tryMount()) {
        customElements.whenDefined(tagName).then(() => {
          tryMount();
        });
        setTimeout(() => {
          if (!container.firstChild) {
            container.innerHTML = '<p style="color:#666;padding:16px;font-size:0.85rem;">Card element <code>' + tagName + '</code> not registered.<br>Make sure your card calls <code>customElements.define()</code>.</p>';
          }
        }, 2500);
      }
    })();
  </script>
</body>
</html>`);
    });

    // GET Card Source (decoded from __JSA_CARD__ block)
    router.get('/:filename/card', (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        const source = cardManager ? cardManager.getCardSource(fullPath) : null;
        // Return empty content (isNew: true) when no block exists yet — frontend opens a blank card tab
        res.json({ content: source ?? '', isNew: !source });
    });

    // PUT Card Source (re-encodes as Base64 and embeds back into the script file)
    router.put('/:filename/card', (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        const { content } = req.body;
        if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });

        let scriptSource = fs.readFileSync(fullPath, 'utf8');
        const base64 = Buffer.from(content, 'utf8').toString('base64');
        const newBlock = `/* __JSA_CARD__\n${base64}\n__JSA_CARD_END__ */`;

        const cardBlockRegex = /\/\* __JSA_CARD__[\s\S]*?__JSA_CARD_END__ \*\//;
        if (cardBlockRegex.test(scriptSource)) {
            scriptSource = scriptSource.replace(cardBlockRegex, newBlock);
        } else {
            // No block yet — append to end of script (first save from card editor)
            scriptSource = scriptSource.trimEnd() + '\n\n' + newBlock + '\n';
        }
        fs.writeFileSync(fullPath, scriptSource, 'utf8');
        res.json({ ok: true });
    });

    // POST Card Action (preview: calls ha.action() on running script directly, bypassing HA event bus)
    router.post('/:filename/actions/:action', async (req, res) => {
        const { filename, action } = req.params;
        const payload = req.body ?? {};
        // Accept name with or without extension
        const normalizedFilename = filename.includes('.') ? filename : filename + '.js';
        try {
            const result = await workerManager.callAction(normalizedFilename, action, payload);
            res.json({ ok: true, result: result ?? null });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET Download
    router.get('/:filename/download', (req, res) => {
        const { filename } = req.params;

        // Sicherheitsprüfung: Verhindere Path Traversal
        if (!filename || filename.includes('..') || filename.includes('/')) {
            return res.status(400).send('Invalid filename.');
        }
        const filePath = getFilePath(filename);
        if (filePath) {
            res.download(filePath, filename, (err) => {
                if (err) console.error(`[API] Error downloading script ${filename}:`, err);
            });
        } else {
            res.status(404).send('Script not found.');
        }
    });

    // POST Content (Save)
    router.post('/:filename/content', async (req, res) => {
        const filename = req.params.filename;
        const fullPath = getFilePath(filename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        fs.writeFileSync(fullPath, req.body.content, 'utf8');
        
        const meta = ScriptHeaderParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);

        if (workerManager.workers.has(filename)) {
            workerManager.stopScript(filename, 'hot-reload');
            setTimeout(async () => {
                workerManager.startScript(fullPath);
                io.emit('status_update');
            }, 500);
        } else {
            depManager.prune();
        }
        io.emit('status_update'); 
        res.json({ ok: true });
    });

    // POST Upload (File)
    router.post('/upload', upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        
        const { type, name } = req.body; // 'automation' oder 'library', optional 'name'
        const originalExt = path.extname(req.file.originalname) || '.js';
        
        // Dateinamen bereinigen (gleiche Logik wie bei Create)
        let filename;
        if (name && name.trim()) {
            filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + originalExt;
        } else {
            filename = path.parse(req.file.originalname).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + originalExt;
        }
        
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const fullPath = path.join(targetDir, filename);

        if (fs.existsSync(fullPath)) {
            return res.status(400).json({ error: `File '${filename}' already exists.` });
        }

        fs.writeFileSync(fullPath, req.file.buffer, 'utf8');
        res.json({ filename });
    });

    // POST Preview (raw source → capability analysis, no file written)
    router.post('/preview', (req, res) => {
        const { source } = req.body;
        if (typeof source !== 'string') return res.status(400).json({ error: 'source required' });
        try {
            const meta = ScriptHeaderParser._parseSource(source);
            const { detected } = CapabilityAnalyzer.analyze(source);
            const declared = meta.permissions || [];
            const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
            res.json({ name: meta.name, description: meta.description, permissions: declared, capabilities: { detected, declared, undeclared, unused } });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST Import (URL/Gist)
    router.post('/import', async (req, res) => {
        const { url, type, name, dryRun } = req.body;
        try {
            const response = await axios.get(url, { responseType: 'text' });
            const code = response.data;
            const urlExt = path.extname(url.split('?')[0]) || '.js';

            // Dateinamen aus URL ableiten und bereinigen
            let filename;
            if (name && name.trim()) {
                filename = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + urlExt;
            } else {
                filename = path.parse(path.basename(url).split('?')[0]).name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + urlExt;
            }

            // Dry-run: analyse and return preview without writing
            if (dryRun) {
                const meta = ScriptHeaderParser._parseSource(code);
                const { detected } = CapabilityAnalyzer.analyze(code);
                const declared = meta.permissions || [];
                const { undeclared, unused } = CapabilityAnalyzer.diff(declared, detected);
                return res.json({ filename, name: meta.name, description: meta.description, permissions: declared, capabilities: { detected, declared, undeclared, unused } });
            }

            const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
            const fullPath = path.join(targetDir, filename);

            if (fs.existsSync(fullPath)) {
                return res.status(400).json({ error: `File '${filename}' already exists.` });
            }

            fs.writeFileSync(fullPath, code, 'utf8');
            res.json({ filename });
        } catch (e) {
            res.status(400).json({ error: "Import failed: " + e.message });
        }
    });

    // POST Create
    router.post('/', async (req, res) => {
        const { name, type, code, extension = '.js' } = req.body;
        const ext = extension.startsWith('.') ? extension : `.${extension}`;
        const filename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + ext;
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const fullPath = path.join(targetDir, filename);
        
        // 1. Create file with initial code
        fs.writeFileSync(fullPath, code || 'ha.log("Ready.");\n', 'utf8');
        
        // 2. Use the central parser to write the metadata header
        ScriptHeaderParser.updateMetadata(fullPath, req.body);

        res.json({ filename });
    });

    // PUT Update Metadata (Header only)
    router.put('/:filename/metadata', async (req, res) => {
        const oldFilename = req.params.filename;
        const { name, type, icon, description, area, label, loglevel, npmModules, includes, extension } = req.body;
        
        let fullPath = getFilePath(oldFilename);
        if (!fullPath) return res.status(404).json({ error: 'File not found' });

        // 1. Calculate new filename & path
        const ext = extension || path.extname(oldFilename);
        const newFilename = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + ext;
        const targetDir = (type === 'library') ? LIBRARIES_DIR : SCRIPTS_DIR;
        const newFullPath = path.join(targetDir, newFilename);
        
        // Check if target exists (only if path actually changes)
        if (newFullPath !== fullPath && fs.existsSync(newFullPath)) {
            return res.status(400).json({ error: `File '${newFilename}' already exists.` });
        }

        // 2. Detect Rename & Library Status
        const wasLibrary = path.dirname(fullPath) === LIBRARIES_DIR;
        const isRenaming = oldFilename !== newFilename;

        // 3. Move/Rename File
        if (newFullPath !== fullPath) {
            if (workerManager.workers.has(oldFilename)) {
                workerManager.stopScript(oldFilename, 'renaming/moving');
            }
            fs.renameSync(fullPath, newFullPath);
            fullPath = newFullPath; // Update path for subsequent write
        }

        // Use Parser to update metadata (handles @expose and formatting centrally)
        // Preserve @permission and @card tags — they are edited in source, not via the metadata form
        const existingMeta = ScriptHeaderParser.parse(fullPath);
        ScriptHeaderParser.updateMetadata(fullPath, { ...req.body, permissions: existingMeta.permissions, card: existingMeta.card });
        
        // 5. REFACTORING: Update consumers
        let updatedConsumers = 0;
        if (wasLibrary && isRenaming) {
            const allFiles = [];
            if (fs.existsSync(SCRIPTS_DIR)) fs.readdirSync(SCRIPTS_DIR).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')).forEach(f => allFiles.push(path.join(SCRIPTS_DIR, f)));
            if (fs.existsSync(LIBRARIES_DIR)) fs.readdirSync(LIBRARIES_DIR).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')).forEach(f => allFiles.push(path.join(LIBRARIES_DIR, f)));

            for (const file of allFiles) {
                if (file === fullPath) continue; // Skip self

                let cContent = fs.readFileSync(file, 'utf8');
                let changed = false;
                
                // Regex to find @include line(s)
                cContent = cContent.replace(/^(\s*\*\s*@include\s+)(.*)$/gm, (match, prefix, args) => {
                    const parts = args.split(/[\s,]+/).filter(p => p.trim().length > 0);
                    const newParts = parts.map(p => {
                        // Check exact match or without .js
                        if (p === oldFilename || p === oldFilename.replace(/\.js$/, '')) {
                            changed = true;
                            return newFilename; 
                        }
                        return p;
                    });
                    if (changed) {
                        return prefix + newParts.join(', ');
                    }
                    return match;
                });

                if (changed) {
                    fs.writeFileSync(file, cContent, 'utf8');
                    updatedConsumers++;
                    const cFilename = path.basename(file);
                    // Restart consumer if running
                    if (workerManager.workers.has(cFilename)) {
                        workerManager.stopScript(cFilename, 'library update');
                        setTimeout(() => workerManager.startScript(file), 500);
                    }
                }
            }
        }

        const meta = ScriptHeaderParser.parse(fullPath);
        if (meta.dependencies.length > 0) await depManager.install(meta.dependencies);
        depManager.prune();
        io.emit('status_update');
        
        res.json({ ok: true, filename: newFilename, updatedConsumers });
    });

    return router;
};