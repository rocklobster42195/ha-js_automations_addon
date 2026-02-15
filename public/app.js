const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, currentEditingFilename = '', socket = null, isMonacoReady = false, allScripts = [];

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

// IntelliSense
async function configureMonaco() {
    if (isMonacoReady) return;

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        checkJs: true,
        allowJs: true,
        lib: ['esnext']
    });

    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        
        if (data.content) {
            // Bereinigen der Entitäten-Liste
            const entities = data.content
                .replace(/export /g, '')
                .replace(/type EntityID =\s+\|/g, 'type EntityID = ');

            // --- DEFINITION DER NEUEN SCHNITTSTELLEN ---
            const haLib = `
                ${entities}

                /** Standard-Attribute, die fast jede Entität hat */
                interface HAAttributes {
                    friendly_name?: string;
                    unit_of_measurement?: string;
                    icon?: string;
                    entity_picture?: string;
                    supported_features?: number;
                    hidden?: boolean;
                    assumed_state?: boolean;
                    device_class?: string;
                    state_class?: string;
                    brightness?: number;
                    current_temperature?: number;
                    [key: string]: any; // Erlaubt beliebige weitere Attribute
                }

                /** Das Event-Objekt, das an den Callback übergeben wird */
                interface HAEvent {
                    /** Die ID der Entität (mit Autocomplete!) */
                    entity_id: EntityID;
                    /** Der neue Zustand */
                    state: string;
                    /** Der vorherige Zustand */
                    old_state: string;
                    /** Attribute der Entität */
                    attributes: HAAttributes;
                }

                /** Das State-Objekt im Cache (ha.states) */
                interface HAState {
                    entity_id: EntityID;
                    state: string;
                    attributes: HAAttributes;
                    last_changed: string;
                    last_updated: string;
                }

                /** Die globale API */
                interface JSAutomationAPI {
                    log(msg: any): void;
                    warn(msg: any): void;
                    error(msg: any): void;
                    debug(msg: any): void;
                    
                    callService(domain: string, service: string, data?: object): void;
                    updateState(entityId: string, state: any, attributes?: object): void;
                    
                    /** 
                     * Abonniere Zustandsänderungen.
                     * @param pattern EntityID, Array, Wildcard (*) oder Regex
                     */
                    on(pattern: EntityID | string | string[] | RegExp, callback: (event: HAEvent) => void): void;
                    
                    /** Synchroner Zugriff auf alle Zustände */
                    states: Record<EntityID, HAState>;
                    
                    store: {
                        val: Record<string, any>;
                        set(key: string, value: any): void;
                        get(key: string): Promise<any>; // Legacy
                        delete(key: string): void;
                    };
                }

                declare var ha: JSAutomationAPI;
                declare var axios: any;
                declare function schedule(cron: string, cb: () => void): void;
                declare function sleep(ms: number): Promise<void>;
            `;

            monaco.languages.typescript.javascriptDefaults.addExtraLib(haLib, 'file:///ha-api.d.ts');
            console.log("✅ IntelliSense Enhanced Mode Loaded.");
        }
    } catch (e) { console.error(e); }
    isMonacoReady = true;
}

function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    // SORTIERUNG: 1. Fehler, 2. Laufend, 3. Alphabetisch
    scripts.sort((a, b) => {
        const getScore = (s) => (s.status === 'error' ? 2 : (s.running ? 1 : 0));
        const scoreDiff = getScore(b) - getScore(a);
        return scoreDiff !== 0 ? scoreDiff : a.name.localeCompare(b.name);
    });

    scripts.forEach(s => {
        const row = document.createElement('div');
        row.className = 'script-row';
        row.title = s.description || `File: ${s.filename}`;
        row.onclick = () => openEditor(s.filename, s.icon);

        const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
        let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : '');

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

/**
 * EDITOR & ACTIONS
 */
async function openEditor(filename, icon) {
    if (!isMonacoReady) return;
    currentEditingFilename = filename;
    document.getElementById('editor-title').innerText = filename;
    document.getElementById('editor-section').classList.remove('hidden');
    document.getElementById('editor-section').style.display = 'flex';
    const res = await apiFetch(`api/scripts/${filename}/content`);
    const data = await res.json();
    if (!editor) {
        editor = monaco.editor.create(document.getElementById('monaco-container'), { value: data.content, language: 'javascript', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, suggest: { showWords: false }, quickSuggestions: { other: true, comments: false, strings: true }});
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentScript);
        editor.onDidChangeModelContent(() => {
            const match = editor.getValue().match(/@icon\s+mdi:(.*)/);
            if (match) { const el = document.getElementById('editor-icon'); if(el) el.className = `mdi mdi-${match[1].trim()}`; }
        });
    } else editor.setValue(data.content);
}

async function saveCurrentScript() {
    if (!editor) return;
    await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: editor.getValue() }) });
}

window.filterScripts = () => {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderScripts(allScripts.filter(s => s.name.toLowerCase().includes(term) || s.filename.toLowerCase().includes(term)), false);
};

// Modals
window.closeModal = () => { 
    const modal = document.getElementById('new-script-modal');
    if (modal) {
        modal.style.display = 'none'; // Direkt ausblenden
    }
};

window.createNewScript = async () => {
    const modal = document.getElementById('new-script-modal');
    document.getElementById('new-script-loglevel').value = 'info'; 
    
    if (!modal) {
        console.error("CRITICAL: Modal-Element nicht gefunden!");
        return;
    }

    // 1. Klasse entfernen (für Sauberkeit)
    modal.classList.remove('hidden');
    
    // 2. Style DIREKT setzen (Das überschreibt alles)
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '999999'; // Ganz nach vorne!


    // Metadaten laden
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            const areaSelect = document.getElementById('new-script-area');
            const labelSelect = document.getElementById('new-script-label');
            
            if (areaSelect) {
                areaSelect.innerHTML = '<option value="">Kein Bereich</option>' + 
                    (areas||[]).map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            }
            if (labelSelect) {
                labelSelect.innerHTML = '<option value="">Kein Label</option>' + 
                    (labels||[]).map(l => `<option value="${l.name}">${l.name}</option>`).join('');
            }
        }
    } catch (e) {
        console.warn("Metadaten konnten nicht geladen werden.");
    }
};

window.submitNewScript = async () => {
    const name = document.getElementById('new-script-name').value.trim();
    if (!name) return alert("Bitte Name eingeben");

    const payload = {
        name: name,
        icon: document.getElementById('new-script-icon').value,
        description: document.getElementById('new-script-desc').value,
        area: document.getElementById('new-script-area').value,
        label: document.getElementById('new-script-label').value,
        loglevel: document.getElementById('new-script-loglevel').value 
    };

    const res = await apiFetch('api/scripts', { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify(payload) 
    });

    if (res.ok) {
        const data = await res.json();
        closeModal();
        await loadScripts();
        setTimeout(() => openEditor(data.filename, payload.icon), 300);
    } else {
        const err = await res.json();
        alert("Fehler: " + err.error);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => {
        const out = document.getElementById('console-output');
        if (out) {
            const div = document.createElement('div');
            div.className = 'log-line';
            let color = '#888';
            if (d.level === 'error' || d.message.includes('❌')) color = 'var(--danger)';
            else if (d.level === 'warn') color = '#ffeb3b';
            else if (d.message.includes('[System]')) color = 'var(--accent)';
            div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span style="color:${color}">${d.message}</span>`;
            out.appendChild(div); out.scrollTop = out.scrollHeight;
        }
    });
    socket.on('status_update', loadScripts);
    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => { configureMonaco(); loadScripts(); });
    }
});

// Live-Vorschau im Modal
window.updateModalIconPreview = () => {
    const input = document.getElementById('new-script-icon');
    const preview = document.getElementById('modal-icon-preview');
    const val = input.value;
    
    // Extrahiere den reinen Namen (ohne mdi:)
    const iconName = val.includes(':') ? val.split(':')[1] : val;
    
    // Setze Klasse
    preview.className = `mdi mdi-${iconName}`;
    
    // Visuelles Feedback bei leerer Eingabe
    if (!val) preview.className = 'mdi mdi-help-box';
};

window.closeEditor = () => { document.getElementById('editor-section').style.display = 'none'; };
async function loadScripts() { const res = await apiFetch('api/scripts'); if (res.ok) renderScripts(await res.json()); }
window.toggleScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); };
window.restartScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); };
window.deleteScript = async (f) => { if(confirm(`Delete ${f}?`)) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } };