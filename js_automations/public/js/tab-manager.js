/**
 * JS AUTOMATIONS - Tab Manager
 * Handles opening, closing, switching, and saving of tabs.
 */

var openTabs = [];
var activeTabFilename = null;

// Suffix used to identify card tabs (not real files — virtual view of __JSA_CARD__ block)
const CARD_TAB_SUFFIX = '[card]';

function renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    openTabs.forEach((tabData, index) => {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';

        // Drag & Drop Logic
        tabEl.draggable = true;
        tabEl.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
            tabEl.style.opacity = '0.5';
        };
        tabEl.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
        tabEl.ondragend = () => { tabEl.style.opacity = ''; };
        tabEl.ondrop = (e) => {
            e.preventDefault();
            const oldIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (!isNaN(oldIndex) && oldIndex !== index) {
                const item = openTabs.splice(oldIndex, 1)[0];
                openTabs.splice(index, 0, item);
                renderTabs();
            }
        };

        tabEl.dataset.filename = tabData.filename;
        if (tabData.filename === activeTabFilename) {
            tabEl.classList.add('active');
        }
        if (tabData.isDirty) {
            tabEl.classList.add('dirty');
        }

        const isCardTab = tabData.type === 'card';
        const badge = (!isCardTab && window.getLanguageBadge) ? window.getLanguageBadge(tabData.filename) : '';

        tabEl.onclick = () => switchToTab(tabData.filename);

        let iconName = 'view-dashboard';
        let statusClass = '';
        let displayName = tabData.filename;

        if (isCardTab) {
            // Card tab: show "‹script.js card›" with dashboard icon
            displayName = tabData.parentScript.replace(/\.[^.]+$/, '') + ' ‹card›';
            tabEl.classList.add('card-tab');
        } else {
            // Live-Daten aus allScripts holen (falls vorhanden), sonst Fallback auf Tab-Daten
            const scriptFromList = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === tabData.filename) : null;
            const effectiveIcon = scriptFromList ? scriptFromList.icon : tabData.icon;

            iconName = effectiveIcon ? effectiveIcon.split(':').pop() : 'script-text';
            if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(iconName)) {
                iconName = 'script-text';
            }

            if (scriptFromList) {
                if (scriptFromList.running) statusClass = 'status-running';
                else if (scriptFromList.status === 'error') statusClass = 'status-error';
            }
        }

        tabEl.innerHTML = `
            <i class="tab-icon mdi mdi-${iconName} ${statusClass}"></i>
            <span class="tab-filename ${statusClass}">${badge}${displayName}</span>
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
    if (typeof isMonacoReady !== 'undefined' && !isMonacoReady) { 
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

        const language = window.getLanguageByFilename ? window.getLanguageByFilename(filename) : 'javascript';
        const uri = monaco.Uri.parse(`file:///${filename}`);
        
        const newTab = {
            filename: filename,
            icon: icon,
            model: monaco.editor.createModel(data.content, language, uri),
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
            updateIconDecorations(newTab.model);
        });

        openTabs.push(newTab);
        updateIconDecorations(newTab.model);
        switchToTab(filename);

        // Auto-open paired card tab if the script has a @card header
        if (/^\s*\*\s*@card\b/m.test(data.content)) {
            const cardTabName = filename + CARD_TAB_SUFFIX;
            if (!openTabs.find(t => t.filename === cardTabName)) {
                await openCardTab(filename);
            }
        }
    } catch(e) {
        console.error(`Failed to open script ${filename}`, e);
        document.getElementById('editor-section').classList.add('hidden');
    }
}

/**
 * Opens a virtual card tab for a Script Pack script.
 * Fetches the decoded __JSA_CARD__ source and opens it in a Monaco model.
 * @param {string} scriptFilename – parent script filename (e.g. 'openligadb.js')
 */
