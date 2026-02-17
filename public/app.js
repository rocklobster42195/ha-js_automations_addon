/**
 * JS AUTOMATIONS - Dashboard Logic (v2.17.4)
 * Feature: Colored Section Headers based on HA Labels
 */

const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, currentEditingFilename = '', socket = null, isMonacoReady = false, allScripts = [];
let haData = { areas: [], labels: [] };
let isDirty = false;
let originalContent = '';
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
            haData = await res.json();
            if (allScripts.length > 0) renderScripts(allScripts, false);
        }
    } catch (e) { console.warn("HA Metadata failed"); }
}

/**
 * UI RENDERING: Groups scripts by Label and remembers collapse state.
 */
function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    if (scripts.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#555">Keine Skripte gefunden.</div>';
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
        
        // Einklapp-Zustand aus dem Gedächtnis (localStorage) prüfen
        const isCollapsed = collapsedSections.includes(key);

        // --- HEADER ERSTELLEN ---
        let headerName = key === NO_GROUP ? 'Nicht zugeordnet' : key;
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
            row.onclick = () => openEditor(s.filename, s.description, s.icon);

            const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
            let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : 'status-stopped');
            const toggleIcon = s.running ? 'mdi-stop' : 'mdi-play';

            row.innerHTML = `
                <div class="script-meta">
                    <div class="script-icon"><i class="mdi mdi-${icon} ${statusClass}"></i></div>
                    <div class="script-details">
                        <span class="script-name">${s.name}</span>
                        <span class="script-filename">${s.filename}</span>
                    </div>
                </div>
                <div class="row-actions">
                    <button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')" title="Start / Stop">
                        <i class="mdi ${toggleIcon}"></i>
                    </button>
                    <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="Restart" ${!s.running?'disabled':''}>
                        <i class="mdi mdi-restart"></i>
                    </button>
                    <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="Löschen">
                        <i class="mdi mdi-delete-outline"></i>
                    </button>
                </div>`;
            contentDiv.appendChild(row);
        });

        groupDiv.appendChild(contentDiv);
        list.appendChild(groupDiv);
    });
}

// --- EDITOR & ACTIONS ---
async function openEditor(filename, description, icon) {
    if (!isMonacoReady) { setTimeout(() => openEditor(filename, description, icon), 500); return; }
    if (isDirty && currentEditingFilename !== filename) { if (!confirm("Discard changes?")) return; }
    currentEditingFilename = filename; setDirty(false);
    document.getElementById('editor-title').innerText = filename;
    updateIconPreview('editor-icon', icon);
    document.getElementById('editor-section').classList.remove('hidden');
    document.getElementById('editor-section').style.display = 'flex';
    const res = await apiFetch(`api/scripts/${filename}/content`);
    const data = await res.json();
    originalContent = data.content;
    if (!editor) {
        editor = monaco.editor.create(document.getElementById('monaco-container'), { value: data.content, language: 'javascript', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, suggest: { showWords: false } });
        editor.onDidChangeModelContent(() => { isDirty = editor.getValue() !== originalContent; setDirty(isDirty); const m = editor.getValue().match(/@icon\s+mdi:(.*)/); if(m) updateIconPreview('editor-icon', 'mdi:'+m[1].trim()); });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentScript);
    } else editor.setValue(data.content);
}

function updateIconPreview(id, s) { const el=document.getElementById(id); if(el) el.className=`mdi mdi-${s?s.split(':').pop().trim():'script-text'}`; }
function setDirty(d) { isDirty = d; document.querySelector('.btn-save').style.opacity = d ? '1' : '0.4'; document.getElementById('editor-title').innerText = currentEditingFilename + (d?' *':''); }

async function saveCurrentScript() { if (!editor) return; await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: editor.getValue() }) }); originalContent = editor.getValue(); setDirty(false); await loadScripts(); }
function closeEditor() { if(isDirty && !confirm("Discard?")) return; setDirty(false); document.getElementById('editor-section').style.display='none'; }
window.closeModal = () => document.getElementById('new-script-modal').style.display='none';

async function createNewScript() {
    document.getElementById('new-script-modal').style.display = 'flex';
    updateIconPreview('modal-icon-preview', 'mdi:script-text');
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = '<option value="">Kein Bereich</option>' + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = '<option value="">Kein Label</option>' + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) {}
}

async function submitNewScript() {
    const n = document.getElementById('new-script-name').value;
    if (!n) return;
    const p = { name: n, icon: document.getElementById('new-script-icon').value, description: document.getElementById('new-script-desc').value, area: document.getElementById('new-script-area').value, label: document.getElementById('new-script-label').value, loglevel: document.getElementById('new-script-loglevel').value };
    const res = await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    if (res.ok) { const data = await res.json(); window.closeModal(); await loadScripts(); setTimeout(() => openEditor(data.filename, p.description, p.icon), 300); }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => {
        const out = document.getElementById('console-output'); if(out) {
            const div = document.createElement('div'); div.className = 'log-line';
            let color = '#888'; if(d.level==='error'||d.message.includes('❌')) color='var(--danger)'; else if(d.level==='warn') color='#ffeb3b'; else if(d.message.includes('[System]')) color='var(--accent)';
            div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span style="color:${color}">${d.message}</span>`;
            out.appendChild(div); out.scrollTop = out.scrollHeight;
        }
    });
    socket.on('status_update', loadScripts);
    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => { configureMonaco(); loadScripts(); });
    }
    loadHAMetadata();
});
async function loadScripts() { const res = await apiFetch('api/scripts'); if (res.ok) renderScripts(await res.json()); }
window.loadScripts = loadScripts;
window.toggleScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); };
window.restartScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); };
window.deleteScript = async (f) => { if(confirm(`Delete?`)) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } };