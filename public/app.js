/**
 * JS AUTOMATIONS - Dashboard Logic (v2.17.4)
 * Feature: Colored Section Headers based on HA Labels
 */

// --- I18N ---
async function initI18next() {
    
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lng');

    // Wenn nicht per URL erzwungen, versuche Config vom Backend zu laden
    if (!lang) {
        try {
            const res = await apiFetch('api/options');
            if (res.ok) {
                const opts = await res.json();
                if (opts.ui_language) lang = opts.ui_language;
            }
        } catch (e) { console.debug("Could not load options", e); }
    }

    // Fallback: Browser-Sprache
    if (!lang) lang = navigator.language.split('-')[0];

    await i18next
        .use(i18nextHttpBackend)
        .init({
            lng: lang,
            fallbackLng: 'en',
            debug: false,
            ns: ['translation'],
            defaultNS: 'translation',
            backend: {
                loadPath: 'locales/{{lng}}/translation.json'
            }
        });
    updateUIWithTranslations();
}

function updateUIWithTranslations() {
    document.title = i18next.t('app_title');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.hasAttribute('data-i18n-placeholder')) {
            el.placeholder = i18next.t(key);
        } else if (el.hasAttribute('data-i18n-title')) {
            el.title = i18next.t(key);
        } else {
            el.innerHTML = i18next.t(key);
        }
    });
}
// --- END I18N ---

const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, socket = null, isMonacoReady = false, allScripts = [];
let haData = { areas: [], labels: [] };
let openTabs = [];
let activeTabFilename = null;
let collapsedSections = JSON.parse(localStorage.getItem('js_collapsed_sections') || '[]');

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

// --- MONACO CONFIG ---
async function configureMonaco() {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, allowJs: true });
    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        if (data.content) {
            const entities = data.content.replace(/export /g, '').replace(/type EntityID =\s+\|/g, 'type EntityID = ');
            const lib = `${entities}\ninterface HA { log(m:any):void; error(m:any):void; callService(d:string,s:string,data?:any):void; onStateChange(id:EntityID,cb:any):void; updateState(id:string,s:any,a?:any):void; store:any; on(p:any,cb:any):void; onStop(cb:any):void; select(p:any):any; }\ndeclare var ha: HA; declare var axios: any; declare function schedule(c:string,cb:any):void; declare function sleep(ms:number):Promise<void>;`;
            monaco.languages.typescript.javascriptDefaults.addExtraLib(lib, 'file:///ha-api.d.ts');
        }
    } catch (e) {}
    isMonacoReady = true;
}

// --- DATA LOADING ---
async function loadHAMetadata() {
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const data = await res.json();
            // TIMING FIX: If HA returns empty lists (during boot), retry in 3s
            if (data.areas.length === 0 && data.labels.length === 0) {
                console.log("⏳ HA Registry not ready. Retrying in 3s...");
                setTimeout(loadHAMetadata, 3000);
                return;
            }
            haData = data;
            console.log("✅ HA Metadata loaded.");
            if (allScripts.length > 0) renderScripts(allScripts, false);
        }
    } catch (e) { console.warn("HA Metadata failed"); }
}

function filterScripts() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (clearBtn) clearBtn.classList.toggle('hidden', searchTerm.length === 0);

    if (searchTerm === '') {
        renderScripts(allScripts, true); // Use complete list
        return;
    }

    const filtered = allScripts.filter(s =>
        s.name.toLowerCase().includes(searchTerm) ||
        s.filename.toLowerCase().includes(searchTerm) ||
        (s.description && s.description.toLowerCase().includes(searchTerm)) ||
        (s.area && s.area.toLowerCase().includes(searchTerm)) ||
        (s.label && s.label.toLowerCase().includes(searchTerm))
    );

    renderScripts(filtered, false);
}

function clearSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
        filterScripts();
    }
}

/**
 * UI RENDERING: Groups scripts by Label and remembers collapse state.
 */
function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    const searchInput = document.getElementById('search-input');
    const isSearchActive = searchInput && searchInput.value.length > 0;

    if (scripts.length === 0) {
        const message = isSearchActive ? i18next.t('no_scripts_found_search') : i18next.t('no_scripts_found');
        list.innerHTML = `<div style="text-align:center; padding:20px; color:#555">${message}</div>`;
        return;
    }

    // 1. Gruppieren nach Label
    const groups = {};
    const NO_GROUP = '___none___';

    scripts.forEach(script => {
        const groupKey = (script.label && script.label.trim() !== '') ? script.label : NO_GROUP;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(script);
    });

    // 2. Gruppen sortieren (Alphabetisch, "Nicht zugeordnet" ganz unten)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === NO_GROUP) return 1;
        if (b === NO_GROUP) return -1;
        return a.localeCompare(b);
    });

    // 3. Rendern der Sektionen
    sortedKeys.forEach(key => {
        const groupScripts = groups[key];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'script-group';
        
        // Einklapp-Zustand prüfen, bei Suche immer ausklappen
        const isCollapsed = isSearchActive ? false : collapsedSections.includes(key);

        // --- HEADER ERSTELLEN ---
        let headerName = key === NO_GROUP ? i18next.t('group_none') : key;
        let iconClass = key === NO_GROUP ? 'mdi-folder-open-outline' : 'mdi-label-outline';
        let iconStyle = '';

        if (key !== NO_GROUP) {
            const haLabel = haData.labels.find(l => l.name === key);
            if (haLabel) {
                if (haLabel.icon) iconClass = haLabel.icon.replace(':', '-');
                if (haLabel.color) iconStyle = `color: ${haLabel.color};`;
            }
        }

        const header = document.createElement('div');
        header.className = 'section-header';
        header.style.opacity = isCollapsed ? '0.5' : '1';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="mdi ${iconClass}" style="font-size:1rem; ${iconStyle}"></i> 
                <span>${headerName}</span>
            </div>
            <i class="mdi mdi-chevron-${isCollapsed ? 'down' : 'up'}" style="font-size:0.8rem; opacity:0.5;"></i>`;
            
        groupDiv.appendChild(header);

        // --- CONTAINER FÜR DIE ZEILEN ---
        const contentDiv = document.createElement('div');
        contentDiv.className = 'group-content';
        contentDiv.style.display = isCollapsed ? 'none' : 'block';

        // Event-Listener zum Einklappen & Speichern
        header.onclick = () => {
            // Bei Suche ist das Einklappen deaktiviert
            if (isSearchActive) return;

            const nowHidden = contentDiv.style.display !== 'none';
            contentDiv.style.display = nowHidden ? 'none' : 'block';
            
            // Icon und Sichtbarkeit anpassen
            const chevron = header.querySelector('.mdi-chevron-up, .mdi-chevron-down');
            if (chevron) chevron.className = `mdi mdi-chevron-${nowHidden ? 'down' : 'up'}`;
            header.style.opacity = nowHidden ? '0.5' : '1';

            // Zustand im LocalStorage dauerhaft merken
            if (nowHidden) {
                if (!collapsedSections.includes(key)) collapsedSections.push(key);
            } else {
                collapsedSections = collapsedSections.filter(s => s !== key);
            }
            localStorage.setItem('js_collapsed_sections', JSON.stringify(collapsedSections));
        };

        // Skripte innerhalb der Gruppe sortieren (Fehler > Running > Stopped)
        groupScripts.sort((a, b) => {
            const score = (s) => (s.status === 'error' ? 2 : (s.running ? 1 : 0));
            const scoreDiff = score(b) - score(a);
            if (scoreDiff !== 0) return scoreDiff;
            return a.name.localeCompare(b.name);
        });

        // --- ZEILEN RENDERN ---
        groupScripts.forEach(s => {
            const row = document.createElement('div');
            row.className = 'script-row';
            row.title = s.description || `File: ${s.filename}`;
            row.onclick = () => openOrSwitchToTab(s.filename, s.icon);

            const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
            let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : 'status-stopped');
            const toggleIcon = s.running ? 'mdi-stop' : 'mdi-play';

            row.innerHTML = `
                <div class="script-icon">
                    <i class="mdi mdi-${icon} ${statusClass}"></i>
                </div>
                <div class="script-info">
                    <div class="script-name">${s.name}</div>
                    <div class="script-lower-row">
                        <span class="script-filename">${s.filename}</span>
                        <div class="row-actions">
                            <button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')" title="${i18next.t('script_action_toggle_title')}">
                                <i class="mdi ${toggleIcon}"></i>
                            </button>
                            <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="${i18next.t('script_action_restart_title')}" ${!s.running?'disabled':''}>
                                <i class="mdi mdi-restart"></i>
                            </button>
                            <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="${i18next.t('script_action_delete_title')}">
                                <i class="mdi mdi-delete-outline"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
            contentDiv.appendChild(row);
        });

        groupDiv.appendChild(contentDiv);
        list.appendChild(groupDiv);
    });
}

// --- EDITOR & TABS ---

function renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    openTabs.forEach(tabData => {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.filename = tabData.filename;
        if (tabData.filename === activeTabFilename) {
            tabEl.classList.add('active');
        }
        if (tabData.isDirty) {
            tabEl.classList.add('dirty');
        }

        tabEl.onclick = () => switchToTab(tabData.filename);
        
        const iconName = tabData.icon ? tabData.icon.split(':').pop() : 'script-text';

        tabEl.innerHTML = `
            <i class="tab-icon mdi mdi-${iconName}"></i>
            <span class="tab-filename">${tabData.filename}</span>
            <div class="tab-close-container">
                <span class="tab-dirty-dot">●</span>
                <button class="tab-close-btn" onclick="event.stopPropagation(); closeTab('${tabData.filename}');">
                    <i class="mdi mdi-close"></i>
                </button>
            </div>
        `;
        tabBar.appendChild(tabEl);
    });
}

async function openOrSwitchToTab(filename, icon) {
    if (!isMonacoReady) { 
        setTimeout(() => openOrSwitchToTab(filename, icon), 500); 
        return; 
    }

    document.getElementById('editor-section').classList.remove('hidden');

    const existingTab = openTabs.find(t => t.filename === filename);
    if (existingTab) {
        switchToTab(filename);
        return;
    }

    try {
        const res = await apiFetch(`api/scripts/${filename}/content`);
        const data = await res.json();
        
        const newTab = {
            filename: filename,
            icon: icon,
            model: monaco.editor.createModel(data.content, 'javascript'),
            isDirty: false,
            originalContent: data.content,
            viewState: null,
        };

        newTab.model.onDidChangeContent(() => {
            const isNowDirty = newTab.model.getValue() !== newTab.originalContent;
            if (newTab.isDirty !== isNowDirty) {
                newTab.isDirty = isNowDirty;
                setDirtyUI(newTab.filename, isNowDirty);
            }
        });

        openTabs.push(newTab);
        switchToTab(filename);
    } catch(e) {
        console.error(`Failed to open script ${filename}`, e);
        document.getElementById('editor-section').classList.add('hidden');
    }
}

function switchToTab(filename) {
    if (!editor) return;

    // Save view state of the outgoing tab
    if (activeTabFilename) {
        const oldTab = openTabs.find(t => t.filename === activeTabFilename);
        if (oldTab) {
            oldTab.viewState = editor.saveViewState();
        }
    }

    activeTabFilename = filename;
    const newTab = openTabs.find(t => t.filename === filename);
    if (!newTab) return;

    // Switch model and restore view state
    editor.setModel(newTab.model);
    if (newTab.viewState) {
        editor.restoreViewState(newTab.viewState);
    }
    editor.focus();

    renderTabs();
    updateToolbarUI(newTab.filename, newTab.icon, newTab.isDirty);
}

function closeTab(filename) {
    const tabToClose = openTabs.find(t => t.filename === filename);
    if (!tabToClose) return;

    if (tabToClose.isDirty && !confirm(i18next.t('confirm_discard_changes', { filename }))) {
        return;
    }

    // Find index and remove tab
    const index = openTabs.findIndex(t => t.filename === filename);
    openTabs.splice(index, 1);
    
    // Clean up the model
    tabToClose.model.dispose();

    if (openTabs.length === 0) {
        // No tabs left, hide editor
        document.getElementById('editor-section').classList.add('hidden');
        activeTabFilename = null;
        editor.setModel(null);
    } else if (activeTabFilename === filename) {
        // Closed the active tab, switch to a new one
        const newIndex = Math.max(0, index - 1);
        switchToTab(openTabs[newIndex].filename);
    }

    renderTabs();
}

function setDirtyUI(filename, isDirty) {
    const tabData = openTabs.find(t => t.filename === filename);
    if (tabData) tabData.isDirty = isDirty;
    
    const tabEl = document.querySelector(`.tab[data-filename="${filename}"]`);
    if (tabEl) tabEl.classList.toggle('dirty', isDirty);

    if (filename === activeTabFilename) {
        updateToolbarUI(filename, tabData.icon, isDirty);
    }
}

