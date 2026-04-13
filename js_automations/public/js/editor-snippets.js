/**
 * JS AUTOMATIONS - Editor Snippets
 *
 * Single source of truth for all editor snippets.
 * Drives: toolbar buttons, context menu actions, Shift+Enter / Ctrl+Shift+Enter keybindings.
 *
 * Shift+Enter       → full snippet (all options, labelled tab stops)
 * Ctrl+Shift+Enter  → minimal snippet (required params only)
 *
 * For ha.register: domain is auto-detected from context text.
 * When unknown a small floating picker lets the user choose.
 */

'use strict';

// ---------------------------------------------------------------------------
// SNIPPET REGISTRY
// ---------------------------------------------------------------------------
// Each entry:
//   id            – unique key (matches legacy insertCodeSnippet type)
//   icon          – MDI class (without 'mdi ' prefix)
//   labelKey      – i18next translation key
//   toolbarGroup  – 'general' | 'entity' | 'store' | false (hidden from toolbar)
//   contextMenu   – { group, order } | false
//   triggers      – array of ha.* expressions that activate Shift+Enter
//   full          – full snippet template (null → use variants)
//   minimal       – minimal snippet template (always non-null)
//   variants      – optional { domainName: template } for ha.register
// ---------------------------------------------------------------------------

const SNIPPET_REGISTRY = [

    // ── General ─────────────────────────────────────────────────────────────

    {
        id: 'log',
        icon: 'mdi-console',
        labelKey: 'snippet_log',
        toolbarGroup: 'general',
        contextMenu: { group: '90_snippets_general', order: 1 },
        triggers: ['ha.log', 'ha.debug', 'ha.warn', 'ha.error'],
        full:    "ha.log(${1:'Message'});\n$0",
        minimal: "ha.log(${1:'Message'});\n$0",
    },
    {
        id: 'service',
        icon: 'mdi-flash',
        labelKey: 'snippet_service',
        toolbarGroup: 'general',
        contextMenu: { group: '90_snippets_general', order: 2 },
        triggers: ['ha.call', 'ha.callService'],
        full:    "ha.call('${1:domain.service}', {\n\tentity_id: '${2:entity.id}',\n\t${3:// data}\n});\n$0",
        minimal: "ha.call('${1:domain.service}');\n$0",
    },
    {
        id: 'listener',
        icon: 'mdi-ear-hearing',
        labelKey: 'snippet_listener',
        toolbarGroup: 'general',
        contextMenu: { group: '90_snippets_general', order: 3 },
        triggers: ['ha.on'],
        full:    "ha.on('${1:entity_id}', (e) => {\n\tha.log(e.state);\n\t${2:// code}\n});\n$0",
        minimal: "ha.on('${1:entity_id}', (e) => {\n\t$2\n});\n$0",
    },
    {
        id: 'listener_array',
        icon: 'mdi-playlist-plus',
        labelKey: 'snippet_listener_array',
        toolbarGroup: 'general',
        contextMenu: false,
        triggers: [],
        full:    "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t${3:// code}\n});\n$0",
        minimal: "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t$2\n});\n$0",
    },
    {
        id: 'on_stop',
        icon: 'mdi-stop-circle-outline',
        labelKey: 'snippet_on_stop',
        toolbarGroup: 'general',
        contextMenu: false,
        triggers: ['ha.onStop'],
        full:    "ha.onStop(() => {\n\t${1:// cleanup code}\n});\n$0",
        minimal: "ha.onStop(() => {\n\t$1\n});\n$0",
    },

    // ── Notifications ────────────────────────────────────────────────────────

    {
        id: 'notify',
        icon: 'mdi-bell',
        labelKey: 'snippet_notify',
        toolbarGroup: 'general',
        contextMenu: { group: '90_snippets_general', order: 4 },
        triggers: ['ha.notify'],
        full:    "ha.notify('${1:Message}', {\n\ttitle: '${2:Title}',\n\tpersistent: ${3|false,true|},\n\ttarget: '${4:notify.notify}',\n\tdata: { $5 }\n});\n$0",
        minimal: "ha.notify('${1:Message}');\n$0",
    },
    {
        id: 'ask',
        icon: 'mdi-message-question',
        labelKey: 'snippet_ask',
        toolbarGroup: 'general',
        contextMenu: { group: '90_snippets_general', order: 5 },
        triggers: ['ha.ask'],
        full: [
            "const \${1:action} = await ha.ask('\${2:Message}', {",
            "\ttitle: '\${3:Title}',",
            "\ttarget: '\${4:notify.notify}',",
            "\ttimeout: \${5:60000},",
            "\tdefaultAction: \${6:null},",
            "\tactions: [",
            "\t\t{ action: '\${7:YES}', title: '\${8:Yes}' },",
            "\t\t{ action: '\${9:NO}',  title: '\${10:No}' },",
            "\t],",
            "});",
            "$0",
        ].join('\n'),
        minimal: "const ${1:action} = await ha.ask('${2:Message}', {\n\tactions: [\n\t\t{ action: '${3:YES}', title: '${4:Yes}' },\n\t],\n});\n$0",
    },

    // ── Entity ───────────────────────────────────────────────────────────────

    {
        id: 'register',
        icon: 'mdi-shape-square-plus',
        labelKey: 'snippet_register',
        toolbarGroup: 'entity',
        contextMenu: { group: '91_snippets_state', order: 0 },
        triggers: ['ha.register'],
        // full is resolved via variants; minimal uses a choice tab stop
        full: null,
        minimal: "ha.register('${1|sensor,switch,select,number,text,button|}.${2:my_entity}', {\n\tname: '${3:Name}',\n\ticon: '${4:mdi:eye}',\n});\n$0",
        variants: {
            sensor: [
                "ha.register('sensor.\${1:my_sensor}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:thermometer}',",
                "\tunit: '\${4:°C}',",
                "\tdevice_class: '\${5:temperature}',",
                "\tstate_class: '\${6:measurement}',",
                "\tinitial_state: \${7:0},",
                "\tentity_category: '\${8|diagnostic,config|}',",
                "});\n$0",
            ].join('\n'),
            switch: [
                "ha.register('switch.\${1:my_switch}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:toggle-switch}',",
                "});\n$0",
            ].join('\n'),
            select: [
                "ha.register('select.\${1:my_select}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:format-list-bulleted}',",
                "\toptions: ['\${4:option1}', '\${5:option2}'],",
                "\tentity_category: '\${6|diagnostic,config|}',",
                "});\n$0",
            ].join('\n'),
            number: [
                "ha.register('number.\${1:my_number}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:numeric}',",
                "\tunit: '\${4}',",
                "\tmin: \${5:0},",
                "\tmax: \${6:100},",
                "\tstep: \${7:1},",
                "\tmode: '\${8|auto,box,slider|}',",
                "\tentity_category: '\${9|diagnostic,config|}',",
                "});\n$0",
            ].join('\n'),
            text: [
                "ha.register('text.\${1:my_text}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:form-textbox}',",
                "});\n$0",
            ].join('\n'),
            button: [
                "ha.register('button.\${1:my_button}', {",
                "\tname: '\${2:Name}',",
                "\ticon: '\${3:mdi:gesture-tap-button}',",
                "});\n$0",
            ].join('\n'),
        },
    },
    {
        id: 'update_state',
        icon: 'mdi-import',
        labelKey: 'snippet_update_state',
        toolbarGroup: 'entity',
        contextMenu: { group: '91_snippets_state', order: 2 },
        triggers: ['ha.update'],
        full:    "ha.update('${1:sensor.my_sensor}', '${2:state_value}', {\n\ticon: '${3:mdi:eye}',\n\t${4:// other attributes}\n});\n$0",
        minimal: "ha.update('${1:entity_id}', '${2:value}');\n$0",
    },
    {
        id: 'state',
        icon: 'mdi-export',
        labelKey: 'snippet_state',
        toolbarGroup: 'entity',
        contextMenu: { group: '91_snippets_state', order: 1 },
        triggers: ['ha.getState', 'ha.getAttr', 'ha.getStateValue', 'ha.states'],
        full:    "ha.getState('${1:entity_id}')$0",
        minimal: "ha.getState('${1:entity_id}')$0",
    },
    {
        id: 'select',
        icon: 'mdi-checkbox-multiple-marked',
        labelKey: 'snippet_select',
        toolbarGroup: 'entity',
        contextMenu: false,
        triggers: ['ha.select'],
        full:    "ha.select('${1:light.*}')\n\t.${2|turnOn,turnOff,toggle|}();\n$0",
        minimal: "ha.select('${1:light.*}')$0",
    },

    // ── Store ────────────────────────────────────────────────────────────────

    {
        id: 'store_set',
        icon: 'mdi-database-import',
        labelKey: 'snippet_store_set',
        toolbarGroup: 'store',
        contextMenu: { group: '92_snippets_store', order: 1 },
        triggers: ['ha.store.set'],
        full:    "ha.store.set('${1:key}', ${2:value});\n$0",
        minimal: "ha.store.set('${1:key}', ${2:value});\n$0",
    },
    {
        id: 'store_get',
        icon: 'mdi-database-export',
        labelKey: 'snippet_store_get',
        toolbarGroup: 'store',
        contextMenu: { group: '92_snippets_store', order: 2 },
        triggers: ['ha.store.get'],
        full:    "const ${1:val} = ha.store.get('${2:key}');\n$0",
        minimal: "const ${1:val} = ha.store.get('${2:key}');\n$0",
    },
    {
        id: 'store_del',
        icon: 'mdi-database-remove',
        labelKey: 'snippet_store_del',
        toolbarGroup: 'store',
        contextMenu: { group: '92_snippets_store', order: 3 },
        triggers: ['ha.store.delete'],
        full:    "ha.store.delete('${1:key}');\n$0",
        minimal: "ha.store.delete('${1:key}');\n$0",
    },

    // ── Card ─────────────────────────────────────────────────────────────────

    {
        id: 'card_litelement',
        icon: 'mdi-view-dashboard-outline',
        labelKey: 'snippet_card_litelement',
        toolbarGroup: 'card',
        contextMenu: false,
        triggers: [],
        full: [
            "class \${1:MyCard} extends HTMLElement {",
            "  constructor() {",
            "    super();",
            "    this.attachShadow({ mode: 'open' });",
            "  }",
            "",
            "  setConfig(config) {",
            "    this._config = config;",
            "    this.render();",
            "  }",
            "",
            "  set hass(hass) {",
            "    this._hass = hass;",
            "    this.render();",
            "  }",
            "",
            "  render() {",
            "    this.shadowRoot.innerHTML = \`",
            "      <style>",
            "        ha-card { padding: 16px; }",
            "      </style>",
            "      <ha-card>",
            "        <div>\\\${this._config?.title ?? 'My Card'}</div>",
            "      </ha-card>",
            "    \`;",
            "  }",
            "",
            "  getCardSize() { return 1; }",
            "}",
            "",
            "customElements.define('\${2:my-jsa-card}', \${1:MyCard});",
            "$0",
        ].join('\n'),
        minimal: "class ${1:MyCard} extends HTMLElement {\n  setConfig(c) { this._config = c; }\n  set hass(h) { this._hass = h; }\n  getCardSize() { return 1; }\n}\ncustomElements.define('${2:my-jsa-card}', ${1:MyCard});\n$0",
    },
    {
        id: 'card_call_action',
        icon: 'mdi-lightning-bolt',
        labelKey: 'snippet_card_call_action',
        toolbarGroup: 'card',
        contextMenu: false,
        triggers: ['__jsa__.callAction'],
        full: [
            "const result = await __jsa__.callAction('\${1:action-name}', {",
            "  \${2:// payload}",
            "});",
            "$0",
        ].join('\n'),
        minimal: "const result = await __jsa__.callAction('${1:action-name}');\n$0",
    },
    {
        id: 'card_config_changed',
        icon: 'mdi-cog-outline',
        labelKey: 'snippet_card_config_changed',
        toolbarGroup: 'card',
        contextMenu: false,
        triggers: [],
        full: [
            "this.dispatchEvent(new CustomEvent('config-changed', {",
            "  bubbles: true,",
            "  composed: true,",
            "  detail: { config: { ...this._config, \${1:key}: \${2:value} } },",
            "}));",
            "$0",
        ].join('\n'),
        minimal: "this.dispatchEvent(new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config: { ...this._config } } }));\n$0",
    },
    {
        id: 'card_ha_vars',
        icon: 'mdi-palette-outline',
        labelKey: 'snippet_card_ha_vars',
        toolbarGroup: 'card',
        contextMenu: false,
        triggers: [],
        full: [
            "/* HA Theme Variables */",
            "/* --primary-color         -- accent / brand color */",
            "/* --primary-text-color    -- main text */",
            "/* --secondary-text-color  -- muted text */",
            "/* --card-background-color -- card surface */",
            "/* --divider-color         -- borders / dividers */",
            "/* --error-color           -- error / danger */",
            "/* --success-color         -- success / OK */",
            "$0",
        ].join('\n'),
        minimal: "/* --primary-color, --primary-text-color, --card-background-color */\n$0",
    },
    {
        id: 'card_wizard',
        icon: 'mdi-wizard-hat',
        labelKey: 'snippet_card_wizard',
        toolbarGroup: 'card',
        contextMenu: false,
        triggers: [],
        // Two-step setup wizard: card detects unconfigured state, fetches live data via
        // __jsa__.callAction(), presents step-by-step selection, fires config-changed on completion.
        full: [
            "class \${1:MyWizardCard} extends HTMLElement {",
            "  constructor() {",
            "    super();",
            "    this.attachShadow({ mode: 'open' });",
            "    this._step = 1;",
            "    this._step1Items = null;",
            "    this._step2Items = null;",
            "    this._selected1 = null;",
            "    this._query = '';",
            "    this._loading = false;",
            "    this._error = null;",
            "  }",
            "",
            "  setConfig(config) {",
            "    this._config = config;",
            "    const configured = Boolean(config?.\${3:item_id});",
            "    this._mode = configured ? 'display' : 'setup';",
            "    if (!configured && !this._step1Items) this._loadStep1();",
            "    this._render();",
            "  }",
            "",
            "  set hass(hass) {",
            "    this._hass = hass;",
            "    __jsa__.connect(hass);",
            "    this._render();",
            "  }",
            "",
            "  // ── Wizard step 1 ──────────────────────────────────────────────────────",
            "",
            "  async _loadStep1() {",
            "    this._loading = true; this._error = null; this._render();",
            "    try {",
            "      this._step1Items = await __jsa__.callAction('\${4:wizard/step1}');",
            "    } catch (e) {",
            "      this._error = e.message;",
            "    }",
            "    this._loading = false; this._render();",
            "  }",
            "",
            "  async _selectStep1(item) {",
            "    this._selected1 = item;",
            "    this._step = 2; this._step2Items = null; this._query = '';",
            "    this._loading = true; this._render();",
            "    try {",
            "      this._step2Items = await __jsa__.callAction('\${5:wizard/step2}', { id: item.id });",
            "    } catch (e) {",
            "      this._error = e.message;",
            "    }",
            "    this._loading = false; this._render();",
            "  }",
            "",
            "  // ── Wizard step 2 \u2192 finish ──────────────────────────────────────────",
            "",
            "  _finish(item) {",
            "    this.dispatchEvent(new CustomEvent('config-changed', {",
            "      bubbles: true, composed: true,",
            "      detail: {",
            "        config: {",
            "          ...this._config,",
            "          \${6:group_id}: this._selected1.id,",
            "          \${3:item_id}: item.id,",
            "          \${7:item_name}: item.name,",
            "        }",
            "      },",
            "    }));",
            "  }",
            "",
            "  // ── Render ─────────────────────────────────────────────────────────────",
            "",
            "  _render() {",
            "    if (this._mode !== 'display') { this._renderWizard(); return; }",
            "    const state = this._hass?.states?.[this._config?.entity_id];",
            "    this.shadowRoot.innerHTML = '<style>:host{display:block}'",
            "      + 'ha-card{background:var(--card-background-color);border-radius:var(--ha-card-border-radius,12px);padding:20px}'",
            "      + '</style><ha-card>' + (state?.state ?? '\u2013') + '</ha-card>';",
            "  }",
            "",
            "  _renderWizard() {",
            "    const items = this._step === 1 ? this._step1Items : this._step2Items;",
            "    const filtered = items ? items.filter(i => i.name.toLowerCase().includes(this._query.toLowerCase())) : null;",
            "    const stepLabel = this._step === 1 ? 'Select group' : 'Select item';",
            "    let body = '';",
            "    if (this._loading) {",
            "      body = '<div class=\"spinner\">Loading\u2026</div>';",
            "    } else if (this._error) {",
            "      body = '<div class=\"error\">\u26a0 ' + this._error + '</div>';",
            "    } else if (filtered) {",
            "      body = '<input id=\"q\" type=\"text\" placeholder=\"Search\u2026\" value=\"' + this._query + '\" />'",
            "        + '<div class=\"list\">' + filtered.map(i => '<div class=\"item\" data-id=\"' + i.id + '\" data-name=\"' + i.name + '\">' + i.name + '</div>').join('') + '</div>'",
            "        + (this._step === 2 ? '<div class=\"footer\"><button id=\"back\">\u2190 Back</button></div>' : '');",
            "    }",
            "    this.shadowRoot.innerHTML = '<style>'",
            "      + ':host{display:block}'",
            "      + 'ha-card{background:var(--card-background-color);border-radius:var(--ha-card-border-radius,12px);overflow:hidden;padding:20px}'",
            "      + 'h3{margin:0 0 4px;font-size:.95rem;font-weight:600;color:var(--primary-text-color)}'",
            "      + '.step{font-size:.75rem;color:var(--secondary-text-color);margin-bottom:14px}'",
            "      + 'input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--divider-color);border-radius:6px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:.9rem;margin-bottom:10px}'",
            "      + '.list{max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px}'",
            "      + '.item{padding:10px 12px;border-radius:8px;cursor:pointer;font-size:.9rem;color:var(--primary-text-color)}'",
            "      + '.item:hover{background:var(--secondary-background-color)}'",
            "      + '.footer{margin-top:14px}'",
            "      + '#back{padding:8px 16px;background:transparent;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:8px;cursor:pointer;font-size:.85rem}'",
            "      + '.spinner{text-align:center;padding:30px;color:var(--secondary-text-color);font-size:.85rem}'",
            "      + '.error{padding:16px;background:#e74c3c22;border-radius:8px;color:var(--error-color,#e74c3c);font-size:.85rem}'",
            "      + '</style><ha-card>'",
            "      + '<h3>\u2699 Setup</h3>'",
            "      + '<div class=\"step\">Step ' + this._step + ' of 2: ' + stepLabel + '</div>'",
            "      + body + '</ha-card>';",
            "    this.shadowRoot.getElementById('q')?.addEventListener('input', e => { this._query = e.target.value; this._render(); });",
            "    this.shadowRoot.querySelectorAll('.item').forEach(el => {",
            "      el.onclick = () => {",
            "        const item = { id: el.dataset.id, name: el.dataset.name };",
            "        this._step === 1 ? this._selectStep1(item) : this._finish(item);",
            "      };",
            "    });",
            "    this.shadowRoot.getElementById('back')?.addEventListener('click', () => { this._step = 1; this._query = ''; this._render(); });",
            "  }",
            "",
            "  // Reuse wizard actions for live data in the Lovelace card editor",
            "  static getConfigElement() { return document.createElement('\${2:my-wizard-card}-editor'); }",
            "",
            "  getCardSize() { return 3; }",
            "}",
            "",
            "customElements.define('\${2:my-wizard-card}', \${1:MyWizardCard});",
            "$0",
        ].join('\n'),
        minimal: [
            "class \${1:MyWizardCard} extends HTMLElement {",
            "  setConfig(config) {",
            "    this._config = config;",
            "    this._mode = Boolean(config?.\${2:item_id}) ? 'display' : 'setup';",
            "    if (this._mode === 'setup' && !this._items) this._load();",
            "    this._render();",
            "  }",
            "  set hass(hass) { this._hass = hass; __jsa__.connect(hass); this._render(); }",
            "  async _load() {",
            "    try { this._items = await __jsa__.callAction('\${3:wizard/step1}'); }",
            "    catch (e) { this._error = e.message; }",
            "    this._render();",
            "  }",
            "  _finish(item) {",
            "    this.dispatchEvent(new CustomEvent('config-changed', {",
            "      bubbles: true, composed: true,",
            "      detail: { config: { ...this._config, \${2:item_id}: item.id } },",
            "    }));",
            "  }",
            "  _render() { /* TODO: render wizard or display based on this._mode */ }",
            "  getCardSize() { return 2; }",
            "}",
            "customElements.define('\${4:my-wizard-card}', \${1:MyWizardCard});",
            "$0",
        ].join('\n'),
    },
];

// ---------------------------------------------------------------------------
// SNIPPET INSERTION
// ---------------------------------------------------------------------------

/**
 * Inserts a snippet by id and mode.
 * Called by toolbar buttons, context menu actions, and Shift+Enter/Ctrl+Shift+Enter.
 * @param {string} id     – snippet id from SNIPPET_REGISTRY
 * @param {'full'|'minimal'} [mode='full']
 * @param {string} [variant] – optional domain variant for 'register'
 */
function insertSnippet(id, mode = 'full', variant = null) {
    if (typeof editor === 'undefined' || !editor) return;
    const def = SNIPPET_REGISTRY.find(s => s.id === id);
    if (!def) return;

    const template = _resolveTemplate(def, mode, variant);
    if (!template) return;

    editor.focus();
    editor.getContribution('snippetController2').insert(template);
}

/** Resolve the correct template string from a definition. */
function _resolveTemplate(def, mode, variant) {
    if (mode === 'full' && def.variants) {
        // Variant explicitly provided (from picker)
        if (variant && def.variants[variant]) return def.variants[variant];
        // No variant — fall back to minimal (choice tab stop)
        return def.minimal;
    }
    return mode === 'full' ? (def.full || def.minimal) : def.minimal;
}

// ---------------------------------------------------------------------------
// CURSOR-CONTEXT RESOLUTION (Shift+Enter logic)
// ---------------------------------------------------------------------------

const REGISTER_DOMAINS = ['sensor', 'switch', 'select', 'number', 'text', 'button'];

/**
 * Finds the snippet matching the expression immediately left of the cursor,
 * deletes that text, and inserts the resolved snippet template.
 * Returns true if a snippet was inserted, false if no match was found.
 *
 * @param {'full'|'minimal'} mode
 */
function resolveAndInsertFromCursor(mode) {
    if (typeof editor === 'undefined' || !editor) return false;

    const model    = editor.getModel();
    const pos      = editor.getPosition();
    const lineText = model.getLineContent(pos.lineNumber);
    const textLeft = lineText.slice(0, pos.column - 1);

    // Build all triggers sorted longest-first to prefer specific matches
    // (e.g. 'ha.store.set' before 'ha.store' before 'ha')
    const allTriggers = [];
    for (const def of SNIPPET_REGISTRY) {
        for (const t of def.triggers) {
            allTriggers.push({ trigger: t, def });
        }
    }
    allTriggers.sort((a, b) => b.trigger.length - a.trigger.length);

    let matchedDef  = null;
    let matchedText = '';

    for (const { trigger, def } of allTriggers) {
        if (textLeft.endsWith(trigger)) {
            matchedDef  = def;
            matchedText = trigger;
            break;
        }
    }

    if (!matchedDef) return false;

    // For ha.register with full mode: detect domain from line text or show picker
    let variant = null;
    if (matchedDef.id === 'register' && mode === 'full') {
        variant = _detectRegisterDomain(textLeft, lineText);
        if (!variant) {
            // Domain not detectable — show floating picker, then insert
            _showRegisterPicker(matchedDef, matchedText, pos);
            return true;
        }
    }

    // Delete the typed trigger text before inserting the snippet
    const col = pos.column;
    const deleteRange = new monaco.Range(
        pos.lineNumber, col - matchedText.length,
        pos.lineNumber, col
    );
    editor.executeEdits('snippet-trigger', [{ range: deleteRange, text: '' }]);
    editor.setPosition({ lineNumber: pos.lineNumber, column: col - matchedText.length });

    insertSnippet(matchedDef.id, mode, variant);
    return true;
}

