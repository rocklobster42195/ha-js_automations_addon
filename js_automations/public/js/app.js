/**
 * JS AUTOMATIONS - Main Entry Point
 * Initializes the application and loads initial data. Monaco Editor itself is owned by
 * components/monaco-editor.ts — see the 'monaco-ready' listener below.
 */

// Capture console methods immediately to allow restoring/filtering.
const originalConsole = {
  log: console.log,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

// Monaco Editor itself is now owned by <monaco-editor> (components/monaco-editor.ts) — it
// dispatches 'monaco-ready' once its own AMD bootstrap + TS typings + completion providers are
// all set up. Everything below that isn't Monaco-specific but used to be nested inside that
// callback (purely by historical accident of file load order, not a real dependency on Monaco)
// waits for the same event so its relative timing is unchanged. Registered here at the top
// level — outside DOMContentLoaded — because app.js (a classic script) always finishes
// executing before components.js (a deferred module) upgrades <monaco-editor> and kicks off its
// (network-bound, so not instant) AMD load; registering inside the async DOMContentLoaded
// handler below would risk losing the race if that load somehow completed first.
document.addEventListener(
  'monaco-ready',
  () => {
    loadScripts();
    initResizer();
    initLogPaneResizer();
    initDevPanelTabs();
    initRepl();
  },
  { once: true }
);

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Internationalization.
  await initI18next();

  // 2. Initialize WebSocket Connection.
  initSocket();

  // --- SETTINGS INTEGRATION (system/console part only — the editor part lives in
  // <monaco-editor> and <editor-view>) ---
  window.addEventListener('settings-changed', (e) => applySystemSettings(e.detail));
  if (window.currentSettings) applySystemSettings(window.currentSettings);

  // 4. Load Global Data.
  loadHAMetadata();
  loadMDIIcons();
  loadHAServices();
  initLogs();

  // Load settings (after i18n init).
  if (window.loadSettingsData) window.loadSettingsData();

  // Start statusbar (after footer exists and socket is ready).
  if (window.statusBar) window.statusBar.init();

  // Initial System Check (Integration Status).
  checkSystemStatus();
});

/**
 * Determines the Monaco language ID based on the file extension.
 * @param {string} filename
 * @returns {string} 'typescript' or 'javascript'
 */
function getLanguageByFilename(filename) {
  if (!filename) return 'javascript';
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'ts') return 'typescript';
  // .blocks scripts open in the dedicated Blockly editor (#blockly-container), not Monaco —
  // this only matters if Monaco is ever asked to render one directly (e.g. future raw-source
  // view), where the raw JSON is at least readable in the JSON language mode.
  if (ext === 'blocks') return 'json';
  return 'javascript';
}
window.getLanguageByFilename = getLanguageByFilename;

/**
 * Heuristic to detect if code is TypeScript based on common keywords/syntax.
 * @param {string} content
 * @returns {string} 'typescript' or 'javascript'
 */
function detectLanguageFromContent(content) {
  if (!content) return 'javascript';
  const tsPatterns = [
    /\binterface\s+\w+/, // interface Name
    /\btype\s+\w+\s*=/, // type Name =
    /\benum\s+\w+/, // enum Name
    /\bnamespace\s+\w+/, // namespace Name
    /:\s*(string|number|boolean|any|void)\b/, // : string
    /\bas\s+(string|number|boolean|any|object)\b/, // value as string
    /\w+<\w+>/, // Array<string> or Generics
    /\b(private|public|protected)\s+\w+/, // Class modifiers
    /\?\./, // Optional chaining (though also in modern JS)
  ];

  const isTypeScript = tsPatterns.some((pattern) => pattern.test(content));
  return isTypeScript ? 'typescript' : 'javascript';
}
window.detectLanguageFromContent = detectLanguageFromContent;

/**
 * Generates the HTML for a language badge (JS/TS).
 * @param {string} filename
 * @returns {string} HTML string
 */
function getLanguageBadge(filename) {
  if (!filename || filename.startsWith('System: ')) return '';
  if (filename.endsWith('.blocks')) return `<span class="lang-badge lang-badge-blocks">BLK</span>`;
  const lang = getLanguageByFilename(filename);
  const label = lang === 'typescript' ? 'TS' : 'JS';
  const cssClass = lang === 'typescript' ? 'lang-badge-ts' : 'lang-badge-js';
  return `<span class="lang-badge ${cssClass}">${label}</span>`;
}
window.getLanguageBadge = getLanguageBadge;

async function checkSystemStatus() {
  try {
    const res = await fetch('api/system/integration');
    if (res.ok) {
      const status = await res.json();

      // Optimistic update: Only overwrite if we don't have a status yet
      // or if the new status is actually "better" (connected)
      if (!window.currentIntegrationStatus || status.is_connected || status.is_running) {
        window.currentIntegrationStatus = status;
      }
      updateSystemNotifications();
    }
  } catch (e) {
    console.warn('System status check failed', e);
  }
}

function updateSystemNotifications() {
  const status = window.currentIntegrationStatus;
  const isSocketConnected = !!(window.socket && window.socket.connected);

  // Update MQTT Status via the Statusbar helper (repurposing the integration icon)
  if (window.statusBar && status && status.mqtt) {
    window.statusBar.updateMqttIndicator(status.mqtt);
  } else if (!isSocketConnected) {
    window.statusBar?.showConnectionLost();
  }

  if (!isSocketConnected) {
    if (typeof window.renderSettingsCategories === 'function') {
      window.renderSettingsCategories(); // Update settings UI with disconnected state
    }
  }

  if (!status) return;

  // Update the banner (Status Bar in Header)
  if (typeof window.handleIntegrationStatus === 'function') {
    if (!isSocketConnected && status.installed) {
      window.handleIntegrationStatus(null);
    } else {
      window.handleIntegrationStatus(status);
    }
  }

  // --- Logic for Settings Notification Dot (sidebar header gear icon) ---
  // The dot indicates if an update is available or a restart is required.
  // This is independent of the socket connection state.
  if (typeof window.appSidebar?.refreshBadges === 'function') {
    window.appSidebar.refreshBadges();
  }

  // Update Settings Sidebar if open
  if (typeof window.renderSettingsCategories === 'function') {
    window.renderSettingsCategories();
  }
}
window.updateSystemNotifications = updateSystemNotifications;

/**
 * Applies system settings, specifically the log level for the browser console.
 */
function applySystemSettings(settings) {
  if (!settings || !settings.system) return;
  const level = settings.system.log_level || 'info';

  // Reset to original methods first
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;

  // Apply filter based on level
  if (level === 'info') {
    console.debug = function () {};
  } else if (level === 'warn') {
    console.debug = function () {};
    console.log = function () {};
    console.info = function () {};
  } else if (level === 'error') {
    console.debug = function () {};
    console.log = function () {};
    console.info = function () {};
    console.warn = function () {};
  }
}
