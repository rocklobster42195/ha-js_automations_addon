/**
 * Settings Logic (Schema-Driven UI)
 */

let settingsSchema = null;
window.currentSettings = null; // Make global
const SETTINGS_TAB_ID = 'System: Settings';
let activeCategory = null;
let settingsEntityTarget = null;
window.cachedEntities = window.cachedEntities || [];

/**
 * Öffnet den Settings-Tab und lädt die Daten.
 */
async function openSettingsTab() {
    console.log("Opening Settings Tab...");
    
    // Haupt-Container sichtbar machen (falls noch keine Tabs offen waren)
    const section = document.getElementById('editor-section');
    if (section) section.classList.remove('hidden');

    // Prüfen, ob Tab schon existiert
    const existing = openTabs.find(t => t.filename === SETTINGS_TAB_ID);
    if (!existing) {
        openTabs.push({
            filename: SETTINGS_TAB_ID,
            icon: 'mdi:cog',
            isDirty: false,
            type: 'settings',
            model: null
        });
    }
    
    if (window.renderTabs) window.renderTabs();
    if (window.switchToTab) window.switchToTab(SETTINGS_TAB_ID);
}

/**
 * Lädt Schema und Werte von der API.
 */
async function loadSettingsData() {
    try {
        const [schemaRes, settingsRes] = await Promise.all([
            apiFetch('api/settings/schema'),
            apiFetch('api/settings')
        ]);

        if (!schemaRes.ok || !settingsRes.ok) {
            console.error("Settings API Error:", schemaRes.status, settingsRes.status);
            throw new Error(`Failed to load settings (API ${settingsRes.status})`);
        }

        settingsSchema = await schemaRes.json();
        window.currentSettings = await settingsRes.json();
        window.dispatchEvent(new CustomEvent('settings-changed', { detail: window.currentSettings }));
        
        renderSettingsCategories();
    
        // Erste Kategorie standardmäßig öffnen, falls noch keine aktiv
        if (!activeCategory && settingsSchema && settingsSchema.length > 0) {
            switchSettingsCategory(settingsSchema[0].id);
        }
    } catch (error) {
        console.error("Failed to load settings:", error);
        // Fallback / Error UI anzeigen
    }
}

/**
 * Rendert die linke Seitenleiste (Kategorien).
 */
function renderSettingsCategories() {
    const container = document.getElementById('settings-categories');
    container.innerHTML = '';

    settingsSchema.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = `settings-category-item ${activeCategory === cat.id ? 'active' : ''}`;
        btn.style.padding = '10px 20px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '10px';
        btn.style.color = activeCategory === cat.id ? '#fff' : '#aaa';
        btn.style.backgroundColor = activeCategory === cat.id ? '#333' : 'transparent';
        btn.style.fontSize = '0.9rem';

        // Notification Dot Logic
        if (cat.id === 'system' && window.currentIntegrationStatus) {
            const s = window.currentIntegrationStatus;
            if (!s.installed || s.needs_update) {
                btn.classList.add('has-notification');
            }
        }

        // Icon
        const icon = document.createElement('i');
        icon.className = `mdi ${cat.icon.replace('mdi:', 'mdi-')}`;
        
        // Label (i18n)
        const label = document.createElement('span');
        label.innerText = i18next.t(cat.label, { defaultValue: cat.label });

        btn.appendChild(icon);
        btn.appendChild(label);

        btn.onclick = () => switchSettingsCategory(cat.id);
        container.appendChild(btn);
    });
}

/**
 * Wechselt die aktive Kategorie und rendert das Formular rechts.
 */
function switchSettingsCategory(catId) {
    activeCategory = catId;
    renderSettingsCategories(); // Update Active State Styles
    renderSettingsForm(catId);
}

/**
 * Rendert das Formular für eine Kategorie basierend auf dem Schema.
 */
function renderSettingsForm(catId) {
    const container = document.getElementById('settings-content');
    container.innerHTML = '';

    const category = settingsSchema.find(c => c.id === catId);
    if (!category) return;

    // Fügt die Klasse 'settings-category-danger' hinzu, wenn es die Danger Zone ist, entfernt sie sonst.
    container.classList.toggle('settings-category-danger', catId === 'danger');

    // Titel der Kategorie
    const title = document.createElement('h3');
    title.innerText = i18next.t(category.label);
    title.style.marginTop = '0';
    title.style.borderBottom = '1px solid #444';
    title.style.paddingBottom = '10px';
    container.appendChild(title);

    // Shared Datalist für Autocomplete einfügen (falls noch nicht existent)
    if (!document.getElementById('settings-entities-datalist')) {
        const dl = document.createElement('datalist');
        dl.id = 'settings-entities-datalist';
        container.appendChild(dl);
    }

    // Items iterieren
    category.items.forEach(item => {
        // Wenn das Item als versteckt markiert ist, nicht rendern
        if (item.hidden) return;
        // Condition Check (Soll das Feld angezeigt werden?)
        if (item.condition) {
            // Safety Check: Falls Kategorie noch nicht in Settings existiert
            if (!window.currentSettings[catId]) window.currentSettings[catId] = {};
            
            const dependentVal = window.currentSettings[catId][item.condition.key];
            if (dependentVal !== item.condition.value) return;
        }

        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '20px';
        // Einrückung für abhängige Felder (Custom Entity, Sparkline)
        if (item.indent || (item.condition && (item.condition.key === 'slot1' || item.condition.key === 'slot2'))) {
            wrapper.style.marginLeft = '20px';
            wrapper.style.paddingLeft = '10px';
            wrapper.style.borderLeft = '1px solid #555';
        }

        // Label
        const label = document.createElement('label');
        label.innerText = i18next.t(item.label);
        label.style.display = 'block';
        label.style.marginBottom = '5px';
        label.style.fontWeight = '500';
        label.style.fontSize = '0.9rem';
        wrapper.appendChild(label);

        // Description (optional)
        if (item.description) {
            const desc = document.createElement('div');
            desc.innerText = i18next.t(item.description);
            desc.style.fontSize = '0.8rem';
            desc.style.color = '#888';
            desc.style.marginBottom = '8px';
            wrapper.appendChild(desc);
        }

        // Input Element generieren
        let input;
        
        // Safety Check für Value Access
        const catSettings = window.currentSettings[catId] || {};
        const value = catSettings[item.key] !== undefined ? catSettings[item.key] : item.default;

        if (item.type === 'boolean') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = value;
            input.onchange = (e) => saveSetting(catId, item.key, e.target.checked);
        } 
        else if (item.type === 'select') {
            input = document.createElement('select');
            input.style.padding = '5px';
            input.style.backgroundColor = '#333';
            input.style.color = '#fff';
            input.style.border = '1px solid #555';
            input.style.borderRadius = '4px';
            input.style.fontSize = '0.9rem';
            
            item.options.forEach(opt => {
                const option = document.createElement('option');
                // Support für einfache Strings oder Objekte {value, label}
                const optVal = typeof opt === 'object' ? opt.value : opt;
                const optLabel = typeof opt === 'object' ? opt.label : opt;
                
                option.value = optVal;
                option.innerText = optLabel;
                if (optVal === value) option.selected = true;
                input.appendChild(option);
            });
            input.onchange = (e) => saveSetting(catId, item.key, e.target.value);
        }
        else if (item.type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            if (item.min) input.min = item.min;
            if (item.max) input.max = item.max;
            input.style.padding = '5px';
            input.style.backgroundColor = '#333';
            input.style.color = '#fff';
            input.style.border = '1px solid #555';
            input.style.fontSize = '0.9rem';
            input.onchange = (e) => saveSetting(catId, item.key, parseFloat(e.target.value));
        }
        else if (item.type === 'entity-picker') {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = value;
            textInput.id = `input-${catId}-${item.key}`;
            
            // Kürzeres Eingabefeld & Autocomplete
            textInput.style.width = '200px';
            textInput.style.padding = '5px';
            textInput.style.backgroundColor = '#333';
            textInput.style.color = '#fff';
            textInput.style.border = '1px solid #555';
            textInput.style.borderRadius = '4px';
            textInput.style.fontSize = '0.9rem';
            textInput.setAttribute('list', 'settings-entities-datalist');
            
            textInput.onfocus = loadEntitiesForAutocomplete;
            textInput.onchange = (e) => saveSetting(catId, item.key, e.target.value);

            input = textInput;
        }
        else if (item.type === 'button') {
            input = document.createElement('button');
            input.innerText = item.buttonLabel ? i18next.t(item.buttonLabel) : i18next.t(item.label);
            input.className = 'btn-primary';
            input.style.width = 'fit-content';
            input.style.marginTop = '5px';
            input.style.fontSize = '0.9rem';
            input.onclick = () => {
                if (item.actionUrl) window.location.href = item.actionUrl;
                // Weitere Actions können hier implementiert werden
            };
        }
        else if (item.type === 'integration-manager') {
            input = document.createElement('div');
            input.id = 'integration-manager-wrapper';
            input.style.marginTop = '5px';
            checkIntegrationStatus(input);
        }
        else {
            // Fallback: Text / Entity-Picker
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.style.width = '100%';
            input.style.padding = '5px';
            input.style.backgroundColor = '#333';
            input.style.color = '#fff';
            input.style.border = '1px solid #555';
            input.style.fontSize = '0.9rem';
            input.onchange = (e) => saveSetting(catId, item.key, e.target.value);
        }

        wrapper.appendChild(input);
        container.appendChild(wrapper);

        // Wenn das Item als inaktiv markiert ist, das Input-Feld deaktivieren und visuell anpassen
        if (item.active === false) {
            input.disabled = true;
            wrapper.style.opacity = '0.6';
            wrapper.style.pointerEvents = 'none'; // Verhindert Interaktion mit Label/Beschreibung
        }
    });
}

/**
 * Speichert eine einzelne Einstellung und aktualisiert den State.
 */
async function saveSetting(catId, key, value) {
    // Optimistic UI Update
    if (!window.currentSettings[catId]) window.currentSettings[catId] = {};
    window.currentSettings[catId][key] = value;
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: window.currentSettings }));

    // Wenn sich ein Feld ändert, das andere beeinflusst (Condition), neu rendern
    renderSettingsForm(catId);

    // API Call
    const payload = { [catId]: { [key]: value } };
    
    try {
        await apiFetch('api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        // Optional: Toast Notification "Gespeichert"

        // Reload bei Sprachänderung erzwingen
        if (catId === 'general' && key === 'ui_language') {
            window.location.reload();
        }
    } catch (e) {
        console.error("Save failed", e);
        alert("Fehler beim Speichern der Einstellung.");
    }
}

/**
 * Lädt Entitäten für die Autocomplete-Liste (Lazy Load).
 */
async function loadEntitiesForAutocomplete() {
    const dl = document.getElementById('settings-entities-datalist');
    if (!dl) return;

    // Wenn Datalist schon befüllt ist, abbrechen
    if (dl.options.length > 0) return;

    // 1. Versuch: Globale IntelliSense-Daten nutzen (schnell & verfügbar)
    if (typeof allEntities !== 'undefined' && Array.isArray(allEntities) && allEntities.length > 0) {
        dl.innerHTML = '';
        allEntities.forEach(entityId => {
            const opt = document.createElement('option');
            opt.value = entityId;
            dl.appendChild(opt);
        });
        return;
    }

    // 2. Versuch: Socket laden (Fallback)
    if (window.cachedEntities.length === 0) {
        try {
            if (typeof window.getHAStates === 'function') {
                window.cachedEntities = await window.getHAStates();
            }
        } catch (e) {
            console.warn("Failed to load entities via Socket", e);
        }
    }

    // Datalist befüllen
    dl.innerHTML = '';
    window.cachedEntities.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.entity_id;
        if (e.attributes.friendly_name) opt.label = e.attributes.friendly_name;
        dl.appendChild(opt);
    });
}

/**
 * Prüft den Status der HA Integration und rendert die UI.
 */
