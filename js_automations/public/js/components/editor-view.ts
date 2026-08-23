import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaTab, JsaSettings } from './global';
import type { MonacoEditorElement } from './monaco-editor';
import './monaco-editor';
import './git-history-panel';

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

// The git repo root is SCRIPTS_DIR, so library scripts are tracked as "libraries/<name>" — but
// the API only ever exposes a bare basename as `filename` (scripts-routes.ts). Git-facing calls
// (log/diff/show) need the real repo-relative path or they silently find no history at all.
function gitPathFor(filename: string): string {
  return isLibraryScript(filename) ? `libraries/${filename}` : filename;
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
    .editor-row {
      display: flex;
      flex-direction: row;
      flex: 1;
      min-height: 0;
    }
    .editor-body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    .editor-body monaco-editor {
      flex: 1;
      min-height: 0;
    }
    .diff-tab-container {
      flex: 1;
      min-height: 0;
      display: none;
    }
    /* Same suppressions git-history-panel.ts's narrow inline diff needed — these are about
     * read-only interactivity (revert/copy actions, fold controls, quick-fix), not panel width,
     * so they still apply at full tab width. Unlike that panel, this one uses
     * renderSideBySide:true, so its ".editor.original" pane is the real left-hand diff view and
     * must NOT be hidden, and ".moved-blocks-lines" can show real moved-code connectors. */
    .diff-tab-container .lightbulb-glyph {
      display: none !important;
    }
    .diff-tab-container .codicon,
    .diff-tab-container [class$='-glyph'] {
      display: none !important;
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
  /** Git history side panel toggle, next to Commit in the toolbar. */
  @state() private _historyPanelOpen = false;

  /** Repo-relative paths with staged-worthy git changes, for disabling the Commit button when
   * the active tab's file has nothing to commit instead of only reporting that after the message
   * dialog. `_gitStatusLoaded` gates the check so the button isn't misleadingly disabled for the
   * brief window before the first status fetch resolves. */
  @state() private _gitChangedPaths = new Set<string>();
  @state() private _gitRepoExists = true;
  @state() private _gitStatusLoaded = false;

  @query('monaco-editor') private _monacoEditorEl?: MonacoEditorElement;

  /** One shared diff-editor widget for all 'diff' tabs — model-swapped per active tab, same
   * "one shared editor, swap model" pattern this file already uses for <monaco-editor> itself,
   * rather than a new Monaco widget instance per tab. */
  private _diffEditorInstance: import('monaco-editor').editor.IStandaloneDiffEditor | null = null;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.openTabs = this._openTabs;
    window.renderTabs = this._renderTabs;
    window.openOrSwitchToTab = this.openOrSwitchToTab;
    window.openCardTab = this.openCardTab;
    window.openDiffTab = this.openDiffTab;
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

    // Same event git-history-panel.ts's commit flow and status-bar.ts's git icon already refresh
    // on — one more listener here rather than threading a shared store through both components.
    window.addEventListener('git-status-refresh', this._refreshGitStatus);
    this._refreshGitStatus();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onGlobalKeydown);
    window.removeEventListener('settings-changed', this._onSettingsChanged);
    window.removeEventListener('card-preview-toggled', this._onCardPreviewToggled);
    window.removeEventListener('git-status-refresh', this._refreshGitStatus);
    this._diffEditorInstance?.dispose();
    this._diffEditorInstance = null;
  }

  private _refreshGitStatus = async (): Promise<void> => {
    try {
      const res = await window.apiFetch!('api/git/status');
      if (!res.ok) return;
      const status = await res.json();
      this._gitRepoExists = !!status.hasRepo;
      this._gitChangedPaths = new Set(status.changedFiles ?? []);
    } catch {
      // Best-effort — leave whatever state we had rather than getting the button stuck disabled
      // on a transient fetch failure.
    } finally {
      this._gitStatusLoaded = true;
    }
  };

  /** Whether the active tab's file has anything for the Commit button to actually do. Unsaved
   * edits always count (saving happens automatically before the commit dialog opens, so they'll
   * produce a change); otherwise falls back to the last known git status for that file. */
  private get _canCommitActiveTab(): boolean {
    const filename = this._activeTabFilename;
    if (!filename || isVirtualTab(filename)) return false;
    const activeTab = this._openTabs.find((t) => t.filename === filename);
    if (activeTab?.isDirty) return true;
    if (!this._gitStatusLoaded || !this._gitRepoExists) return true;
    return this._gitChangedPaths.has(gitPathFor(filename));
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

  /** Opens one commit's diff (vs. its previous commit) as a full-width tab — triggered from
   * git-history-panel.ts's "Open diff in tab" button, since its own inline diff was too cramped
   * in that 380px side panel. One tab per commit; re-opening an already-open commit's diff just
   * switches to the existing tab rather than duplicating. */
  openDiffTab = async (
    subjectFilename: string,
    hash: string,
    shortHash: string,
    message?: string,
    gitPath?: string
  ): Promise<void> => {
    const tabFilename = `System: Diff: ${subjectFilename}@${hash}`;
    const existing = this._openTabs.find((t) => t.filename === tabFilename);
    if (existing) {
      this.switchToTab(tabFilename);
      return;
    }

    try {
      const gitFile = gitPath || gitPathFor(subjectFilename);
      const res = await window.apiFetch!(
        `api/git/diff?hash1=${encodeURIComponent(hash + '~1')}&hash2=${encodeURIComponent(hash)}&file=${encodeURIComponent(gitFile)}`
      );
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const { before, after } = await res.json();
      const language = subjectFilename.endsWith('.ts') ? 'typescript' : 'javascript';
      const original = window.monaco!.editor.createModel(before ?? '', language);
      const modified = window.monaco!.editor.createModel(after ?? '', language);

      const newTab: JsaTab = {
        filename: tabFilename,
        icon: 'file-compare',
        type: 'diff',
        isDirty: false,
        model: null,
        diffSubjectFilename: subjectFilename,
        diffHash: hash,
        diffShortHash: shortHash,
        diffMessage: message,
        diffOriginalModel: original,
        diffModifiedModel: modified,
      };
      this._openTabs.push(newTab);
      this.switchToTab(tabFilename);
    } catch (e) {
      console.error(`[DiffTab] Failed to load diff for ${subjectFilename}@${hash}`, e);
      window.alertToast?.show(
        this._t('history_diff_load_error', 'Failed to load diff: {{error}}', {
          error: e instanceof Error ? e.message : String(e),
        })
      );
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
      } else if (
        oldTab &&
        oldTab.type !== 'store' &&
        oldTab.type !== 'settings' &&
        oldTab.type !== 'reference' &&
        oldTab.type !== 'diff'
      ) {
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
    const diffContainer = this.renderRoot.querySelector<HTMLElement>('#diff-tab-container');

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
      if (diffContainer) diffContainer.style.display = 'none';

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
    } else if (newTab.type === 'diff') {
      // A diff editor is a structurally different Monaco widget (createDiffEditor, not
      // createModel+setModel) — it can't reuse <monaco-editor>'s shared single-model registry,
      // so it gets its own dedicated container, toggled the same way #blockly-container is.
      if (this._monacoEditorEl) this._monacoEditorEl.style.display = 'none';
      blocklyContainer?.classList.add('hidden');
      // The container's baseline CSS is `display:none` (see static styles) — clearing the
      // inline style here would just fall back to that, not show it, so this needs an explicit
      // non-none value rather than ''. Must be 'block', not 'flex': Monaco's own root div isn't
      // a flex child (no explicit width), so a flex container collapses it to content width
      // (reproduced live — only the overview-ruler strip showed, no diff text).
      if (diffContainer) diffContainer.style.display = 'block';

      if (!this._diffEditorInstance && window.monaco && diffContainer) {
        this._diffEditorInstance = window.monaco.editor.createDiffEditor(diffContainer, {
          readOnly: true,
          automaticLayout: true,
          // Word-wrap needs the inline (single-column) diff, not side-by-side: Monaco's
          // side-by-side renderer doesn't correctly pad the shorter pane to match a
          // wrapped-taller line's height on the other side, corrupting the whole layout once any
          // line wraps (reproduced live). Inline diff has no second pane to misalign against.
          renderSideBySide: false,
          wordWrap: 'on',
          minimap: { enabled: false },
          theme: 'vs-dark',
          fontSize: 12,
          renderMarginRevertIcon: false,
          renderIndicators: false,
          hideUnchangedRegions: { enabled: false },
          folding: false,
        });
        // See git-history-panel.ts's identical comment — the diff editor doesn't forward
        // `lightbulb`/`folding`/`wordWrap` from its own construction options down to the two
        // inner standalone editors, so they have to be set directly on each side too.
        this._diffEditorInstance
          .getOriginalEditor()
          .updateOptions({ lightbulb: { enabled: false }, folding: false, wordWrap: 'on' });
        this._diffEditorInstance
          .getModifiedEditor()
          .updateOptions({ lightbulb: { enabled: false }, folding: false, wordWrap: 'on' });
        // Auto-scrolls to the first change on every diff update — still worth doing with word
        // wrap on: a diff can open scrolled to the top of a long file with the actual change
        // several screens down.
        this._diffEditorInstance.onDidUpdateDiff(() => {
          const changes = this._diffEditorInstance?.getLineChanges();
          const firstCharChange = changes?.[0]?.charChanges?.[0];
          if (firstCharChange) {
            this._diffEditorInstance?.getModifiedEditor().revealPositionNearTop({
              lineNumber: firstCharChange.modifiedStartLineNumber,
              column: firstCharChange.modifiedStartColumn,
            });
            return;
          }
          const firstLineChange = changes?.[0];
          if (firstLineChange) {
            const line = firstLineChange.modifiedStartLineNumber || firstLineChange.originalStartLineNumber || 1;
            this._diffEditorInstance?.getModifiedEditor().revealLineNearTop(line);
          }
        });
      }
      this._diffEditorInstance?.setModel({
        original: newTab.diffOriginalModel as import('monaco-editor').editor.ITextModel,
        modified: newTab.diffModifiedModel as import('monaco-editor').editor.ITextModel,
      });
      // Same same-tick-resize layout glitch git-history-panel.ts's diff view had to work around
      // — force a fresh layout pass once the tab-switch's own layout has actually settled.
      requestAnimationFrame(() => requestAnimationFrame(() => this._diffEditorInstance?.layout()));
    } else {
      if (this._monacoEditorEl) this._monacoEditorEl.style.display = '';
      blocklyContainer?.classList.add('hidden');
      if (diffContainer) diffContainer.style.display = 'none';

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

  // Arrow-bound like every other method assigned to window.* in this class — a plain method
  // here loses `this` when invoked as window.closeTab(filename) (its only real-world call
  // shape, e.g. app-sidebar.ts's delete flow), throwing on `this._openTabs` being undefined.
  closeTab = async (filename: string): Promise<void> => {
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
    if (tabToClose.type === 'diff') {
      // The shared diff-editor widget stays alive for other diff tabs — only clear its model
      // if this closed tab was the one it was currently showing, before disposing that tab's
      // own models (avoids disposing models still attached to a live widget).
      if (this._activeTabFilename === filename) this._diffEditorInstance?.setModel(null);
      (tabToClose.diffOriginalModel as import('monaco-editor').editor.ITextModel | undefined)?.dispose();
      (tabToClose.diffModifiedModel as import('monaco-editor').editor.ITextModel | undefined)?.dispose();
    }

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
  };

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
      this._refreshGitStatus();
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
      // Card content lives inside the parent script's file, not this virtual tab — refresh so
      // the Commit button is correct if/when the user switches back to the parent script tab.
      this._refreshGitStatus();
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
    this._refreshGitStatus();
    await window.loadScripts?.();
  };

  /** Explicit action, deliberately NOT tied to save/deploy — save hot-reloads a running script's
   * worker (scripts-routes.ts's POST .../content), so a commit-on-save/deploy rule would fire on
   * every save of an active script. Auto-saves first if the tab is dirty so a commit never
   * captures stale content, then opens the message dialog. */
  commitActiveTab = async (): Promise<void> => {
    if (!this._activeTabFilename || isVirtualTab(this._activeTabFilename)) return;
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (!activeTab) return;

    const wasDirty = !!activeTab.isDirty;
    if (wasDirty) await this.saveActiveTab();

    const message = await window.commitDialog?.prompt(`update: ${this._activeTabFilename}`, wasDirty);
    if (!message) return;

    try {
      const res = await window.apiFetch!('api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Scoped to just this file — clicking Commit on one script must never sweep up
        // unrelated pending changes elsewhere in the repo.
        body: JSON.stringify({ message, paths: [this._activeTabFilename] }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const result = await res.json();
      if (result.hash === null) {
        window.alertToast?.show(
          this._t('commit_nothing_to_commit', 'Nothing to commit — no changes since the last commit.'),
          {
            variant: 'info',
          }
        );
      } else {
        window.alertToast?.show(
          this._t('commit_success', 'Committed ({{hash}}).', { hash: (result.hash as string).slice(0, 7) }),
          { variant: 'success' }
        );
        window.dispatchEvent(new CustomEvent('git-status-refresh'));
      }
    } catch (e) {
      window.alertToast?.show(
        this._t('commit_error', 'Commit failed: {{error}}', { error: e instanceof Error ? e.message : String(e) })
      );
    }
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
    if (tab.type === 'diff') return { iconName: 'file-compare', statusClass: '' };
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
    if (tab.type === 'diff') {
      return this._t('history_diff_tab_title', 'Diff: {{filename}} @ {{hash}}', {
        filename: tab.diffSubjectFilename ?? '',
        hash: tab.diffShortHash ?? '',
      });
    }
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
            const badge =
              !isCardTab && tab.type !== 'diff' && window.getLanguageBadge ? window.getLanguageBadge(tab.filename) : '';
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
    // Type-based rather than a hardcoded filename list — a diff tab's synthetic filename varies
    // per commit, so it can't be matched literally the way the other three system views can.
    const isSystemTab =
      activeTab?.type === 'store' ||
      activeTab?.type === 'settings' ||
      activeTab?.type === 'reference' ||
      activeTab?.type === 'diff';
    const isBlocklyTab = activeTab?.type === 'blockly';
    const isDiffTab = activeTab?.type === 'diff';
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
            ?disabled=${isSystemTab || !this._canCommitActiveTab}
            style=${isSystemTab ? 'opacity:0.1' : `opacity:${this._canCommitActiveTab ? '1' : '0.3'}`}
            title=${
              !isSystemTab && !this._canCommitActiveTab
                ? this._t('commit_nothing_to_commit', 'Nothing to commit — no changes since the last commit.')
                : this._t('commit_button_title', 'Commit')
            }
            @click=${() => this.commitActiveTab()}
          >
            <i class="mdi mdi-source-commit"></i>
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
            isBlocklyTab || isDiffTab
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
              : isDiffTab
                ? nothing
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
          <button
            ?disabled=${isSystemTab}
            style=${isSystemTab ? 'opacity:0.1' : this._historyPanelOpen ? 'color: var(--accent)' : ''}
            title=${this._t('history_panel_title', 'History')}
            @click=${() => (this._historyPanelOpen = !this._historyPanelOpen)}
          >
            <i class="mdi mdi-history"></i>
          </button>
          <button title=${this._t('close_all_tabs_title', 'Close all tabs')} @click=${() => this.closeAllTabs()}>
            <i class="mdi mdi-close-box-multiple"></i>
          </button>
        </div>
      </div>
    `;
  }

  willUpdate() {
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    const showEditorBody =
      !activeTab?.type || activeTab.type === 'blockly' || activeTab.type === 'card' || activeTab.type === 'diff';
    // The host normally claims flex:1 so the editor body fills #editor-section. When a virtual
    // tab (store/settings/reference) is active, that body is hidden and routed to a sibling
    // element instead — without shrinking the host too, it still claims half the flex space as
    // an empty box (see the old #editor-wrapper, which used to be hidden outright for this case).
    this.style.flex = showEditorBody ? '1' : '0 0 auto';
  }

  render() {
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    // Store/Settings/Reference are routed to sibling elements outside #editor-body entirely
    // (see switchToTab) — the tab bar itself stays visible regardless so those views don't
    // strand you unable to click back to an open script tab.
    const showEditorBody =
      !activeTab?.type || activeTab.type === 'blockly' || activeTab.type === 'card' || activeTab.type === 'diff';

    return html`
      ${mdiStylesheetLink}
      <!-- The diff tab (#diff-tab-container below) builds a Monaco diff editor directly into
           this component's own Shadow DOM. Monaco's AMD loader injects editor.main.css — which
           defines the actual diff colors (.line-insert/.line-delete/.char-insert/.char-delete)
           — into document.head only, so it never reaches here (same class of bug monaco-editor.ts
           already had to work around). Without this, the diff editor computes real changes and
           applies the right CSS classes, but nothing colors them — it just looks like "no diff". -->
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/editor/editor.main.css"
      />
      ${this._renderTabBar()}
      <div class="editor-panel" style=${showEditorBody ? '' : 'display:none'}>
        ${this._renderToolbar(activeTab)} ${this._renderModeBanner(activeTab)}
        <div class="editor-row">
          <div class="editor-body">
            <monaco-editor
              @save-requested=${() => this.saveActiveTab()}
              @word-wrap-changed=${() => this.requestUpdate()}
            ></monaco-editor>
            <slot name="blockly"></slot>
            <div id="diff-tab-container" class="diff-tab-container"></div>
          </div>
          ${
            this._historyPanelOpen && this._activeTabFilename && !isVirtualTab(this._activeTabFilename)
              ? html`
                  <git-history-panel
                    .filename=${this._activeTabFilename}
                    .gitPath=${gitPathFor(this._activeTabFilename)}
                    @close=${() => (this._historyPanelOpen = false)}
                    @restore-into-editor=${(e: CustomEvent<{ content: string }>) =>
                      this._loadContentIntoActiveEditor(e.detail.content)}
                    @open-diff-tab=${(
                      e: CustomEvent<{
                        filename: string;
                        gitPath?: string;
                        hash: string;
                        shortHash?: string;
                        message?: string;
                      }>
                    ) =>
                      this.openDiffTab(
                        e.detail.filename,
                        e.detail.hash,
                        e.detail.shortHash ?? e.detail.hash.slice(0, 7),
                        e.detail.message,
                        e.detail.gitPath
                      )}
                  ></git-history-panel>
                `
              : nothing
          }
        </div>
      </div>
    `;
  }

  /** Loads historical content into the active tab's Monaco model for review — does NOT commit
   * and does NOT save; the user reviews/edits, then goes through the normal save+Commit flow. */
  private _loadContentIntoActiveEditor(content: string): void {
    const activeTab = this._openTabs.find((t) => t.filename === this._activeTabFilename);
    if (!activeTab || !window.monacoEditor) return;
    window.monacoEditor.setModelValue(activeTab.model, content);
    activeTab.isDirty = window.monacoEditor.getModelValue(activeTab.model) !== activeTab.originalContent;
    this._renderTabs();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'editor-view': EditorViewElement;
  }
}