async function openCardTab(scriptFilename) {
    if (typeof isMonacoReady !== 'undefined' && !isMonacoReady) {
        setTimeout(() => openCardTab(scriptFilename), 500);
        return;
    }

    const cardTabName = scriptFilename + CARD_TAB_SUFFIX;
    const existingTab = openTabs.find(t => t.filename === cardTabName);
    if (existingTab) {
        switchToTab(cardTabName);
        return;
    }

    try {
        const res = await apiFetch(`api/scripts/${scriptFilename}/card`);
        if (!res.ok) {
            console.error(`[CardTab] Unexpected error loading card for ${scriptFilename}`, res.status);
            return;
        }
        const data = await res.json();

        const uri = monaco.Uri.parse(`file:///card__${scriptFilename}`);
        // isNew: no __JSA_CARD__ block exists yet — open with empty content, mark dirty so Ctrl+S creates it
        const initialContent = data.isNew ? '' : data.content;
        const newTab = {
            filename: cardTabName,
            icon: 'view-dashboard',
            type: 'card',
            parentScript: scriptFilename,
            model: monaco.editor.createModel(initialContent, 'javascript', uri),
            isDirty: data.isNew,
            originalContent: data.isNew ? null : data.content,  // null = "not yet saved"
            viewState: null,
        };

        newTab.model.onDidChangeContent(() => {
            // originalContent === null means "new card, not yet written" — always dirty until first save
            const isNowDirty = newTab.originalContent === null
                ? true
                : newTab.model.getValue() !== newTab.originalContent;
            if (newTab.isDirty !== isNowDirty) {
                newTab.isDirty = isNowDirty;
                setDirtyUI(cardTabName, isNowDirty);
            }
        });

        // Insert card tab directly after its parent script tab
        const parentIndex = openTabs.findIndex(t => t.filename === scriptFilename);
        if (parentIndex !== -1) {
            openTabs.splice(parentIndex + 1, 0, newTab);
        } else {
            openTabs.push(newTab);
        }

        switchToTab(cardTabName);
    } catch (e) {
        console.error(`[CardTab] Failed to open card tab for ${scriptFilename}`, e);
    }
}

function switchToTab(filename) {
    if (activeTabFilename && editor) {
        const oldTab = openTabs.find(t => t.filename === activeTabFilename);
        if (oldTab && oldTab.type !== 'store') {
            oldTab.viewState = editor.saveViewState();
        }
    }

    activeTabFilename = filename;
    const newTab = openTabs.find(t => t.filename === filename);
    if (!newTab) return;

    if (newTab.type === 'store') {
        document.getElementById('editor-wrapper').classList.add('hidden');
        document.getElementById('store-wrapper').classList.remove('hidden');
        const settingsWrapper = document.getElementById('settings-wrapper');
        if (settingsWrapper) settingsWrapper.classList.add('hidden');
        if (typeof window.loadStoreData === 'function') window.loadStoreData();
    } else if (newTab.type === 'settings') {
        document.getElementById('editor-wrapper').classList.add('hidden');
        document.getElementById('store-wrapper').classList.add('hidden');
        const settingsWrapper = document.getElementById('settings-wrapper');
        if (settingsWrapper) settingsWrapper.classList.remove('hidden');
        if (typeof window.loadSettingsData === 'function') window.loadSettingsData();
    } else {
        document.getElementById('store-wrapper').classList.add('hidden');
        const settingsWrapper = document.getElementById('settings-wrapper');
        if (settingsWrapper) settingsWrapper.classList.add('hidden');
        document.getElementById('editor-wrapper').classList.remove('hidden');
        
        if (editor) {
            editor.setModel(newTab.model);
            if (newTab.viewState) {
                editor.restoreViewState(newTab.viewState);
            }
            editor.focus();
        }
    }

    renderTabs();
    updateToolbarUI(newTab.filename, newTab.icon, newTab.isDirty);
    updateEditorMode(newTab.filename);

    // Rebuild snippet toolbar to match context (script vs. card)
    const toolbarSnippets = document.getElementById('toolbar-snippets');
    if (toolbarSnippets && typeof buildSnippetToolbar === 'function') {
        const snippetMode = newTab.type === 'card' ? 'card' : 'script';
        buildSnippetToolbar(toolbarSnippets, snippetMode);
    }

    // Show preview button for card tabs AND for script tabs that have a @card header
    const isCardTab = newTab.type === 'card';
    let parentScriptForPreview = null;
    if (isCardTab) {
        parentScriptForPreview = newTab.parentScript;
    } else {
        const scriptMeta = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === filename) : null;
        if (scriptMeta && scriptMeta.card) parentScriptForPreview = filename;
    }
    document.body.classList.toggle('card-tab-active', !!parentScriptForPreview);
    window._activeCardParentScript = parentScriptForPreview;

    // Sync Card menu button active state (lit when preview is open)
    const cardMenuBtn = document.getElementById('btn-card-menu');
    if (cardMenuBtn && typeof CardPreview !== 'undefined') {
        cardMenuBtn.classList.toggle('preview-active', CardPreview.isOpen());
    }
}

function closeTab(filename) {
    const tabToClose = openTabs.find(t => t.filename === filename);
    if (!tabToClose) return;

    if (tabToClose.isDirty && !confirm(i18next.t('confirm_discard_changes', { filename }))) {
        return;
    }

    const index = openTabs.findIndex(t => t.filename === filename);
    openTabs.splice(index, 1);

    if (tabToClose.model) tabToClose.model.dispose();

    // Cascade-close the paired card tab when its parent script is closed
    if (tabToClose.type !== 'card') {
        const cardTabName = filename + CARD_TAB_SUFFIX;
        const cardTabIndex = openTabs.findIndex(t => t.filename === cardTabName);
        if (cardTabIndex !== -1) {
            const cardTab = openTabs[cardTabIndex];
            if (cardTab.model) cardTab.model.dispose();
            openTabs.splice(cardTabIndex, 1);
            if (activeTabFilename === cardTabName) activeTabFilename = null;
        }
    }

    if (openTabs.length === 0) {
        document.getElementById('editor-section').classList.add('hidden');
        activeTabFilename = null;
        if (editor) editor.setModel(null);
    } else if (activeTabFilename === filename || activeTabFilename === null) {
        const newIndex = Math.max(0, index - 1);
        switchToTab(openTabs[Math.min(newIndex, openTabs.length - 1)].filename);
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

/**
 * Updates the card-tab toggle button (#btn-open-card-tab) visibility and icon.
 * Shows only on script tabs whose script has a @card header.
 * @param {string} filename - Active tab filename
 */
function _updateCardTabBtn(filename) {
    const btn = document.getElementById('btn-open-card-tab');
    if (!btn) return;

    const isCardTab = filename.endsWith(CARD_TAB_SUFFIX);
    if (isCardTab) {
        btn.classList.add('hidden');
        return;
    }

    const script = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === filename) : null;
    const hasCard = !!(script && script.card);
    btn.classList.toggle('hidden', !hasCard);

    if (hasCard) {
        const cardTabName = filename + CARD_TAB_SUFFIX;
        const cardTabOpen = openTabs.some(t => t.filename === cardTabName);
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = cardTabOpen
                ? 'mdi mdi-view-dashboard-edit-outline'
                : 'mdi mdi-view-dashboard-edit-outline';
        }
        btn.classList.toggle('preview-active', cardTabOpen);
        btn.title = cardTabOpen ? 'Close Card Tab' : 'Open Card Tab';
    }
}

/**
 * Toggles the card tab for the currently active script tab open or closed.
 * Called from the #btn-open-card-tab button in the toolbar.
 */
function toggleCardTab() {
    if (!activeTabFilename || activeTabFilename.endsWith(CARD_TAB_SUFFIX)) return;
    const cardTabName = activeTabFilename + CARD_TAB_SUFFIX;
    if (openTabs.some(t => t.filename === cardTabName)) {
        closeTab(cardTabName);
    } else {
        openCardTab(activeTabFilename);
    }
    _updateCardTabBtn(activeTabFilename);
}

function updateToolbarUI(filename, icon, isDirty) {
    const saveBtn = document.querySelector('.btn-save');
    const toggleBtn = document.getElementById('btn-script-toggle');
    const restartBtn = document.getElementById('btn-script-restart');
    const editBtn = document.getElementById('btn-script-edit');
    const dupBtn = document.getElementById('btn-script-duplicate');
    const deleteBtn = document.getElementById('btn-script-delete');

    _updateCardTabBtn(filename);

    // Card tabs: save enabled, script controls hidden
    const isCardTab = filename.endsWith(CARD_TAB_SUFFIX);
    if (isCardTab) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = isDirty ? '1' : '0.4';
        if (toggleBtn) { toggleBtn.disabled = true; toggleBtn.style.opacity = '0.1'; }
        if (restartBtn) { restartBtn.disabled = true; restartBtn.style.opacity = '0.1'; }
        if (editBtn) { editBtn.disabled = true; editBtn.style.opacity = '0.1'; }
        if (dupBtn) { dupBtn.disabled = true; dupBtn.style.opacity = '0.1'; }
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.style.opacity = '0.1'; }
        return;
    }

    if (filename === 'System: Store' || filename === 'System: Settings') {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.1';
        if (toggleBtn) { toggleBtn.disabled = true; toggleBtn.style.opacity = '0.1'; }
        if (restartBtn) { restartBtn.disabled = true; restartBtn.style.opacity = '0.1'; }
        if (editBtn) { editBtn.disabled = true; editBtn.style.opacity = '0.1'; }
        if (dupBtn) { dupBtn.disabled = true; dupBtn.style.opacity = '0.1'; }
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.style.opacity = '0.1'; }
    } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = isDirty ? '1' : '0.4';

        // Script Status prüfen (allScripts ist global aus script-list.js)
        const script = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === filename) : null;
        const isLib = script && script.path && (script.path.includes('/libraries/') || script.path.includes('\\libraries\\'));
        
        if (toggleBtn) {
            if (isLib) {
                toggleBtn.disabled = true;
                toggleBtn.style.opacity = '0.3';
                toggleBtn.title = i18next.t('library_cannot_start');
                const i = toggleBtn.querySelector('i');
                i.className = 'mdi mdi-play';
                i.style.color = '';
            } else {
                toggleBtn.disabled = false;
                toggleBtn.style.opacity = '1';
                toggleBtn.title = i18next.t('script_action_toggle_title');
                const i = toggleBtn.querySelector('i');
                if (script && script.running) {
                    i.className = 'mdi mdi-stop';
                    i.style.color = 'var(--accent)';
                } else {
                    i.className = 'mdi mdi-play';
                    i.style.color = '';
                }
            }
        }

        if (restartBtn) {
            if (isLib) {
                restartBtn.disabled = true;
                restartBtn.style.opacity = '0.3';
            } else {
                restartBtn.disabled = !(script && script.running);
                restartBtn.style.opacity = (script && script.running) ? '1' : '0.4';
            }
        }

        if (editBtn) {
            editBtn.disabled = false;
            editBtn.style.opacity = '1';
        }
        if (dupBtn) {
            dupBtn.disabled = false;
            dupBtn.style.opacity = '1';
        }
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
        }
    }
}

function updateEditorMode(filename) {
    const isCardTab = filename.endsWith(CARD_TAB_SUFFIX);
    const script = !isCardTab && (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === filename) : null;
    const isLib = script && script.path && (script.path.includes('/libraries/') || script.path.includes('\\libraries\\'));

    const container = document.getElementById('editor-wrapper');
    if (!container) return;

    // Remove existing banners
    const existingBanner = document.getElementById('lib-mode-banner');
    if (existingBanner) existingBanner.remove();
    const existingCardBanner = document.getElementById('card-mode-banner');
    if (existingCardBanner) existingCardBanner.remove();

    if (isCardTab) {
        const cardTab = openTabs.find(t => t.filename === filename);
        const banner = document.createElement('div');
        banner.id = 'card-mode-banner';
        banner.style.background = '#1a1f2e';
        banner.style.color = 'var(--accent)';
        banner.style.padding = '4px 10px';
        banner.style.fontSize = '0.8rem';
        banner.style.borderBottom = '1px solid var(--accent-dark, #1a4a8a)';
        banner.innerHTML = `<i class="mdi mdi-view-dashboard-outline" style="margin-right:6px;"></i> Card Editor — <strong>${cardTab?.parentScript ?? ''}</strong> &nbsp;·&nbsp; Ctrl+S to save`;
        container.insertBefore(banner, container.firstChild);
    } else if (isLib) {
        const banner = document.createElement('div');
        banner.id = 'lib-mode-banner';
        banner.style.background = '#1e2a36';
        banner.style.color = '#64b5f6';
        banner.style.padding = '4px 10px';
        banner.style.fontSize = '0.8rem';
        banner.style.borderBottom = '1px solid #0d47a1';
        banner.innerHTML = '<i class="mdi mdi-bookshelf" style="margin-right:6px;"></i> ' + i18next.t('library_mode_banner', { filename });
        container.insertBefore(banner, container.firstChild);
    }
}

