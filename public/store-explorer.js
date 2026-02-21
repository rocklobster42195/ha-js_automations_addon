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
        const meta = (item && typeof item === 'object' && 'owner' in item) ? item : { owner: 'System', updated: null };
        
        const valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);

        // Filterung
        if (filter && !key.toLowerCase().includes(filter) && !valStr.toLowerCase().includes(filter)) {
            return;
        }
        count++;

        const row = document.createElement('tr');
        
        // Value-Darstellung: Wenn Objekt, dann als Code-Block, sonst Text
        let valueHtml = `<div class="store-value">${escapeHtml(valStr)}</div>`;
        if (typeof val === 'object') {
            valueHtml = `<pre class="store-json">${escapeHtml(valStr)}</pre>`;
        }

        row.innerHTML = `
            <td class="store-key">${escapeHtml(key)}</td>
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
    // Aktuellen Wert holen (wir "schummeln" und holen ihn aus dem DOM oder laden neu, 
    // aber sauberer ist ein API Call oder wir speichern die Daten global in store-explorer.js)
    // Für V1: Wir nehmen an, der User weiß, was er tut oder wir laden kurz neu.
    
    // Besser: Wir fragen den User nach dem NEUEN Wert.
    // Um den alten Wert anzuzeigen, müssten wir `data` global vorhalten.
    // Workaround: Leerer Prompt oder wir laden den Wert einzeln (nicht implementiert).
    // Wir machen es einfach:
    
    const input = prompt(`New value for "${key}" (JSON allowed):`);
    if (input === null) return; // Abbrechen

    let value = input;
    try {
        value = JSON.parse(input);
    } catch (e) {
        // Wenn kein gültiges JSON, bleibt es ein String
    }

    try {
        await apiFetch('api/store', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key, value })
        });
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