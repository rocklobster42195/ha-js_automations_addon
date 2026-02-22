/**
 * JS AUTOMATIONS - Tab Manager
 * Handles opening, closing, switching, and saving of tabs.
 */

var openTabs = [];
var activeTabFilename = null;

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

        tabEl.onclick = () => switchToTab(tabData.filename);
        
        let iconName = tabData.icon ? tabData.icon.split(':').pop() : 'script-text';
        if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(iconName)) {
            iconName = 'script-text';
        }

        let statusClass = '';
        if (typeof allScripts !== 'undefined') {
            const s = allScripts.find(s => s.filename === tabData.filename);
            if (s) {
                if (s.running) statusClass = 'status-running';
                else if (s.status === 'error') statusClass = 'status-error';
            }
        }

        tabEl.innerHTML = `
            <i class="tab-icon mdi mdi-${iconName} ${statusClass}"></i>
            <span class="tab-filename ${statusClass}">${tabData.filename}</span>
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
            updateIconDecorations(newTab.model);
        });

        openTabs.push(newTab);
        updateIconDecorations(newTab.model);
        switchToTab(filename);
    } catch(e) {
        console.error(`Failed to open script ${filename}`, e);
        document.getElementById('editor-section').classList.add('hidden');
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
        if (typeof window.loadStoreData === 'function') window.loadStoreData();
    } else {
        document.getElementById('store-wrapper').classList.add('hidden');
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

    if (openTabs.length === 0) {
        document.getElementById('editor-section').classList.add('hidden');
        activeTabFilename = null;
        if (editor) editor.setModel(null);
    } else if (activeTabFilename === filename) {
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
    const saveBtn = document.querySelector('.btn-save');
    const toggleBtn = document.getElementById('btn-script-toggle');
    const restartBtn = document.getElementById('btn-script-restart');

    if (filename === 'System: Store') {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.1';
        if (toggleBtn) { toggleBtn.disabled = true; toggleBtn.style.opacity = '0.1'; }
        if (restartBtn) { restartBtn.disabled = true; restartBtn.style.opacity = '0.1'; }
    } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = isDirty ? '1' : '0.4';

        // Script Status prüfen (allScripts ist global aus script-list.js)
        const script = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === filename) : null;
        
        if (toggleBtn) {
            toggleBtn.disabled = false;
            toggleBtn.style.opacity = '1';
            const i = toggleBtn.querySelector('i');
            if (script && script.running) {
                i.className = 'mdi mdi-stop';
                i.style.color = 'var(--accent)';
            } else {
                i.className = 'mdi mdi-play';
                i.style.color = '';
            }
        }

        if (restartBtn) {
            restartBtn.disabled = !(script && script.running);
            restartBtn.style.opacity = (script && script.running) ? '1' : '0.4';
        }
    }
}

async function toggleActiveScript() {
    if (activeTabFilename && activeTabFilename !== 'System: Store') await window.toggleScript(activeTabFilename);
}

async function restartActiveScript() {
    if (activeTabFilename && activeTabFilename !== 'System: Store') await window.restartScript(activeTabFilename);
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
window.switchToTab = switchToTab;
window.closeTab = closeTab;
window.saveActiveTab = saveActiveTab;
window.closeAllTabs = closeAllTabs;
window.toggleActiveScript = toggleActiveScript;
window.restartActiveScript = restartActiveScript;