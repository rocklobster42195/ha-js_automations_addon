/**
 * JS AUTOMATIONS - Dashboard Logic (v2.16.4)
 * Fix: Modal visibility and global function access
 */

// 1. GLOBAL STATE & PATHS
const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null;
let currentEditingFilename = '';
let originalContent = ''; 
let isDirty = false;
let socket = null;
let isMonacoReady = false;
let allScripts = [];

/**
 * Helper: API Fetch with Ingress support
 */
async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

/**
 * MODAL MANAGEMENT (Top-Level for immediate access)
 */
window.closeModal = () => {
    const modal = document.getElementById('new-script-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
};

window.createNewScript = async () => {
    console.log("➕ Opening Modal...");
    const modal = document.getElementById('new-script-modal');
    if (!modal) return console.error("Modal element not found!");

    // A. SOFORT ANZEIGEN (Bevor irgendwas anderes passiert)
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // B. FELDER RESETTEN
    document.getElementById('new-script-name').value = '';
    document.getElementById('new-script-desc').value = '';
    const preview = document.getElementById('modal-icon-preview');
    if (preview) preview.className = 'mdi mdi-script-text';

    // C. HA METADATEN LADEN (Hintergrund, darf nicht blockieren)
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            const areaSelect = document.getElementById('new-script-area');
            const labelSelect = document.getElementById('new-script-label');
            if (areaSelect) areaSelect.innerHTML = '<option value="">Kein Bereich</option>' + (areas||[]).map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            if (labelSelect) labelSelect.innerHTML = '<option value="">Kein Label</option>' + (labels||[]).map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) {
        console.warn("Could not load HA metadata, modal stays open though.");
    }
};

window.updateModalIconPreview = () => {
    const input = document.getElementById('new-script-icon');
    const preview = document.getElementById('modal-icon-preview');
    if (input && preview) {
        const iconName = input.value.split(':').pop().trim() || 'script-text';
        preview.className = `mdi mdi-${iconName}`;
    }
};

window.submitNewScript = async () => {
    const name = document.getElementById('new-script-name').value.trim();
    if (!name) return alert("Name erforderlich");

    const payload = {
        name,
        icon: document.getElementById('new-script-icon').value,
        description: document.getElementById('new-script-desc').value,
        area: document.getElementById('new-script-area').value,
        label: document.getElementById('new-script-label').value,
        loglevel: document.getElementById('new-script-loglevel').value || 'info'
    };

    const res = await apiFetch('api/scripts', { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify(payload) 
    });

    if (res.ok) {
        const data = await res.json();
        window.closeModal();
        await loadScripts();
        setTimeout(() => openEditor(data.filename, payload.description, payload.icon), 300);
    }
};

/**
 * UI HELPERS
 */
function updateToolbarIcon(mdiString) {
    const el = document.getElementById('editor-icon');
    if (!el) return;
    const iconName = mdiString ? mdiString.split(':').pop().trim() : 'script-text';
    el.className = `mdi mdi-${iconName}`;
}

function setDirty(dirty) {
    isDirty = dirty;
    const titleEl = document.getElementById('editor-title');
    const saveBtn = document.querySelector('.btn-save');
    if (dirty) {
        if (titleEl && !titleEl.innerText.endsWith(' *')) titleEl.innerText += ' *';
        if (saveBtn) saveBtn.style.opacity = '1';
    } else {
        if (titleEl) titleEl.innerText = currentEditingFilename;
        if (saveBtn) saveBtn.style.opacity = '0.4';
    }
}

/**
 * MONACO CONFIGURATION
 */
async function configureMonaco() {
    if (isMonacoReady) return;
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, allowJs: true, lib: ['esnext'] });
    
    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        if (data.content) {
            const entities = data.content.replace(/export /g, '').replace(/type EntityID =\s+\|/g, 'type EntityID = ');
            const haLib = `
                ${entities}
                interface HAAttributes { friendly_name?: string; unit_of_measurement?: string; icon?: string; brightness?: number; [key: string]: any; }
                interface HAEvent { entity_id: EntityID; state: string; old_state: string; attributes: HAAttributes; }
                interface HAState { entity_id: EntityID; state: string; attributes: HAAttributes; last_changed: string; last_updated: string; }
                interface JSAPI { 
                    debug(m:any):void; log(m:any):void; warn(m:any):void; error(m:any):void; 
                    callService(d:string,s:string,data?:any):void; updateState(id:string,s:any,a?:any):void; 
                    on(p:EntityID|string|string[]|RegExp, cb:(e:HAEvent)=>void):void; 
                    onStop(cb:()=>void):void;
                    select(p:EntityID|string|string[]|RegExp): any;
                    states: Record<EntityID, HAState>; 
                    store: { val: any, set(k:string,v:any):void, delete(k:string):void }; 
                }
                declare var ha: JSAPI; declare var axios: any;
                declare function schedule(c:string,cb:any):void; declare function sleep(ms:number):Promise<void>;
            `;
            monaco.languages.typescript.javascriptDefaults.addExtraLib(haLib, 'file:///ha-api.d.ts');
        }
    } catch (e) {}
    isMonacoReady = true;
}

