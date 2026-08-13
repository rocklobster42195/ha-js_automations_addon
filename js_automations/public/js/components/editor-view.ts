import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaTab, JsaSettings } from './global';
import type { MonacoEditorElement } from './monaco-editor';
import './monaco-editor';

// Not real files — virtual view of a script's __JSA_CARD__ block.
const CARD_TAB_SUFFIX = '[card]';

// "Hat" block types (no previous/next connection) that start a run — a workspace with none of
// these compiles to valid but inert code (nothing ever calls into it). Kept in sync by hand with
// blockly-blocks.js's trigger block definitions; there's no single source of truth to derive
// this list from without also loading Blockly itself in this file.
const BLOCKLY_TRIGGER_TYPES = [
  'ha_trigger_on',
  'ha_trigger_on_state',
  'ha_schedule_interval',
  'ha_schedule_daily',
  'ha_schedule_cron',
  'ha_store_on',
  'ha_mqtt_subscribe',
  'ha_on_webhook',
];

function blocklyWorkspaceHasTrigger(blocksState: { blocks: unknown } | null | undefined): boolean {
  const blocks = blocksState?.blocks as { blocks?: { type: string }[] } | undefined;
  const topBlocks = blocks?.blocks ?? [];
  return topBlocks.some((b) => BLOCKLY_TRIGGER_TYPES.includes(b.type));
}

function isVirtualTab(filename: string | null | undefined): boolean {
  return !filename || filename.startsWith('System: ') || filename.endsWith(CARD_TAB_SUFFIX);
}

function isLibraryScript(filename: string): boolean {
  const script = window.allScripts?.find((s) => s.filename === filename);
  return !!(script?.path && (script.path.includes('/libraries/') || script.path.includes('\\libraries\\')));
}

/**
 * Tab lifecycle + toolbar shell for the script editor (RFC Phase B item 8), replacing
 * tab-manager.js. Embeds `<monaco-editor>` for the Monaco-tab path; the Blockly-tab path keeps
 * calling into blockly-editor.js's existing vanilla bridge (`window.ensureBlocklyReady` etc. —
 * Blockly integration is out of scope for this migration).
 *
 * `#blockly-container` is projected via a named slot rather than owned in this component's own
 * Shadow DOM: blockly-editor.js does `document.getElementById('blockly-container')` directly,
 * and moving that div behind a shadow boundary would silently break that lookup. Slotted content
 * physically stays in the light DOM, so the id lookup keeps working unchanged — see index.html.
 *
 * `window.openTabs` is the exact same array as this component's own `_openTabs` (never
 * reassigned, only mutated in place) because store-explorer.ts, settings-view.ts, and
 * reference.js already push directly onto it and then call `window.renderTabs?.()` — matching
 * that existing contract instead of requiring three call sites elsewhere to change.
 */
