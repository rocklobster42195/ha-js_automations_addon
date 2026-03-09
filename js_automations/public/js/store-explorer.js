/**
 * JS AUTOMATIONS - Store Explorer Logic
 * Handles the "System: Store" tab.
 */

const STORE_TAB_ID = 'System: Store';
let storeCache = {}; // Lokaler Cache für schnelles Filtern

// Öffnet den Store-Tab oder wechselt dorthin
function openStoreTab() {
    console.log("Opening Store Tab...");
    
    // FIX: Haupt-Container sichtbar machen (falls noch keine Tabs offen waren)
    const section = document.getElementById('editor-section');
    if (section) section.classList.remove('hidden');

    // Prüfen, ob Tab schon existiert
    const existing = openTabs.find(t => t.filename === STORE_TAB_ID);
    if (!existing) {
        openTabs.push({
            filename: STORE_TAB_ID,
            icon: 'mdi:database-search',
            isDirty: false,
            type: 'store', // Markierung für switchToTab
            model: null    // Kein Monaco Model
        });
    }
    
    injectStoreComponents(); // Sicherstellen, dass Modal und Button da sind
    if (window.renderTabs) window.renderTabs();
    if (window.switchToTab) window.switchToTab(STORE_TAB_ID);
}

// Lädt Daten und rendert die Tabelle
async function loadStoreData() {
    const container = document.getElementById('store-table-body');
    if (!container) return;

    container.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">Loading data...</td></tr>';

    try {
        // Wir nutzen die globale apiFetch aus app.js
        const res = await apiFetch('api/store'); 
        if (res.ok) {
            storeCache = await res.json();
            renderStoreTable();
        } else {
            container.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--danger);">Error loading data.</td></tr>';
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger);">${e.message}</td></tr>`;
    }
}