function updateToolbarUI(filename, icon, isDirty) {
    document.querySelector('.btn-save').style.opacity = isDirty ? '1' : '0.4';
}

async function saveActiveTab() {
    if (!activeTabFilename) return;
    const activeTab = openTabs.find(t => t.filename === activeTabFilename);
    if (!activeTab || !activeTab.isDirty) return;

    const content = activeTab.model.getValue();
    await apiFetch(`api/scripts/${activeTabFilename}/content`, { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ content: content }) 
    });
    
    activeTab.originalContent = content;
    setDirtyUI(activeTabFilename, false);
    await loadScripts(); // Refresh script list in case metadata changed
}
window.saveActiveTab = saveActiveTab;

function closeAllTabs() { 
    if (openTabs.some(t => t.isDirty) && !confirm(i18next.t('confirm_discard_all_changes'))) {
        return;
    }
    openTabs.forEach(t => t.model.dispose());
    openTabs = [];
    activeTabFilename = null;
    editor.setModel(null);
    document.getElementById('editor-section').classList.add('hidden');
    renderTabs();
}
window.closeAllTabs = closeAllTabs;

function updateIconPreview(id, s) { const el=document.getElementById(id); if(el) el.className=`mdi mdi-${s?s.split(':').pop().trim():'script-text'}`; }

window.closeModal = () => document.getElementById('new-script-modal').classList.add('hidden');

async function createNewScript() {
    document.getElementById('new-script-modal').classList.remove('hidden');
    updateIconPreview('modal-icon-preview', 'mdi:script-text');
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = `<option value="">${i18next.t('area_none')}</option>` + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = `<option value="">${i18next.t('label_none')}</option>` + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) {}
}

async function submitNewScript() {
    const n = document.getElementById('new-script-name').value;
    if (!n) return;
    const p = { name: n, icon: document.getElementById('new-script-icon').value, description: document.getElementById('new-script-desc').value, area: document.getElementById('new-script-area').value, label: document.getElementById('new-script-label').value, loglevel: document.getElementById('new-script-loglevel').value };
    const res = await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    if (res.ok) { 
        const data = await res.json(); 
        window.closeModal(); 
        await loadScripts(); 
        setTimeout(() => openOrSwitchToTab(data.filename, p.icon), 100); 
    }
}

// --- LOGGING SYSTEM ---
let logEntries = [];
let knownSources = new Set(['System']);

async function initLogs() {
    try {
        const res = await apiFetch('api/logs');
        if (res.ok) {
            const history = await res.json();
            const container = document.getElementById('console-output');
            if (container) container.innerHTML = '';
            logEntries = [];
            
            // Reset sources
            knownSources = new Set(['System']);
            const select = document.getElementById('logFilter');
            if (select) {
                select.innerHTML = `<option value="ALL">${i18next.t('log_filter_all')}</option><option value="System">System</option>`;
            }
            
            history.forEach(entry => appendLog(entry, false));
            scrollToBottom();
        }
    } catch (e) { console.error("Log load failed", e); }
}

async function clearLogs() {
    await apiFetch('api/logs', { method: 'DELETE' });
    const container = document.getElementById('console-output');
    if (container) container.innerHTML = '';
    logEntries = [];
}
window.clearLogs = clearLogs;

function appendLog(entry, autoScroll = true) {
    if (typeof entry === 'string') {
        entry = { ts: Date.now(), level: 'info', source: 'System', message: entry };
    }
    logEntries.push(entry);

    const source = entry.source || 'System';
    if (!knownSources.has(source)) {
        knownSources.add(source);
        const select = document.getElementById('logFilter');
        if (select) {
            const opt = document.createElement('option');
            opt.value = source;
            opt.textContent = source;
            select.appendChild(opt);
        }
    }

    const out = document.getElementById('console-output');
    if (!out) return;

    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.source = source;

    // Colors
    let color = '#ddd'; 
    if (entry.level === 'error' || (entry.message && entry.message.includes('❌'))) color = '#ff5555'; 
    else if (entry.level === 'warn') color = '#ffb86c'; 
    else if (entry.level === 'debug') color = '#6272a4'; 
    else if (source === 'System') color = '#8be9fd'; 

    const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    div.innerHTML = `<span class="log-time" style="color:#666; margin-right:8px;">[${timeStr}]</span>` +
                    `<span style="color:#bd93f9; font-weight:bold; margin-right:8px;">[${source}]</span>` +
                    `<span style="color:${color}">${entry.message}</span>`;

    const currentFilter = document.getElementById('logFilter')?.value || 'ALL';
    if (currentFilter !== 'ALL' && source !== currentFilter) {
        div.style.display = 'none';
    }

    out.appendChild(div);
    if (autoScroll) scrollToBottom();
}

