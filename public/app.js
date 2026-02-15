/**
 * JS Automations - v2.9.0
 */

const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, currentEditingFilename = '', socket = null, allScripts = [];

// Helper for API
async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

// IntelliSense Config
async function configureMonaco() {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, allowJs: true });
    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        if (data.content) {
            const entities = data.content.replace(/export /g, '').replace(/type EntityID =\s+\|/g, 'type EntityID = ');
            const lib = `${entities}\ninterface HA { log(m:any):void; error(m:any):void; callService(d:string,s:string,data?:any):void; onStateChange(id:EntityID,cb:any):void; updateState(id:string,s:any,a?:any):void; store:any; }\ndeclare var ha: HA; declare var axios: any; declare function schedule(c:string,cb:()=>void):void; declare function sleep(ms:number):Promise<void>;`;
            monaco.languages.typescript.javascriptDefaults.addExtraLib(lib, 'file:///ha-api.d.ts');
        }
    } catch (e) {}
}

/**
 * LIST RENDERING WITH SORTING
 */
function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    // SORT: 1. Running first, 2. Alphabetical
    scripts.sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    scripts.forEach(s => {
        const row = document.createElement('div');
        row.className = 'script-row';
        row.title = s.description || `File: ${s.filename}`;
        row.onclick = () => openEditor(s.filename);
        const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
        
        row.innerHTML = `
            <div class="script-meta">
                <div class="script-icon"><i class="mdi mdi-${icon} ${s.running?'status-running':''}"></i></div>
                <div class="script-details">
                    <span class="script-name">${s.name}</span>
                    <span class="script-filename">${s.filename}</span>
                </div>
            </div>
            <div class="row-actions">
                <button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')"><i class="mdi ${s.running?'mdi-stop':'mdi-play'}"></i></button>
                <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" ${!s.running?'disabled':''}><i class="mdi mdi-restart"></i></button>
                <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')"><i class="mdi mdi-delete-outline"></i></button>
            </div>`;
        list.appendChild(row);
    });
}

/**
 * EDITOR LOGIC
 */
async function openEditor(filename) {
    currentEditingFilename = filename;
    document.getElementById('editor-title').innerText = filename;
    document.getElementById('editor-section').classList.remove('hidden');
    const res = await apiFetch(`api/scripts/${filename}/content`);
    const data = await res.json();
    if (!editor) {
        editor = monaco.editor.create(document.getElementById('monaco-container'), { 
            value: data.content, language: 'javascript', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, suggest: { showWords: false }, quickSuggestions: { other: true, comments: false, strings: true }
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentScript);
    } else editor.setValue(data.content);
}

async function saveCurrentScript() {
    if (!editor) return;
    const content = editor.getValue();
    await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content }) });
}

function filterScripts() {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderScripts(allScripts.filter(s => s.name.toLowerCase().includes(term) || s.filename.toLowerCase().includes(term)), false);
}

function closeEditor() { document.getElementById('editor-section').classList.add('hidden'); }
function closeModal() { document.getElementById('new-script-modal').style.display = 'none'; }

async function createNewScript() {
    const modal = document.getElementById('new-script-modal');
    modal.style.display = 'flex';
    // Load metadata
    try {
        const res = await apiFetch('api/ha/metadata');
        const { areas, labels } = await res.json();
        document.getElementById('new-script-area').innerHTML = '<option value="">Kein Bereich</option>' + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
        document.getElementById('new-script-label').innerHTML = '<option value="">Kein Label</option>' + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
    } catch (e) {}
}

async function submitNewScript() {
    const payload = {
        name: document.getElementById('new-script-name').value,
        icon: document.getElementById('new-script-icon').value,
        description: document.getElementById('new-script-desc').value,
        area: document.getElementById('new-script-area').value,
        label: document.getElementById('new-script-label').value
    };
    if (!payload.name) return;
    await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    closeModal(); loadScripts();
}

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => {
        const out = document.getElementById('console-output');
        const div = document.createElement('div');
        div.className = 'log-line';
        div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> ${d.message}`;
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
    });
    socket.on('status_update', loadScripts);
    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => { configureMonaco(); loadScripts(); });
    }
});

async function loadScripts() { const res = await apiFetch('api/scripts'); if (res.ok) renderScripts(await res.json()); }
async function toggleScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); setTimeout(loadScripts, 100); }
async function restartScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); setTimeout(loadScripts, 1000); }
async function deleteScript(f) { if(confirm(`Skript ${f} löschen?`)) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } }