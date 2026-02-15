const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, currentEditingFilename = '', socket = null, allScripts = [];

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

async function configureMonaco() {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, allowJs: true });
    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        if (data.content) {
            const entities = data.content.replace(/export /g, '').replace(/type EntityID =\s+\|/g, 'type EntityID = ');
            const lib = `${entities}\ninterface HA { log(m:any):void; error(m:any):void; callService(d:string,s:string,data?:any):void; onStateChange(id:EntityID,cb:any):void; updateState(id:string,s:any,a?:any):void; store: { val: any, set: (k:string,v:any)=>void, delete: (k:string)=>void }; }\ndeclare var ha: HA; declare var axios: any; declare function schedule(c:string,cb:()=>void):void; declare function sleep(ms:number):Promise<void>;`;
            monaco.languages.typescript.javascriptDefaults.addExtraLib(lib, 'file:///ha-api.d.ts');
        }
    } catch (e) {}
}

function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    // SORTIERUNG: 1. Fehler, 2. Laufend, 3. Alphabetisch
    scripts.sort((a, b) => {
        if (a.status === 'error' && b.status !== 'error') return -1;
        if (b.status === 'error' && a.status !== 'error') return 1;
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (b.status === 'running' && a.status !== 'running') return 1;
        return a.name.localeCompare(b.name);
    });

    scripts.forEach(s => {
        const row = document.createElement('div');
        row.className = 'script-row';
        row.title = s.description || `Datei: ${s.filename}`;
        row.onclick = () => openEditor(s.filename);

        // Status-Icon Farbe bestimmen
        let statusClass = 'status-stopped';
        if (s.status === 'running') statusClass = 'status-running';
        if (s.status === 'error') statusClass = 'status-error';

        const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
        const toggleIcon = (s.status === 'running') ? 'mdi-stop' : 'mdi-play';

        row.innerHTML = `
    <div class="script-meta">
        <div class="script-icon"><i class="mdi mdi-${icon} ${statusClass}"></i></div>
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
    await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: editor.getValue() }) });
}

function filterScripts() {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderScripts(allScripts.filter(s => s.name.toLowerCase().includes(term) || s.filename.toLowerCase().includes(term)), false);
}

function closeEditor() { document.getElementById('editor-section').classList.add('hidden'); }
// public/app.js

async function createNewScript() {
    console.log("🚩 1. Erster Schritt: Modal finden");
    const modal = document.getElementById('new-script-modal');
    
    if (!modal) {
        console.error("❌ Fehler: Modal 'new-script-modal' nicht im HTML gefunden!");
        return;
    }

    // --- SOFORT ANZEIGEN ---
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    console.log("🚩 2. Modal wird jetzt angezeigt (display: flex)");

    // Felder leeren
    document.getElementById('new-script-name').value = '';
    document.getElementById('new-script-desc').value = '';

    // --- JETZT ERST NETZWERK (Optional) ---
    console.log("🚩 3. Starte Hintergrund-Laden der HA-Daten...");
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            console.log("🚩 4. Daten erhalten:", areas.length, "Bereiche");
            
            const areaSelect = document.getElementById('new-script-area');
            const labelSelect = document.getElementById('new-script-label');
            
            if (areaSelect) {
                areaSelect.innerHTML = '<option value="">Kein Bereich</option>' + 
                    (areas || []).map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            }
            if (labelSelect) {
                labelSelect.innerHTML = '<option value="">Kein Label</option>' + 
                    (labels || []).map(l => `<option value="${l.name}">${l.name}</option>`).join('');
            }
        }
    } catch (e) {
        console.warn("🚩 Hintergrund-Laden fehlgeschlagen, aber das Modal ist ja schon offen.");
    }
}

// Hilfsfunktion zum Schließen
function closeModal() {
    const modal = document.getElementById('new-script-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
}

// Sendet die Daten
async function submitNewScript() {
    const name = document.getElementById('new-script-name').value;
    if (!name) return alert("Name erforderlich");

    const payload = {
        name: name,
        icon: document.getElementById('new-script-icon').value,
        description: document.getElementById('new-script-desc').value,
        area: document.getElementById('new-script-area').value,
        label: document.getElementById('new-script-label').value
    };

    console.log("Sende Payload:", payload);

    const res = await apiFetch('api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        const data = await res.json();
        console.log("Erfolgreich erstellt:", data.filename);
        closeModal();
        await loadScripts(); // Liste neu laden
        openEditor(data.filename); // Editor direkt öffnen
    } else {
        const err = await res.json();
        alert("Fehler: " + err.error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => {
        const out = document.getElementById('console-output');
        const div = document.createElement('div');
        div.className = 'log-line';
        const isError = d.type === 'error' || d.message.includes('❌');
        const color = isError ? 'var(--danger)' : (d.message.includes('[System]') ? 'var(--accent)' : 'inherit');
        div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span style="color:${color}">${d.message}</span>`;
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
async function deleteScript(f) { if(confirm(`Löschen?`)) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } }