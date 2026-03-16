/**
 * JS AUTOMATIONS - Main Entry Point
 * Initializes the application, Monaco Editor, and loads initial data.
 */

var editor = null; // Global instance for editor-config.js

// Capture console methods immediately to allow restoring/filtering
const originalConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Internationalization
    await initI18next();
    
    // 2. Initialize WebSocket Connection
    initSocket();

    // 3. Initialize Monaco Editor (AMD Loader)
    if (typeof require !== 'undefined') {
        const monacoLang = i18next.language.startsWith('de') ? 'de' : '';
        require.config({ 
            paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' },
            'vs/nls': { availableLanguages: { '*': monacoLang } }
        });
        
        require(['vs/editor/editor.main'], () => {
            // Create Editor Instance
            editor = monaco.editor.create(document.getElementById('monaco-container'), {
                model: null, // No model initially, will be set when a tab is opened
                language: 'javascript',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: true },
                suggest: { showWords: false }
            });

            // Restore Word Wrap Setting
            const savedWordWrap = localStorage.getItem('js_editor_wordwrap') || 'off';
            editor.updateOptions({ wordWrap: savedWordWrap });
            
            // Update UI Button for Word Wrap
            const wrapButton = document.getElementById('btn-word-wrap');
            if (wrapButton) {
                const icon = wrapButton.querySelector('i');
                if (icon) {
                    icon.className = `mdi mdi-wrap${savedWordWrap === 'on' ? '' : '-disabled'}`;
                }
            }

            // Register Keyboard Shortcuts (Ctrl+S / Cmd+S)
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveActiveTab);

            // --- SETTINGS INTEGRATION ---
            window.addEventListener('settings-changed', (e) => {
                applyEditorSettings(e.detail);
                applySystemSettings(e.detail);
            });
            if (window.currentSettings) {
                // Einstellungen mit einer kleinen Verzögerung anwenden, um sicherzustellen, dass Monaco vollständig bereit ist.
                // Dies verhindert potenzielle Race Conditions während der Editor-Initialisierung.
                setTimeout(() => {
                    applyEditorSettings(window.currentSettings);
                    applySystemSettings(window.currentSettings);
                }, 100);
            }

            // Add Context Menu Action: Insert Entity
            editor.addAction({
                id: 'insert-entity',
                label: i18next.t('modal_insert_entity_title', { defaultValue: 'Insert Entity' }),
                contextMenuGroupId: '90_snippets_general',
                contextMenuOrder: 0,
                keybindings: [ monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE ],
                run: () => { if (window.openEntityPicker) window.openEntityPicker(); }
            });

            // --- SNIPPETS CONTEXT MENU ---
            const snippetActions = [
                { id: 'snip-log', type: 'log', label: 'snippet_log', group: '90_snippets_general', order: 1 },
                { id: 'snip-service', type: 'service', label: 'snippet_service', group: '90_snippets_general', order: 2 },
                { id: 'snip-listener', type: 'listener', label: 'snippet_listener', group: '90_snippets_general', order: 3 },
                { id: 'snip-register', type: 'register', label: 'snippet_register', group: '91_snippets_state', order: 0 },
                { id: 'snip-state', type: 'state', label: 'snippet_state', group: '91_snippets_state', order: 1 },
                { id: 'snip-update', type: 'update_state', label: 'snippet_update_state', group: '91_snippets_state', order: 2 },
                { id: 'snip-store-set', type: 'store_set', label: 'snippet_store_set', group: '92_snippets_store', order: 1 },
                { id: 'snip-store-get', type: 'store_get', label: 'snippet_store_get', group: '92_snippets_store', order: 2 },
                { id: 'snip-store-del', type: 'store_del', label: 'snippet_store_del', group: '92_snippets_store', order: 3 }
            ];
            snippetActions.forEach(s => editor.addAction({ id: s.id, label: i18next.t(s.label), contextMenuGroupId: s.group, contextMenuOrder: s.order, run: () => window.insertCodeSnippet(s.type) }));

            // Initialize Editor Configuration & Layout
            configureMonaco();
            loadScripts();
            initResizer();
        });
    }

    // 4. Load Global Data
    loadHAMetadata();
    loadMDIIcons();
    loadHAServices();
    initLogs();

    // Settings laden (nach i18n init)
    if (window.loadSettingsData) window.loadSettingsData();
    
    injectSidebarFooter();

    // Statusbar starten (nachdem Footer existiert und Socket bereit ist)
    if (window.statusBar) window.statusBar.init();

    // Initial System Check (Integration Status)
    checkSystemStatus();
});

function injectSidebarFooter() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer'; // Bestehende Klasse für Styling beibehalten
    footer.id = 'status-bar'; // ID für globale Steuerung (z.B. Ein-/Ausblenden) hinzufügen
    footer.innerHTML = `
        <div class="system-indicators" style="display:flex; gap:10px; align-items:center;">
            <div class="stat-item" title="Backend Heartbeat">
                <i id="heartbeat-icon" class="mdi mdi-circle-outline heartbeat-icon" style="transition: all 0.2s ease-in-out; opacity: 0.3;"></i>
            </div>
            <div id="integration-status-item" class="stat-item" title="HA Integration Status">
                <i id="integration-status-icon" class="mdi mdi-circle-outline integration-icon" style="transition: all 0.2s ease-in-out; opacity: 0.3;"></i>
            </div>
        </div>
        <div class="status-slots">
            <div id="sb-slot1" class="sb-item sb-hidden"></div>
            <div id="sb-slot2" class="sb-item sb-hidden"></div>
            <div id="sb-slot3" class="sb-item sb-hidden"></div>
        </div>
    `;
    sidebar.appendChild(footer);
}

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
        console.warn("System status check failed", e);
    }
}

function updateSystemNotifications() {
    const status = window.currentIntegrationStatus;

    // Update Icon State
    const intIcon = document.getElementById('integration-status-icon');
    const intItem = document.getElementById('integration-status-item');
    if (intIcon) {
        // Check if socket is actually connected
        const isSocketConnected = window.socket && window.socket.connected;

        // The bridge is "running" if:
        // 1. The status object says so (fetch/socket)
        // 2. OR we have cached entities (proof that data is flowing)
        const hasEntities = window.cachedEntities && window.cachedEntities.length > 0;
        const isRunning = !!(status && (status.is_running || status.available || status.is_connected)) || 
                          !!(window._lastIntegrationStatus && (window._lastIntegrationStatus.is_connected || window._lastIntegrationStatus.is_running)) ||
                          hasEntities;

        const isDev = !!(status && status.dev_mode);

        if (!isSocketConnected) {
            intIcon.className = 'mdi mdi-circle-outline integration-icon';
            intIcon.style.color = 'var(--danger)';
            intIcon.style.opacity = '1';
            if (intItem) intItem.title = 'HA Integration: Disconnected (Socket)';
        } else if (!status && !isRunning) {
            // Checking status...
            intIcon.className = 'mdi mdi-circle-outline integration-icon';
            intIcon.style.color = '#999';
            intIcon.style.opacity = '0.3';
            if (intItem) intItem.title = 'HA Integration: Checking...';
        } else if (isRunning) {
            // Fully active and running
            intIcon.className = 'mdi mdi-circle-slice-8 integration-icon';
            intIcon.style.color = '#fff';
            intIcon.style.opacity = '1';
            if (intItem) intItem.title = 'HA Integration: Active';
        } else if (isDev && !isRunning) {
            // Dev Mode but not running yet
            intIcon.className = 'mdi mdi-circle-outline integration-icon';
            intIcon.style.color = 'var(--warn)';
            intIcon.style.opacity = '1';
            if (intItem) intItem.title = 'HA Integration: Developer Mode (Bridge disconnected)';
        } else if (status.installed) {
            // Files present but bridge not active (Legacy or Restart required)
            intIcon.className = 'mdi mdi-circle-slice-8 integration-icon';
            intIcon.style.color = 'var(--warn)';
            intIcon.style.opacity = '1';
            if (intItem) intItem.title = 'HA Integration: Files present, not running (Legacy/Restart needed)';
        } else {
            // Missing or not installed
            intIcon.className = 'mdi mdi-circle-outline integration-icon';
            intIcon.style.color = '';
            intIcon.style.opacity = '0.3';
            if (intItem) intItem.title = 'HA Integration: Not installed';
        }
    }

    // If the socket is disconnected, we can't trust the update/install status from the 'status' object.
    // So, we prevent showing a notification based on potentially stale data.
    const isSocketConnected = window.socket && window.socket.connected;
    if (!isSocketConnected) {
        const settingsBtn = Array.from(document.querySelectorAll('.header-actions button')).find(btn => btn.querySelector('.mdi-cog'));
        if (settingsBtn) {
            settingsBtn.classList.remove('has-notification');
        }
        // Also clear the integration banner message
        if (typeof window.handleIntegrationStatus === 'function') {
            window.handleIntegrationStatus(null);
        }
        if (typeof window.renderSettingsCategories === 'function') {
            window.renderSettingsCategories(); // Update settings UI with disconnected state
        }
        return; // Stop here
    }

    const isSocketConnected = window.socket && window.socket.connected;

    if (!status) return;

    // --- Logic for Settings Notification Dot & Banner ---
    
    // Base condition for the notification: Is an update needed or is the integration not installed?
    const needsUpdateAttention = !status.dev_mode && (!status.installed || status.needs_update);
    let showDot = needsUpdateAttention;

    // If the socket is disconnected, we need to be smart to avoid showing the dot incorrectly.
    if (!isSocketConnected) {
        // If the status says the integration IS installed, then the disconnect is temporary.
        // In this case, we should HIDE the notification, as the update status might be stale.
        if (status.installed) {
            showDot = false;
        }
        // If status.installed is false, showDot remains true, which is correct (to show "not installed").
    }

    // Update the banner
    if (typeof window.handleIntegrationStatus === 'function') {
        // If disconnected BUT the integration is known to be installed, it's a temporary connection loss.
        // We can pass `null` to the banner to let it show a generic "disconnected" message.
        if (!isSocketConnected && status.installed) {
            window.handleIntegrationStatus(null);
        } else {
            window.handleIntegrationStatus(status);
        }
    }

    // Apply the final decision to the settings button
    const settingsBtn = Array.from(document.querySelectorAll('.header-actions button')).find(btn => btn.querySelector('.mdi-cog'));
    if (settingsBtn) {
        if (showDot) settingsBtn.classList.add('has-notification');
        else settingsBtn.classList.remove('has-notification');
    }
    
    // Update Settings Sidebar if open
    if (typeof window.renderSettingsCategories === 'function') {
        window.renderSettingsCategories();
    }
}
window.updateSystemNotifications = updateSystemNotifications;

/**
 * Applies settings to the Monaco Editor instance.
 */
function applyEditorSettings(settings) {
    if (!editor || !settings || !settings.editor) return;
    const conf = settings.editor;

    editor.updateOptions({
        fontSize: conf.fontSize,
        wordWrap: conf.wordWrap,
        minimap: { enabled: conf.minimap }
    });

    const toolbar = document.querySelector('.editor-toolbar');
    if (toolbar) {
        const shouldHide = !conf.showToolbar;
        if ((toolbar.style.display === 'none') !== shouldHide) {
            toolbar.style.display = shouldHide ? 'none' : 'flex';
            setTimeout(() => editor.layout(), 0);
        }
    }

    // Sync Toolbar Button UI
    const wrapButton = document.getElementById('btn-word-wrap');
    if (wrapButton && wrapButton.querySelector('i')) {
        wrapButton.querySelector('i').className = `mdi mdi-wrap${conf.wordWrap === 'on' ? '' : '-disabled'}`;
    }
}

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
        console.debug = function() {};
    } else if (level === 'warn') {
        console.debug = function() {};
        console.log = function() {};
        console.info = function() {};
    } else if (level === 'error') {
        console.debug = function() {};
        console.log = function() {};
        console.info = function() {};
        console.warn = function() {};
    }
}