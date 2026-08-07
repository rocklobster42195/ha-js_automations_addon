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
}

export interface JsaTab {
  filename: string;
  icon: string;
  isDirty: boolean;
  type?: string;
  model: unknown;
  viewState?: unknown;
}

export interface JsaCardPreviewBridge {
  open(scriptFilename: string): void;
  close(): void;
  toggle(scriptFilename: string | null | undefined): void;
  reload(): void;
  isOpen(): boolean;
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
    /** Opens the create/edit modal (store-modal.js) — omit `key` for create mode. */
    openStoreModal?: (key?: string) => void;
    /** Opens/switches to the Store Explorer tab (store-modal.js). */
    openStoreTab?: () => void;
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
    closeTab?: (filename: string) => void;
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
    openCreationWizard?: (mode?: string, data?: unknown) => Promise<void> | void;
    openReferenceTab?: () => void;
    openOrSwitchToTab?: (filename: string, icon?: string) => Promise<void> | void;
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
    /** api.js: ingress-aware URL prefix, e.g. '/api/hassio_ingress/<token>/'. */
    BASE_PATH?: string;
    /** Set by tab-manager.js's switchToTab() — the script whose card the preview toggle button controls. */
    _activeCardParentScript?: string | null;
    _toggleCardPreview?: () => void;
  }
}

export {};
