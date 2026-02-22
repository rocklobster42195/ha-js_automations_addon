/**
 * JS AUTOMATIONS - Script List Manager
 * Handles the sidebar list, filtering, creation, and deletion of scripts.
 */

var allScripts = [];
var collapsedSections = JSON.parse(localStorage.getItem('js_collapsed_sections') || '[]');
var npmPackages = []; // Temporärer Speicher für das Modal
var editingScriptFilename = null; // Wenn gesetzt, sind wir im Edit-Modus
var duplicatedScriptContent = null; // Speicher für Code beim Duplizieren

async function loadScripts() {
    // Refresh Metadata (Labels, Areas) in background
    if (typeof loadHAMetadata === 'function') loadHAMetadata();

    // apiFetch is global from app.js
    const res = await apiFetch('api/scripts');
    if (res.ok) renderScripts(await res.json());
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

    // Toolbar des aktiven Tabs aktualisieren (falls Statusänderung)
    if (typeof activeTabFilename !== 'undefined' && activeTabFilename && activeTabFilename !== 'System: Store') {
        const tab = typeof openTabs !== 'undefined' ? openTabs.find(t => t.filename === activeTabFilename) : null;
        if (tab && typeof updateToolbarUI === 'function') {
            updateToolbarUI(activeTabFilename, tab.icon, tab.isDirty);
        }
    }

    // Tabs aktualisieren (für Status-Farben)
    if (typeof renderTabs === 'function') renderTabs();

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

        if (key !== NO_GROUP && typeof haData !== 'undefined') {
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
            if (isSearchActive) return;
            const nowHidden = contentDiv.style.display !== 'none';
            contentDiv.style.display = nowHidden ? 'none' : 'block';
            const chevron = header.querySelector('.mdi-chevron-up, .mdi-chevron-down');
            if (chevron) chevron.className = `mdi mdi-chevron-${nowHidden ? 'down' : 'up'}`;
            header.style.opacity = nowHidden ? '0.5' : '1';
            if (nowHidden) {
                if (!collapsedSections.includes(key)) collapsedSections.push(key);
            } else {
                collapsedSections = collapsedSections.filter(s => s !== key);
            }
            localStorage.setItem('js_collapsed_sections', JSON.stringify(collapsedSections));
        };

        // Skripte innerhalb der Gruppe sortieren
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

            let icon = s.icon ? s.icon.split(':').pop() : 'script-text';
            if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(icon)) {
                icon = 'script-text';
            }
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
                            <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="${i18next.t('script_action_restart_title')}" ${!s.running ? 'disabled' : ''}>
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

function updateIconPreview(id, s) { 
    const el = document.getElementById(id); 
    if (!el) return;
    
    let icon = s ? s.split(':').pop().trim() : 'script-text';
    if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(icon)) {
        icon = 'script-text';
    }
    el.className = `mdi mdi-${icon}`; 
}

function closeModal() { document.getElementById('new-script-modal').classList.add('hidden'); }

function checkScriptName() {
    const nameInput = document.getElementById('new-script-name');
    const errEl = document.getElementById('modal-error-msg');
    const createBtn = document.querySelector('#new-script-modal .btn-primary');

    const name = nameInput.value.trim();

    // Im Edit-Modus prüfen wir den Dateinamen nicht (da wir ihn eh nicht ändern)
    if (editingScriptFilename) return;

    // Button deaktivieren, wenn leer
    if (!name) {
        if (errEl) { errEl.textContent = ''; }
        if (createBtn) createBtn.disabled = true;
        return;
    }

    // Simulation der Backend-Dateinamen-Generierung (Slugify)
    // Muss exakt mit server.js übereinstimmen: Nur a-z, 0-9 und _ (keine Bindestriche!)
    const slug = name.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

    const filename = slug + '.js';

    // Prüfen ob Dateiname existiert
    const exists = allScripts.some(s => s.filename === filename);

    if (exists) {
        const msg = i18next.t('error_file_exists', { filename, defaultValue: `File '${filename}' already exists.` });
        if (errEl) { errEl.textContent = msg; }
        if (createBtn) createBtn.disabled = true;
    } else {
        if (errEl) { errEl.textContent = ''; }
        if (createBtn) createBtn.disabled = false;
    }
}

async function createNewScript() {
    document.getElementById('new-script-modal').classList.remove('hidden');
    editingScriptFilename = null;
    duplicatedScriptContent = null;
    
    // Reset Formular
    document.getElementById('new-script-name').value = '';
    document.getElementById('new-script-desc').value = '';
    document.getElementById('new-script-icon').value = 'mdi:script-text';
    document.getElementById('new-script-area').value = '';
    document.getElementById('new-script-label').value = '';
    document.getElementById('new-script-loglevel').value = 'info';
    
    // UI Reset
    document.querySelector('#new-script-modal h3').textContent = i18next.t('modal_new_automation_title');
    document.querySelector('#new-script-modal .btn-primary').textContent = i18next.t('button_create');

    // Reset NPM Input
    npmPackages = [];
    renderNpmTags();
    document.getElementById('npm-input').value = '';

    checkScriptName();

    updateIconPreview('modal-icon-preview', 'mdi:script-text');
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = `<option value="">${i18next.t('area_none')}</option>` + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = `<option value="">${i18next.t('label_none')}</option>` + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) { }
}

async function editScript(filename) {
    const script = allScripts.find(s => s.filename === filename);
    if (!script) return;

    editingScriptFilename = filename;
    document.getElementById('new-script-modal').classList.remove('hidden');

    // UI Update
    document.querySelector('#new-script-modal h3').textContent = i18next.t('modal_edit_script_title');
    document.querySelector('#new-script-modal .btn-primary').textContent = i18next.t('save_title');
    document.querySelector('#new-script-modal .btn-primary').disabled = false;

    // Load Metadata (Areas/Labels) first
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = `<option value="">${i18next.t('area_none')}</option>` + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = `<option value="">${i18next.t('label_none')}</option>` + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) { }

    // Fill Form
    document.getElementById('new-script-name').value = script.name || '';
    document.getElementById('new-script-desc').value = script.description || '';
    document.getElementById('new-script-icon').value = script.icon || 'mdi:script-text';
    document.getElementById('new-script-area').value = script.area || '';
    document.getElementById('new-script-label').value = script.label || '';
    document.getElementById('new-script-loglevel').value = script.loglevel || 'info';

    updateIconPreview('modal-icon-preview', script.icon);

    // Fill NPM
    npmPackages = [];
    if (script.dependencies) script.dependencies.forEach(d => addNpmTag(d));
    renderNpmTags();
}

async function duplicateScript(filename) {
    const script = allScripts.find(s => s.filename === filename);
    if (!script) return;

    // Content laden
    try {
        const res = await apiFetch(`api/scripts/${filename}/content`);
        if (res.ok) {
            const data = await res.json();
            // Header entfernen (alles bis zum ersten */)
            duplicatedScriptContent = data.content.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
        }
    } catch (e) {
        console.error("Failed to fetch script content for duplication", e);
        return;
    }

    editingScriptFilename = null; // Wir erstellen ein neues Skript
    document.getElementById('new-script-modal').classList.remove('hidden');

    // UI Update
    document.querySelector('#new-script-modal h3').textContent = i18next.t('modal_duplicate_script_title', { defaultValue: 'Duplicate Script' });
    document.querySelector('#new-script-modal .btn-primary').textContent = i18next.t('button_duplicate', { defaultValue: 'DUPLICATE' });
    
    // Load Metadata
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = `<option value="">${i18next.t('area_none')}</option>` + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = `<option value="">${i18next.t('label_none')}</option>` + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) { }

    // Fill Form
    document.getElementById('new-script-name').value = `${script.name} (Copy)`;
    document.getElementById('new-script-desc').value = script.description || '';
    document.getElementById('new-script-icon').value = script.icon || 'mdi:script-text';
    document.getElementById('new-script-area').value = script.area || '';
    document.getElementById('new-script-label').value = script.label || '';
    document.getElementById('new-script-loglevel').value = script.loglevel || 'info';

    updateIconPreview('modal-icon-preview', script.icon);

    // Fill NPM
    npmPackages = [];
    if (script.dependencies) script.dependencies.forEach(d => addNpmTag(d));
    renderNpmTags();

    checkScriptName(); // Namen validieren
}

// --- NPM CHIP LOGIC ---
function handleNpmInput(e) {
    const input = e.target;
    const val = input.value.trim();

    // Enter (13), Komma (188) oder Space -> Tag erstellen
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        e.preventDefault();
        if (val) {
            addNpmTag(val);
            input.value = '';
        }
    }
    // Backspace -> Letzten Tag löschen, wenn Input leer
    else if (e.key === 'Backspace' && val === '' && npmPackages.length > 0) {
        removeNpmTag(npmPackages.length - 1);
    }
}

function addNpmTag(pkgName) {
    // Duplikate vermeiden
    if (npmPackages.some(p => p.name === pkgName)) return;

    const pkg = { name: pkgName, status: 'loading' };
    npmPackages.push(pkg);
    renderNpmTags();
    validateNpmPackage(pkg);
}

function removeNpmTag(index) {
    npmPackages.splice(index, 1);
    renderNpmTags();
}

function renderNpmTags() {
    const container = document.getElementById('npm-tags-container');
    if (!container) return;
    container.innerHTML = '';

    npmPackages.forEach((pkg, index) => {
        const tag = document.createElement('div');
        tag.className = `npm-tag ${pkg.status}`;

        // Tooltip für Feedback (z.B. "Package not found" oder "Network Error")
        if (pkg.error) tag.title = pkg.error;
        else if (pkg.status === 'valid') tag.title = 'Package available';
        
        let icon = '';
        if (pkg.status === 'loading') icon = '<i class="mdi mdi-loading mdi-spin"></i>';
        else if (pkg.status === 'valid') icon = '<i class="mdi mdi-check"></i>';
        else if (pkg.status === 'invalid') icon = '<i class="mdi mdi-alert-circle-outline"></i>';

        tag.innerHTML = `${icon} ${pkg.name} <span class="npm-tag-close" onclick="removeNpmTag(${index})">&times;</span>`;
        container.appendChild(tag);
    });
}

