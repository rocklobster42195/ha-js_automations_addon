/**
 * Settings Logic (Schema-Driven UI)
 */

let settingsSchema = null;
window.currentSettings = null; // Make global
const SETTINGS_TAB_ID = 'System: Settings';
let activeCategory = null;
let settingsEntityTarget = null;
window.cachedEntities = window.cachedEntities || [];
let isProgrammaticScroll = false;
let pendingScrollTarget = null;

/**
 * Öffnet den Settings-Tab und lädt die Daten.
 */
async function openSettingsTab(targetId = null) {
    console.log("Opening Settings Tab...");
    pendingScrollTarget = targetId;
    
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

    // Falls bereits geladen, sofort scrollen
    if (settingsSchema && targetId) {
        setTimeout(() => scrollToSection(targetId), 100);
    }
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
        renderAllSettings();
        initScrollSpy();

        // Statische Elemente im Settings-Wrapper übersetzen (z.B. Header in der Sidebar)
        if (window.updateUIWithTranslations) {
            window.updateUIWithTranslations(document.getElementById('settings-wrapper'));
        }

        // Check for deep linking
        if (pendingScrollTarget) {
            const target = pendingScrollTarget;
            pendingScrollTarget = null;
            setTimeout(() => scrollToSection(target), 200);
        } else if (settingsSchema && settingsSchema.length > 0) {
            // Standardmäßig die erste Kategorie markieren
            setActiveCategoryUI(settingsSchema[0].id);
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
    if (!container || !settingsSchema) return;

    container.innerHTML = '';

    settingsSchema.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = `settings-category-item ${activeCategory === cat.id ? 'active' : ''}`;
        btn.dataset.id = cat.id;

        // Notification Dot Logic
        if (cat.id === 'system') {
            // Priority 1: Restart needed (purple dot)
            if (window.currentIntegrationStatus && window.currentIntegrationStatus.needs_restart && !window.currentIntegrationStatus.dev_mode) {
                btn.classList.add('badge-info'); // Lila
            }
            // Priority 2: Addon update available (orange dot) - same as header
            else if (window.newVersionInfo && window.newVersionInfo.update_available) {
                btn.classList.add('badge-warning'); // Orange
            }
        }

        // Icon
        const icon = document.createElement('i');
        icon.className = `mdi ${cat.icon.replace('mdi:', 'mdi-')}`;
        
        // Label (i18n)
        const label = document.createElement('span');
        label.setAttribute('data-i18n', cat.label);
        label.innerText = i18next.t(cat.label, { defaultValue: cat.label });

        btn.appendChild(icon);
        btn.appendChild(label);

        // Ensure no inline styles override our CSS classes
        btn.style.backgroundColor = '';
        btn.style.color = '';

        btn.onclick = () => {
            isProgrammaticScroll = true;
            scrollToSection(cat.id);
            setActiveCategoryUI(cat.id);
            
            // Hide integration banner & dot if "system" category is clicked
            if (cat.id === 'system') {
                if (typeof window.hideIntegrationBanner === 'function') {
                    window.hideIntegrationBanner();
                }
                // Remove the orange dot on click, mirroring header behavior
                btn.classList.remove('badge-warning');
            }

            // Re-enable ScrollSpy tracking after scroll animation
            setTimeout(() => { isProgrammaticScroll = false; }, 800);
        };
        container.appendChild(btn);
    });
}

function setActiveCategoryUI(catId) {
    activeCategory = catId;
    document.querySelectorAll('.settings-category-item').forEach(item => {
        const isActive = item.dataset.id === catId;
        item.classList.toggle('active', isActive);
    });
}

function scrollToSection(id) {
    let element = document.getElementById(`settings-section-${id}`);
    
    // Special handle for installer anchor
    if (id === 'integration' || id === 'installer') {
        element = document.getElementById('settings-installer-anchor') || document.getElementById('settings-section-system');
    }

    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Initialisiert ScrollSpy mit IntersectionObserver.
 */
function initScrollSpy() {
    const content = document.getElementById('settings-content');
    const sections = document.querySelectorAll('.settings-section');
    
    const options = {
        root: content,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
        if (isProgrammaticScroll) return;
        
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const catId = entry.target.id.replace('settings-section-', '');
                setActiveCategoryUI(catId);

                // Hide integration banner when reaching the system section (where the installer lives)
                if (catId === 'system' && typeof window.hideIntegrationBanner === 'function') {
                    window.hideIntegrationBanner();
                }
            }
        });
    }, options);

    sections.forEach(section => observer.observe(section));
}

/**
 * Rendert alle Kategorien untereinander.
 */
function renderAllSettings() {
    const container = document.getElementById('settings-content');
    container.innerHTML = '';

    // Shared Datalist für Autocomplete einfügen
    const dl = document.createElement('datalist');
    dl.id = 'settings-entities-datalist';
    container.appendChild(dl);

    settingsSchema.forEach(category => {
        const section = document.createElement('section');
        section.id = `settings-section-${category.id}`;
        section.className = 'settings-section';
        if (category.id === 'danger') section.classList.add('settings-category-danger');

        // Titel der Kategorie
        const title = document.createElement('h3');
        const icon = document.createElement('i');
        icon.className = `mdi ${category.icon.replace('mdi:', 'mdi-')}`;
        title.appendChild(icon);
        const titleText = document.createElement('span');
        titleText.setAttribute('data-i18n', category.label);
        titleText.innerText = i18next.t(category.label);
        title.appendChild(titleText);
        section.appendChild(title);

        renderSettingsItems(category, section);
        container.appendChild(section);
    });
}

/**
 * Rendert die Items einer Kategorie in ein Ziel-Element.
 */
function renderSettingsItems(category, section) {
    const catId = category.id;
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
        wrapper.className = 'settings-item-wrapper';
        // Einrückung für abhängige Felder (Custom Entity, Sparkline)
        if (item.indent || (item.condition && (item.condition.key === 'slot1' || item.condition.key === 'slot2'))) {
            wrapper.style.marginLeft = '20px';
            wrapper.style.paddingLeft = '10px';
            wrapper.style.borderLeft = '1px solid #555';
        }

        // Label
        const label = document.createElement('label');
        label.setAttribute('data-i18n', item.label);
        label.innerText = i18next.t(item.label);
        label.style.display = 'block';
        label.style.marginBottom = '5px';
        label.style.fontWeight = '500';
        label.style.fontSize = '0.9rem';
        wrapper.appendChild(label);

        // Description (optional)
        if (item.description) {
            const desc = document.createElement('div');
            desc.setAttribute('data-i18n', item.description);
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
                option.innerText = i18next.t(optLabel, { defaultValue: optLabel });
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
            input.id = 'settings-installer-anchor'; // Sprungpunkt für Installer
            const innerWrapper = document.createElement('div');
            innerWrapper.id = 'integration-manager-wrapper';
            input.appendChild(innerWrapper);
            input.style.marginTop = '5px';
            checkIntegrationStatus(innerWrapper);
        }
        else {
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
        section.appendChild(wrapper);

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

    // Wenn sich ein Feld ändert, das andere beeinflusst, das UI aktualisieren
    renderAllSettings();

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
            // Wir hängen einen Parameter an, damit wir nach dem Reload wissen, dass wir die Settings öffnen sollen
            const url = new URL(window.location.href);
            url.searchParams.set('open', 'settings');
            window.location.href = url.toString();
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
 * Triggert den HA Neustart.
 */
async function restartHA() {
    if (!confirm(i18next.t('settings.system.confirm_restart_ha'))) return;
    
    try {
        await apiFetch('api/system/restart-ha', { method: 'POST' });
        // UI Feedback: Connection loss overlay will handle the rest via socket events
    } catch (e) {
        alert(i18next.t('settings.system.integration_error_alert', { error: e.message }));
    }
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
    let icon, color, title, desc, btnHtml = '';

    if (status.dev_mode) {
        // Developer Mode: Manual management
        icon = status.active ? 'mdi-check-circle' : 'mdi-developer-board';
        color = status.active ? 'var(--success)' : 'var(--warn)';
        title = i18next.t('settings.system.integration_dev_mode');
        
        if (status.active) {
            desc = i18next.t('settings.system.integration_active') + ` (v${status.version_running})`;
        } else if (status.is_running) {
            desc = i18next.t('settings.system.integration_version_mismatch', { 
                running: status.version_running, 
                available: status.version_available,
                defaultValue: `Version Mismatch: HA is running v${status.version_running}, local source is v${status.version_available}.`
            });
        } else {
            desc = i18next.t('settings.system.integration_dev_mode_desc');
        }
        btnHtml = ''; 

    } else if (status.needs_restart) {
        // State 2: Files copied or mismatch -> Restart needed
        icon = 'mdi-restart-alert';
        color = '#b05dff'; // Lila/Purple signaling restart
        title = i18next.t('settings.system.post_install_title');
        desc = i18next.t('settings.system.post_install_desc');
        btnHtml = `<button class="btn-primary" onclick="restartHA()" style="background-color: #6200ea;">${i18next.t('settings.system.restart_ha_btn')}</button>`;
    
    } else if (!status.installed || status.needs_update) {
        // State 1: Component missing OR Update available
        const isUpdate = status.installed && status.needs_update;
        icon = isUpdate ? 'mdi-information' : 'mdi-alert-circle';
        color = isUpdate ? 'var(--accent)' : 'var(--warn)';
        title = i18next.t(isUpdate ? 'settings.system.integration_update_available' : 'settings.system.integration_missing');
        desc = isUpdate 
            ? i18next.t('settings.system.integration_update_desc', { installed: status.version_installed, available: status.version_available })
            : i18next.t('settings.system.integration_missing_desc');
        
        btnHtml = `<button class="btn-primary" onclick="installIntegration(this)" style="${!isUpdate ? 'background:var(--warn) !important; color:#000 !important;' : ''}">
            ${isUpdate ? i18next.t('settings.system.integration_update_btn', { version: status.version_available }) : i18next.t('settings.system.integration_install_btn')}
        </button>`;
    
    } else {
        // Final state: installed, configured, and up-to-date.
        icon = 'mdi-check-circle';
        color = 'var(--success)';
        title = i18next.t('settings.system.integration_active');
        desc = i18next.t('settings.system.integration_installed_version', { version: status.version_installed });
    }

    container.innerHTML = `
        <div style="width:fit-content; max-width: 600px; background:#1e1e1e; border:1px solid #383838; border-radius:6px; padding:10px; display:flex; align-items:center; gap:15px;">
            <i class="mdi ${icon}" style="font-size:1.8rem; color:${color}; margin-left: 5px;"></i>
            <div style="flex:1;">
                <div style="font-weight:bold; font-size:0.95rem; margin-bottom:2px; color:#fff; display: flex; align-items: center; gap: 8px;">
                    ${title}
                    <i class="mdi mdi-refresh" style="cursor:pointer; font-size: 0.9rem; opacity: 0.5;" onclick="checkIntegrationStatus(document.getElementById('integration-manager-wrapper'))" title="${i18next.t('refresh_list_title')}"></i>
                </div>
                <div style="color:#aaa; font-size:0.85rem;">${desc}</div>
            </div>
            <div style="margin-right: 5px;">${btnHtml}</div>
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
window.restartHA = restartHA;
window.installIntegration = installIntegration;
window.renderSettingsCategories = renderSettingsCategories;