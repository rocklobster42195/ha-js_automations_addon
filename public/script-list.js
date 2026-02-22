/**
 * JS AUTOMATIONS - Script List Manager
 * Handles the sidebar list, filtering, creation, and deletion of scripts.
 */

var allScripts = [];
var collapsedSections = JSON.parse(localStorage.getItem('js_collapsed_sections') || '[]');

async function loadScripts() { 
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

function updateIconPreview(id, s) { const el=document.getElementById(id); if(el) el.className=`mdi mdi-${s?s.split(':').pop().trim():'script-text'}`; }

function closeModal() { document.getElementById('new-script-modal').classList.add('hidden'); }

async function createNewScript() {
    document.getElementById('new-script-modal').classList.remove('hidden');
    // Reset Formular
    document.getElementById('new-script-name').value = '';
    document.getElementById('new-script-desc').value = '';
    document.getElementById('new-script-icon').value = 'mdi:script-text';

    const errEl = document.getElementById('modal-error-msg');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

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
    const n = document.getElementById('new-script-name').value.trim();
     const errEl = document.getElementById('modal-error-msg');
    if (!n) return;

    // Check if name already exists
    if (allScripts.some(s => s.name.toLowerCase() === n.toLowerCase())) {
        const msg = i18next.t('error_script_exists', { defaultValue: 'A script with this name already exists.' });
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        else alert(msg);
        return;
    }

    const p = { name: n, icon: document.getElementById('new-script-icon').value, description: document.getElementById('new-script-desc').value, area: document.getElementById('new-script-area').value, label: document.getElementById('new-script-label').value, loglevel: document.getElementById('new-script-loglevel').value };
    const res = await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    if (res.ok) { 
        const data = await res.json(); 
        closeModal(); 
        await loadScripts(); 
        setTimeout(() => openOrSwitchToTab(data.filename, p.icon), 100); 
    } else {
        const err = await res.json().catch(() => ({}));
        const msg = i18next.t('error_create_failed', { defaultValue: 'Creation failed' }) + ": " + (err.message || res.statusText);
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        else alert(msg);
    }
}

async function toggleScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); }
async function restartScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); }
async function deleteScript(f) { 
    if(confirm(i18next.t('confirm_delete_script', { filename: f }))) { 
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
window.renderScripts = renderScripts;
window.updateIconPreview = updateIconPreview;
window.closeModal = closeModal;
window.createNewScript = createNewScript;
window.submitNewScript = submitNewScript;
window.toggleScript = toggleScript;
window.restartScript = restartScript;
window.deleteScript = deleteScript;