/**
 * Tries to detect the ha.register domain from the current line text.
 * Looks for patterns like ha.register('sensor. or ha.register("switch.
 */
function _detectRegisterDomain(textLeft, fullLine) {
    const combined = (textLeft + fullLine).toLowerCase();
    for (const domain of REGISTER_DOMAINS) {
        if (combined.includes(`'${domain}.`) || combined.includes(`"${domain}.`)) {
            return domain;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// VARIANT PICKER (floating widget for ha.register without known domain)
// ---------------------------------------------------------------------------

function _showRegisterPicker(def, matchedText, cursorPos) {
    // Remove any existing picker
    _closeRegisterPicker();

    const existing = document.getElementById('snippet-register-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'snippet-register-picker';
    picker.className = 'snippet-variant-picker';

    const label = document.createElement('span');
    label.className = 'snippet-variant-picker__label';
    label.textContent = 'ha.register — Entity type:';
    picker.appendChild(label);

    for (const domain of REGISTER_DOMAINS) {
        const btn = document.createElement('button');
        btn.className = 'snippet-variant-picker__btn';
        btn.textContent = domain;
        btn.onclick = () => {
            _closeRegisterPicker();

            // Delete the typed trigger text
            const col = cursorPos.column;
            const deleteRange = new monaco.Range(
                cursorPos.lineNumber, col - matchedText.length,
                cursorPos.lineNumber, col
            );
            editor.executeEdits('snippet-trigger', [{ range: deleteRange, text: '' }]);
            editor.setPosition({
                lineNumber: cursorPos.lineNumber,
                column: col - matchedText.length
            });

            insertSnippet('register', 'full', domain);
        };
        picker.appendChild(btn);
    }

    // Position near the cursor using Monaco's layoutInfo
    const layoutInfo = editor.getLayoutInfo();
    const scrolledTop = editor.getScrollTop();
    const lineHeight  = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const editorDom   = editor.getDomNode();
    const editorRect  = editorDom.getBoundingClientRect();

    const top  = editorRect.top + (cursorPos.lineNumber - 1) * lineHeight - scrolledTop + lineHeight + 4;
    const left = editorRect.left + layoutInfo.contentLeft + 8;

    picker.style.top  = `${top}px`;
    picker.style.left = `${left}px`;

    document.body.appendChild(picker);

    // Auto-close if user clicks outside or presses Escape
    const onKey = (e) => {
        if (e.key === 'Escape') { _closeRegisterPicker(); document.removeEventListener('keydown', onKey); }
    };
    const onClickOut = (e) => {
        if (!picker.contains(e.target)) { _closeRegisterPicker(); document.removeEventListener('mousedown', onClickOut); }
    };
    setTimeout(() => {
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClickOut);
    }, 0);
}

function _closeRegisterPicker() {
    const el = document.getElementById('snippet-register-picker');
    if (el) el.remove();
}

// ---------------------------------------------------------------------------
// TOOLBAR BUILDER
// ---------------------------------------------------------------------------

const TOOLBAR_GROUPS_BY_MODE = {
    script: ['general', 'entity', 'store'],
    card:   ['card'],
};

/**
 * Builds a single "Snippets" toggle button inside the given container.
 * Clicking it opens a dropdown panel with all grouped snippet entries.
 * @param {HTMLElement} container
 * @param {'script'|'card'} [mode='script']
 */
function buildSnippetToolbar(container, mode = 'script') {
    if (!container) return;
    container.innerHTML = '';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'btn-snippets-toggle';
    const label = (typeof i18next !== 'undefined')
        ? i18next.t('snippets_title', { defaultValue: 'Snippets' })
        : 'Snippets';
    toggleBtn.title = label;
    toggleBtn.setAttribute('data-i18n', 'snippets_title');
    toggleBtn.setAttribute('data-i18n-title', '');
    toggleBtn.innerHTML = '<i class="mdi mdi-puzzle-outline"></i>';
    toggleBtn.onclick = (e) => { e.stopPropagation(); _toggleSnippetDropdown(toggleBtn, mode); };
    container.appendChild(toggleBtn);
}

function _toggleSnippetDropdown(anchorBtn, mode = 'script') {
    // If already open, close and return
    if (document.getElementById('snippet-toolbar-dropdown')) {
        _closeSnippetDropdown();
        return;
    }

    const dropdown = document.createElement('div');
    dropdown.id = 'snippet-toolbar-dropdown';
    dropdown.className = 'snippet-variant-picker';

    const activeGroups = TOOLBAR_GROUPS_BY_MODE[mode] || TOOLBAR_GROUPS_BY_MODE.script;

    let firstGroup = true;
    for (const group of activeGroups) {
        const entries = SNIPPET_REGISTRY.filter(s => s.toolbarGroup === group);
        if (entries.length === 0) continue;

        if (!firstGroup) {
            const sep = document.createElement('div');
            sep.className = 'snip-group-sep';
            dropdown.appendChild(sep);
        }
        firstGroup = false;

        for (const def of entries) {
            const btn = document.createElement('button');
            const label = (typeof i18next !== 'undefined')
                ? i18next.t(def.labelKey, { defaultValue: def.id })
                : def.id;
            btn.title = label;
            btn.innerHTML = `<i class="mdi ${def.icon}"></i><span>${label}</span>`;
            btn.onclick = () => {
                _closeSnippetDropdown();
                insertSnippet(def.id, 'full');
            };
            dropdown.appendChild(btn);
        }
    }

    // Position below the anchor button
    const rect = anchorBtn.getBoundingClientRect();
    dropdown.style.top  = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    document.body.appendChild(dropdown);

    // Auto-close on Escape or click outside
    const onKey = (e) => {
        if (e.key === 'Escape') { _closeSnippetDropdown(); document.removeEventListener('keydown', onKey); }
    };
    const onClickOut = (e) => {
        if (!dropdown.contains(e.target) && e.target !== anchorBtn) {
            _closeSnippetDropdown();
            document.removeEventListener('mousedown', onClickOut);
        }
    };
    setTimeout(() => {
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClickOut);
    }, 0);
}

function _closeSnippetDropdown() {
    const el = document.getElementById('snippet-toolbar-dropdown');
    if (el) el.remove();
}

// ---------------------------------------------------------------------------
// CONTEXT MENU REGISTRATION
// ---------------------------------------------------------------------------

/**
 * Registers all snippets that have contextMenu defined as editor actions.
 * Call this after the Monaco editor instance is created.
 * @param {object} editorInstance – Monaco editor instance
 */
function registerSnippetContextMenu(editorInstance) {
    for (const def of SNIPPET_REGISTRY) {
        if (!def.contextMenu) continue;
        editorInstance.addAction({
            id: `snip-${def.id}`,
            label: (typeof i18next !== 'undefined')
                ? i18next.t(def.labelKey, { defaultValue: def.id })
                : def.id,
            contextMenuGroupId: def.contextMenu.group,
            contextMenuOrder:   def.contextMenu.order,
            run: () => insertSnippet(def.id, 'full'),
        });
    }
}

// ---------------------------------------------------------------------------
// KEYBINDING REGISTRATION
// ---------------------------------------------------------------------------

/**
 * Registers Shift+Enter and Ctrl+Shift+Enter on the given editor instance.
 * @param {object} editorInstance – Monaco editor instance
 */
function registerSnippetKeybindings(editorInstance) {
    // Shift+Enter → full snippet
    editorInstance.addCommand(
        monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
            const inserted = resolveAndInsertFromCursor('full');
            if (!inserted) {
                // No snippet matched — behave like a normal newline
                editorInstance.trigger('keyboard', 'type', { text: '\n' });
            }
        }
    );

    // Ctrl+Shift+Enter → minimal snippet
    editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
            const inserted = resolveAndInsertFromCursor('minimal');
            if (!inserted) {
                editorInstance.trigger('keyboard', 'type', { text: '\n' });
            }
        }
    );
}

// ---------------------------------------------------------------------------
// LEGACY BRIDGE
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for the old insertCodeSnippet(type) calls.
 * Toolbar buttons and any other callers can continue to use this.
 */
function insertCodeSnippet(id) {
    insertSnippet(id, 'full');
}