function filterLogs() {
    const filter = document.getElementById('logFilter').value;
    const container = document.getElementById('console-output');
    if (!container) return;
    
    Array.from(container.children).forEach(el => {
        if (filter === 'ALL' || el.dataset.source === filter) {
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    });
    scrollToBottom();
}
window.filterLogs = filterLogs;

function scrollToBottom() {
    const c = document.getElementById('console-output');
    if (c) c.scrollTop = c.scrollHeight;
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    await initI18next();

    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => appendLog(d));
    socket.on('status_update', loadScripts);

    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
            // --- CREATE EDITOR INSTANCE ---
            editor = monaco.editor.create(document.getElementById('monaco-container'), {
                model: null, // No model initially, will be set when a tab is opened
                language: 'javascript',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: false },
                suggest: { showWords: false }
            });

            // --- Restore Word Wrap Setting ---
            const savedWordWrap = localStorage.getItem('js_editor_wordwrap') || 'off';
            editor.updateOptions({ wordWrap: savedWordWrap });
            const wrapButton = document.getElementById('btn-word-wrap');
            if (wrapButton) {
                const icon = wrapButton.querySelector('i');
                if (icon) {
                    icon.className = `mdi mdi-wrap${savedWordWrap === 'on' ? '' : '-disabled'}`;
                }
            }

            // Add Ctrl+S save command
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveActiveTab);

            // --- LOAD INITIAL DATA ---
            configureMonaco();
            loadScripts();
            initResizer();
        });
    }
    loadHAMetadata();
    initLogs();
});
async function loadScripts() { const res = await apiFetch('api/scripts'); if (res.ok) renderScripts(await res.json()); }
window.loadScripts = loadScripts;
window.toggleScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); };
window.restartScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); };
window.deleteScript = async (f) => { if(confirm(i18next.t('confirm_delete_script', { filename: f }))) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } };

function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorSection = document.getElementById('editor-section');
    const mainContent = document.querySelector('.main-content');

    // Restore saved height from localStorage
    const savedEditorHeight = localStorage.getItem('js_editor_height_px');
    if (savedEditorHeight) {
        editorSection.style.height = `${savedEditorHeight}px`;
    }

    const handleMouseMove = (e) => {
        const mainContentRect = mainContent.getBoundingClientRect();
        let newEditorHeight = e.clientY - mainContentRect.top;

        // Constraints
        const minHeight = 90; // From CSS (tab-bar + editor-toolbar)
        const maxHeight = mainContent.clientHeight - 45 - resizer.offsetHeight; // 45px for log-header
        
        if (newEditorHeight < minHeight) newEditorHeight = minHeight;
        if (newEditorHeight > maxHeight) newEditorHeight = maxHeight;
        
        editorSection.style.height = `${newEditorHeight}px`;
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save the new height in pixels
        localStorage.setItem('js_editor_height_px', editorSection.clientHeight);
    };

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        document.body.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });
}

function toggleWordWrap() {
    if (!editor) return;

    const currentOptions = editor.getOptions();
    const currentWordWrap = currentOptions.get(monaco.editor.EditorOption.wordWrap);
    
    const newWordWrapValue = (currentWordWrap === 'off') ? 'on' : 'off';
    editor.updateOptions({ wordWrap: newWordWrapValue });
    localStorage.setItem('js_editor_wordwrap', newWordWrapValue);

    // Visual feedback on the button
    const wrapButton = document.getElementById('btn-word-wrap');
    if (wrapButton) {
        const icon = wrapButton.querySelector('i');
        if (icon) {
            icon.className = `mdi mdi-wrap${newWordWrapValue === 'on' ? '' : '-disabled'}`;
        }
    }
}
window.toggleWordWrap = toggleWordWrap;