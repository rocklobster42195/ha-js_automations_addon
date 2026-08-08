import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaMonacoEditorBridge, JsaSettings } from './global';

// Monaco's runtime is loaded via the CDN AMD loader (see index.html) — never bundled — so this
// import is type-only (erased by esbuild, zero runtime cost) and exists purely so the rest of
// this file gets real type-checking against the exact same 0.44.0 API surface the CDN serves.
type Monaco = typeof import('monaco-editor');
type IStandaloneCodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type ITextModel = import('monaco-editor').editor.ITextModel;
type ICodeEditorViewState = import('monaco-editor').editor.ICodeEditorViewState;

declare global {
  interface Window {
    monaco?: Monaco;
    require?: {
      config: (opts: {
        paths: Record<string, string>;
        'vs/nls'?: { availableLanguages: Record<string, string> };
      }) => void;
      (deps: string[], callback: () => void): void;
    };
  }
}

// ---------------------------------------------------------------------------
// SNIPPET REGISTRY — ported verbatim from editor-snippets.js (single source of truth there,
// now here). See that file's git history if you need the original for reference.
// ---------------------------------------------------------------------------

type SnippetGroup = 'general' | 'entity' | 'store' | 'card' | false;

interface SnippetContextMenu {
  group: string;
  order: number;
}

interface SnippetDef {
  id: string;
  icon: string;
  labelKey: string;
  toolbarGroup: SnippetGroup;
  contextMenu: SnippetContextMenu | false;
  triggers: string[];
  full: string | null;
  minimal: string;
  variants?: Record<string, string>;
}

const REGISTER_DOMAINS = ['sensor', 'switch', 'select', 'number', 'text', 'button'];

