/**
 * Minimal typings for the legacy window globals these components still talk
 * to. Not-yet-migrated files (socket-client.js, app.js, settings.js, ...)
 * remain the source of truth for these; widen as more of them move to LIT.
 */

export interface JsaSocket {
  connected: boolean;
  on(event: string, cb: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

export interface JsaI18next {
  t(key: string, options?: Record<string, unknown>): string;
  language: string;
}

export interface JsaScriptCapabilities {
  detected: string[];
  declared: string[];
  undeclared: string[];
}

export interface JsaEntityConflict {
  expected: string;
  actual: string;
}

export interface JsaScript {
  filename: string;
  name: string;
  icon?: string;
  expose?: string | null;
  running?: boolean;
  status?: string;
  description?: string;
  area?: string;
  label?: string;
  path?: string;
  capabilities?: JsaScriptCapabilities;
  card?: string | boolean;
  cardInstalled?: boolean;
  entity_conflicts?: JsaEntityConflict[];
  ram_usage?: number;
  last_started?: string | number;
  includes?: string[];
  [key: string]: unknown;
}

export interface JsaHaLabel {
  name: string;
  icon?: string;
  color?: string;
}

export interface JsaHaData {
  areas: unknown[];
  labels: JsaHaLabel[];
  services: Record<string, unknown>;
  language: string | null;
}

export interface JsaAppSidebarBridge {
  setActiveScript(filename: string | null): void;
  /** Re-checks window.newVersionInfo and refreshes the settings gear icon's update-available dot. */
  refreshBadges(): void;
  /** Opens Settings, keeping mobile screen state in sync — use instead of window.openSettingsTab directly. */
  openSettings(target?: string): void;
  /** Resets mobile screen state back to the dashboard — call when closing a tab that put it elsewhere. */
  returnToDashboard(): void;
}

export interface JsaIntegrationStatus {
  installed?: boolean;
  is_connected?: boolean;
  is_running?: boolean;
  mqtt?: { enabled: boolean; connected: boolean };
  /** Set while `is_connected` is false — `expected: true` means a `homeassistant.restart`
   *  service call was observed just before the drop (status icon shows orange, not red). */
  reconnect?: { expected: boolean } | null;
}

export interface JsaStatusBarSettings {
  slot1?: string;
  slot2?: string;
  slot3?: string;
  customEntitySlot1?: string;
  customEntitySlot2?: string;
  customEntitySlot3?: string;
  show_sparkline_slot1?: boolean;
  show_sparkline_slot2?: boolean;
  show_sparkline_slot3?: boolean;
  show_statusbar?: boolean;
  hide_sparkline_on_dense?: boolean;
  header_action_1?: string;
  header_action_2?: string;
  header_action_3?: string;
}

export interface JsaEditorSettings {
  fontSize?: number;
  wordWrap?: 'on' | 'off';
  minimap?: boolean;
  showToolbar?: boolean;
}

export interface JsaBackupSettings {
  schedule_enabled?: boolean;
  schedule_frequency?: 'daily' | 'weekly';
  schedule_weekday?: string;
  schedule_time?: string;
  retention_count?: number;
  webdav_enabled?: boolean;
  webdav_url?: string;
  webdav_username?: string;
  webdav_password?: string;
}

export interface JsaVersioningSettings {
  author_name?: string;
  author_email?: string;
  git_enabled?: boolean;
  git_repo_url?: string;
  git_token?: string;
}

export interface JsaSettings {
  statusbar?: JsaStatusBarSettings;
  mqtt?: { enabled?: boolean };
  editor?: JsaEditorSettings;
  backup?: JsaBackupSettings;
  versioning?: JsaVersioningSettings;
  [key: string]: unknown;
}

export interface JsaHaState {
  entity_id: string;
  state: string;
  attributes: {
    unit_of_measurement?: string;
    icon?: string;
    friendly_name?: string;
    rgb_color?: number[];
    icon_color?: string;
    [key: string]: unknown;
  };
}

export interface JsaStatusBarBridge {
  init(): void;
  updateMqttIndicator(status: { connected: boolean; error?: string }): void;
  setConnected(isConnected: boolean): void;
  isDisconnected(): boolean;
  showConnectionLost(): void;
  /** Reflects the addon's own connection to Home Assistant (distinct from setConnected(), which
   *  tracks the browser's socket.io link to the addon server) — drives the heartbeat icon's
   *  orange/red distinction while reconnecting. */
  setHaConnectionState(isConnected: boolean, expectedRestart: boolean): void;
}

export interface JsaStoreExplorerBridge {
  getItem(key: string): unknown;
  hasKey(key: string): boolean;
  refreshIfSocketDown(): void;
  openTab(): void;
}

export interface JsaStoreItemModalBridge {
  open(key?: string): void;
  close(): void;
}

export interface JsaOpenScriptModalData {
  filename?: string;
  name?: string;
  icon?: string;
  expose?: string | null;
  path?: string;
  area?: string;
  label?: string;
  loglevel?: string;
  description?: string;
  dependencies?: string[];
  includes?: string[];
  /** Duplicate mode: the source script's raw content. */
  code?: string;
  /** Duplicate mode, .blocks source only: last-compiled JS, for the "duplicate as JavaScript" checkbox. */
  jsCode?: string | null;
}

export interface JsaScriptModalBridge {
  open(mode?: 'create' | 'edit' | 'duplicate', data?: JsaOpenScriptModalData | null): Promise<void> | void;
}

export interface JsaTab {
  filename: string;
  icon: string;
  isDirty: boolean;
  type?: 'store' | 'settings' | 'reference' | 'blockly' | 'card' | 'diff';
  model: unknown;
  viewState?: unknown;
  /** Monaco tabs only — last-saved content, compared against the live model to derive isDirty.
   * null on a not-yet-saved card tab, where every edit is dirty until the first save. */
  originalContent?: string | null;
  /** Card tabs only — the parent script's filename (card tab's own filename is
   * `${parentScript}[card]`). */
  parentScript?: string;
  /** Only present on `type: 'blockly'` tabs — see openBlocklyTab() in tab-manager.js. */
  jsa?: Record<string, unknown>;
  blocksState?: { blocks: unknown; variables: unknown };
  /** Blockly tabs only — last-saved workspace JSON, compared against the live workspace to
   * derive isDirty. */
  originalBlocksJson?: string;
  /** Diff tabs only (type: 'diff') — the real script this diff is about, and the commit it shows. */
  diffSubjectFilename?: string;
  diffHash?: string;
  diffShortHash?: string;
  diffMessage?: string;
  /** Diff tabs only — live Monaco ITextModel instances, typed unknown like `model`. */
  diffOriginalModel?: unknown;
  diffModifiedModel?: unknown;
}

export interface JsaCardPreviewBridge {
  open(scriptFilename: string): void;
  close(): void;
  toggle(scriptFilename: string | null | undefined): void;
  reload(): void;
  isOpen(): boolean;
}

export interface JsaConfirmDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  checkboxLabel?: string;
  checkboxDefault?: boolean;
}

export interface JsaConfirmDialogBridge {
  confirm(message: string, opts?: JsaConfirmDialogOptions): Promise<boolean>;
  confirmWithCheckbox(
    message: string,
    opts?: JsaConfirmDialogOptions
  ): Promise<{ confirmed: boolean; checked: boolean }>;
}

export interface JsaCommitDialogBridge {
  /** Resolves the (possibly edited) commit message, or null if the user cancelled. wasDirty
   * surfaces a one-line "unsaved changes will be saved first" note in the dialog. */
  prompt(defaultMessage: string, wasDirty?: boolean): Promise<string | null>;
}

export interface JsaRestoreModalBridge {
  open(): void;
}

export interface JsaAlertToastBridge {
  show(message: string, opts?: { variant?: 'error' | 'info' | 'success' | 'warning'; duration?: number }): void;
}

export interface JsaEntityPickerModalBridge {
  open(): void;
  close(): void;
}

export interface JsaMonacoEditorBridge {
  /** onContentChange fires on every edit — icon decorations update automatically; the callback
   * is for caller-side concerns like dirty-tracking. */
  createModel(content: string, language: string, uriPath: string, onContentChange?: (model: unknown) => void): unknown;
  disposeModel(model: unknown): void;
  setModel(model: unknown): void;
  getValue(): string;
  /** Reads the value of any model reference, not just the one currently attached to the editor. */
  getModelValue(model: unknown): string;
  /** Writes to any model reference, not just the one currently attached to the editor. */
  setModelValue(model: unknown, value: string): void;
  saveViewState(): unknown;
  restoreViewState(state: unknown): void;
  focus(): void;
  layout(): void;
  setReadOnly(readOnly: boolean): void;
  /** Inserts text at the current cursor selection — used by entity-picker-modal.ts instead of it reaching into a raw Monaco editor/selection API. */
  insertTextAtCursor(text: string): void;
  updateIconDecorations(model: unknown): void;
  setMode(mode: 'script' | 'card'): void;
  loadLibraryDefinitions(): Promise<void>;
  isReady(): boolean;
  /** Inserts a registered snippet (by id, see SNIPPET_REGISTRY) into the currently active
   * model as a live, tab-stop-navigable Monaco snippet - used to pre-fill a newly created,
   * still-empty card tab with the card boilerplate instead of leaving it blank. */
  insertSnippet(id: string, mode?: 'full' | 'minimal', variant?: string | null): void;
  /** Opens Monaco's own find widget prefilled with `term` (same as Ctrl+F) — follow-through for
   * app-sidebar.ts's code-search filter. Sticks across setModel() so it re-opens when the
   * matching script is opened after the search already ran. */
  highlightSearchTerm(term: string): void;
  /** Closes the find widget and forgets the term, so a later setModel() doesn't re-open it. */
  clearSearchHighlight(): void;
}

export interface JsaLogEntry {
  ts?: number;
  level?: string;
  source?: string;
  message: string;
  /** Present only for .blocks scripts — see blockly-compiler.js's scrub_() instrumentation. */
  blockId?: string;
  scriptId?: string;
}

export interface JsaLogViewerBridge {
  /** Mobile per-script inline log (RFC §7) — a one-time snapshot for populating the panel when
   * it opens; subsequent entries arrive live via the 'jsa-log-appended' window event. */
  getEntriesForSource(source: string): JsaLogEntry[];
}

export interface JsaWatchTile {
  label: string;
  value: unknown;
}

export interface JsaWatchPanelBridge {
  /** Mobile per-script inline status (RFC §7 follow-up), keyed by filename — used for the
   * initial snapshot and to re-fetch after a live 'jsa-watch-updated'/'jsa-watch-cleared' event. */
  getTilesForFilename(filename: string): JsaWatchTile[];
}

declare global {
  interface Window {
    socket?: JsaSocket;
    i18next?: JsaI18next;
    apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
    openSettingsTab?: (target?: string) => void;
    allScripts?: JsaScript[];
    currentIntegrationStatus?: JsaIntegrationStatus;
    handleIntegrationStatus?: (status: JsaIntegrationStatus | null) => void;
    hideIntegrationBanner?: () => void;
    initLogs?: () => Promise<void>;
    appendLog?: (entry: any, autoScroll?: boolean) => void;
    /** blockly-editor.js — highlights the block on the active .blocks canvas that threw. */
    highlightBlocklyError?: (scriptId: string, blockId: string, message: string) => void;
    currentSettings?: JsaSettings | null;
    getHAStates?: () => Promise<JsaHaState[]>;
    cachedEntities?: JsaHaState[];
    /** In-flight dedup for fetchAllStatesDeduped() (see ha-entity-cache.ts). */
    _jsaEntityFetchPromise?: Promise<JsaHaState[]> | null;
    statusBar?: JsaStatusBarBridge;
    onWatchUpdate?: (data: any) => void;
    onWatchClear?: (data: any) => void;
    onInspectSnapshot?: (data: any) => void;
    onBreakpointHit?: (data: any) => void;
    onBreakpointContinued?: (data: any) => void;
    storeExplorer?: JsaStoreExplorerBridge;
    loadStoreData?: () => Promise<void>;
    onStoreChanged?: (data: { cleared?: boolean; deleted?: boolean; key?: string; item?: unknown }) => void;
    storeItemModal?: JsaStoreItemModalBridge;
    onHaEventStream?: (payload: { t: number; type: string; data: Record<string, any> }) => void;
    /** All known entity IDs, populated by editor-config.js for Monaco completions; also used by the entity-filter dropdowns. */
    allEntities?: string[];
    /** repl.js (not yet migrated) still calls this as a bare global — see js/components/index.ts. */
    observeTabVisibility?: (el: HTMLElement, cb: (visible: boolean) => void) => MutationObserver;
    /** <editor-view>'s bridge for the editor tab strip — see components/editor-view.ts. */
    openTabs?: JsaTab[];
    renderTabs?: () => void;
    switchToTab?: (filename: string) => void;
    updateToolbarUI?: (filename: string, icon: string, isDirty: boolean) => void;
    closeTab?: (filename: string) => Promise<void>;
    openCardTab?: (scriptFilename: string) => Promise<void>;
    toggleCardTab?: () => Promise<void>;
    openDiffTab?: (subjectFilename: string, hash: string, shortHash: string, message?: string) => Promise<void>;
    saveActiveTab?: () => Promise<void>;
    closeAllTabs?: () => Promise<void>;
    toggleActiveScript?: () => Promise<void>;
    restartActiveScript?: () => Promise<void>;
    editActiveScript?: () => Promise<void>;
    deleteActiveScript?: () => Promise<void>;
    duplicateActiveScript?: () => Promise<void>;
    downloadActiveScript?: () => void;
    toggleShowCode?: () => void;
    /** blockly-editor.js's workspace-changed listener calls this to mark the active Blockly
     * tab dirty. */
    onBlocklyWorkspaceChanged?: () => void;
    /** blockly-editor.js bridges (Blockly integration stays vanilla — not part of the LIT
     * migration, see docs/RFC_FRONTEND_MODERNIZATION.md). */
    ensureBlocklyReady?: () => Promise<void>;
    isBlocklyReady?: () => boolean;
    getBlocklyWorkspaceState?: () => { blocks: unknown; variables: unknown };
    getBlocklyGeneratedCode?: () => string;
    reapplyBlocklyError?: (scriptId: string) => void;
    /** app.js: maps a filename extension to a Monaco language id. */
    getLanguageByFilename?: (filename: string) => string;
    activeTabFilename?: string | null;
    loadSettingsData?: (isBackgroundRefresh?: boolean) => Promise<void>;
    /** Re-checks window.newVersionInfo and refreshes the settings category sidebar's update-available dot. */
    renderSettingsCategories?: () => void;
    newVersionInfo?: { update_available?: boolean; [key: string]: unknown } | null;
    /** app.js (not yet migrated) globals for the script sidebar. */
    haData?: JsaHaData;
    mdiIcons?: string[];
    loadHAMetadata?: (retryCount?: number) => Promise<void>;
    getLanguageBadge?: (filename: string) => string;
    loadVersion?: () => Promise<void>;
    openReferenceTab?: () => void;
    openOrSwitchToTab?: (filename: string, icon?: string) => Promise<void> | void;
    /** blockly-editor.js — (re)loads the given workspace state into the Blockly canvas. */
    loadBlocklyWorkspace?: (state: { jsa: Record<string, unknown>; blocks: unknown; variables: unknown }) => void;
    scriptModal?: JsaScriptModalBridge;
    /** app-sidebar.ts bridges — replace the old script-list.js globals. */
    loadScripts?: () => Promise<void>;
    renderScripts?: (scripts: JsaScript[], updateGlobal?: boolean) => void;
    toggleScript?: (filename: string) => Promise<void>;
    restartScript?: (filename: string) => Promise<void>;
    deleteScript?: (filename: string) => Promise<void>;
    editScript?: (filename: string) => Promise<void>;
    duplicateScript?: (filename: string) => Promise<void>;
    updateScriptStats?: (statsMap: Record<string, { ram_usage: number }>) => void;
    appSidebar?: JsaAppSidebarBridge;
    /** editor-config.js: reloads library `.d.ts` IntelliSense after a library script is deleted. */
    loadLibraryDefinitions?: () => Promise<void>;
    CardPreview?: JsaCardPreviewBridge;
    confirmDialog?: JsaConfirmDialogBridge;
    commitDialog?: JsaCommitDialogBridge;
    restoreModal?: JsaRestoreModalBridge;
    alertToast?: JsaAlertToastBridge;
    entityPickerModal?: JsaEntityPickerModalBridge;
    monacoEditor?: JsaMonacoEditorBridge;
    logViewer?: JsaLogViewerBridge;
    watchPanel?: JsaWatchPanelBridge;
    /** api.js: ingress-aware URL prefix, e.g. '/api/hassio_ingress/<token>/'. */
    BASE_PATH?: string;
    /** Set by tab-manager.js's switchToTab() — the script whose card the preview toggle button controls. */
    _activeCardParentScript?: string | null;
    _toggleCardPreview?: () => void;
  }
}

export {};
