/**
 * JS AUTOMATIONS - Script List Manager
 * Handles the sidebar list, filtering, creation, and deletion of scripts.
 */

var allScripts = [];
var collapsedSections = JSON.parse(localStorage.getItem('js_collapsed_sections') || '[]');

async function loadScripts() {
    // Refresh Metadata (Labels, Areas) in background
    if (typeof loadHAMetadata === 'function') {
        try { await loadHAMetadata(); } catch (e) { console.debug("Metadata load error", e); }
    }

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
    const groupDisplayNames = {};
    const NO_GROUP = '___none___';
    const LIB_GROUP = '___libraries___';

    scripts.forEach(script => {
        // Check if it is a library (based on path)
        const isLib = script.path && (script.path.includes('/libraries/') || script.path.includes('\\libraries\\'));
        
        const rawLabel = (script.label && script.label.trim() !== '') ? script.label : NO_GROUP;
        const groupKey = isLib ? LIB_GROUP : rawLabel;
        
        const normalizedKey = (groupKey === NO_GROUP || groupKey === LIB_GROUP) ? groupKey : groupKey.toLowerCase();

        if (!groups[normalizedKey]) {
            groups[normalizedKey] = [];
            groupDisplayNames[normalizedKey] = groupKey;
        } else {
            // Falls der bisherige Anzeigename nur Kleinbuchstaben enthält, der neue aber nicht -> Update auf "schönere" Schreibweise
            if (groupDisplayNames[normalizedKey] === normalizedKey && groupKey !== normalizedKey) {
                groupDisplayNames[normalizedKey] = groupKey;
            }
        }
        groups[normalizedKey].push(script);
    });

    // 2. Gruppen sortieren (Alphabetisch, "Nicht zugeordnet" ganz unten)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === LIB_GROUP) return 1; // Libraries immer ganz unten
        if (b === LIB_GROUP) return -1;
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
        const isCollapsed = isSearchActive ? false : collapsedSections.some(s => s.toLowerCase() === key.toLowerCase());

        // --- HEADER ERSTELLEN ---
        let headerName = key === NO_GROUP ? i18next.t('group_none') : (groupDisplayNames[key] || key);
        let iconClass = key === NO_GROUP ? 'mdi-folder-open-outline' : 'mdi-label-outline';
        let iconStyle = '';

        if (key === LIB_GROUP) {
            headerName = i18next.t('group_global_libraries');
            iconClass = "mdi-bookshelf";
        }

        if (key !== NO_GROUP && typeof haData !== 'undefined' && haData && Array.isArray(haData.labels)) {
            const haLabel = haData.labels.find(l => l.name.toLowerCase() === key);
            if (haLabel) {
                headerName = haLabel.name;
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
                collapsedSections = collapsedSections.filter(s => s.toLowerCase() !== key.toLowerCase());
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
            
            row.title = buildScriptTooltip(s);
            
            row.onclick = () => openOrSwitchToTab(s.filename, s.icon);

            let icon = s.icon ? s.icon.split(':').pop() : 'script-text';
            if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0 && !mdiIcons.includes(icon)) {
                icon = 'script-text';
            }
            let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : 'status-stopped');
            const toggleIcon = s.running ? 'mdi-stop' : 'mdi-play';

            const badge = (window.getLanguageBadge) ? window.getLanguageBadge(s.filename) : '';
            // Libraries sind passiv -> Keine Controls
            const isLib = key === LIB_GROUP;
            const controlsHtml = isLib ? 
                `<span style="font-size:0.75rem; color:#666; font-style:italic; margin-right:10px;">${i18next.t('status_passive_library')}</span>
                 <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="${i18next.t('script_action_delete_title')}"><i class="mdi mdi-delete-outline"></i></button>` 
                : 
                `<button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')" title="${i18next.t('script_action_toggle_title')}"><i class="mdi ${toggleIcon}"></i></button>
                 <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="${i18next.t('script_action_restart_title')}" ${!s.running ? 'disabled' : ''}><i class="mdi mdi-restart"></i></button>
                 <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="${i18next.t('script_action_delete_title')}"><i class="mdi mdi-delete-outline"></i></button>`;

            row.innerHTML = `
                <div class="script-icon">
                    <i class="mdi mdi-${icon} ${statusClass}"></i>
                </div>
                <div class="script-info">
                    <div class="script-name">${s.name}</div>
                    <div class="script-lower-row">
                        <span class="script-filename">${badge}${s.filename}</span>
                        <div class="row-actions">
                            ${controlsHtml}
                        </div>
                    </div>
                </div>`;
            contentDiv.appendChild(row);
        });

        groupDiv.appendChild(contentDiv);
        list.appendChild(groupDiv);
    });
}

function buildScriptTooltip(s) {
    const lang = s.filename.endsWith('.ts') ? 'TypeScript' : 'JavaScript';
    const lines = [`File: ${s.filename} (${lang})`];
    lines.push(`State: ${s.running ? 'Running' : 'Stopped'}`);
    
    if (s.ram_usage) lines.push(`RAM: ~${s.ram_usage.toFixed(1)} MB`);
    if (s.last_started) lines.push(`Started: ${new Date(s.last_started).toLocaleString()}`);
    
    if (s.description) lines.push(`\n${s.description}`);
    return lines.join('\n');
}

function updateScriptStats(statsMap) {
    if (!allScripts) return;
    let changed = false;
    
    // Daten im lokalen Array aktualisieren
    for (const [filename, data] of Object.entries(statsMap)) {
        const script = allScripts.find(s => s.filename === filename);
        if (script) {
            script.ram_usage = data.ram_usage;
            changed = true;
        }
    }
    
    // Nur DOM-Attribute aktualisieren (kein Re-Render)
    if (changed && document.body.classList.contains('expert-mode')) {
        const rows = document.querySelectorAll('.script-row');
        rows.forEach(row => {
            const nameEl = row.querySelector('.script-filename');
            if (nameEl) {
                const s = allScripts.find(script => script.filename === nameEl.textContent);
                if (s) row.title = buildScriptTooltip(s);
            }
        });
    }
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

async function createNewScript() {
    // Redirect to Wizard
    if (window.openCreationWizard) window.openCreationWizard('create');
}

async function editScript(filename) {
    const script = allScripts.find(s => s.filename === filename);
    if (!script) return;
    
    if (window.openCreationWizard) window.openCreationWizard('edit', script);
}

async function duplicateScript(filename) {
    const script = allScripts.find(s => s.filename === filename);
    if (!script) return;

    let code = '';
    // Content laden
    try {
        const res = await apiFetch(`api/scripts/${filename}/content`);
        if (res.ok) {
            const data = await res.json();
            // Header entfernen (alles bis zum ersten */)
            code = data.content.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
        }
    } catch (e) {
        console.error("Failed to fetch script content for duplication", e);
        return;
    }

    if (window.openCreationWizard) window.openCreationWizard('duplicate', { ...script, code });
}

async function toggleScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f, action: 'toggle' }) }); }
async function restartScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f, action: 'restart' }) }); }
async function deleteScript(f) {
    // Check dependencies (Libraries)
    const dependents = allScripts.filter(s => {
        if (!s.includes || !Array.isArray(s.includes)) return false;
        // Check exact match or without .js extension (users might write @include lib or @include lib.js)
        return s.includes.some(inc => inc === f || inc === f.replace(/\.(js|ts)$/, ''));
    });

    if (dependents.length > 0) {
        const depNames = dependents.map(s => s.name).join(', ');
        const msg = i18next.t('warn_library_in_use', { 
            filename: f, 
            count: dependents.length, 
            scripts: depNames
        });
        if (!confirm(msg)) return;
    } else {
        const shouldConfirm = window.currentSettings?.general?.confirm_delete ?? true;
        if (shouldConfirm && !confirm(i18next.t('confirm_delete_script', { filename: f }))) return;
    }

    await apiFetch(`api/scripts/${f}`, { method: 'DELETE' });
    // openTabs is global from tab-manager.js
    if (typeof openTabs !== 'undefined') {
        const t = openTabs.find(t => t.filename === f);
        if (t) t.isDirty = false;
        closeTab(f);
    }
    loadScripts();
    
    // NEU: IntelliSense aktualisieren (falls Library gelöscht wurde)
    if (typeof loadLibraryDefinitions === 'function') await loadLibraryDefinitions();
}

// Make globally available
window.loadScripts = loadScripts;
window.filterScripts = filterScripts;
window.clearSearch = clearSearch;
window.renderScripts = renderScripts;
window.updateIconPreview = updateIconPreview;
window.createNewScript = createNewScript;
window.toggleScript = toggleScript;
window.restartScript = restartScript;
window.deleteScript = deleteScript;
window.editScript = editScript;
window.duplicateScript = duplicateScript;
window.updateScriptStats = updateScriptStats;

// --- VERSION LOADER ---
async function loadVersion() {
    const el = document.getElementById('app-version');
    if (!el) return;
    try {
        const res = await apiFetch('api/status');
        if (res.ok) {
            const data = await res.json();
            if (data.version) el.textContent = `v${data.version}`;
        }
    } catch (e) { console.debug("Version check failed", e); }
}
loadVersion();