/**
 * LIST RENDERING
 */
function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    scripts.sort((a, b) => {
        const getScore = (s) => (s.status === 'error' ? 2 : (s.running ? 1 : 0));
        const scoreDiff = getScore(b) - getScore(a);
        return scoreDiff !== 0 ? scoreDiff : a.name.localeCompare(b.name);
    }).forEach(s => {
        const row = document.createElement('div');
        row.className = 'script-row';
        row.title = s.description || `File: ${s.filename}`;
        row.onclick = () => openEditor(s.filename, s.description, s.icon);

        const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
        let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : '');
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
                <button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')" title="Start/Stop"><i class="mdi ${toggleIcon}"></i></button>
                <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="Restart" ${!s.running?'disabled':''}><i class="mdi mdi-restart"></i></button>
                <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="Delete"><i class="mdi mdi-delete-outline"></i></button>
            </div>`;
        list.appendChild(row);
    });
}

/**
 * EDITOR LOGIC
 */
async function openEditor(filename, description, icon) {
    if (!isMonacoReady) { setTimeout(() => openEditor(filename, description, icon), 500); return; }
    if (isDirty && currentEditingFilename !== filename) { if (!confirm("Discard unsaved changes?")) return; }

    currentEditingFilename = filename;
    setDirty(false);
    document.getElementById('editor-title').innerText = filename;
    updateToolbarIcon(icon);
    document.getElementById('editor-section').classList.remove('hidden');
    document.getElementById('editor-section').style.display = 'flex';

    const res = await apiFetch(`api/scripts/${filename}/content`);
    const data = await res.json();
    originalContent = data.content;

    if (!editor) {
        editor = monaco.editor.create(document.getElementById('monaco-container'), {
            value: data.content, language: 'javascript', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, suggest: { showWords: false }, quickSuggestions: { other: true, comments: false, strings: true }
        });
        editor.onDidChangeModelContent(() => {
            isDirty = editor.getValue() !== originalContent;
            setDirty(isDirty);
            const iconMatch = editor.getValue().match(/@icon\s+mdi:(.*)/);
            if (iconMatch) updateToolbarIcon('mdi:' + iconMatch[1].trim());
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, window.saveCurrentScript);
    } else {
        editor.setValue(data.content);
        setTimeout(() => editor.layout(), 10);
    }
}

/**
 * API ACTIONS
 */
async function loadScripts() {
    const res = await apiFetch('api/scripts');
    if (res.ok) renderScripts(await res.json());
}

window.saveCurrentScript = async () => {
    if (!editor || !isDirty) return;
    const content = editor.getValue();
    const res = await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content }) });
    if (res.ok) { originalContent = content; setDirty(false); loadScripts(); }
};

window.toggleScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); };
window.restartScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); };
window.deleteScript = async (f) => { if(confirm(`Delete ${f}?`)) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } };

window.filterScripts = () => {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderScripts(allScripts.filter(s => s.name.toLowerCase().includes(term) || s.filename.toLowerCase().includes(term)), false);
};

window.closeEditor = () => { if (isDirty && !confirm("Discard changes?")) return; setDirty(false); document.getElementById('editor-section').style.display = 'none'; };

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => {
        const out = document.getElementById('console-output');
        if (!out) return;
        const div = document.createElement('div');
        div.className = 'log-line';
        let color = '#888';
        if (d.level === 'error') color = 'var(--danger)';
        if (d.message.includes('[System]')) color = 'var(--accent)';
        div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span style="color:${color}">${d.message}</span>`;
        out.appendChild(div); out.scrollTop = out.scrollHeight;
    });
    socket.on('status_update', loadScripts);
    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => { configureMonaco(); loadScripts(); });
    }
    window.onbeforeunload = (e) => { if (isDirty) return "Ungespeichert!"; };
});

window.loadScripts = loadScripts;