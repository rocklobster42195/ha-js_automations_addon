/**
 * JS-AUTOMATION - Dashboard Logic (v1.5.0)
 * THE COLOR ENFORCER & INTELLISENSE FIX
 */

const BASE_PATH = window.location.pathname.endsWith('/') 
    ? window.location.pathname 
    : window.location.pathname + '/';

let editor = null;
let currentEditingFilename = '';
let socket = null;
let isMonacoReady = false;

// --- CSS INJEKTOR (ULTRA AGGRESSIVE) ---
function injectStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Zwingt die gesamte Monaco-Vorschlagsbox zur Sichtbarkeit */
        .suggest-widget, 
        .monaco-editor .suggest-widget {
            background-color: #252525 !important;
            border: 2px solid #03a9f4 !important;
            color: #ffffff !important;
            visibility: visible !important;
            display: block !important;
        }

        /* Die einzelnen Zeilen */
        .monaco-editor .suggest-widget .monaco-list-row,
        .monaco-editor .suggest-widget .monaco-list-row .contents,
        .monaco-editor .suggest-widget .monaco-list-row .main,
        .monaco-editor .suggest-widget .monaco-list-row .label-name {
            color: #ffffff !important;
            background-color: transparent !important;
            opacity: 1 !important;
            display: flex !important;
        }

        /* Die hervorgehobene Zeile */
        .monaco-editor .suggest-widget .monaco-list-row.focused {
            background-color: #03a9f4 !important;
        }
        .monaco-editor .suggest-widget .monaco-list-row.focused .label-name {
            color: #000000 !important;
        }

        /* Icons in der Liste */
        .monaco-editor .suggest-widget .monaco-list-row .icon {
            filter: invert(1) brightness(2) !important;
        }
        .monaco-editor .suggest-widget .monaco-highlighted-label span {
    color: #ffffff !important;
}
.monaco-editor .suggest-widget .monaco-highlighted-label .highlight {
    color: #4fc3f7 !important;
}
    `;
    document.head.appendChild(style);
    console.log("💉 Aggressive CSS Injected.");
}

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

/**
 * INTELLISENSE KONFIGURATION
 */
async function configureMonaco() {
    if (isMonacoReady) return;

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        checkJs: true,
        allowJs: true
    });

    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        
        if (data.content) {
            // Bereinige die Typen radikal für Monaco
            const entitiesClean = data.content
                .replace(/export /g, '')
                .replace(/\|/g, '') // Entfernt alle Pipes
                .replace(/type EntityID =\s+/g, 'type EntityID = ');

            const combinedLib = `
                ${entitiesClean}
                
                declare interface HAState { 
                    entity_id: EntityID; 
                    state: string; 
                    attributes: any; 
                }

                declare var ha: {
                    log: (msg: any) => void;
                    error: (msg: any) => void;
                    callService: (domain: string, service: string, data?: object) => void;
                    updateState: (entityId: string, state: any, attributes?: object) => void;
                    onStateChange: (entityId: EntityID, callback: (newState: HAState) => void) => void;
                };
            `;

            // Wir geben der Datei einen Namen, der auf .d.ts endet
            monaco.languages.typescript.javascriptDefaults.addExtraLib(combinedLib, 'file:///ha-master-lib.d.ts');
            console.log("✅ IntelliSense: Master Library Injected.");
        }
    } catch (e) {
        console.error("❌ IntelliSense Error:", e);
    }
    isMonacoReady = true;
}

/**
 * INITIALISIERUNG
 */
document.addEventListener('DOMContentLoaded', () => {
    injectStyles();

    if (typeof io !== 'undefined') {
        socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
        socket.on('connect', () => { console.log("✅ Socket Connected"); loadScripts(); });
        socket.on('log', handleIncomingLog);
        socket.on('status_update', loadScripts);
    }

    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            configureMonaco();
        });
    }
    loadScripts();
});

async function openEditor(filename) {
    currentEditingFilename = filename;
    document.getElementById('editor-title').innerText = filename;
    document.getElementById('editor-overlay').style.display = 'flex';

    const res = await apiFetch(`api/scripts/${filename}/content`);
    const data = await res.json();

    if (!editor) {
        editor = monaco.editor.create(document.getElementById('monaco-container'), {
            value: data.content,
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            minimap: { enabled: false },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: true },
            fixedOverflowWidgets: true // Zwingt Menüs aus dem Iframe-Container
        });
    } else {
        editor.setValue(data.content);
    }
}

// --- LOGGING ---
function handleIncomingLog(data) {
    const out = document.getElementById('console-output');
    if(!out) return;
    const div = document.createElement('div');
    div.className = 'log-entry';
    const isError = data.message.includes('Error') || data.message.includes('❌');
    div.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> <span style="color:${isError?'#ff5252':'inherit'}">${data.message}</span>`;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
}

// --- API ACTIONS (Unverändert) ---
async function loadScripts() {
    const res = await apiFetch('api/scripts');
    if (res.ok) renderScripts(await res.json());
}

function renderScripts(scripts) {
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = scripts.length === 0 ? '<div style="text-align:center; padding:20px; color:#666">No scripts found.</div>' : '';
    scripts.forEach(script => {
        const div = document.createElement('div');
        div.className = 'script-card';
        const icon = script.icon ? script.icon.split(':').pop() : 'script-text-outline';
        div.innerHTML = `
            <div class="card-header">
                <div class="script-icon-wrapper"><i class="mdi mdi-${icon} script-icon"></i></div>
                <div class="script-meta">
                    <div class="script-title">${script.name}</div>
                    <div class="script-filename">${script.filename}</div>
                </div>
            </div>
            <div class="card-actions">
                <div class="status-badge"><div class="status-dot ${script.running ? 'running' : ''}"></div><span>${script.running ? 'Running' : 'Stopped'}</span></div>
                <div class="btn-group">
                    <button onclick="toggleScript('${script.filename}')" class="${script.running ? 'btn-stop' : 'btn-play'}"><i class="mdi ${script.running ? 'mdi-stop' : 'mdi-play'}"></i></button>
                    <button onclick="openEditor('${script.filename}')"><i class="mdi mdi-code-braces"></i></button>
                    <button onclick="restartScript('${script.filename}')" ${!script.running ? 'disabled style="opacity:0.3"' : ''}><i class="mdi mdi-restart"></i></button>
                    <button onclick="deleteScript('${script.filename}')" class="btn-delete"><i class="mdi mdi-trash-can-outline"></i></button>
                </div>
            </div>`;
        list.appendChild(div);
    });
}

async function createNewScript() {
    const name = prompt("Automation Name:"); if (!name) return;
    await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name }) });
    loadScripts();
}
async function toggleScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); }
async function restartScript(f) { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); }
async function deleteScript(f) { if(!confirm("Delete?")) return; await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); }
async function saveCurrentScript() {
    const content = editor.getValue();
    await apiFetch(`api/scripts/${currentEditingFilename}/content`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content }) });
    document.getElementById('editor-overlay').style.display = 'none';
    loadScripts();
}
function closeEditor() { document.getElementById('editor-overlay').style.display = 'none'; }