@customElement('editor-view')
export class EditorViewElement extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    #tab-bar {
      display: flex;
      background: var(--surface-1);
      width: 100%;
      height: 45px;
      flex-shrink: 0;
      overflow-x: auto;
      border-bottom: 1px solid var(--border);
      -ms-overflow-style: none;
    }
    #tab-bar::-webkit-scrollbar {
      display: none;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 15px;
      border-right: 1px solid var(--surface-0);
      cursor: pointer;
      font-size: 0.85rem;
      font-family: monospace;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .tab:hover {
      background: #2a2a2a;
    }
    .tab.active {
      background: var(--surface-0);
      color: var(--text-primary);
    }
    .tab .tab-icon {
      font-size: 1rem;
    }
    .status-running {
      color: var(--accent) !important;
    }
    .status-error {
      color: var(--danger) !important;
    }
    .tab-filename {
      flex-grow: 1;
    }
    .lang-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      text-transform: uppercase;
      margin-right: 6px;
      vertical-align: middle;
    }
    .lang-badge-js {
      background-color: #f7df1e;
      color: #000;
    }
    .lang-badge-ts {
      background-color: #3178c6;
      color: #fff;
    }
    .lang-badge-blocks {
      background-color: #4caf50;
      color: #fff;
    }
    .tab-close-container {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: 8px;
    }
    .tab-close-btn {
      width: 100%;
      height: 100%;
      border-radius: 4px;
      color: var(--text-muted) !important;
      font-size: 1.1rem !important;
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      align-items: center;
      justify-content: center;
    }
    .tab-close-btn:hover {
      color: #fff !important;
      background: #333 !important;
    }
    .tab-dirty-dot {
      font-size: 1.2rem;
      color: var(--accent);
      line-height: 1;
      display: none;
    }
    .tab:hover .tab-close-btn,
    .tab.active .tab-close-btn {
      display: flex;
    }
    .tab.dirty .tab-dirty-dot {
      display: block;
    }
    .tab.dirty:hover .tab-dirty-dot {
      display: none;
    }
    .tab.dirty:hover .tab-close-btn {
      display: flex;
    }
    .tab.dirty:not(:hover) .tab-close-btn {
      display: none;
    }
    .tab.card-tab .tab-icon {
      color: var(--accent);
      opacity: 0.8;
    }
    .tab.card-tab .tab-filename {
      font-style: italic;
      opacity: 0.9;
    }

    .editor-toolbar {
      background: #111;
      height: 45px;
      padding: 0 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .editor-toolbar button {
      color: var(--text-secondary);
      font-size: 1.3rem;
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .editor-toolbar button:hover:not(:disabled) {
      color: var(--text-primary);
      background: #252525;
    }
    .editor-toolbar button:disabled {
      cursor: default;
    }
    .editor-toolbar button.preview-active {
      color: var(--accent);
    }
    .toolbar-separator {
      width: 1px;
      height: 24px;
      background: var(--border);
      margin: 0 8px;
    }

    .editor-panel {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .editor-body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .editor-body monaco-editor {
      flex: 1;
      min-height: 0;
    }

    .mode-banner {
      padding: 4px 10px;
      font-size: 0.8rem;
      border-bottom: 1px solid;
    }
    .mode-banner.card {
      background: #1a1f2e;
      color: var(--accent);
      border-bottom-color: var(--accent-dark, #1a4a8a);
    }
    .mode-banner.lib {
      background: #1e2a36;
      color: #64b5f6;
      border-bottom-color: #0d47a1;
    }
    .mode-banner i {
      margin-right: 6px;
    }
  `;

  /** Same array as window.openTabs — see class doc comment for why this is never reassigned. */
  private _openTabs: JsaTab[] = [];
  /** Filenames currently mid-fetch in openOrSwitchToTab — guards against a second concurrent
   * call for the same file (e.g. a restored-tab call racing a user click) both passing the
   * "not open yet" check and calling monacoEditor.createModel() for the same URI twice, which
   * throws "Cannot add model because it already exists" and leaves the editor half-initialized. */
  private _pendingTabOpens = new Set<string>();
  /** Bumped whenever _openTabs is mutated in place, or _activeTabFilename's window-backed
   * value changes, to force a re-render (LIT can't observe either on its own). */
  @state() private _tabsVersion = 0;

  /** Backed by window.activeTabFilename itself (not a separate field) so that script-modal.ts's
   * existing direct write to window.activeTabFilename — followed by its existing
   * window.renderTabs?.() call — keeps working without having to route through the heavier
   * switchToTab(), which would wrongly reload the Blockly workspace / reset Monaco view state
   * for what both call sites intend as a same-tab rename, not a navigation. */
  private get _activeTabFilename(): string | null {
    return window.activeTabFilename ?? null;
  }
  private set _activeTabFilename(value: string | null) {
    window.activeTabFilename = value;
    this._tabsVersion++;
  }
  @state() private _showingBlocklyCode = false;
  private _blocklyCodeModel: unknown = null;
  /** Toolbar-visibility half of the old applyEditorSettings() — the Monaco-options half
   * (fontSize/wordWrap/minimap) lives in <monaco-editor> itself. */
  @state() private _toolbarHidden = false;

  @query('monaco-editor') private _monacoEditorEl?: MonacoEditorElement;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.openTabs = this._openTabs;
    window.renderTabs = this._renderTabs;
    window.openOrSwitchToTab = this.openOrSwitchToTab;
    window.openCardTab = this.openCardTab;
    window.toggleCardTab = this.toggleCardTab;
    window.switchToTab = this.switchToTab;
    window.closeTab = this.closeTab;
    window.saveActiveTab = this.saveActiveTab;
    window.closeAllTabs = this.closeAllTabs;
    window.toggleActiveScript = this.toggleActiveScript;
    window.restartActiveScript = this.restartActiveScript;
    window.editActiveScript = this.editActiveScript;
    window.deleteActiveScript = this.deleteActiveScript;
    window.duplicateActiveScript = this.duplicateActiveScript;
    window.downloadActiveScript = this.downloadActiveScript;
    window.updateToolbarUI = () => this.requestUpdate();
    window.onBlocklyWorkspaceChanged = this._onBlocklyWorkspaceChanged;
    window.toggleShowCode = this._toggleShowCode;

    // Ctrl+S for Monaco tabs is handled inside <monaco-editor> (only fires while Monaco itself
    // has focus). Blockly tabs have no Monaco focus target (the workspace is an SVG canvas), so
    // that binding never sees the keypress — without this, the browser's native "Save Page As"
    // dialog opens instead.
    document.addEventListener('keydown', this._onGlobalKeydown);

    // Toolbar-visibility half of the old applyEditorSettings() (see field doc comment above).
    window.addEventListener('settings-changed', this._onSettingsChanged);
    if (window.currentSettings) {
      setTimeout(() => this._applyToolbarVisibility(window.currentSettings), 100);
    }

    // <card-preview> dispatches this on open/close — see that component's own _syncPreviewBtn()
    // doc comment for why a window event is needed instead of a direct DOM query.
    window.addEventListener('card-preview-toggled', this._onCardPreviewToggled);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onGlobalKeydown);
    window.removeEventListener('settings-changed', this._onSettingsChanged);
    window.removeEventListener('card-preview-toggled', this._onCardPreviewToggled);
  }

  private _onCardPreviewToggled = (): void => {
    this.requestUpdate();
  };

  private _onGlobalKeydown = (e: KeyboardEvent): void => {
    const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
    if (!isSaveShortcut) return;
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (activeTab?.type === 'blockly') {
      e.preventDefault();
      this.saveActiveTab();
    }
  };

  private _onSettingsChanged = (e: Event): void => {
    this._applyToolbarVisibility((e as CustomEvent<JsaSettings>).detail);
  };

  private _applyToolbarVisibility(settings: JsaSettings | null | undefined): void {
    if (!settings?.editor) return;
    const shouldHide = !settings.editor.showToolbar;
    if (this._toolbarHidden !== shouldHide) {
      this._toolbarHidden = shouldHide;
      setTimeout(() => window.monacoEditor?.layout(), 0);
    }
  }

  private _renderTabs = (): void => {
    this._tabsVersion++;
  };

  private _onBlocklyWorkspaceChanged = (): void => {
    const tab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (!tab || tab.type !== 'blockly') return;
    const current = JSON.stringify(window.getBlocklyWorkspaceState?.());
    const isNowDirty = current !== tab.originalBlocksJson;
    if (tab.isDirty !== isNowDirty) {
      tab.isDirty = isNowDirty;
      this._renderTabs();
    }
  };

  // -------------------------------------------------------------------------
  // Tab lifecycle
  // -------------------------------------------------------------------------

  openOrSwitchToTab = async (filename: string, icon?: string): Promise<void> => {
    if (!window.monacoEditor?.isReady()) {
      setTimeout(() => this.openOrSwitchToTab(filename, icon), 500);
      return;
    }

    document.getElementById('editor-section')?.classList.remove('hidden');

    const existingTab = this._openTabs.find((t) => t.filename === filename);
    if (existingTab) {
      this.switchToTab(filename);
      return;
    }

    // A concurrent call for the same file is already fetching/creating its model — don't
    // race it. Once it lands, `existingTab` above will pick it up.
    if (this._pendingTabOpens.has(filename)) return;
    this._pendingTabOpens.add(filename);

    try {
      const res = await window.apiFetch!(`api/scripts/${filename}/content`);
      const data = await res.json();

      if (filename.endsWith('.blocks')) {
        await this.openBlocklyTab(filename, icon ?? '', data.content);
        return;
      }

      const language = window.getLanguageByFilename ? window.getLanguageByFilename(filename) : 'javascript';
      const newTab: JsaTab = {
        filename,
        icon: icon ?? '',
        model: null,
        isDirty: false,
        originalContent: data.content,
        viewState: null,
      };
      newTab.model = window.monacoEditor.createModel(data.content, language, filename, (model) => {
        const isNowDirty = window.monacoEditor!.getModelValue(model) !== newTab.originalContent;
        if (newTab.isDirty !== isNowDirty) {
          newTab.isDirty = isNowDirty;
          this._renderTabs();
        }
      });

      this._openTabs.push(newTab);
      this.switchToTab(filename);

      // Auto-open paired card tab if the script has a @card header
      if (/^\s*\*\s*@card\b/m.test(data.content)) {
        const cardTabName = filename + CARD_TAB_SUFFIX;
        if (!this._openTabs.find((t) => t.filename === cardTabName)) {
          await this.openCardTab(filename);
        }
      }
    } catch (e) {
      console.error(`Failed to open script ${filename}`, e);
      document.getElementById('editor-section')?.classList.add('hidden');
    } finally {
      this._pendingTabOpens.delete(filename);
    }
  };

  /** Opens a `.blocks` file in the Blockly editor. Unlike Monaco tabs, there is no persistent
   * per-tab model — the tab keeps its own serialized state (jsa + blocks JSON) and the single
   * shared workspace is loaded/saved from it on every switch. See blockly-editor.js. */
  private openBlocklyTab = async (filename: string, icon: string, rawContent: string): Promise<void> => {
    await window.ensureBlocklyReady?.();

    let parsed: { jsa?: Record<string, unknown>; blocks?: unknown; variables?: unknown };
    try {
      parsed = JSON.parse(rawContent || '{}');
    } catch {
      parsed = {};
    }
    const blocksState = {
      blocks: parsed.blocks || { languageVersion: 0, blocks: [] },
      variables: parsed.variables || [],
    };

    const newTab: JsaTab = {
      filename,
      icon,
      type: 'blockly',
      jsa: parsed.jsa || {},
      blocksState,
      isDirty: false,
      originalBlocksJson: JSON.stringify(blocksState),
      viewState: null,
      model: null,
    };

    this._openTabs.push(newTab);
    this.switchToTab(filename);
  };

  /** Opens a virtual card tab for a Script Pack script — fetches the decoded __JSA_CARD__
   * source and opens it in a Monaco model. */
  openCardTab = async (scriptFilename: string): Promise<void> => {
    if (!window.monacoEditor?.isReady()) {
      setTimeout(() => this.openCardTab(scriptFilename), 500);
      return;
    }

    const cardTabName = scriptFilename + CARD_TAB_SUFFIX;
    const existingTab = this._openTabs.find((t) => t.filename === cardTabName);
    if (existingTab) {
      this.switchToTab(cardTabName);
      return;
    }

    try {
      const res = await window.apiFetch!(`api/scripts/${scriptFilename}/card`);
      if (!res.ok) {
        console.error(`[CardTab] Unexpected error loading card for ${scriptFilename}`, res.status);
        return;
      }
      const data = await res.json();

      // isNew: no __JSA_CARD__ block exists yet — open with empty content, mark dirty so
      // Ctrl+S creates it. originalContent stays null (rather than '') so the dirty-check
      // below can tell "not yet saved" apart from "saved as empty string".
      const initialContent = data.isNew ? '' : data.content;
      const newTab: JsaTab = {
        filename: cardTabName,
        icon: 'view-dashboard',
        type: 'card',
        parentScript: scriptFilename,
        model: null,
        isDirty: data.isNew,
        originalContent: data.isNew ? null : data.content,
        viewState: null,
      };
      newTab.model = window.monacoEditor.createModel(
        initialContent,
        'javascript',
        `card__${scriptFilename}`,
        (model) => {
          const isNowDirty =
            newTab.originalContent === null
              ? true
              : window.monacoEditor!.getModelValue(model) !== newTab.originalContent;
          if (newTab.isDirty !== isNowDirty) {
            newTab.isDirty = isNowDirty;
            this._renderTabs();
          }
        }
      );

      // Insert card tab directly after its parent script tab
      const parentIndex = this._openTabs.findIndex((t) => t.filename === scriptFilename);
      if (parentIndex !== -1) {
        this._openTabs.splice(parentIndex + 1, 0, newTab);
      } else {
        this._openTabs.push(newTab);
      }

      this.switchToTab(cardTabName);

      // A brand-new card starts as a blank file with no scaffold at all - pre-fill it with the
      // card boilerplate as a live, tab-stop-navigable snippet (class name propagates to both
      // its occurrences) instead of leaving the user to find and trigger it manually.
      if (data.isNew) window.monacoEditor?.insertSnippet('card_litelement', 'full');
    } catch (e) {
      console.error(`[CardTab] Failed to open card tab for ${scriptFilename}`, e);
    }
  };

  /** Toggles the card tab for the currently active script tab open or closed — called from the
   * card-tab-toggle toolbar button. */
  toggleCardTab = async (): Promise<void> => {
    if (!this._activeTabFilename || this._activeTabFilename.endsWith(CARD_TAB_SUFFIX)) return;
    const cardTabName = this._activeTabFilename + CARD_TAB_SUFFIX;
    if (this._openTabs.some((t) => t.filename === cardTabName)) {
      await this.closeTab(cardTabName);
    } else {
      await this.openCardTab(this._activeTabFilename);
    }
  };

  switchToTab = (filename: string): void => {
    // Always leave any open "Show Code" view behind when switching tabs — it's a transient
    // per-session view toggle, not state worth persisting per tab, and leaving Monaco stuck in
    // readOnly mode for the next (non-Blockly) tab would be a real bug.
    if (this._showingBlocklyCode) this._exitBlocklyCodeView();

    if (this._activeTabFilename) {
      const oldTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
      if (oldTab?.type === 'blockly') {
        // No persistent Monaco-style model for Blockly — snapshot the live workspace into the
        // tab before swapping it out, so in-progress edits survive the tab switch.
        if (window.getBlocklyWorkspaceState) oldTab.blocksState = window.getBlocklyWorkspaceState();
      } else if (oldTab && oldTab.type !== 'store' && oldTab.type !== 'settings' && oldTab.type !== 'reference') {
        oldTab.viewState = window.monacoEditor?.saveViewState() ?? null;
      }
    }

    this._activeTabFilename = filename;
    const newTab = this._openTabs.find((t) => t.filename === filename);
    if (!newTab) return;

    // Virtual tabs (store/settings/reference) have a `type`; only real script tabs should
    // highlight a sidebar row.
    window.appSidebar?.setActiveScript(newTab.type ? null : filename);

    // Every "virtual view" (editor/store/settings/reference) shares the same main-content slot
    // inside #editor-section — always hide all of them first, then show only the active one.
    // <editor-view>'s own tab bar is NOT part of this — it stays visible regardless of which
    // view is active (see the showEditorBody computation in render()), so switching to Store or
    // Settings doesn't strand you unable to click back to an open script tab.
    document.getElementById('store-wrapper')?.classList.add('hidden');
    document.getElementById('settings-wrapper')?.classList.add('hidden');
    document.getElementById('reference-wrapper')?.classList.add('hidden');

    const blocklyContainer = this.querySelector<HTMLElement>('#blockly-container');

    if (newTab.type === 'store') {
      document.getElementById('store-wrapper')?.classList.remove('hidden');
      window.loadStoreData?.();
    } else if (newTab.type === 'settings') {
      document.getElementById('settings-wrapper')?.classList.remove('hidden');
      window.loadSettingsData?.();
    } else if (newTab.type === 'reference') {
      document.getElementById('reference-wrapper')?.classList.remove('hidden');
    } else if (newTab.type === 'blockly') {
      // <monaco-editor> has no model on a Blockly tab, so it just renders blank rather than
      // disappearing — without hiding it explicitly, it keeps its flex share of .editor-body
      // and squishes the Blockly canvas into half the available height.
      if (this._monacoEditorEl) this._monacoEditorEl.style.display = 'none';
      blocklyContainer?.classList.remove('hidden');

      if (window.isBlocklyReady?.()) {
        window.loadBlocklyWorkspace?.({
          jsa: newTab.jsa ?? {},
          blocks: newTab.blocksState?.blocks,
          variables: newTab.blocksState?.variables,
        });
        // Surfaces an error that happened while this script's tab wasn't the one on screen —
        // the common case for any trigger you can only fire from elsewhere in the UI (Store
        // Explorer, MQTT devtools, an external webhook call, ...).
        window.reapplyBlocklyError?.(newTab.filename);
      }
    } else {
      if (this._monacoEditorEl) this._monacoEditorEl.style.display = '';
      blocklyContainer?.classList.add('hidden');

      window.monacoEditor?.setMode(newTab.type === 'card' ? 'card' : 'script');
      window.monacoEditor?.setModel(newTab.model);
      if (newTab.viewState) window.monacoEditor?.restoreViewState(newTab.viewState);
      window.monacoEditor?.focus();
    }

    // Show preview button for card tabs AND for script tabs that have a @card header
    const isCardTab = newTab.type === 'card';
    let parentScriptForPreview: string | null = null;
    if (isCardTab) {
      parentScriptForPreview = newTab.parentScript ?? null;
    } else {
      const scriptMeta = window.allScripts?.find((s) => s.filename === filename);
      if (scriptMeta?.card) parentScriptForPreview = filename;
    }
    document.body.classList.toggle('card-tab-active', !!parentScriptForPreview);
    window._activeCardParentScript = parentScriptForPreview;

    this._renderTabs();
  };

  async closeTab(filename: string): Promise<void> {
    const tabToClose = this._openTabs.find((t) => t.filename === filename);
    if (!tabToClose) return;

    if (
      tabToClose.isDirty &&
      !(await window.confirmDialog?.confirm(this._t('confirm_discard_changes', undefined, { filename })))
    ) {
      return;
    }

    const index = this._openTabs.findIndex((t) => t.filename === filename);
    this._openTabs.splice(index, 1);

    window.monacoEditor?.disposeModel(tabToClose.model);

    // Cascade-close the paired card tab when its parent script is closed
    if (tabToClose.type !== 'card') {
      const cardTabName = filename + CARD_TAB_SUFFIX;
      const cardTabIndex = this._openTabs.findIndex((t) => t.filename === cardTabName);
      if (cardTabIndex !== -1) {
        const cardTab = this._openTabs[cardTabIndex];
        window.monacoEditor?.disposeModel(cardTab.model);
        this._openTabs.splice(cardTabIndex, 1);
        if (this._activeTabFilename === cardTabName) {
          this._activeTabFilename = null;
        }
      }
    }

    if (this._openTabs.length === 0) {
      document.getElementById('editor-section')?.classList.add('hidden');
      this._activeTabFilename = null;
      window.appSidebar?.setActiveScript(null);
      window.monacoEditor?.setModel(null);
    } else if (this._activeTabFilename === filename || this._activeTabFilename === null) {
      const newIndex = Math.max(0, index - 1);
      this.switchToTab(this._openTabs[Math.min(newIndex, this._openTabs.length - 1)].filename);
    }

    this._renderTabs();
  }

  saveActiveTab = async (): Promise<void> => {
    if (!this._activeTabFilename) return;
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (!activeTab || !activeTab.isDirty) return;

    if (activeTab.type === 'blockly') {
      const blocksState = window.getBlocklyWorkspaceState?.();
      if (!blocksState) return;
      // A script exposed as a switch/button (@expose) is legitimately trigger-less — toggling
      // it in HA calls startScript() directly, running the top-level blocks once. Only warn
      // when there's neither a trigger block nor any other way for the script to ever run.
      const isExposed = !!activeTab.jsa?.expose;
      if (!blocklyWorkspaceHasTrigger(blocksState) && !isExposed) {
        const proceed = await window.confirmDialog?.confirm(
          this._t(
            'blockly_no_trigger_warning',
            'This script has no trigger block, so it will never actually run when enabled. Save anyway?'
          )
        );
        if (!proceed) return;
      }
      activeTab.blocksState = blocksState;
      const content = JSON.stringify(
        { jsa: activeTab.jsa, blocks: blocksState.blocks, variables: blocksState.variables },
        null,
        2
      );

      await window.apiFetch!(`api/scripts/${this._activeTabFilename}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      activeTab.originalBlocksJson = JSON.stringify(blocksState);
      activeTab.isDirty = false;
      this._renderTabs();
      await window.loadScripts?.();
      return;
    }

    const content = window.monacoEditor?.getModelValue(activeTab.model) ?? '';

    if (activeTab.type === 'card') {
      await window.apiFetch!(`api/scripts/${activeTab.parentScript}/card`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      activeTab.originalContent = content;
      activeTab.isDirty = false;
      this._renderTabs();
      if (window.CardPreview?.isOpen()) window.CardPreview.reload();
      return;
    }

    await window.apiFetch!(`api/scripts/${this._activeTabFilename}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    activeTab.originalContent = content;
    activeTab.isDirty = false;
    this._renderTabs();
    await window.loadScripts?.();
  };

  closeAllTabs = async (): Promise<void> => {
    if (
      this._openTabs.some((t) => t.isDirty) &&
      !(await window.confirmDialog?.confirm(this._t('confirm_discard_all_changes')))
    ) {
      return;
    }
    this._openTabs.forEach((t) => window.monacoEditor?.disposeModel(t.model));
    this._openTabs.splice(0, this._openTabs.length);
    this._activeTabFilename = null;
    window.monacoEditor?.setModel(null);
    document.getElementById('editor-section')?.classList.add('hidden');
    this._renderTabs();
  };

  // -------------------------------------------------------------------------
  // "Show Code" — Blockly tabs only: toggles between the canvas and a read-only Monaco view of
  // the code the current workspace would compile to (live-generated in the browser, see
  // blockly-editor.js's getBlocklyGeneratedCode() — no server round-trip, so it reflects
  // unsaved edits too, unlike the last-compiled dist file).
  // -------------------------------------------------------------------------

  private _toggleShowCode = (): void => {
    const tab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (!tab || tab.type !== 'blockly') return;
    if (this._showingBlocklyCode) this._exitBlocklyCodeView();
    else this._enterBlocklyCodeView();
  };

  private _enterBlocklyCodeView(): void {
    if (!window.monacoEditor) return;
    this._showingBlocklyCode = true;
    this.querySelector<HTMLElement>('#blockly-container')?.classList.add('hidden');
    if (this._monacoEditorEl) this._monacoEditorEl.style.display = '';

    const code = window.getBlocklyGeneratedCode ? window.getBlocklyGeneratedCode() : '';
    if (this._blocklyCodeModel) window.monacoEditor.disposeModel(this._blocklyCodeModel);
    this._blocklyCodeModel = window.monacoEditor.createModel(code, 'javascript', '__blockly_code_preview__.js');
    window.monacoEditor.setModel(this._blocklyCodeModel);
    window.monacoEditor.setReadOnly(true);
  }

  private _exitBlocklyCodeView(): void {
    this._showingBlocklyCode = false;
    window.monacoEditor?.setReadOnly(false);
    if (this._blocklyCodeModel) {
      window.monacoEditor?.disposeModel(this._blocklyCodeModel);
      this._blocklyCodeModel = null;
    }
    if (this._monacoEditorEl) this._monacoEditorEl.style.display = 'none';
    this.querySelector<HTMLElement>('#blockly-container')?.classList.remove('hidden');
  }

  // -------------------------------------------------------------------------
  // Toolbar actions delegating to the active script (no-ops on virtual/card tabs)
  // -------------------------------------------------------------------------

  toggleActiveScript = async (): Promise<void> => {
    if (!isVirtualTab(this._activeTabFilename)) await window.toggleScript?.(this._activeTabFilename!);
  };

  restartActiveScript = async (): Promise<void> => {
    if (!isVirtualTab(this._activeTabFilename)) await window.restartScript?.(this._activeTabFilename!);
  };

  editActiveScript = async (): Promise<void> => {
    if (!isVirtualTab(this._activeTabFilename)) await window.editScript?.(this._activeTabFilename!);
  };

  duplicateActiveScript = async (): Promise<void> => {
    if (!isVirtualTab(this._activeTabFilename)) await window.duplicateScript?.(this._activeTabFilename!);
  };

  deleteActiveScript = async (): Promise<void> => {
    if (!isVirtualTab(this._activeTabFilename)) await window.deleteScript?.(this._activeTabFilename!);
  };

  downloadActiveScript = (): void => {
    if (isVirtualTab(this._activeTabFilename)) return;
    const link = document.createElement('a');
    link.href = (window.BASE_PATH ?? '/') + `api/scripts/${this._activeTabFilename}/download`;
    link.setAttribute('download', this._activeTabFilename!);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private _tabIcon(tab: JsaTab): { iconName: string; statusClass: string } {
    if (tab.type === 'card') return { iconName: 'view-dashboard', statusClass: '' };
    const scriptFromList = window.allScripts?.find((s) => s.filename === tab.filename);
    const effectiveIcon = scriptFromList ? scriptFromList.icon : tab.icon;
    let iconName = effectiveIcon ? effectiveIcon.split(':').pop()! : 'script-text';
    if (window.mdiIcons && window.mdiIcons.length > 0 && !window.mdiIcons.includes(iconName)) {
      iconName = 'script-text';
    }
    let statusClass = '';
    if (scriptFromList) {
      if (scriptFromList.running) statusClass = 'status-running';
      else if (scriptFromList.status === 'error') statusClass = 'status-error';
    }
    return { iconName, statusClass };
  }

  private _tabDisplayName(tab: JsaTab): string {
    if (tab.type === 'card') return (tab.parentScript ?? '').replace(/\.[^.]+$/, '') + ' ‹card›';
    return tab.filename;
  }

  private _renderTabBar() {
    return html`
      <div id="tab-bar">
        ${repeat(
          this._openTabs,
          (tab) => tab.filename,
          (tab, index) => {
            const { iconName, statusClass } = this._tabIcon(tab);
            const isCardTab = tab.type === 'card';
            const badge = !isCardTab && window.getLanguageBadge ? window.getLanguageBadge(tab.filename) : '';
            return html`
              <div
                class="tab ${tab.filename === this._activeTabFilename ? 'active' : ''} ${
                  tab.isDirty ? 'dirty' : ''
                } ${isCardTab ? 'card-tab' : ''}"
                draggable="true"
                data-filename=${tab.filename}
                @click=${() => this.switchToTab(tab.filename)}
                @dragstart=${(e: DragEvent) => {
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.setData('text/plain', String(index));
                  (e.currentTarget as HTMLElement).style.opacity = '0.5';
                }}
                @dragover=${(e: DragEvent) => {
                  e.preventDefault();
                  e.dataTransfer!.dropEffect = 'move';
                }}
                @dragend=${(e: DragEvent) => {
                  (e.currentTarget as HTMLElement).style.opacity = '';
                }}
                @drop=${(e: DragEvent) => {
                  e.preventDefault();
                  const oldIndex = parseInt(e.dataTransfer!.getData('text/plain'), 10);
                  if (!isNaN(oldIndex) && oldIndex !== index) {
                    const item = this._openTabs.splice(oldIndex, 1)[0];
                    this._openTabs.splice(index, 0, item);
                    this._renderTabs();
                  }
                }}
              >
                <i class="tab-icon mdi mdi-${iconName} ${statusClass}"></i>
                <span class="tab-filename ${statusClass}">${unsafeHTML(badge)}${this._tabDisplayName(tab)}</span>
                <div class="tab-close-container">
                  <span class="tab-dirty-dot">●</span>
                  <button
                    class="tab-close-btn"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.closeTab(tab.filename);
                    }}
                  >
                    <i class="mdi mdi-close"></i>
                  </button>
                </div>
              </div>
            `;
          }
        )}
      </div>
    `;
  }

  private _renderModeBanner(activeTab: JsaTab | undefined) {
    if (!activeTab) return nothing;
    if (activeTab.type === 'card') {
      return html`
        <div class="mode-banner card">
          <i class="mdi mdi-card-text-outline"></i>Card Editor —
          <strong>${activeTab.parentScript ?? ''}</strong> &nbsp;·&nbsp; Ctrl+S to save
        </div>
      `;
    }
    if (activeTab.type !== 'blockly' && isLibraryScript(activeTab.filename)) {
      return html`
        <div class="mode-banner lib">
          <i class="mdi mdi-bookshelf"></i>${unsafeHTML(
            this._t('library_mode_banner', undefined, { filename: activeTab.filename })
          )}
        </div>
      `;
    }
    return nothing;
  }

  private _renderToolbar(activeTab: JsaTab | undefined) {
    const filename = this._activeTabFilename;
    const isCardTab = !!filename?.endsWith(CARD_TAB_SUFFIX);
    const isSystemTab =
      filename === 'System: Store' || filename === 'System: Settings' || filename === 'System: Reference';
    const isBlocklyTab = activeTab?.type === 'blockly';
    const isDirty = !!activeTab?.isDirty;

    const script = filename && !isCardTab ? window.allScripts?.find((s) => s.filename === filename) : undefined;
    const isLib = filename ? isLibraryScript(filename) : false;
    const hasCard = !!(!isCardTab && script?.card);
    const cardTabOpen = filename ? this._openTabs.some((t) => t.filename === filename + CARD_TAB_SUFFIX) : false;

    // Card tabs and virtual System tabs: only Save is meaningful.
    const scriptControlsDisabled = isCardTab || isSystemTab;

    return html`
      <div class="editor-toolbar" style=${this._toolbarHidden ? 'display:none' : ''}>
        <div class="toolbar-left">
          <button
            ?disabled=${scriptControlsDisabled || isLib}
            style=${scriptControlsDisabled || isLib ? 'opacity:0.3' : ''}
            title=${isLib ? this._t('library_cannot_start') : this._t('script_action_toggle_title', 'Start / Stop')}
            @click=${() => this.toggleActiveScript()}
          >
            <i
              class="mdi mdi-${script?.running ? 'stop' : 'play'}"
              style=${script?.running ? 'color: var(--accent)' : ''}
            ></i>
          </button>
          <button
            ?disabled=${scriptControlsDisabled || isLib || !script?.running}
            style=${scriptControlsDisabled || isLib || !script?.running ? 'opacity:0.4' : ''}
            title=${this._t('script_action_restart_title', 'Restart')}
            @click=${() => this.restartActiveScript()}
          >
            <i class="mdi mdi-restart"></i>
          </button>
          <div class="toolbar-separator"></div>
          <button
            ?disabled=${isSystemTab}
            style=${isSystemTab ? 'opacity:0.1' : `opacity:${isDirty ? '1' : '0.4'}`}
            title=${this._t('save_title', 'Save')}
            @click=${() => this.saveActiveTab()}
          >
            <i class="mdi mdi-content-save"></i>
          </button>
          <button
            ?disabled=${scriptControlsDisabled}
            style=${scriptControlsDisabled ? 'opacity:0.1' : ''}
            title="Edit Metadata"
            @click=${() => this.editActiveScript()}
          >
            <i class="mdi mdi-pencil"></i>
          </button>
          <button
            ?disabled=${isVirtualTab(filename)}
            style=${isVirtualTab(filename) ? 'opacity:0.1' : ''}
            title=${this._t('download_script_title', 'Download Script')}
            @click=${() => this.downloadActiveScript()}
          >
            <i class="mdi mdi-download"></i>
          </button>
          <button
            ?disabled=${scriptControlsDisabled}
            style=${scriptControlsDisabled ? 'opacity:0.1' : ''}
            title=${this._t('script_action_duplicate_title', 'Duplicate')}
            @click=${() => this.duplicateActiveScript()}
          >
            <i class="mdi mdi-content-duplicate"></i>
          </button>
          ${
            isBlocklyTab
              ? nothing
              : html`
                  <button
                    title=${this._t('toggle_word_wrap_title', 'Toggle word wrap')}
                    @click=${() => this._monacoEditorEl?.toggleWordWrap()}
                  >
                    <i class="mdi mdi-wrap${this._monacoEditorEl?.wordWrapEnabled ? '' : '-disabled'}"></i>
                  </button>
                `
          }
          ${
            hasCard
              ? html`
                  <button
                    class=${cardTabOpen ? 'preview-active' : ''}
                    title=${cardTabOpen ? 'Close Card Tab' : 'Open Card Tab'}
                    @click=${() => this.toggleCardTab()}
                  >
                    <i class="mdi mdi-card-text${cardTabOpen ? '' : '-outline'}"></i>
                  </button>
                `
              : nothing
          }
          <div class="toolbar-separator"></div>
          ${
            isBlocklyTab
              ? html`
                  <button
                    class=${this._showingBlocklyCode ? 'preview-active' : ''}
                    title=${this._t('blockly_show_code_title', 'Show Code')}
                    @click=${() => this._toggleShowCode()}
                  >
                    <i class="mdi mdi-code-braces"></i>
                  </button>
                `
              : html`
                  <button
                    title=${this._t('snippet_toolbar_title', 'Insert snippet')}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._monacoEditorEl?.openSnippetMenu(e.currentTarget as HTMLElement);
                    }}
                  >
                    <i class="mdi mdi-puzzle-outline"></i>
                  </button>
                `
          }
          ${
            !isBlocklyTab && (isCardTab || hasCard)
              ? html`
                  <button
                    class=${window.CardPreview?.isOpen() ? 'preview-active' : ''}
                    title=${this._t('card_preview_toggle_title', 'Show / Hide Preview')}
                    @click=${() => window._toggleCardPreview?.()}
                  >
                    <i class="mdi mdi-monitor-dashboard"></i>
                  </button>
                `
              : nothing
          }
        </div>
        <div class="toolbar-right">
          <button title=${this._t('close_all_tabs_title', 'Close all tabs')} @click=${() => this.closeAllTabs()}>
            <i class="mdi mdi-close-box-multiple"></i>
          </button>
        </div>
      </div>
    `;
  }

  render() {
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    // Store/Settings/Reference are routed to sibling elements outside #editor-body entirely
    // (see switchToTab) — the tab bar itself stays visible regardless so those views don't
    // strand you unable to click back to an open script tab.
    const showEditorBody = !activeTab?.type || activeTab.type === 'blockly' || activeTab.type === 'card';

    return html`
      ${mdiStylesheetLink} ${this._renderTabBar()}
      <div class="editor-panel" style=${showEditorBody ? '' : 'display:none'}>
        ${this._renderToolbar(activeTab)} ${this._renderModeBanner(activeTab)}
        <div class="editor-body">
          <monaco-editor
            @save-requested=${() => this.saveActiveTab()}
            @word-wrap-changed=${() => this.requestUpdate()}
          ></monaco-editor>
          <slot name="blockly"></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'editor-view': EditorViewElement;
  }
}
