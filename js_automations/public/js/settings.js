/**
 * Settings Logic (Schema-Driven UI)
 */

let settingsSchema = null;
window.currentSettings = null; 
const SETTINGS_TAB_ID = 'System: Settings';
let activeCategory = null;
let settingsEntityTarget = null;
window.cachedEntities = window.cachedEntities || [];
let isProgrammaticScroll = false;
let pendingScrollTarget = null;

/**
 * Opens the settings tab and loads data.
 */
async function openSettingsTab(targetId = null) {
    console.log("Opening Settings Tab...");
    pendingScrollTarget = targetId;
    
    // Make main container visible if no tabs were open
    const section = document.getElementById('editor-section');
    if (section) section.classList.remove('hidden');

    // Check if tab already exists
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

    // If already loaded, scroll immediately
    if (settingsSchema && targetId) {
        setTimeout(() => scrollToSection(targetId), 100);
    }
}

/**
 * Loads schema and values from the API.
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

        // Translate static elements in the settings wrapper.
        if (window.updateUIWithTranslations) {
            window.updateUIWithTranslations(document.getElementById('settings-wrapper'));
        }

        // Check for deep linking
        if (pendingScrollTarget) {
            const target = pendingScrollTarget;
            pendingScrollTarget = null;
            setTimeout(() => scrollToSection(target), 200);
        } else if (settingsSchema && settingsSchema.length > 0) {
            // Highlight the first category by default
            setActiveCategoryUI(settingsSchema[0].id);
        }
    } catch (error) {
        console.error("Failed to load settings:", error);
        // Display fallback or error UI.
    }
}

/**
 * Renders the left sidebar (categories).
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
            if (window.newVersionInfo && window.newVersionInfo.update_available) {
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
 * Initializes ScrollSpy with IntersectionObserver.
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
 * Renders all categories sequentially.
 */