function _isVirtualTab(filename) {
    return !filename || filename.startsWith('System: ') || filename.endsWith(CARD_TAB_SUFFIX);
}

async function toggleActiveScript() {
    if (!_isVirtualTab(activeTabFilename)) await window.toggleScript(activeTabFilename);
}

async function restartActiveScript() {
    if (!_isVirtualTab(activeTabFilename)) await window.restartScript(activeTabFilename);
}

async function editActiveScript() {
    if (!_isVirtualTab(activeTabFilename)) await window.editScript(activeTabFilename);
}

async function duplicateActiveScript() {
    if (!_isVirtualTab(activeTabFilename)) await window.duplicateScript(activeTabFilename);
}

async function deleteActiveScript() {
    if (!_isVirtualTab(activeTabFilename)) await window.deleteScript(activeTabFilename);
}

async function downloadActiveScript() {
    if (_isVirtualTab(activeTabFilename)) return;

    // Create a temporary link to trigger the download
    const link = document.createElement('a');
    link.href = (typeof BASE_PATH !== 'undefined' ? BASE_PATH : '/') + `api/scripts/${activeTabFilename}/download`;
    link.setAttribute('download', activeTabFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function saveActiveTab() {
    if (!activeTabFilename) return;
    const activeTab = openTabs.find(t => t.filename === activeTabFilename);
    if (!activeTab || !activeTab.isDirty) return;

    const content = activeTab.model.getValue();

    if (activeTab.type === 'card') {
        // Card tab: PUT back to the parent script's card endpoint
        await apiFetch(`api/scripts/${activeTab.parentScript}/card`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        activeTab.originalContent = content;
        setDirtyUI(activeTabFilename, false);
        // Auto-reload the preview if it is open
        if (typeof CardPreview !== 'undefined' && CardPreview.isOpen()) {
            CardPreview.reload();
        }
        return;
    }

    await apiFetch(`api/scripts/${activeTabFilename}/content`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ content: content })
    });

    activeTab.originalContent = content;
    setDirtyUI(activeTabFilename, false);
    if (typeof loadScripts === 'function') await loadScripts();
}

function closeAllTabs() { 
    if (openTabs.some(t => t.isDirty) && !confirm(i18next.t('confirm_discard_all_changes'))) {
        return;
    }
    openTabs.forEach(t => { if(t.model) t.model.dispose(); });
    openTabs = [];
    activeTabFilename = null;
    if (editor) editor.setModel(null);
    document.getElementById('editor-section').classList.add('hidden');
    renderTabs();
}

// Make globally available
window.renderTabs = renderTabs;
window.openOrSwitchToTab = openOrSwitchToTab;
window.openCardTab = openCardTab;
window.toggleCardTab = toggleCardTab;
window.switchToTab = switchToTab;
window.closeTab = closeTab;
window.saveActiveTab = saveActiveTab;
window.closeAllTabs = closeAllTabs;
window.toggleActiveScript = toggleActiveScript;
window.restartActiveScript = restartActiveScript;
window.editActiveScript = editActiveScript;
window.deleteActiveScript = deleteActiveScript;
window.duplicateActiveScript = duplicateActiveScript;
window.downloadActiveScript = downloadActiveScript;