const SNIPPET_REGISTRY: SnippetDef[] = [
  {
    id: 'log',
    icon: 'mdi-console',
    labelKey: 'snippet_log',
    toolbarGroup: 'general',
    contextMenu: { group: '90_snippets_general', order: 1 },
    triggers: ['ha.log', 'ha.debug', 'ha.warn', 'ha.error'],
    full: "ha.log(${1:'Message'});\n$0",
    minimal: "ha.log(${1:'Message'});\n$0",
  },
  {
    id: 'service',
    icon: 'mdi-flash',
    labelKey: 'snippet_service',
    toolbarGroup: 'general',
    contextMenu: { group: '90_snippets_general', order: 2 },
    triggers: ['ha.call', 'ha.callService'],
    full: "ha.call('${1:domain.service}', {\n\tentity_id: '${2:entity.id}',\n\t${3:// data}\n});\n$0",
    minimal: "ha.call('${1:domain.service}');\n$0",
  },
  {
    id: 'listener',
    icon: 'mdi-ear-hearing',
    labelKey: 'snippet_listener',
    toolbarGroup: 'general',
    contextMenu: { group: '90_snippets_general', order: 3 },
    triggers: ['ha.on'],
    full: "ha.on('${1:entity_id}', (e) => {\n\tha.log(e.state);\n\t${2:// code}\n});\n$0",
    minimal: "ha.on('${1:entity_id}', (e) => {\n\t$2\n});\n$0",
  },
  {
    id: 'listener_array',
    icon: 'mdi-playlist-plus',
    labelKey: 'snippet_listener_array',
    toolbarGroup: 'general',
    contextMenu: false,
    triggers: [],
    full: "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t${3:// code}\n});\n$0",
    minimal: "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t$2\n});\n$0",
  },
  {
    id: 'on_stop',
    icon: 'mdi-stop-circle-outline',
    labelKey: 'snippet_on_stop',
    toolbarGroup: 'general',
    contextMenu: false,
    triggers: ['ha.onStop'],
    full: 'ha.onStop(() => {\n\t${1:// cleanup code}\n});\n$0',
    minimal: 'ha.onStop(() => {\n\t$1\n});\n$0',
  },
  {
    id: 'notify',
    icon: 'mdi-bell',
    labelKey: 'snippet_notify',
    toolbarGroup: 'general',
    contextMenu: { group: '90_snippets_general', order: 4 },
    triggers: ['ha.notify'],
    full: "ha.notify('${1:Message}', {\n\ttitle: '${2:Title}',\n\tpersistent: ${3|false,true|},\n\ttarget: '${4:notify.notify}',\n\tdata: { $5 }\n});\n$0",
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
      "const ${1:action} = await ha.ask('${2:Message}', {",
      "\ttitle: '${3:Title}',",
      "\ttarget: '${4:notify.notify}',",
      '\ttimeout: ${5:60000},',
      '\tdefaultAction: ${6:null},',
      '\tactions: [',
      "\t\t{ action: '${7:YES}', title: '${8:Yes}' },",
      "\t\t{ action: '${9:NO}',  title: '${10:No}' },",
      '\t],',
      '});',
      '$0',
    ].join('\n'),
    minimal:
      "const ${1:action} = await ha.ask('${2:Message}', {\n\tactions: [\n\t\t{ action: '${3:YES}', title: '${4:Yes}' },\n\t],\n});\n$0",
  },
  {
    id: 'register',
    icon: 'mdi-shape-square-plus',
    labelKey: 'snippet_register',
    toolbarGroup: 'entity',
    contextMenu: { group: '91_snippets_state', order: 0 },
    triggers: ['ha.register'],
    full: null,
    minimal:
      "ha.register('${1|sensor,switch,select,number,text,button|}.${2:my_entity}', {\n\tname: '${3:Name}',\n\ticon: '${4:mdi:eye}',\n});\n$0",
    variants: {
      sensor: [
        "ha.register('sensor.${1:my_sensor}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:thermometer}',",
        "\tunit: '${4:°C}',",
        "\tdevice_class: '${5:temperature}',",
        "\tstate_class: '${6:measurement}',",
        '\tinitial_state: ${7:0},',
        "\tentity_category: '${8|diagnostic,config|}',",
        '});\n$0',
      ].join('\n'),
      switch: [
        "ha.register('switch.${1:my_switch}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:toggle-switch}',",
        '});\n$0',
      ].join('\n'),
      select: [
        "ha.register('select.${1:my_select}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:format-list-bulleted}',",
        "\toptions: ['${4:option1}', '${5:option2}'],",
        "\tentity_category: '${6|diagnostic,config|}',",
        '});\n$0',
      ].join('\n'),
      number: [
        "ha.register('number.${1:my_number}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:numeric}',",
        "\tunit: '${4}',",
        '\tmin: ${5:0},',
        '\tmax: ${6:100},',
        '\tstep: ${7:1},',
        "\tmode: '${8|auto,box,slider|}',",
        "\tentity_category: '${9|diagnostic,config|}',",
        '});\n$0',
      ].join('\n'),
      text: [
        "ha.register('text.${1:my_text}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:form-textbox}',",
        '});\n$0',
      ].join('\n'),
      button: [
        "ha.register('button.${1:my_button}', {",
        "\tname: '${2:Name}',",
        "\ticon: '${3:mdi:gesture-tap-button}',",
        '});\n$0',
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
    full: "ha.update('${1:sensor.my_sensor}', '${2:state_value}', {\n\ticon: '${3:mdi:eye}',\n\t${4:// other attributes}\n});\n$0",
    minimal: "ha.update('${1:entity_id}', '${2:value}');\n$0",
  },
  {
    id: 'unregister',
    icon: 'mdi-delete-outline',
    labelKey: 'snippet_unregister',
    toolbarGroup: 'entity',
    contextMenu: { group: '91_snippets_state', order: 3 },
    triggers: ['ha.unregister'],
    full: null,
    minimal: "ha.unregister('${1:entity_id}');\n$0",
  },
  {
    id: 'state',
    icon: 'mdi-export',
    labelKey: 'snippet_state',
    toolbarGroup: 'entity',
    contextMenu: { group: '91_snippets_state', order: 1 },
    triggers: ['ha.getState', 'ha.getAttr', 'ha.getStateValue', 'ha.states'],
    full: "ha.getState('${1:entity_id}')$0",
    minimal: "ha.getState('${1:entity_id}')$0",
  },
  {
    id: 'select',
    icon: 'mdi-checkbox-multiple-marked',
    labelKey: 'snippet_select',
    toolbarGroup: 'entity',
    contextMenu: false,
    triggers: ['ha.select'],
    full: "ha.select('${1:light.*}')\n\t.${2|turnOn,turnOff,toggle|}();\n$0",
    minimal: "ha.select('${1:light.*}')$0",
  },
  {
    id: 'store_set',
    icon: 'mdi-database-import',
    labelKey: 'snippet_store_set',
    toolbarGroup: 'store',
    contextMenu: { group: '92_snippets_store', order: 1 },
    triggers: ['ha.store.set'],
    full: "ha.store.set('${1:key}', ${2:value});\n$0",
    minimal: "ha.store.set('${1:key}', ${2:value});\n$0",
  },
  {
    id: 'store_get',
    icon: 'mdi-database-export',
    labelKey: 'snippet_store_get',
    toolbarGroup: 'store',
    contextMenu: { group: '92_snippets_store', order: 2 },
    triggers: ['ha.store.get'],
    full: "const ${1:val} = ha.store.get('${2:key}');\n$0",
    minimal: "const ${1:val} = ha.store.get('${2:key}');\n$0",
  },
  {
    id: 'store_del',
    icon: 'mdi-database-remove',
    labelKey: 'snippet_store_del',
    toolbarGroup: 'store',
    contextMenu: { group: '92_snippets_store', order: 3 },
    triggers: ['ha.store.delete'],
    full: "ha.store.delete('${1:key}');\n$0",
    minimal: "ha.store.delete('${1:key}');\n$0",
  },
  {
    id: 'card_litelement',
    icon: 'mdi-card-text-outline',
    labelKey: 'snippet_card_litelement',
    toolbarGroup: 'card',
    contextMenu: false,
    triggers: [],
    full: [
      'class ${1:MyCard} extends HTMLElement {',
      '  constructor() {',
      '    super();',
      "    this.attachShadow({ mode: 'open' });",
      '  }',
      '',
      '  setConfig(config) {',
      '    this._config = config;',
      '    this.render();',
      '  }',
      '',
      '  set hass(hass) {',
      '    this._hass = hass;',
      '    this.render();',
      '  }',
      '',
      '  render() {',
      '    this.shadowRoot.innerHTML = `',
      '      <style>',
      '        ha-card { padding: 16px; }',
      '      </style>',
      '      <ha-card>',
      "        <div>\\${this._config?.title ?? 'My Card'}</div>",
      '      </ha-card>',
      '    `;',
      '  }',
      '',
      '  getCardSize() { return 1; }',
      '}',
      '',
      "customElements.define('${2:my-jsa-card}', ${1:MyCard});",
      '$0',
    ].join('\n'),
    minimal:
      "class ${1:MyCard} extends HTMLElement {\n  setConfig(c) { this._config = c; }\n  set hass(h) { this._hass = h; }\n  getCardSize() { return 1; }\n}\ncustomElements.define('${2:my-jsa-card}', ${1:MyCard});\n$0",
  },
  {
    id: 'card_call_action',
    icon: 'mdi-lightning-bolt',
    labelKey: 'snippet_card_call_action',
    toolbarGroup: 'card',
    contextMenu: false,
    triggers: ['__jsa__.callAction'],
    full: ["const result = await __jsa__.callAction('${1:action-name}', {", '  ${2:// payload}', '});', '$0'].join(
      '\n'
    ),
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
      '  bubbles: true,',
      '  composed: true,',
      '  detail: { config: { ...this._config, ${1:key}: ${2:value} } },',
      '}));',
      '$0',
    ].join('\n'),
    minimal:
      "this.dispatchEvent(new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config: { ...this._config } } }));\n$0",
  },
  {
    id: 'card_ha_vars',
    icon: 'mdi-palette-outline',
    labelKey: 'snippet_card_ha_vars',
    toolbarGroup: 'card',
    contextMenu: false,
    triggers: [],
    full: [
      '/* HA Theme Variables */',
      '/* --primary-color         -- accent / brand color */',
      '/* --primary-text-color    -- main text */',
      '/* --secondary-text-color  -- muted text */',
      '/* --card-background-color -- card surface */',
      '/* --divider-color         -- borders / dividers */',
      '/* --error-color           -- error / danger */',
      '/* --success-color         -- success / OK */',
      '$0',
    ].join('\n'),
    minimal: '/* --primary-color, --primary-text-color, --card-background-color */\n$0',
  },
  {
    id: 'card_wizard',
    icon: 'mdi-wizard-hat',
    labelKey: 'snippet_card_wizard',
    toolbarGroup: 'card',
    contextMenu: false,
    triggers: [],
    full: [
      'class ${1:MyWizardCard} extends HTMLElement {',
      '  constructor() {',
      '    super();',
      "    this.attachShadow({ mode: 'open' });",
      '    this._step = 1;',
      '    this._step1Items = null;',
      '    this._step2Items = null;',
      '    this._selected1 = null;',
      "    this._query = '';",
      '    this._loading = false;',
      '    this._error = null;',
      '  }',
      '',
      '  setConfig(config) {',
      '    this._config = config;',
      '    const configured = Boolean(config?.${3:item_id});',
      "    this._mode = configured ? 'display' : 'setup';",
      '    if (!configured && !this._step1Items) this._loadStep1();',
      '    this._render();',
      '  }',
      '',
      '  set hass(hass) {',
      '    this._hass = hass;',
      '    __jsa__.connect(hass);',
      '    this._render();',
      '  }',
      '',
      '  async _loadStep1() {',
      '    this._loading = true; this._error = null; this._render();',
      '    try {',
      "      this._step1Items = await __jsa__.callAction('${4:wizard/step1}');",
      '    } catch (e) {',
      '      this._error = e.message;',
      '    }',
      '    this._loading = false; this._render();',
      '  }',
      '',
      '  async _selectStep1(item) {',
      '    this._selected1 = item;',
      "    this._step = 2; this._step2Items = null; this._query = '';",
      '    this._loading = true; this._render();',
      '    try {',
      "      this._step2Items = await __jsa__.callAction('${5:wizard/step2}', { id: item.id });",
      '    } catch (e) {',
      '      this._error = e.message;',
      '    }',
      '    this._loading = false; this._render();',
      '  }',
      '',
      '  _finish(item) {',
      "    this.dispatchEvent(new CustomEvent('config-changed', {",
      '      bubbles: true, composed: true,',
      '      detail: {',
      '        config: {',
      '          ...this._config,',
      '          ${6:group_id}: this._selected1.id,',
      '          ${3:item_id}: item.id,',
      '          ${7:item_name}: item.name,',
      '        }',
      '      },',
      '    }));',
      '  }',
      '',
      '  _render() {',
      "    if (this._mode !== 'display') { this._renderWizard(); return; }",
      '    const state = this._hass?.states?.[this._config?.entity_id];',
      "    this.shadowRoot.innerHTML = '<style>:host{display:block}'",
      "      + 'ha-card{background:var(--card-background-color);border-radius:var(--ha-card-border-radius,12px);padding:20px}'",
      "      + '</style><ha-card>' + (state?.state ?? '–') + '</ha-card>';",
      '  }',
      '',
      '  _renderWizard() {',
      '    const items = this._step === 1 ? this._step1Items : this._step2Items;',
      '    const filtered = items ? items.filter(i => i.name.toLowerCase().includes(this._query.toLowerCase())) : null;',
      "    const stepLabel = this._step === 1 ? 'Select group' : 'Select item';",
      "    let body = '';",
      '    if (this._loading) {',
      '      body = \'<div class="spinner">Loading…</div>\';',
      '    } else if (this._error) {',
      "      body = '<div class=\"error\">⚠ ' + this._error + '</div>';",
      '    } else if (filtered) {',
      '      body = \'<input id="q" type="text" placeholder="Search…" value="\' + this._query + \'" />\'',
      "        + '<div class=\"list\">' + filtered.map(i => '<div class=\"item\" data-id=\"' + i.id + '\" data-name=\"' + i.name + '\">' + i.name + '</div>').join('') + '</div>'",
      '        + (this._step === 2 ? \'<div class="footer"><button id="back">← Back</button></div>\' : \'\');',
      '    }',
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
      "      + '<h3>⚙ Setup</h3>'",
      "      + '<div class=\"step\">Step ' + this._step + ' of 2: ' + stepLabel + '</div>'",
      "      + body + '</ha-card>';",
      "    this.shadowRoot.getElementById('q')?.addEventListener('input', e => { this._query = e.target.value; this._render(); });",
      "    this.shadowRoot.querySelectorAll('.item').forEach(el => {",
      '      el.onclick = () => {',
      '        const item = { id: el.dataset.id, name: el.dataset.name };',
      '        this._step === 1 ? this._selectStep1(item) : this._finish(item);',
      '      };',
      '    });',
      "    this.shadowRoot.getElementById('back')?.addEventListener('click', () => { this._step = 1; this._query = ''; this._render(); });",
      '  }',
      '',
      "  static getConfigElement() { return document.createElement('${2:my-wizard-card}-editor'); }",
      '',
      '  getCardSize() { return 3; }',
      '}',
      '',
      "customElements.define('${2:my-wizard-card}', ${1:MyWizardCard});",
      '$0',
    ].join('\n'),
    minimal: [
      'class ${1:MyWizardCard} extends HTMLElement {',
      '  setConfig(config) {',
      '    this._config = config;',
      "    this._mode = Boolean(config?.${2:item_id}) ? 'display' : 'setup';",
      "    if (this._mode === 'setup' && !this._items) this._load();",
      '    this._render();',
      '  }',
      '  set hass(hass) { this._hass = hass; __jsa__.connect(hass); this._render(); }',
      '  async _load() {',
      "    try { this._items = await __jsa__.callAction('${3:wizard/step1}'); }",
      '    catch (e) { this._error = e.message; }',
      '    this._render();',
      '  }',
      '  _finish(item) {',
      "    this.dispatchEvent(new CustomEvent('config-changed', {",
      '      bubbles: true, composed: true,',
      '      detail: { config: { ...this._config, ${2:item_id}: item.id } },',
      '    }));',
      '  }',
      '  _render() { /* TODO: render wizard or display based on this._mode */ }',
      '  getCardSize() { return 2; }',
      '}',
      "customElements.define('${4:my-wizard-card}', ${1:MyWizardCard});",
      '$0',
    ].join('\n'),
  },
];