function renderAllSettings() {
    const container = document.getElementById('settings-content');
    container.innerHTML = '';

    // Insert shared datalist for autocomplete.
    const dl = document.createElement('datalist');
    dl.id = 'settings-entities-datalist';
    container.appendChild(dl);

    settingsSchema.forEach(category => {
        const section = document.createElement('section');
        section.id = `settings-section-${category.id}`;
        section.className = 'settings-section';
        if (category.id === 'danger') section.classList.add('settings-category-danger');

        // Category Title
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
 * Renders the items of a category into a target element.
 */
function renderSettingsItems(category, section) {
    const catId = category.id;
    category.items.forEach(item => {
        // Skip if item is marked as hidden
        if (item.hidden) return;
        // Condition check (should field be displayed?)
        if (item.condition) {
            // Safety check: category exists in settings
            if (!window.currentSettings[catId]) window.currentSettings[catId] = {};
            
            const dependentVal = window.currentSettings[catId][item.condition.key];
            if (dependentVal !== item.condition.value) return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'settings-item-wrapper';
        // Indentation for dependent fields
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

        // Description
        if (item.description) {
            const desc = document.createElement('div');
            desc.setAttribute('data-i18n', item.description);
            desc.innerText = i18next.t(item.description);
            desc.style.fontSize = '0.8rem';
            desc.style.color = '#888';
            desc.style.marginBottom = '8px';
            wrapper.appendChild(desc);
        }

        // Generate input element
        let input;
        
        // Value Access
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
                // Support for strings or {value, label} objects
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
            if (item.min !== undefined) input.min = item.min;
            if (item.max !== undefined) input.max = item.max;
            input.style.padding = '5px';
            input.style.backgroundColor = '#333';
            input.style.color = '#fff';
            input.style.border = '1px solid #555';
            input.style.fontSize = '0.9rem';
            input.style.width = '100px';
            input.onchange = (e) => saveSetting(catId, item.key, parseFloat(e.target.value));
        }
        else if (item.type === 'entity-picker') {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = value;
            textInput.id = `input-${catId}-${item.key}`;
            
            // Autocomplete field
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
            };
        }
        else if (item.type === 'mqtt-test') {
            input = document.createElement('button');
            input.innerText = i18next.t(item.label);
            input.className = 'btn-primary';
            input.style.width = 'fit-content';
            input.style.marginTop = '5px';
            input.style.fontSize = '0.9rem';
            input.onclick = () => testMqttConnection(input);
        }
        else if (item.type === 'mqtt-autodetect') {
            input = document.createElement('button');
            input.innerText = i18next.t(item.label);
            input.className = 'btn-text';
            input.style.width = 'fit-content';
            input.style.marginTop = '5px';
            input.style.fontSize = '0.85rem';
            input.style.color = 'var(--accent)';
            input.onclick = () => discoverMqttSettings(input);
        }
        else {
            input = document.createElement('input');
            input.type = item.mode === 'password' ? 'password' : 'text';
            input.value = value;
            input.style.width = '100%';
            input.style.maxWidth = '400px';
            input.style.padding = '5px';
            input.style.backgroundColor = '#333';
            input.style.color = '#fff';
            input.style.border = '1px solid #555';
            input.style.fontSize = '0.9rem';
            input.onchange = (e) => saveSetting(catId, item.key, e.target.value);
        }

        wrapper.appendChild(input);
        section.appendChild(wrapper);

        // Adjust visual state for inactive items
        if (item.active === false) {
            input.disabled = true;
            wrapper.style.opacity = '0.6';
            wrapper.style.pointerEvents = 'none'; 
        }
    });
}

/**
 * Saves a single setting and updates the state.
 */
async function saveSetting(catId, key, value) {
    // Optimistic UI Update
    if (!window.currentSettings[catId]) window.currentSettings[catId] = {};
    window.currentSettings[catId][key] = value;
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: window.currentSettings }));

    // Refresh UI if dependent fields change
    renderAllSettings();

    // API call
    const payload = { [catId]: { [key]: value } };
    
    try {
        await apiFetch('api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Force reload on language change
        if (catId === 'general' && key === 'ui_language') {
            // Add param to reopen settings after reload
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
 * Loads entities for the autocomplete list.
 */
async function loadEntitiesForAutocomplete() {
    const dl = document.getElementById('settings-entities-datalist');
    if (!dl) return;

    // Skip if already populated
    if (dl.options.length > 0) return;

    // Try Global IntelliSense data first
    if (typeof allEntities !== 'undefined' && Array.isArray(allEntities) && allEntities.length > 0) {
        dl.innerHTML = '';
        allEntities.forEach(entityId => {
            const opt = document.createElement('option');
            opt.value = entityId;
            dl.appendChild(opt);
        });
        return;
    }

    // Socket fallback
    if (window.cachedEntities.length === 0) {
        try {
            if (typeof window.getHAStates === 'function') {
                window.cachedEntities = await window.getHAStates();
            }
        } catch (e) {
            console.warn("Failed to load entities via Socket", e);
        }
    }

    // Populate datalist
    dl.innerHTML = '';
    window.cachedEntities.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.entity_id;
        if (e.attributes.friendly_name) opt.label = e.attributes.friendly_name;
        dl.appendChild(opt);
    });
}

/**
 * Tests the MQTT connection using current UI settings.
 */
async function testMqttConnection(btn) {
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = `<i class="mdi mdi-loading mdi-spin"></i> Testing...`;
    
    try {
        const mqttSettings = window.currentSettings.mqtt;
        const res = await apiFetch('api/mqtt/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mqttSettings)
        });
        
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || `Status ${res.status}`);
        }

        const result = await res.json();
        if (result.success) {
            alert(i18next.t('settings.system.mqtt_test_success'));
        } else {
            alert(i18next.t('settings.system.mqtt_test_error', { error: result.error }));
        }
    } catch (e) {
        console.error("MQTT Test failed:", e);
        alert(i18next.t('settings.system.mqtt_test_error', { error: e.message }));
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

/**
 * Attempts to auto-discover MQTT settings from HA.
 */
async function discoverMqttSettings(btn) {
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = `<i class="mdi mdi-loading mdi-spin"></i> Detecting...`;
    
    try {
        const res = await apiFetch('api/mqtt/discover');
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || `Status ${res.status}`);
        }

        const result = await res.json();
        
        if (result && result.host) {
            // Update local settings and UI
            if (!window.currentSettings.mqtt) window.currentSettings.mqtt = {};
            
            window.currentSettings.mqtt.host = result.host;
            window.currentSettings.mqtt.port = result.port;
            if (result.username) window.currentSettings.mqtt.username = result.username;
            
            // Re-render to show new values in inputs
            renderAllSettings();
            alert(i18next.t('settings.system.mqtt_autodetect_success'));
        } else {
            alert(i18next.t('settings.system.mqtt_autodetect_not_found'));
        }
    } catch (e) {
        console.error("MQTT Discovery failed:", e);
        alert("Discovery failed: " + e.message);
    } finally {
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
window.testMqttConnection = testMqttConnection;