async function checkIntegrationStatus(container, showRestartHint = false) {
    container.innerHTML = `<div style="width:fit-content; padding:10px; font-size:0.9rem; background:#252526; border-radius:6px; border:1px solid #383838; color:#aaa;"><i class="mdi mdi-loading mdi-spin"></i> ${i18next.t('settings.system.integration_checking')}</div>`;
    try {
        const res = await apiFetch('api/system/integration');
        if (res.ok) {
            const status = await res.json();
            
            // Update Global State & UI Dots
            window.currentIntegrationStatus = status;
            if (window.updateSystemNotifications) window.updateSystemNotifications();

            renderIntegrationUI(container, status, showRestartHint);
        } else {
            container.innerHTML = `<div style="width:fit-content; padding:10px; font-size:0.9rem; background:#252526; border-radius:6px; border:1px solid #383838; color:#f44336;">${i18next.t('settings.system.integration_check_failed')}</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div style="width:fit-content; padding:10px; font-size:0.9rem; background:#252526; border-radius:6px; border:1px solid #383838; color:#f44336;">${i18next.t('settings.system.integration_error', { error: e.message })}</div>`;
    }
}

function renderIntegrationUI(container, status, showRestartHint = false) {
    let icon = 'mdi-check-circle';
    let color = 'var(--success)';
    let title = i18next.t('settings.system.integration_active');
    let desc = i18next.t('settings.system.integration_installed_version', { version: status.version_installed });
    if (showRestartHint) {
        desc += ` <span style="color:var(--warn);">${i18next.t('settings.system.restart_required_hint')}</span>`;
    }
    let btnHtml = '';

    if (!status.installed) {
        icon = 'mdi-alert-circle';
        color = 'var(--warn)';
        title = i18next.t('settings.system.integration_missing');
        desc = i18next.t('settings.system.integration_missing_desc');
        btnHtml = `<button class="btn-primary" onclick="installIntegration(this)" style="background:var(--warn) !important; color:#000 !important;">${i18next.t('settings.system.integration_install_btn')}</button>`;
    } else if (status.needs_update) {
        icon = 'mdi-information';
        color = 'var(--accent)';
        title = i18next.t('settings.system.integration_update_available');
        desc = i18next.t('settings.system.integration_update_desc', { installed: status.version_installed, available: status.version_available });
        btnHtml = `<button class="btn-primary" onclick="installIntegration(this)">${i18next.t('settings.system.integration_update_btn', { version: status.version_available })}</button>`;
    }

    container.innerHTML = `
        <div style="width:fit-content; background:#1e1e1e; border:1px solid #383838; border-radius:6px; padding:10px; display:flex; align-items:center; gap:15px;">
            <i class="mdi ${icon}" style="font-size:1.5rem; color:${color};"></i>
            <div style="flex:1;">
                <div style="font-weight:bold; font-size:0.95rem; margin-bottom:2px; color:#fff;">${title}</div>
                <div style="color:#aaa; font-size:0.85rem;">${desc}</div>
            </div>
            <div>${btnHtml}</div>
        </div>
    `;
}

async function installIntegration(btn) {
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = `<i class="mdi mdi-loading mdi-spin"></i> ${i18next.t('settings.system.integration_installing')}`;
    
    try {
        const res = await apiFetch('api/system/integration/install', { method: 'POST' });
        if (res.ok) {
            const wrapper = document.getElementById('integration-manager-wrapper');
            if (wrapper) checkIntegrationStatus(wrapper, true);
        } else {
            const err = await res.json();
            alert(i18next.t('settings.system.integration_error_alert', { error: (err.error || "Unknown error") }));
            btn.disabled = false;
            btn.innerText = originalText;
        }
    } catch (e) {
        alert(i18next.t('settings.system.integration_error_alert', { error: e.message }));
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// Auto-load settings on startup
window.openSettingsTab = openSettingsTab;
window.loadSettingsData = loadSettingsData;
window.installIntegration = installIntegration;
window.renderSettingsCategories = renderSettingsCategories;