async function validateNpmPackage(pkg) {
    // Version abschneiden für Check (z.B. axios@1.0.0 -> axios)
    // Fix für Scoped Packages (@scope/pkg) und Versionen
    let cleanName = pkg.name;
    const lastAt = cleanName.lastIndexOf('@');
    if (lastAt > 0) cleanName = cleanName.substring(0, lastAt);

    // URL Encode für Slashes in Scoped Packages (@scope%2Fpkg)
    try {
        const res = await apiFetch(`api/npm/check/${encodeURIComponent(cleanName)}`);
        const data = await res.json();
        pkg.status = data.ok ? 'valid' : 'invalid';
        pkg.error = data.ok ? null : (data.error || 'Unknown error');
    } catch (e) {
        pkg.status = 'invalid';
        pkg.error = 'Backend connection failed';
    }
    renderNpmTags();
}

async function submitNewScript() {
    const n = document.getElementById('new-script-name').value.trim();
    const errEl = document.getElementById('modal-error-msg');
    if (!n) return;
    
    let icon = document.getElementById('new-script-icon').value;
    const iconName = icon ? icon.split(':').pop().trim() : '';
    if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(iconName)) {
        icon = 'mdi:script-text';
    }

    // FIX: Falls noch Text im NPM-Input steht (nicht mit Enter bestätigt), jetzt hinzufügen
    const npmInput = document.getElementById('npm-input');
    if (npmInput && npmInput.value.trim()) {
        addNpmTag(npmInput.value.trim());
        npmInput.value = '';
    }

    // NPM Pakete sammeln (nur Namen)
    // Warnung bei ungültigen Paketen? Optional. Wir speichern sie trotzdem.
    const desc = document.getElementById('new-script-desc').value;
    
    const p = { 
        name: n, 
        icon: icon, 
        description: desc, 
        npmModules: npmPackages.map(p => p.name), // NEU: Liste der Pakete
        area: document.getElementById('new-script-area').value, 
        label: document.getElementById('new-script-label').value, 
        loglevel: document.getElementById('new-script-loglevel').value,
        code: duplicatedScriptContent // Code übergeben (falls vorhanden)
    };

    let res;
    if (editingScriptFilename) {
        // UPDATE MODE
        res = await apiFetch(`api/scripts/${editingScriptFilename}/metadata`, { 
            method: 'PUT', 
            headers: {'Content-Type':'application/json'}, 
            body: JSON.stringify(p) 
        });
    } else {
        // CREATE MODE
        res = await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    }

    if (res.ok) {
        const data = await res.json();
        closeModal();
        await loadScripts();
        const targetFilename = editingScriptFilename || data.filename;

        // Refresh Editor Content if tab is open
        if (typeof openTabs !== 'undefined') {
            const tab = openTabs.find(t => t.filename === targetFilename);
            if (tab) {
                const cRes = await apiFetch(`api/scripts/${targetFilename}/content`);
                if (cRes.ok) {
                    const cData = await cRes.json();
                    if (tab.model) {
                        tab.model.setValue(cData.content);
                        tab.originalContent = cData.content;
                        tab.isDirty = false;
                    }
                    tab.icon = p.icon;
                }
            }
        }

        setTimeout(() => openOrSwitchToTab(targetFilename, p.icon), 100);
        duplicatedScriptContent = null; // Reset
    } else {
        const err = await res.json().catch(() => ({}));
        const msg = i18next.t('error_create_failed', { defaultValue: 'Creation failed' }) + ": " + (err.message || res.statusText);
        if (errEl) { 
            errEl.textContent = msg; 
        }
    }
}

async function toggleScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f, action: 'toggle' }) }); }
async function restartScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f, action: 'restart' }) }); }
async function deleteScript(f) {
    if (confirm(i18next.t('confirm_delete_script', { filename: f }))) {
        await apiFetch(`api/scripts/${f}`, { method: 'DELETE' });
        // openTabs is global from tab-manager.js
        if (typeof openTabs !== 'undefined') {
            const t = openTabs.find(t => t.filename === f);
            if (t) t.isDirty = false;
            closeTab(f);
        }
        loadScripts();
    }
}

// Make globally available
window.loadScripts = loadScripts;
window.filterScripts = filterScripts;
window.clearSearch = clearSearch;
window.checkScriptName = checkScriptName;
window.renderScripts = renderScripts;
window.updateIconPreview = updateIconPreview;
window.closeModal = closeModal;
window.createNewScript = createNewScript;
window.submitNewScript = submitNewScript;
window.toggleScript = toggleScript;
window.restartScript = restartScript;
window.deleteScript = deleteScript;
window.handleNpmInput = handleNpmInput;
window.removeNpmTag = removeNpmTag;
window.editScript = editScript;
window.duplicateScript = duplicateScript;