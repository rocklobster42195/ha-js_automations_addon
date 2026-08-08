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

export interface JsaSettings {
  statusbar?: JsaStatusBarSettings;
  mqtt?: { enabled?: boolean };
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
  type?: string;
  model: unknown;
  viewState?: unknown;
  /** Only present on `type: 'blockly'` tabs — see openBlocklyTab() in tab-manager.js. */
  jsa?: Record<string, unknown>;
  blocksState?: { blocks: unknown; variables: unknown };
}

export interface JsaCardPreviewBridge {
  open(scriptFilename: string): void;
  close(): void;
  toggle(scriptFilename: string | null | undefined): void;
  reload(): void;
  isOpen(): boolean;
}

export interface JsaConfirmDialogBridge {
  confirm(
    message: string,
    opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
  ): Promise<boolean>;
}

export interface JsaAlertToastBridge {
  show(message: string, opts?: { variant?: 'error' | 'info' | 'success' | 'warning'; duration?: number }): void;
}

export interface JsaEntityPickerModalBridge {
  open(): void;
  close(): void;
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
  /** Mobile per-script inline log (RFC §7) — a snapshot at call time, not a live subscription. */
  getEntriesForSource(source: string): JsaLogEntry[];
}

export interface JsaWatchTile {
  label: string;
  value: unknown;
}

export interface JsaWatchPanelBridge {
  /** Mobile per-script inline status (RFC §7 follow-up) — a snapshot at call time, keyed by filename. */
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
    /** tab-manager.js (not yet migrated) globals for the editor tab strip. */
    openTabs?: JsaTab[];
    renderTabs?: () => void;
    switchToTab?: (filename: string) => void;
    updateToolbarUI?: (filename: string, icon: string, isDirty: boolean) => void;
    closeTab?: (filename: string) => Promise<void>;
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
    alertToast?: JsaAlertToastBridge;
    entityPickerModal?: JsaEntityPickerModalBridge;
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