function renderStoreTable() {
    const data = storeCache;
    const container = document.getElementById('store-table-body');
    const filterInput = document.getElementById('store-search');
    const clearBtn = document.getElementById('store-search-clear');
    const filter = filterInput ? filterInput.value.toLowerCase() : '';
    
    if (clearBtn) clearBtn.classList.toggle('hidden', filter.length === 0);

    container.innerHTML = '';

    const keys = Object.keys(data).sort();

    if (keys.length === 0) {
        container.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">Store is empty.</td></tr>';
        return;
    }

    let count = 0;
    keys.forEach(key => {
        const item = data[key];
        // Fallback, falls Datenstruktur mal abweicht (z.B. Legacy)
        const val = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
        const meta = (item && typeof item === 'object' && 'owner' in item) ? item : { owner: 'System', updated: null, isSecret: false };
        
        const valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);

        // Filterung
        // Bei Secrets suchen wir NICHT im Value, um Sicherheit zu wahren (oder optional doch, aber hier strikt)
        const searchInVal = meta.isSecret ? '' : valStr.toLowerCase();
        if (filter && !key.toLowerCase().includes(filter) && !searchInVal.includes(filter)) {
            return;
        }
        count++;

        const row = document.createElement('tr');
        
        // Value-Darstellung
        let valueHtml = '';
        let iconHtml = '';

        if (meta.isSecret) {
            const safeKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            valueHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <span id="secret-val-${count}" class="store-value-masked">••••••••</span>
                    <button class="btn-row" onclick="toggleSecretDisplay('${safeKey}', 'secret-val-${count}', this)" title="Show/Hide">
                        <i class="mdi mdi-eye"></i>
                    </button>
                </div>`;
        } else if (typeof val === 'object') {
            valueHtml = `<pre class="store-json">${escapeHtml(valStr)}</pre>`;
        } else {
            valueHtml = `<div class="store-value">${escapeHtml(valStr)}</div>`;
        }

        row.innerHTML = `
            <td class="store-key">${iconHtml}${escapeHtml(key)}</td>
            <td class="store-val-cell">${valueHtml}</td>
            <td class="store-owner">${escapeHtml(meta.owner || 'System')}</td>
            <td class="store-updated">${meta.updated ? new Date(meta.updated).toLocaleString() : '-'}</td>
            <td class="store-accessed">${meta.accessed ? new Date(meta.accessed).toLocaleString() : '-'}</td>
            <td class="store-actions">
                <button onclick="editStoreItem('${key}')" title="Edit">
                    <i class="mdi mdi-pencil"></i>
                </button>
                <button onclick="deleteStoreItem('${key}')" title="Delete" class="btn-danger">
                    <i class="mdi mdi-delete-forever"></i>
                </button>
            </td>
        `;
        container.appendChild(row);
    });

    if (count === 0) {
        container.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">No results found.</td></tr>';
    }
}

async function editStoreItem(key) {
    const item = storeCache[key];
    if (!item) return;
    const val = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
    const isSecret = item.isSecret || false;
    
    // Value für Editor vorbereiten (JSON Stringify wenn Objekt)
    let valStr = val;
    if (typeof val === 'object') valStr = JSON.stringify(val, null, 2);

    openStoreModal(key, valStr, isSecret);
}

function openStoreModal(key = null, value = '', isSecret = false) {
    const modal = document.getElementById('store-modal');
    if (!modal) return;

    const titleEl = document.getElementById('store-modal-title');
    const keyInput = document.getElementById('store-key-input');
    const valInput = document.getElementById('store-value-input');
    const secretCheck = document.getElementById('store-secret-check');
    const toggleIcon = document.getElementById('store-value-toggle');

    // Reset UI
    modal.classList.remove('hidden');
    valInput.type = isSecret ? 'password' : 'text';
    toggleIcon.className = isSecret ? 'mdi mdi-eye' : 'mdi mdi-eye-off';
    
    if (key) {
        // Edit Mode
        titleEl.textContent = 'Edit Variable';
        keyInput.value = key;
        keyInput.disabled = true; // Key cannot be changed (it's the ID)
    } else {
        // Create Mode
        titleEl.textContent = 'New Variable';
        keyInput.value = '';
        keyInput.disabled = false;
    }

    valInput.value = value;
    secretCheck.checked = isSecret;
}

function closeStoreModal() {
    document.getElementById('store-modal').classList.add('hidden');
}

function toggleStoreValueVisibility() {
    const input = document.getElementById('store-value-input');
    const icon = document.getElementById('store-value-toggle');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'mdi mdi-eye-off';
    } else {
        input.type = 'password';
        icon.className = 'mdi mdi-eye';
    }
}

function toggleStoreSecretState() {
    const isSecret = document.getElementById('store-secret-check').checked;
    const input = document.getElementById('store-value-input');
    const icon = document.getElementById('store-value-toggle');
    
    // Wenn Secret aktiviert wird, Input auf Password setzen
    if (isSecret) {
        input.type = 'password';
        icon.className = 'mdi mdi-eye';
    } else {
        input.type = 'text';
        icon.className = 'mdi mdi-eye-off';
    }
}

async function saveStoreItemFromModal() {
    const key = document.getElementById('store-key-input').value.trim();
    let valStr = document.getElementById('store-value-input').value;
    const isSecret = document.getElementById('store-secret-check').checked;

    if (!key) {
        alert("Key is required");
        return;
    }

    // Versuchen, JSON zu parsen, wenn es kein Secret ist oder wenn es wie JSON aussieht
    // Bei Secrets speichern wir Strings oft als Strings, aber JSON ist auch erlaubt.
    let value = valStr;
    try {
        // Nur parsen wenn es wie JSON aussieht ({...} oder [...])
        if (valStr.trim().startsWith('{') || valStr.trim().startsWith('[')) {
            value = JSON.parse(valStr);
        }
    } catch (e) {
        // Ignore, keep as string
    }

    try {
        await apiFetch('api/store', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key, value, isSecret })
        });
        closeStoreModal();
        loadStoreData();
    } catch (e) { alert("Error saving: " + e.message); }
}

async function deleteStoreItem(key) {
    if (!confirm(`Do you really want to delete the key "${key}" from the store?`)) return;

    try {
        await apiFetch(`api/store/${key}`, { method: 'DELETE' });
        loadStoreData(); // Refresh
    } catch (e) {
        alert("Error deleting: " + e.message);
    }
}

async function clearStore() {
    if (!confirm("WARNING: Do you really want to clear the ENTIRE store? All saved variables from all scripts will be lost!")) return;
    
    try {
        await apiFetch('api/store', { method: 'DELETE' });
        loadStoreData();
    } catch (e) {
        alert("Error: " + e.message);
    }
}

function clearStoreSearch() {
    const input = document.getElementById('store-search');
    if (input) {
        input.value = '';
        renderStoreTable();
    }
}

function toggleSecretDisplay(key, spanId, btn) {
    const span = document.getElementById(spanId);
    const icon = btn.querySelector('i');
    const item = storeCache[key];
    
    if (!span || !item) return;
    
    const isHidden = icon.classList.contains('mdi-eye');
    
    if (isHidden) {
        const val = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
        let valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
        
        if (typeof val === 'object') {
            span.innerHTML = `<pre class="store-json" style="margin:0;">${escapeHtml(valStr)}</pre>`;
            span.className = ''; 
        } else {
            span.textContent = valStr;
            span.className = 'store-value';
        }
        icon.className = 'mdi mdi-eye-off';
    } else {
        span.textContent = '••••••••';
        span.className = 'store-value-masked';
        icon.className = 'mdi mdi-eye';
    }
}

// --- INJECTION HELPERS ---
function injectStoreComponents() {
    // 1. Inject Modal if missing
    if (!document.getElementById('store-modal')) {
        const modalHtml = `
        <div id="store-modal" class="modal-overlay hidden">
            <div class="modal">
                <h3 id="store-modal-title">Store Item</h3>
                <div class="form-group">
                    <label>Key (ID)</label>
                    <input type="text" id="store-key-input" placeholder="e.g. my_api_key">
                </div>
                <div class="form-group" style="margin-top:15px;">
                    <label>Value</label>
                    <div class="icon-input-container">
                        <input type="text" id="store-value-input" placeholder="Value">
                        <i id="store-value-toggle" class="mdi mdi-eye-off" style="cursor:pointer; opacity:0.7;" onclick="toggleStoreValueVisibility()"></i>
                    </div>
                </div>
                <div class="form-group" style="margin-top:15px; flex-direction:row; align-items:center; gap:10px;">
                    <input type="checkbox" id="store-secret-check" style="width:auto !important;" onchange="toggleStoreSecretState()">
                    <label for="store-secret-check" style="margin:0; cursor:pointer; font-size:0.9rem; color:#ddd; text-transform:none;">Is Secret (Masked in UI)</label>
                </div>
                <div class="modal-btns">
                    <button class="btn-primary" onclick="saveStoreItemFromModal()">SAVE</button>
                    <button class="btn-text" onclick="closeStoreModal()">CANCEL</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 2. Inject Add Button to Toolbar if missing
    const toolbar = document.querySelector('.store-toolbar');
    if (toolbar && !document.getElementById('btn-store-add')) {
        // Button vor dem Suchfeld einfügen oder am Anfang der Actions
        const searchBox = toolbar.querySelector('.store-search-box');
        const btn = document.createElement('button');
        btn.id = 'btn-store-add';
        btn.title = 'Add Variable';
        btn.innerHTML = '<i class="mdi mdi-plus"></i>';
        btn.onclick = () => openStoreModal();
        
        if (searchBox) {
            toolbar.insertBefore(btn, searchBox);
        } else {
            toolbar.appendChild(btn);
        }
    }
}

// Hilfsfunktion für HTML Escaping
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Make globally available
window.openStoreTab = openStoreTab;
window.loadStoreData = loadStoreData;
window.deleteStoreItem = deleteStoreItem;
window.editStoreItem = editStoreItem;
window.clearStore = clearStore;
window.renderStoreTable = renderStoreTable;
window.clearStoreSearch = clearStoreSearch;
window.openStoreModal = openStoreModal;
window.closeStoreModal = closeStoreModal;
window.saveStoreItemFromModal = saveStoreItemFromModal;
window.toggleStoreValueVisibility = toggleStoreValueVisibility;
window.toggleStoreSecretState = toggleStoreSecretState;
window.toggleSecretDisplay = toggleSecretDisplay;