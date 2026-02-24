/**
 * JS AUTOMATIONS - Main Entry Point
 * Initializes the application, Monaco Editor, and loads initial data.
 */

var editor = null; // Global instance for editor-config.js

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
                minimap: { enabled: false },
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
    
    injectSidebarFooter();
});

function injectSidebarFooter() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.innerHTML = `
        <div class="stat-item" title="CPU Usage">
            <i class="mdi mdi-chip"></i> <span id="stat-cpu" style="min-width:28px; text-align:right;">0%</span>
            <canvas id="cpu-sparkline" width="24" height="20" style="margin-left:4px; opacity:0.8;"></canvas>
        </div>
        <div class="stat-item" title="RAM Usage">
            <i class="mdi mdi-memory"></i> <span id="stat-ram">0 / 0 MB</span>
            <canvas id="ram-sparkline" width="24" height="20" style="margin-left:4px; opacity:0.8;"></canvas>
        </div>
    `;
    sidebar.appendChild(footer);
}