const TOOLBAR_GROUPS_BY_MODE: Record<'script' | 'card', SnippetGroup[]> = {
  script: ['general', 'entity', 'store'],
  card: ['card'],
};

interface StoreKeyEntry {
  key: string;
  type: string;
}

interface TypingFile {
  filename: string;
  content: string;
}

/**
 * Facade + full IntelliSense/snippet ownership for the Monaco editor instance (RFC Phase B item
 * 8). Absorbs app.js's Monaco bootstrap, editor-config.js (completion providers, TS typings,
 * icon decorations, word-wrap), and editor-snippets.js (snippet registry, insertion, the two
 * floating pickers — rebuilt here as real LIT-rendered popovers instead of hand-rolled
 * document.body-appended divs with manual getBoundingClientRect positioning).
 *
 * Owns its own `#monaco-container` fully inside Shadow DOM — safe because, unlike
 * `#blockly-container` (see `<editor-view>`), nothing outside this component does
 * `document.getElementById('monaco-container')` once editor-config.js/editor-snippets.js are
 * gone too.
 */
@customElement('monaco-editor')
export class MonacoEditorElement extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    #monaco-container {
      flex: 1;
      width: 100%;
      min-height: 0;
    }

    /* Matches style.css's .icon-preview-inline — Monaco's deltaDecorations() render inside
       this component's own Shadow DOM, so the global stylesheet never reaches them. */
    .icon-preview-inline {
      display: inline-block;
      margin-right: 5px;
      color: #999 !important;
      font-size: 1.1em;
      vertical-align: middle;
      opacity: 0.8;
    }

    .toolbar-btn {
      color: var(--text-secondary);
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 1.1rem;
    }

    .toolbar-btn:hover {
      color: #fff;
      background: #252525;
    }

    .snippet-menu {
      position: fixed;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 10000;
      min-width: 200px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .snippet-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: none;
      color: var(--text-primary);
      padding: 7px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.85rem;
      text-align: left;
      width: 100%;
    }

    .snippet-menu button:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .snippet-menu .group-sep {
      height: 1px;
      background: var(--border);
      margin: 4px 2px;
    }

    .snippet-menu .picker-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 4px 10px;
    }
  `;

  @state() private _wordWrap: 'on' | 'off' = 'off';
  @state() private _snippetMenuOpen = false;
  @state() private _snippetMenuPos = { top: 0, left: 0 };
  @state() private _registerPickerOpen = false;
  @state() private _registerPickerPos = { top: 0, left: 0 };
  @state() private _mode: 'script' | 'card' = 'script';

  private _monaco: Monaco | null = null;
  private _editor: IStandaloneCodeEditor | null = null;
  private _allEntities: string[] = [];
  private _allStoreKeys: StoreKeyEntry[] = [];
  private _libDisposables: { dispose(): void }[] = [];
  private _pendingRegisterMatch: { text: string; pos: { lineNumber: number; column: number } } | null = null;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    const bridge: JsaMonacoEditorBridge = {
      createModel: this.createModel,
      disposeModel: this.disposeModel,
      setModel: this.setModel,
      getValue: this.getValue,
      getModelValue: this.getModelValue,
      saveViewState: this.saveViewState,
      restoreViewState: this.restoreViewState,
      focus: this.focus,
      layout: this.layout,
      setReadOnly: this.setReadOnly,
      insertTextAtCursor: this.insertTextAtCursor,
      updateIconDecorations: this.updateIconDecorations,
      setMode: this.setMode,
      loadLibraryDefinitions: this.loadLibraryDefinitions,
      isReady: () => this._ready,
    };
    window.monacoEditor = bridge;
    // Documented external call site (global.d.ts): some not-yet-migrated code may still call
    // this bare global after a library script is deleted.
    window.loadLibraryDefinitions = this.loadLibraryDefinitions;

    document.addEventListener('click', this._onDocumentClick);
    document.addEventListener('keydown', this._onDocumentKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.monacoEditor?.createModel === this.createModel) delete window.monacoEditor;
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onDocumentKeydown);
  }

  // Both floating popovers stop propagation on clicks inside themselves (see render()), so any
  // click that reaches here happened outside either one — close whichever is open.
  private _onDocumentClick = (): void => {
    if (this._snippetMenuOpen) this._snippetMenuOpen = false;
    if (this._registerPickerOpen) {
      this._registerPickerOpen = false;
      this._pendingRegisterMatch = null;
    }
  };

  private _onDocumentKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (this._snippetMenuOpen) this._snippetMenuOpen = false;
    if (this._registerPickerOpen) {
      this._registerPickerOpen = false;
      this._pendingRegisterMatch = null;
    }
  };

  private _ready = false;

  firstUpdated() {
    this._initMonaco();
  }

  private _initMonaco(): void {
    if (typeof window.require === 'undefined') {
      console.error('[monaco-editor] AMD loader (require) not found — check the <script> tag in index.html');
      return;
    }
    const monacoLang = window.i18next?.language?.startsWith('de') ? 'de' : '';
    window.require.config({
      paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' },
      'vs/nls': { availableLanguages: { '*': monacoLang } },
    });

    window.require(['vs/editor/editor.main'], () => {
      const monacoNS = window.monaco;
      if (!monacoNS) {
        console.error('[monaco-editor] Monaco failed to load');
        return;
      }
      this._monaco = monacoNS;
      const container = this.renderRoot.querySelector<HTMLElement>('#monaco-container');
      if (!container) return;

      this._editor = monacoNS.editor.create(container, {
        model: null,
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: true },
        suggest: { showWords: false },
      });

      const savedWordWrap = (localStorage.getItem('js_editor_wordwrap') as 'on' | 'off') || 'off';
      this._setWordWrap(savedWordWrap);
      this._editor.updateOptions({ wordWrap: savedWordWrap });

      this._editor.addCommand(monacoNS.KeyMod.CtrlCmd | monacoNS.KeyCode.KeyS, () => {
        this.dispatchEvent(new CustomEvent('save-requested', { bubbles: true, composed: true }));
      });

      this._editor.addAction({
        id: 'insert-entity',
        label: this._t('modal_insert_entity_title', 'Insert Entity'),
        contextMenuGroupId: '90_snippets_general',
        contextMenuOrder: 0,
        keybindings: [monacoNS.KeyMod.CtrlCmd | monacoNS.KeyCode.KeyE],
        run: () => {
          window.entityPickerModal?.open();
        },
      });

      this._registerSnippetContextMenu();
      this._registerSnippetKeybindings();

      this._configureMonaco().then(() => {
        this._ready = true;
        this.dispatchEvent(new CustomEvent('monaco-ready', { bubbles: true, composed: true }));
      });

      window.addEventListener('settings-changed', ((e: CustomEvent) => {
        this._applyEditorSettings(e.detail);
      }) as EventListener);
      if (window.currentSettings) {
        setTimeout(() => this._applyEditorSettings(window.currentSettings), 100);
      }

      this._loadEditorSettings();
    });
  }

  // -------------------------------------------------------------------------
  // Public facade — <editor-view> calls these instead of touching monaco/editor directly.
  // -------------------------------------------------------------------------

  /** Creates a model and wires icon-decoration updates (always) plus an optional caller
   * callback (e.g. dirty-tracking) on every content change — consolidates the "model +
   * onDidChangeContent" pairing tab-manager.js used to do at each of its three call sites. */
  createModel = (
    content: string,
    language: string,
    uriPath: string,
    onContentChange?: (model: ITextModel) => void
  ): ITextModel | null => {
    if (!this._monaco) return null;
    const uri = this._monaco.Uri.parse(`file:///${uriPath}`);
    const model = this._monaco.editor.createModel(content, language, uri);
    model.onDidChangeContent(() => {
      this.updateIconDecorations(model);
      onContentChange?.(model);
    });
    return model;
  };

  disposeModel = (model: ITextModel | null | undefined): void => {
    model?.dispose();
  };

  setModel = (model: ITextModel | null): void => {
    this._editor?.setModel(model);
  };

  /** Reads the value of any model reference, not just the one currently attached to the
   * editor — used for dirty-comparison against a tab's own model when it may not be active. */
  getModelValue = (model: ITextModel | null | undefined): string => {
    return model?.getValue() ?? '';
  };

  getValue = (): string => {
    return this._editor?.getModel()?.getValue() ?? '';
  };

  saveViewState = (): ICodeEditorViewState | null => {
    return this._editor?.saveViewState() ?? null;
  };

  restoreViewState = (state: ICodeEditorViewState | null): void => {
    if (state) this._editor?.restoreViewState(state);
  };

  focus = (): void => {
    this._editor?.focus();
  };

  layout = (): void => {
    this._editor?.layout();
  };

  setReadOnly = (readOnly: boolean): void => {
    this._editor?.updateOptions({ readOnly });
  };

  /** Mode controls which snippet groups the dropdown shows — 'card' for the card-editor virtual
   * tab, 'script' otherwise. */
  setMode = (mode: 'script' | 'card'): void => {
    this._mode = mode;
  };

  /** Inserts plain text at the current cursor position — used by entity-picker-modal.ts's
   * "Insert Entity" flow instead of it reaching into a raw Monaco editor/selection API itself. */
  insertTextAtCursor = (text: string): void => {
    if (!this._editor || !this._monaco) return;
    const selection = this._editor.getSelection();
    if (!selection) return;
    this._editor.executeEdits('insert-entity', [{ range: selection, text, forceMoveMarkers: true }]);
    this._editor.focus();
  };

  // -------------------------------------------------------------------------
  // Icon decorations (mdi:xxx inline glyph preview) — ported from editor-config.js.
  // -------------------------------------------------------------------------

  updateIconDecorations = (model: ITextModel | null | undefined): void => {
    if (!this._monaco || !model) return;
    const text = model.getValue();
    const regex = /(?:@icon\s+|["'])(mdi:([a-z0-9-]+))/g;
    const decorations: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const iconName = match[2];
      const matchIndex = match.index + match[0].indexOf(match[1]);
      const startPos = model.getPositionAt(matchIndex);
      decorations.push({
        range: new this._monaco.Range(startPos.lineNumber, startPos.column, startPos.lineNumber, startPos.column),
        options: {
          beforeContentClassName: `mdi mdi-${iconName} icon-preview-inline`,
          stickiness: this._monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    const modelWithDecos = model as ITextModel & { _iconDecos?: string[] };
    modelWithDecos._iconDecos = model.deltaDecorations(modelWithDecos._iconDecos || [], decorations);
  };

  // -------------------------------------------------------------------------
  // Word wrap — ported from editor-config.js (toggleWordWrap + the loadEditorSettings/
  // applyEditorSettings restore paths, unified here instead of being duplicated three times).
  // -------------------------------------------------------------------------

  /** editor-view.ts renders its own word-wrap toolbar button (reading `.wordWrapEnabled`) since
   * it lives outside this component's Shadow DOM — a plain property read only reflects the
   * value at editor-view's last render, so every state change here also fires a bubbling event
   * editor-view listens for to know to re-render. */
  private _setWordWrap(value: 'on' | 'off'): void {
    this._wordWrap = value;
    this.dispatchEvent(
      new CustomEvent('word-wrap-changed', { bubbles: true, composed: true, detail: { enabled: value === 'on' } })
    );
  }

  private _toggleWordWrap(): void {
    if (!this._editor) return;
    const next = this._wordWrap === 'off' ? 'on' : 'off';
    this._editor.updateOptions({ wordWrap: next });
    this._setWordWrap(next);
    localStorage.setItem('js_editor_wordwrap', next);
  }

  private _loadEditorSettings(): void {
    if (!this._editor) return;
    // completeFunctionCalls is a real Monaco/TS-worker suggest option not present in the
    // published 0.44.0 .d.ts (a known lag between monaco-editor's npm types and its bundled
    // TS-language-service version) — cast to preserve behavior without widening the option type.
    this._editor.updateOptions({
      suggest: { completeFunctionCalls: true } as import('monaco-editor').editor.ISuggestOptions,
    });

    const savedWrap = localStorage.getItem('js_editor_wordwrap') as 'on' | 'off' | null;
    if (savedWrap) {
      this._editor.updateOptions({ wordWrap: savedWrap });
      this._setWordWrap(savedWrap);
    }

    const savedScale = localStorage.getItem('js_editor_minimap_scale');
    if (savedScale) {
      this._editor.updateOptions({ minimap: { scale: parseInt(savedScale, 10) } });
    }
  }

  private _applyEditorSettings(settings: JsaSettings | null | undefined): void {
    if (!this._editor || !settings?.editor) return;
    const conf = settings.editor;
    this._editor.updateOptions({
      fontSize: conf.fontSize,
      wordWrap: conf.wordWrap,
      minimap: { enabled: conf.minimap },
    });
    if (conf.wordWrap) this._setWordWrap(conf.wordWrap);
  }

  // -------------------------------------------------------------------------
  // TS/JS config, typings, completion providers — ported from editor-config.js.
  // -------------------------------------------------------------------------

  private async _configureMonaco(): Promise<void> {
    const m = this._monaco;
    if (!m) return;

    // Node16 isn't in the published 0.44.0 .d.ts's ModuleKind/ModuleResolutionKind enums (same
    // npm-types-lag-behind-bundled-TS-version issue as completeFunctionCalls above) but does
    // exist at runtime in the embedded TS-language-service — cast to preserve behavior.
    const moduleKindNode16 = (m.languages.typescript.ModuleKind as unknown as { Node16: number }).Node16;
    const moduleResolutionNode16 = (m.languages.typescript.ModuleResolutionKind as unknown as { Node16: number })
      .Node16;

    const sharedOptions = {
      target: m.languages.typescript.ScriptTarget.ES2020,
      module: moduleKindNode16,
      moduleResolution: moduleResolutionNode16,
      allowNonTsExtensions: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      baseUrl: 'file:///',
      paths: { '*': ['file:///node_modules/@types/*'] },
    };
    // .ts tabs — natively type-checked, so strict/noEmit apply directly (ported from app.js's
    // former initMonacoTypeScript(), which configured typescriptDefaults; editor-config.js's
    // configureMonaco() only ever configured javascriptDefaults, so .ts tabs need this too).
    m.languages.typescript.typescriptDefaults.setCompilerOptions({
      ...sharedOptions,
      noEmit: true,
      strict: true,
    });
    // .js tabs — checkJs opts them into the same type-checking on a best-effort basis.
    m.languages.typescript.javascriptDefaults.setCompilerOptions({
      ...sharedOptions,
      checkJs: true,
      allowJs: true,
    });

    // Card-side __jsa__ type defs (available in card tabs for __jsa__.callAction() etc.) —
    // ported from app.js's former initMonacoTypeScript(). Static (not server-sourced), so this
    // only needs registering once, unlike _loadTypings() below.
    const jsaCardDefs = [
      'declare const __jsa__: {',
      '  /**',
      '   * Call a named action handler registered in the parent script via ha.action().',
      "   * Returns the handler's resolved value.",
      '   */',
      '  callAction(action: string, payload?: Record<string, unknown>): Promise<unknown>;',
      "  /** Filename of the parent script that owns this card (e.g. 'openligadb.js') */",
      '  scriptName: string;',
      '};',
    ].join('\n');
    m.languages.typescript.javascriptDefaults.addExtraLib(jsaCardDefs, 'file:///jsa-card-api.d.ts');

    await this._loadTypings();
    this._registerCompilerSignalListener();

    await this.loadLibraryDefinitions();
    this._registerCompletionProviders();
  }

  /** Fetches and registers the server-generated `.d.ts` typings (entities, services, store
   * schema, ...) — re-run on the server's 'typings_updated' socket event, not just at startup. */
  private async _loadTypings(): Promise<void> {
    const m = this._monaco;
    if (!m) return;
    try {
      const res = await fetch('api/scripts/typings');
      if (res.ok) {
        const typings: TypingFile[] = await res.json();
        for (const lib of typings) {
          const uri = `file:///${lib.filename}`;
          // Registered for both TS and JS defaults — .ts tabs need these too (see the compiler
          // options split above), not just .js ones.
          m.languages.typescript.typescriptDefaults.addExtraLib(lib.content, uri);
          m.languages.typescript.javascriptDefaults.addExtraLib(lib.content, uri);
        }

        const entitiesLib = typings.find((t) => t.filename === 'entities.d.ts');
        if (entitiesLib?.content) {
          const matches = entitiesLib.content.match(/"([a-z0-9_]+\.[a-z0-9_-]+)"/g);
          if (matches) {
            this._allEntities = matches.map((mm) => mm.replace(/"/g, '')).sort();
            window.allEntities = this._allEntities;
          }
        }

        this._allStoreKeys = [];
        const storeContent = entitiesLib?.content ?? '';
        const schemaMatch = storeContent.match(/interface GlobalStoreSchema \{([\s\S]*?)\}/);
        if (schemaMatch?.[1]) {
          const storeRegex = /"([^"]+)"\s*:\s*([^;]+);/g;
          let m2: RegExpExecArray | null;
          while ((m2 = storeRegex.exec(schemaMatch[1])) !== null) {
            this._allStoreKeys.push({ key: m2[1], type: m2[2].trim() });
          }
        }
        this._allStoreKeys.sort((a, b) => a.key.localeCompare(b.key));
      }
    } catch (e) {
      console.error('Error configuring Monaco:', e);
    }
  }

  private _compilerMarkers = new Map<string, import('monaco-editor').editor.IMarkerData[]>();
  private _compilerSignalRegistered = false;

  /** Live TS-compiler-error markers pushed from the server over the socket (a background
   * compile-on-save process, not Monaco's own in-browser checker) — ported from app.js's former
   * initMonacoTypeScript(). Guarded to register once; typings_updated can fire repeatedly. */
  private _registerCompilerSignalListener(): void {
    if (!window.socket || this._compilerSignalRegistered) return;
    this._compilerSignalRegistered = true;

    window.socket.on('typings_updated', () => this._loadTypings());
    window.socket.on('compiler_signal', (data: Record<string, unknown>) => {
      const filename = data.filename as string;
      if (data.type === 'TS_OK') {
        this._clearCompilerMarkers(filename);
      } else {
        this._handleCompilerMarker(
          filename,
          data.line as number,
          data.col as number,
          data.text as string,
          data.code as string,
          data.type as string
        );
      }
    });
  }

  private _handleCompilerMarker(
    filename: string,
    line: number,
    col: number,
    message: string,
    code: string,
    type: string
  ): void {
    const m = this._monaco;
    if (!m) return;
    const model = m.editor.getModels().find((mm) => mm.uri.path.endsWith(filename));
    if (!model) return;

    if (!this._compilerMarkers.has(filename)) this._compilerMarkers.set(filename, []);
    const markers = this._compilerMarkers.get(filename)!;
    markers.push({
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + 10,
      message: `${code}: ${message}`,
      severity: type === 'TS_ERR' ? m.MarkerSeverity.Error : m.MarkerSeverity.Warning,
      source: 'TypeScript Compiler',
    });
    m.editor.setModelMarkers(model, 'compiler', markers);
  }

  private _clearCompilerMarkers(filename: string): void {
    const m = this._monaco;
    if (!m) return;
    const model = m.editor.getModels().find((mm) => mm.uri.path.endsWith(filename));
    this._compilerMarkers.delete(filename);
    if (model) m.editor.setModelMarkers(model, 'compiler', []);
  }

  loadLibraryDefinitions = async (): Promise<void> => {
    const m = this._monaco;
    if (!m) return;
    try {
      const res = await window.apiFetch!('api/scripts');
      if (!res.ok) return;
      const scripts = (await res.json()) as { filename: string; path?: string }[];
      const libs = scripts.filter(
        (s) => s.path && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\'))
      );

      this._libDisposables.forEach((d) => d.dispose());
      this._libDisposables = [];

      for (const lib of libs) {
        try {
          const cRes = await window.apiFetch!(`api/scripts/${lib.filename}/content`);
          if (cRes.ok) {
            const data = await cRes.json();
            const disposable = m.languages.typescript.javascriptDefaults.addExtraLib(
              data.content,
              `file:///libraries/${lib.filename}`
            );
            this._libDisposables.push(disposable);
          }
        } catch (e) {
          // skip library that failed to load
        }
      }
    } catch (e) {
      console.warn('IntelliSense Load Error', e);
    }
  };

  private _registerCompletionProviders(): void {
    const m = this._monaco;
    if (!m) return;
    const languages = ['javascript', 'typescript'];

    for (const lang of languages) {
      // MDI Icons
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['"', "'", ':', ' '],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          if (
            textUntilPosition.match(/(@icon\s+|icon["']?\s*[:=]\s*["'])(mdi:)?$/) ||
            textUntilPosition.endsWith('mdi:')
          ) {
            const icons =
              window.mdiIcons && window.mdiIcons.length > 0
                ? window.mdiIcons
                : [
                    'account',
                    'home',
                    'lightbulb',
                    'switch',
                    'bell',
                    'check',
                    'alert',
                    'calendar',
                    'clock',
                    'weather-sunny',
                    'water',
                    'thermometer',
                    'battery',
                    'wifi',
                  ];
            return {
              suggestions: icons.map((i) => ({
                label: `mdi:${i}`,
                kind: m.languages.CompletionItemKind.Value,
                insertText: textUntilPosition.endsWith('mdi:') ? i : `mdi:${i}`,
                documentation: { value: `!Preview \n\n **mdi:${i}**`, isTrusted: true },
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }
          return { suggestions: [] };
        },
      });

      // ha.call / ha.callService services + fields
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const lookahead = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column + 2,
          });

          let charsToReplace = 0;
          if (lookahead.startsWith("'") || lookahead.startsWith('"')) {
            charsToReplace = 1;
            if (lookahead.length > 1 && lookahead[1] === ')') charsToReplace = 2;
          }
          const rangeToReplace = new m.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column + charsToReplace
          );

          if (textUntilPosition.match(/ha\.call\(\s*['"](?:[^'"]*)$/)) {
            const suggestions: import('monaco-editor').languages.CompletionItem[] = [];
            const services = window.haData?.services;
            if (services) {
              for (const domain in services) {
                const domainServices = services[domain] as Record<string, unknown>;
                for (const service in domainServices) {
                  const id = `${domain}.${service}`;
                  const serviceObj = domainServices[service] as {
                    description?: string;
                    fields?: Record<string, { required?: boolean }>;
                  };
                  const desc = serviceObj.description || '';
                  const fields = serviceObj.fields || {};
                  const fieldNames = Object.keys(fields);

                  const requiredFields = fieldNames.filter((f) => fields[f]?.required);
                  const common = ['entity_id', 'media_player_entity_id', 'message', 'value', 'target', 'title'];
                  const priorityFields = common.filter((f) => fieldNames.includes(f) && !requiredFields.includes(f));
                  let snippetFields = [...requiredFields, ...priorityFields];

                  if (snippetFields.length === 0) {
                    if (
                      [
                        'light',
                        'switch',
                        'input_boolean',
                        'automation',
                        'script',
                        'scene',
                        'fan',
                        'cover',
                        'lock',
                      ].includes(domain)
                    ) {
                      snippetFields = ['entity_id'];
                    }
                  }

                  let insertText = id;
                  if (snippetFields.length > 0) {
                    const props = snippetFields.map((f, i) => `${f}: '\${${i + 1}:${f}}'`).join(', ');
                    insertText = `${id}', { ${props} })`;
                  } else if (fieldNames.length > 0) {
                    insertText = `${id}', { \${1:} })`;
                  }

                  suggestions.push({
                    label: id,
                    kind: m.languages.CompletionItemKind.Method,
                    insertText,
                    insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: rangeToReplace,
                    documentation: { value: desc, isTrusted: true },
                    detail: 'Service',
                  });
                }
              }
            }
            return { suggestions: suggestions.sort((a, b) => String(a.label).localeCompare(String(b.label))) };
          }

          if (textUntilPosition.match(/ha\.callService\(\s*['"](?:[^'"]*)$/)) {
            const services = window.haData?.services;
            const domains =
              services && Object.keys(services).length > 0
                ? Object.keys(services).sort()
                : ['light', 'switch', 'notify', 'media_player', 'climate', 'automation', 'script', 'scene', 'tts'];
            return {
              suggestions: domains.map((d) => ({
                label: d,
                kind: m.languages.CompletionItemKind.Module,
                insertText: d,
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }

          const serviceMatch = textUntilPosition.match(/ha\.callService\(\s*['"]([^'"]+)['"]\s*,\s*['"](?:[^'"]*)$/);
          if (serviceMatch) {
            const domain = serviceMatch[1];
            const servicesForDomain = window.haData?.services?.[domain] as
              Record<string, { description?: string }> | undefined;
            let services: string[];
            let serviceData: Record<string, { description?: string }> = {};

            if (servicesForDomain) {
              services = Object.keys(servicesForDomain).sort();
              serviceData = servicesForDomain;
            } else {
              services = ['turn_on', 'turn_off', 'toggle', 'reload'];
              if (domain === 'media_player') services = ['play_media', 'media_pause', 'media_play', 'volume_set'];
            }

            const textAfter = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: model.getLineMaxColumn(position.lineNumber),
            });
            const hasArgs = !!textAfter.match(/^\s*['"]\s*,/);

            return {
              suggestions: services.map((s) => {
                const item: import('monaco-editor').languages.CompletionItem = {
                  label: s,
                  kind: m.languages.CompletionItemKind.Function,
                  insertText: hasArgs ? s : `${s}', { entity_id: '\${1}' })`,
                  insertTextRules: hasArgs
                    ? m.languages.CompletionItemInsertTextRule.None
                    : m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range: hasArgs ? (undefined as unknown as import('monaco-editor').IRange) : rangeToReplace,
                };
                if (serviceData[s]?.description) {
                  item.documentation = { value: serviceData[s].description as string, isTrusted: true };
                }
                return item;
              }),
            };
          }
          return { suggestions: [] };
        },
      });

      // HA entities
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: (model, position, context) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          if (
            textUntilPosition.match(
              /ha\.(entity|update|on|waitFor|select|onStateChange|getState|getAttr|getStateValue|getGroupMembers)\(\s*['"]$/
            ) ||
            textUntilPosition.match(/ha\.states\[\s*['"]$/) ||
            textUntilPosition.match(/ha\.(on|waitFor|select)\(\s*\[[^\]]*['"]$/)
          ) {
            return {
              suggestions: this._allEntities.map((e) => ({
                label: e,
                kind: m.languages.CompletionItemKind.Constant,
                insertText: e,
                detail: 'Entity',
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }

          const keyMatch = textUntilPosition.match(/(entity_id|media_player_entity_id)["']?\s*:\s*['"]$/);
          if (keyMatch) {
            const fieldName = keyMatch[1];
            let domainFilter: string | null = null;

            const startLine = Math.max(1, position.lineNumber - 50);
            const textContext = model.getValueInRange({
              startLineNumber: startLine,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });

            const callMatches = [...textContext.matchAll(/ha\.(call|callService)\s*\(\s*['"]([^'"]+)['"]/g)];
            if (callMatches.length > 0) {
              const lastMatch = callMatches[callMatches.length - 1];
              const method = lastMatch[1];
              const servicePath = lastMatch[2];
              const textAfterMatch = textContext.substring(lastMatch.index ?? 0);
              let openParens = 0;
              for (const char of textAfterMatch) {
                if (char === '(') openParens++;
                if (char === ')') openParens--;
              }
              if (openParens > 0) {
                const serviceDomain = method === 'call' ? servicePath.split('.')[0] : servicePath;
                if (fieldName === 'media_player_entity_id' || serviceDomain === 'tts') {
                  domainFilter = 'media_player';
                } else {
                  domainFilter = serviceDomain;
                }
              }
            }

            let entities = this._allEntities;
            const ignoredDomains = ['homeassistant', 'notify'];
            if (domainFilter && !ignoredDomains.includes(domainFilter)) {
              const filtered = this._allEntities.filter((e) => e.startsWith(domainFilter + '.'));
              if (filtered.length > 0) entities = filtered;
            }

            return {
              suggestions: entities.map((e) => ({
                label: e,
                kind: m.languages.CompletionItemKind.Constant,
                insertText: e,
                detail: 'Entity',
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }

          if (context && context.triggerKind === m.languages.CompletionTriggerKind.Invoke) {
            const singleQuotes = (textUntilPosition.match(/'/g) || []).length;
            const doubleQuotes = (textUntilPosition.match(/"/g) || []).length;
            if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) {
              return {
                suggestions: this._allEntities.map((e) => ({
                  label: e,
                  kind: m.languages.CompletionItemKind.Constant,
                  insertText: e,
                  detail: 'Entity',
                  range: undefined as unknown as import('monaco-editor').IRange,
                })),
              };
            }
          }
          return { suggestions: [] };
        },
      });

      // device_class enum
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          if (textUntilPosition.match(/device_class["']?\s*:\s*['"]$/)) {
            const classes = [
              'aqi',
              'battery',
              'carbon_dioxide',
              'carbon_monoxide',
              'current',
              'date',
              'distance',
              'duration',
              'energy',
              'frequency',
              'gas',
              'humidity',
              'illuminance',
              'monetary',
              'motion',
              'nitrogen_dioxide',
              'occupancy',
              'opening',
              'ozone',
              'pm1',
              'pm10',
              'pm25',
              'power',
              'power_factor',
              'pressure',
              'signal_strength',
              'smoke',
              'speed',
              'temperature',
              'timestamp',
              'voltage',
              'volume',
              'water',
              'weight',
              'wind_speed',
            ];
            return {
              suggestions: classes.map((c) => ({
                label: c,
                kind: m.languages.CompletionItemKind.EnumMember,
                insertText: c,
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }
          return { suggestions: [] };
        },
      });

      // Store keys
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          if (textUntilPosition.match(/ha\.store\.(get|set|delete)\(\s*['"]$/)) {
            return {
              suggestions: this._allStoreKeys.map((item) => ({
                label: item.key,
                kind: m.languages.CompletionItemKind.Field,
                insertText: item.key,
                detail: item.type,
                documentation: {
                  value: `**Store Key:** \`${item.key}\`\n\n**Type:** \`${item.type}\``,
                  isTrusted: true,
                },
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }
          return { suggestions: [] };
        },
      });

      // State-change filter (gt/lt/...) + threshold values
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"', ',', ' '],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          if (textUntilPosition.match(/ha\.(on|waitFor)\(\s*['"][^'"]+['"]\s*,\s*['"]$/)) {
            const filters = [
              { label: 'eq', doc: 'Equal to (==)' },
              { label: 'ne', doc: 'Not equal to (!=)' },
              { label: 'gt', doc: 'Greater than (>)' },
              { label: 'ge', doc: 'Greater than or equal to (>=)' },
              { label: 'lt', doc: 'Less than (<)' },
              { label: 'le', doc: 'Less than or equal to (<=)' },
            ];
            return {
              suggestions: filters.map((f) => ({
                label: f.label,
                kind: m.languages.CompletionItemKind.EnumMember,
                insertText: f.label,
                documentation: f.doc,
                detail: 'Change Filter',
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }

          const thresholdMatch = textUntilPosition.match(
            /ha\.(on|waitFor)\(\s*['"][^'"]+['"]\s*,\s*['"](gt|ge|lt|le|eq|ne)['"]\s*,\s*$/
          );
          if (thresholdMatch) {
            const filter = thresholdMatch[2];
            const isNumeric = ['gt', 'ge', 'lt', 'le'].includes(filter);
            const suggestions = isNumeric
              ? [
                  { label: '0', insertText: '0', detail: 'Numeric Threshold' },
                  { label: '10', insertText: '10', detail: 'Numeric Threshold' },
                  { label: '20', insertText: '20', detail: 'Numeric Threshold' },
                  { label: '50', insertText: '50', detail: 'Numeric Threshold' },
                ]
              : [
                  { label: "'on'", insertText: "'on'", detail: 'State' },
                  { label: "'off'", insertText: "'off'", detail: 'State' },
                ];
            return {
              suggestions: suggestions.map((s) => ({
                ...s,
                kind: m.languages.CompletionItemKind.Value,
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }
          return { suggestions: [] };
        },
      });

      // @include library names
      m.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [' ', '@', ','],
        provideCompletionItems: (model, position) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          if (textUntilPosition.endsWith('@')) {
            return {
              suggestions: [
                {
                  label: 'include',
                  kind: m.languages.CompletionItemKind.Keyword,
                  insertText: 'include ',
                  documentation: 'Include a global library from the libraries folder.',
                  range: undefined as unknown as import('monaco-editor').IRange,
                },
              ],
            };
          }

          if (textUntilPosition.match(/@include\s+[^,]*$/) || textUntilPosition.match(/@include\s+.*,\s*[^,]*$/)) {
            const libs = (window.allScripts ?? []).filter(
              (s) => s.path && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\'))
            );
            return {
              suggestions: libs.map((l) => ({
                label: l.filename,
                kind: m.languages.CompletionItemKind.File,
                insertText: l.filename,
                detail: 'Library',
                documentation: l.description || l.filename,
                range: undefined as unknown as import('monaco-editor').IRange,
              })),
            };
          }
          return { suggestions: [] };
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Snippet system — ported from editor-snippets.js.
  // -------------------------------------------------------------------------

  private _insertSnippet(id: string, mode: 'full' | 'minimal' = 'full', variant: string | null = null): void {
    if (!this._editor) return;
    const def = SNIPPET_REGISTRY.find((s) => s.id === id);
    if (!def) return;
    const template = this._resolveTemplate(def, mode, variant);
    if (!template) return;

    this._editor.focus();
    const contribution = this._editor.getContribution('snippetController2') as unknown as {
      insert(template: string): void;
    };
    contribution.insert(template);
  }

  private _resolveTemplate(def: SnippetDef, mode: 'full' | 'minimal', variant: string | null): string | null {
    if (mode === 'full' && def.variants) {
      if (variant && def.variants[variant]) return def.variants[variant];
      return def.minimal;
    }
    return mode === 'full' ? def.full || def.minimal : def.minimal;
  }

  /** Shift+Enter (full) / Ctrl+Shift+Enter (minimal) — finds the snippet matching the ha.*
   * expression immediately left of the cursor, deletes it, inserts the resolved snippet. */
  private _resolveAndInsertFromCursor(mode: 'full' | 'minimal'): boolean {
    if (!this._editor || !this._monaco) return false;
    const model = this._editor.getModel();
    const pos = this._editor.getPosition();
    if (!model || !pos) return false;

    const lineText = model.getLineContent(pos.lineNumber);
    const textLeft = lineText.slice(0, pos.column - 1);

    const allTriggers: { trigger: string; def: SnippetDef }[] = [];
    for (const def of SNIPPET_REGISTRY) {
      for (const t of def.triggers) allTriggers.push({ trigger: t, def });
    }
    allTriggers.sort((a, b) => b.trigger.length - a.trigger.length);

    let matchedDef: SnippetDef | null = null;
    let matchedText = '';
    for (const { trigger, def } of allTriggers) {
      if (textLeft.endsWith(trigger)) {
        matchedDef = def;
        matchedText = trigger;
        break;
      }
    }
    if (!matchedDef) return false;

    let variant: string | null = null;
    if (matchedDef.id === 'register' && mode === 'full') {
      variant = this._detectRegisterDomain(textLeft, lineText);
      if (!variant) {
        this._openRegisterPicker(matchedText, pos);
        return true;
      }
    }

    const col = pos.column;
    const deleteRange = new this._monaco.Range(pos.lineNumber, col - matchedText.length, pos.lineNumber, col);
    this._editor.executeEdits('snippet-trigger', [{ range: deleteRange, text: '' }]);
    this._editor.setPosition({ lineNumber: pos.lineNumber, column: col - matchedText.length });

    this._insertSnippet(matchedDef.id, mode, variant);
    return true;
  }

  private _detectRegisterDomain(textLeft: string, fullLine: string): string | null {
    const combined = (textLeft + fullLine).toLowerCase();
    for (const domain of REGISTER_DOMAINS) {
      if (combined.includes(`'${domain}.`) || combined.includes(`"${domain}.`)) return domain;
    }
    return null;
  }

  private _registerSnippetContextMenu(): void {
    if (!this._editor) return;
    for (const def of SNIPPET_REGISTRY) {
      if (!def.contextMenu) continue;
      this._editor.addAction({
        id: `snip-${def.id}`,
        label: this._t(def.labelKey, def.id),
        contextMenuGroupId: def.contextMenu.group,
        contextMenuOrder: def.contextMenu.order,
        run: () => this._insertSnippet(def.id, 'full'),
      });
    }
  }

  private _registerSnippetKeybindings(): void {
    if (!this._editor || !this._monaco) return;
    const m = this._monaco;
    this._editor.addCommand(m.KeyMod.Shift | m.KeyCode.Enter, () => {
      const inserted = this._resolveAndInsertFromCursor('full');
      if (!inserted) this._editor!.trigger('keyboard', 'type', { text: '\n' });
    });
    this._editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.Enter, () => {
      const inserted = this._resolveAndInsertFromCursor('minimal');
      if (!inserted) this._editor!.trigger('keyboard', 'type', { text: '\n' });
    });
  }

  // -- Floating pickers, rebuilt as real LIT-rendered popovers ---------------

  private _openRegisterPicker(matchedText: string, cursorPos: { lineNumber: number; column: number }): void {
    if (!this._editor || !this._monaco) return;
    this._pendingRegisterMatch = { text: matchedText, pos: cursorPos };

    const layoutInfo = this._editor.getLayoutInfo();
    const scrolledTop = this._editor.getScrollTop();
    const lineHeight = this._editor.getOption(this._monaco.editor.EditorOption.lineHeight) as number;
    const editorRect = this._editor.getDomNode()!.getBoundingClientRect();

    this._registerPickerPos = {
      top: editorRect.top + (cursorPos.lineNumber - 1) * lineHeight - scrolledTop + lineHeight + 4,
      left: editorRect.left + layoutInfo.contentLeft + 8,
    };
    this._registerPickerOpen = true;
  }

  private _pickRegisterDomain(domain: string): void {
    if (!this._editor || !this._monaco || !this._pendingRegisterMatch) return;
    const { text, pos } = this._pendingRegisterMatch;
    const col = pos.column;
    const deleteRange = new this._monaco.Range(pos.lineNumber, col - text.length, pos.lineNumber, col);
    this._editor.executeEdits('snippet-trigger', [{ range: deleteRange, text: '' }]);
    this._editor.setPosition({ lineNumber: pos.lineNumber, column: col - text.length });

    this._registerPickerOpen = false;
    this._pendingRegisterMatch = null;
    this._insertSnippet('register', 'full', domain);
  }

  private _toggleSnippetMenu(anchorEl: HTMLElement): void {
    if (this._snippetMenuOpen) {
      this._snippetMenuOpen = false;
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    this._snippetMenuPos = { top: rect.bottom + 4, left: rect.left };
    this._snippetMenuOpen = true;
  }

  private _pickSnippet(id: string): void {
    this._snippetMenuOpen = false;
    this._insertSnippet(id, 'full');
  }

  // -------------------------------------------------------------------------

  render() {
    const activeGroups = TOOLBAR_GROUPS_BY_MODE[this._mode] ?? TOOLBAR_GROUPS_BY_MODE.script;

    return html`
      ${mdiStylesheetLink}
      <!-- Monaco's AMD loader injects its core editor.main.css into document.head once at
           module-load time — that never reaches this component's Shadow DOM (same class of
           bug as the MDI icon fix above), so it's duplicated here explicitly. The browser's
           HTTP cache makes the repeat fetch free after the first load. -->
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/editor/editor.main.css"
      />
      <div id="monaco-container"></div>

      ${
        this._registerPickerOpen
          ? html`
              <div
                class="snippet-menu"
                style="top:${this._registerPickerPos.top}px; left:${this._registerPickerPos.left}px;"
                @click=${(e: Event) => e.stopPropagation()}
              >
                <div class="picker-label">${this._t('wizard_label_language', 'ha.register — Entity type')}</div>
                ${REGISTER_DOMAINS.map(
                  (domain) => html`<button @click=${() => this._pickRegisterDomain(domain)}>${domain}</button>`
                )}
              </div>
            `
          : nothing
      }
      ${
        this._snippetMenuOpen
          ? html`
              <div
                class="snippet-menu"
                style="top:${this._snippetMenuPos.top}px; left:${this._snippetMenuPos.left}px;"
                @click=${(e: Event) => e.stopPropagation()}
              >
                ${activeGroups.map((group, i) => {
                  const entries = SNIPPET_REGISTRY.filter((s) => s.toolbarGroup === group);
                  if (entries.length === 0) return nothing;
                  return html`
                    ${i > 0 ? html`<div class="group-sep"></div>` : nothing}
                    ${entries.map(
                      (def) => html`
                        <button @click=${() => this._pickSnippet(def.id)}>
                          <i class="mdi ${def.icon}"></i><span>${this._t(def.labelKey, def.id)}</span>
                        </button>
                      `
                    )}
                  `;
                })}
              </div>
            `
          : nothing
      }
    `;
  }

  // Public accessors used by <editor-view>'s toolbar for the word-wrap / snippet buttons it
  // renders alongside its own — kept as plain methods rather than forcing editor-view to reach
  // into this component's private state.
  toggleWordWrap(): void {
    this._toggleWordWrap();
  }

  get wordWrapEnabled(): boolean {
    return this._wordWrap === 'on';
  }

  openSnippetMenu(anchorEl: HTMLElement): void {
    this._toggleSnippetMenu(anchorEl);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'monaco-editor': MonacoEditorElement;
  }
}
