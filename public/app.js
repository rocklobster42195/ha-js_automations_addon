/**
 * JS AUTOMATIONS - Dashboard Logic (v2.17.4)
 * Feature: Colored Section Headers based on HA Labels
 */

// --- I18N ---
async function initI18next() {
    
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lng');

    // Wenn nicht per URL erzwungen, versuche Config vom Backend zu laden
    if (!lang) {
        try {
            const res = await apiFetch('api/options');
            if (res.ok) {
                const opts = await res.json();
                if (opts.ui_language) lang = opts.ui_language;
            }
        } catch (e) { console.debug("Could not load options", e); }
    }

    // Fallback: Browser-Sprache
    if (!lang) lang = navigator.language.split('-')[0];

    await i18next
        .use(i18nextHttpBackend)
        .init({
            lng: lang,
            fallbackLng: 'en',
            debug: false,
            ns: ['translation'],
            defaultNS: 'translation',
            backend: {
                loadPath: 'locales/{{lng}}/translation.json'
            }
        });
    updateUIWithTranslations();
}

function updateUIWithTranslations() {
    document.title = i18next.t('app_title');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.hasAttribute('data-i18n-placeholder')) {
            el.placeholder = i18next.t(key);
        } else if (el.hasAttribute('data-i18n-title')) {
            el.title = i18next.t(key);
        } else {
            el.innerHTML = i18next.t(key);
        }
    });
}
// --- END I18N ---

const BASE_PATH = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
let editor = null, socket = null, isMonacoReady = false, allScripts = [];
let haData = { areas: [], labels: [], services: {} };
let mdiIcons = [];
let allEntities = [];
let openTabs = [];
let activeTabFilename = null;
let collapsedSections = JSON.parse(localStorage.getItem('js_collapsed_sections') || '[]');

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

// --- MONACO CONFIG ---
function registerCompletionProviders() {
    // MDI Icons Provider
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['"', "'", ':', ' '],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            if (textUntilPosition.match(/(@icon\s+|icon["']?\s*[:=]\s*["'])(mdi:)?$/) || textUntilPosition.endsWith('mdi:')) {
                const icons = mdiIcons.length > 0 ? mdiIcons : ['account', 'home', 'lightbulb', 'switch', 'bell', 'check', 'alert', 'calendar', 'clock', 'weather-sunny', 'water', 'thermometer', 'battery', 'wifi'];
                return {
                    suggestions: icons.map(i => ({
                        label: `mdi:${i}`,
                        kind: monaco.languages.CompletionItemKind.Value,
                        insertText: textUntilPosition.endsWith('mdi:') ? i : `mdi:${i}`,
                        documentation: {
                            value: `!Preview \n\n **mdi:${i}**`,
                            isTrusted: true
                        }
                    }))
                };
            }
            return { suggestions: [] };
        }
    });

    // HA Services Provider
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            // Match: ha.callService(' or ha.callService('dom - erlaubt Text nach dem Quote
            if (textUntilPosition.match(/ha\.callService\(\s*['"](?:[^'"]*)$/)) {
                // Dynamische Domains oder Fallback
                const domains = (haData.services && Object.keys(haData.services).length > 0) 
                    ? Object.keys(haData.services).sort() 
                    : ['light', 'switch', 'notify', 'media_player', 'climate', 'automation', 'script', 'scene', 'tts'];
                return { suggestions: domains.map(d => ({ label: d, kind: monaco.languages.CompletionItemKind.Module, insertText: d })) };
            }
            // Regex Fix: Capture Domain (zwischen den Quotes)
            // Erlaubt nun auch Text nach dem Anführungszeichen (für Filterung während des Tippens)
            // Vereinfacht: Ignoriert Backreference für mehr Robustheit (z.B. bei gemischten Quotes während des Tippens)
            const serviceMatch = textUntilPosition.match(/ha\.callService\(\s*['"]([^'"]+)['"]\s*,\s*['"](?:[^'"]*)$/);
            if (serviceMatch) {
                const domain = serviceMatch[1]; // Domain ist jetzt in Gruppe 1
                let services = [];
                let serviceData = {};

                if (haData.services && haData.services[domain]) {
                    services = Object.keys(haData.services[domain]).sort();
                    serviceData = haData.services[domain];
                } else {
                    // Fallback
                    services = ['turn_on', 'turn_off', 'toggle', 'reload'];
                    if (domain === 'media_player') services = ['play_media', 'media_pause', 'media_play', 'volume_set'];
                }

                // Check text AFTER cursor to prevent duplication
                // If we are in a snippet or existing code like: 'service', { ... }
                const textAfter = model.getValueInRange({
                    startLineNumber: position.lineNumber, 
                    startColumn: position.column, 
                    endLineNumber: position.lineNumber, 
                    endColumn: model.getLineMaxColumn(position.lineNumber)
                });
                const hasArgs = textAfter.match(/^\s*['"]\s*,/);

                return { 
                    suggestions: services.map(s => {
                        // SNIPPET LOGIC: Automatisch Schema einfügen
                        // Aus "turn_on" wird "turn_on', { entity_id: '${1}' }"
                        // ABER: Nur wenn noch keine Argumente folgen!
                        const item = { 
                            label: s, 
                            kind: monaco.languages.CompletionItemKind.Function, 
                            insertText: hasArgs ? s : `${s}', { entity_id: '\${1}' }`,
                            insertTextRules: hasArgs ? monaco.languages.CompletionItemInsertTextRule.None : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                        };
                        if (serviceData[s] && serviceData[s].description) {
                            item.documentation = { value: serviceData[s].description, isTrusted: true };
                        }
                        return item;
                    }) 
                };
            }
            return { suggestions: [] };
        }
    });

    // HA Entities Provider
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            
            // Matches: ha.updateState(' or ha.on(' or ha.onStateChange(' or ha.states['
            if (textUntilPosition.match(/ha\.(updateState|on|onStateChange)\(\s*['"]$/) || textUntilPosition.match(/ha\.states\[\s*['"]$/)) {
                return {
                    suggestions: allEntities.map(e => ({
                        label: e,
                        kind: monaco.languages.CompletionItemKind.Constant,
                        insertText: e,
                        detail: 'Entity'
                    }))
                };
            }

            // Context-aware trigger (entity_id:)
            if (textUntilPosition.match(/entity_id["']?\s*:\s*['"]$/)) {
                let domainFilter = null;
                
                // Look back for ha.callService domain (max 50 lines)
                const startLine = Math.max(1, position.lineNumber - 50);
                const range = {startLineNumber: startLine, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column};
                const textContext = model.getValueInRange(range);
                
                // Find all callService calls
                const matches = [...textContext.matchAll(/ha\.callService\s*\(\s*['"]([^'"]+)['"]/g)];
                if (matches.length > 0) {
                    const lastMatch = matches[matches.length - 1];
                    // Check if we are still inside the parentheses of this call
                    const textAfterMatch = textContext.substring(lastMatch.index);
                    let openParens = 0;
                    for (const char of textAfterMatch) {
                        if (char === '(') openParens++;
                        if (char === ')') openParens--;
                    }
                    if (openParens > 0) {
                        domainFilter = lastMatch[1];
                    }
                }

                let entities = allEntities;
                if (domainFilter && domainFilter !== 'homeassistant') {
                    const filtered = allEntities.filter(e => e.startsWith(domainFilter + '.'));
                    // Only apply filter if we have results (fallback to all if 0 found)
                    if (filtered.length > 0) entities = filtered;
                }

                return {
                    suggestions: entities.map(e => ({
                        label: e,
                        kind: monaco.languages.CompletionItemKind.Constant,
                        insertText: e,
                        detail: 'Entity'
                    }))
                };
            }

            return { suggestions: [] };
        }
    });

    // HA Device Class Provider
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            
            if (textUntilPosition.match(/device_class["']?\s*:\s*['"]$/)) {
                const classes = ['aqi', 'battery', 'carbon_dioxide', 'carbon_monoxide', 'current', 'date', 'distance', 'duration', 'energy', 'frequency', 'gas', 'humidity', 'illuminance', 'monetary', 'motion', 'nitrogen_dioxide', 'occupancy', 'opening', 'ozone', 'pm1', 'pm10', 'pm25', 'power', 'power_factor', 'pressure', 'signal_strength', 'smoke', 'speed', 'temperature', 'timestamp', 'voltage', 'volume', 'water', 'weight', 'wind_speed'];
                return {
                    suggestions: classes.map(c => ({
                        label: c,
                        kind: monaco.languages.CompletionItemKind.EnumMember,
                        insertText: c
                    }))
                };
            }
            return { suggestions: [] };
        }
    });
}

async function configureMonaco() {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, allowJs: true });
    try {
        const res = await apiFetch('api/scripts/entities.d.ts/content');
        const data = await res.json();
        if (data.content) {
            // Extract entities for IntelliSense
            const matches = data.content.match(/"([a-z0-9_]+\.[a-z0-9_\-]+)"/g);
            if (matches) {
                allEntities = matches.map(m => m.replace(/"/g, '')).sort();
                console.log(`✅ Loaded ${allEntities.length} Entities.`);
            }
            const entities = data.content.replace(/export /g, '').replace(/type EntityID =\s+\|/g, 'type EntityID = ');
            const lib = `
${entities}

interface HAAttributes {
    /** (Optional) Name displayed in the UI */
    friendly_name?: string;
    /** (Optional) Unit of measurement (e.g. '°C', '€') */
    unit_of_measurement?: string;
    /** (Optional) Icon (e.g. 'mdi:home') */
    icon?: string;
    /** (Optional) Device class (e.g. 'temperature', 'motion') */
    device_class?: string;
    /** (Optional) State class for statistics */
    state_class?: 'measurement' | 'total' | 'total_increasing';
    /** (Optional) URL to an image */
    entity_picture?: string;
    /** (Optional) Custom attribute */
    last_updated_by?: string;
    [key: string]: any;
}

/** Home Assistant JavaScript Automation API */
interface HA {
    /** Log a message to the console (Info level). */
    log(message: any): void;
    /** Log an error message. */
    error(message: any): void;
    /** Call a Home Assistant service. */
    callService(domain: string, service: string, data?: Record<string, any>): void;
    /** Update or create a state in Home Assistant. */
    updateState(entityId: EntityID, state: any, attributes?: HAAttributes): void;
    /** Local storage for the script. */
    store: { val: Record<string, any>; set(key: string, value: any): void; get(key: string): any; delete(key: string): void; };
    /** Access to all current states in Home Assistant. */
    states: Record<EntityID, { state: string; attributes: any; }>;
    /** Subscribe to events. Supports wildcards (e.g. 'switch.*'). */
    on(pattern: EntityID | string | string[], callback: (event: any) => void): void;
    /** Cleanup function when script stops. */
    onStop(callback: () => void): void;
    /** Select multiple entities. */
    select(pattern: string): { count: number; each(callback: (entity: any) => void): void; map<T>(callback: (entity: any) => T): T[]; };
}
declare var ha: HA;
declare var axios: any;
declare function schedule(cron: string, callback: () => void): void;
declare function sleep(ms: number): Promise<void>;
`;
            monaco.languages.typescript.javascriptDefaults.addExtraLib(lib, 'file:///ha-api.d.ts');
        }
    } catch (e) {}
    registerCompletionProviders();
    isMonacoReady = true;
}

function updateIconDecorations(model) {
    if (typeof monaco === 'undefined' || !model) return;

    const text = model.getValue();
    // Findet "mdi:icon-name" in Anführungszeichen oder nach @icon
    const regex = /(?:@icon\s+|["'])(mdi:([a-z0-9-]+))/g;
    const decorations = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        const iconName = match[2]; // z.B. "home"
        
        // Position berechnen (Start des "mdi:..." Strings)
        const matchIndex = match.index + match[0].indexOf(match[1]);
        const startPos = model.getPositionAt(matchIndex);
        
        decorations.push({
            range: new monaco.Range(startPos.lineNumber, startPos.column, startPos.lineNumber, startPos.column),
            options: {
                // Nutzt die MDI-Klasse direkt für das Rendering
                beforeContentClassName: `mdi mdi-${iconName} icon-preview-inline`,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
        });
    }
    // Alte Decorations löschen und neue setzen (speichern in model._iconDecos)
    model._iconDecos = model.deltaDecorations(model._iconDecos || [], decorations);
}

/**
 * Fügt Code-Snippets an der Cursor-Position ein.
 * Nutzt Monaco's SnippetController für Tabstops (${1}).
 */
function insertCodeSnippet(type) {
    if (!editor) return;
    const contribution = editor.getContribution('snippetController2');
    
    let template = '';
    switch (type) {
        case 'log':
            template = 'ha.log("${1:Message}");';
            break;
        case 'service':
            template = "ha.callService('${1:domain}', '${2:service}', { entity_id: '${3}' });";
            break;
        case 'listener':
            template = "ha.on('${1:entity_id}', (e) => {\n\t${2:// code}\n});";
            break;
        case 'listener_array':
            template = "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t${3:// code}\n});";
            break;
        case 'state':
            template = "ha.states['${1:entity_id}']";
            break;
        case 'update_state':
            template = "ha.updateState('${1:sensor.my_sensor}', '${2:state_value}', {\n\tfriendly_name: '${3:Name}',\n\tunit_of_measurement: '${4:EUR}',\n\ticon: '${5:mdi:robot}',\n\tdevice_class: '${6:monetary}',\n\tentity_picture: '${7:https://...}',\n\tlast_updated_by: '${8:JS-Automation}'\n});";
            break;
        case 'select':
            template = "ha.select('${1:light.*}').turnOff();";
            break;
        case 'on_stop':
            template = "ha.onStop(() => {\n\t${1:// cleanup code}\n});";
            break;
        case 'store_set':
            template = "ha.store.set('${1:key}', ${2:value});";
            break;
        case 'store_get':
            template = "const ${1:val} = ha.store.get('${2:key}');";
            break;
        case 'store_del':
            template = "ha.store.delete('${1:key}');";
            break;
    }
    
    if (template) {
        editor.focus();
        contribution.insert(template);
    }
}

// --- DATA LOADING ---
async function loadHAMetadata() {
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const data = await res.json();
            // TIMING FIX: If HA returns empty lists (during boot), retry in 3s
            if (data.areas.length === 0 && data.labels.length === 0) {
                console.log("⏳ HA Registry not ready. Retrying in 3s...");
                setTimeout(loadHAMetadata, 3000);
                return;
            }
            haData.areas = data.areas || [];
            haData.labels = data.labels || [];
            console.log("✅ HA Metadata loaded.");
            if (allScripts.length > 0) renderScripts(allScripts, false);
        }
    } catch (e) { console.warn("HA Metadata failed"); }
}

async function loadHAServices() {
    try {
        const res = await apiFetch('api/ha/services');
        if (res.ok) {
            haData.services = await res.json();
            console.log(`✅ Loaded Services for ${Object.keys(haData.services).length} Domains.`);
        }
    } catch (e) { console.warn("HA Services load failed", e); }
}

async function loadMDIIcons() {
    try {
        // Sucht den Link zur CSS-Datei im DOM
        const link = document.querySelector('link[href*="materialdesignicons.min.css"]');
        if (!link) return;

        const res = await fetch(link.href);
        if (res.ok) {
            const css = await res.text();
            // Extrahiert alle Klassennamen wie .mdi-account::before
            const regex = /\.mdi-([a-z0-9-]+)::before/g;
            let match;
            const iconSet = new Set();
            while ((match = regex.exec(css)) !== null) {
                iconSet.add(match[1]);
            }
            mdiIcons = Array.from(iconSet).sort();
            console.log(`✅ Loaded ${mdiIcons.length} MDI Icons.`);
            
            // Datalist im Modal befüllen
            const dl = document.getElementById('mdi-suggestions');
            if (dl) dl.innerHTML = mdiIcons.map(i => `<option value="mdi:${i}">`).join('');
        }
    } catch (e) { console.warn("MDI Load failed", e); }
}

function filterScripts() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (clearBtn) clearBtn.classList.toggle('hidden', searchTerm.length === 0);

    if (searchTerm === '') {
        renderScripts(allScripts, true); // Use complete list
        return;
    }

    const filtered = allScripts.filter(s =>
        s.name.toLowerCase().includes(searchTerm) ||
        s.filename.toLowerCase().includes(searchTerm) ||
        (s.description && s.description.toLowerCase().includes(searchTerm)) ||
        (s.area && s.area.toLowerCase().includes(searchTerm)) ||
        (s.label && s.label.toLowerCase().includes(searchTerm))
    );

    renderScripts(filtered, false);
}

function clearSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
        filterScripts();
    }
}

/**
 * UI RENDERING: Groups scripts by Label and remembers collapse state.
 */
function renderScripts(scripts, updateGlobal = true) {
    if (updateGlobal) allScripts = scripts;
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = '';

    const searchInput = document.getElementById('search-input');
    const isSearchActive = searchInput && searchInput.value.length > 0;

    if (scripts.length === 0) {
        const message = isSearchActive ? i18next.t('no_scripts_found_search') : i18next.t('no_scripts_found');
        list.innerHTML = `<div style="text-align:center; padding:20px; color:#555">${message}</div>`;
        return;
    }

    // 1. Gruppieren nach Label
    const groups = {};
    const NO_GROUP = '___none___';

    scripts.forEach(script => {
        const groupKey = (script.label && script.label.trim() !== '') ? script.label : NO_GROUP;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(script);
    });

    // 2. Gruppen sortieren (Alphabetisch, "Nicht zugeordnet" ganz unten)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === NO_GROUP) return 1;
        if (b === NO_GROUP) return -1;
        return a.localeCompare(b);
    });

    // 3. Rendern der Sektionen
    sortedKeys.forEach(key => {
        const groupScripts = groups[key];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'script-group';
        
        // Einklapp-Zustand prüfen, bei Suche immer ausklappen
        const isCollapsed = isSearchActive ? false : collapsedSections.includes(key);

        // --- HEADER ERSTELLEN ---
        let headerName = key === NO_GROUP ? i18next.t('group_none') : key;
        let iconClass = key === NO_GROUP ? 'mdi-folder-open-outline' : 'mdi-label-outline';
        let iconStyle = '';

        if (key !== NO_GROUP) {
            const haLabel = haData.labels.find(l => l.name === key);
            if (haLabel) {
                if (haLabel.icon) iconClass = haLabel.icon.replace(':', '-');
                if (haLabel.color) iconStyle = `color: ${haLabel.color};`;
            }
        }

        const header = document.createElement('div');
        header.className = 'section-header';
        header.style.opacity = isCollapsed ? '0.5' : '1';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="mdi ${iconClass}" style="font-size:1rem; ${iconStyle}"></i> 
                <span>${headerName}</span>
            </div>
            <i class="mdi mdi-chevron-${isCollapsed ? 'down' : 'up'}" style="font-size:0.8rem; opacity:0.5;"></i>`;
            
        groupDiv.appendChild(header);

        // --- CONTAINER FÜR DIE ZEILEN ---
        const contentDiv = document.createElement('div');
        contentDiv.className = 'group-content';
        contentDiv.style.display = isCollapsed ? 'none' : 'block';

        // Event-Listener zum Einklappen & Speichern
        header.onclick = () => {
            // Bei Suche ist das Einklappen deaktiviert
            if (isSearchActive) return;

            const nowHidden = contentDiv.style.display !== 'none';
            contentDiv.style.display = nowHidden ? 'none' : 'block';
            
            // Icon und Sichtbarkeit anpassen
            const chevron = header.querySelector('.mdi-chevron-up, .mdi-chevron-down');
            if (chevron) chevron.className = `mdi mdi-chevron-${nowHidden ? 'down' : 'up'}`;
            header.style.opacity = nowHidden ? '0.5' : '1';

            // Zustand im LocalStorage dauerhaft merken
            if (nowHidden) {
                if (!collapsedSections.includes(key)) collapsedSections.push(key);
            } else {
                collapsedSections = collapsedSections.filter(s => s !== key);
            }
            localStorage.setItem('js_collapsed_sections', JSON.stringify(collapsedSections));
        };

        // Skripte innerhalb der Gruppe sortieren (Fehler > Running > Stopped)
        groupScripts.sort((a, b) => {
            const score = (s) => (s.status === 'error' ? 2 : (s.running ? 1 : 0));
            const scoreDiff = score(b) - score(a);
            if (scoreDiff !== 0) return scoreDiff;
            return a.name.localeCompare(b.name);
        });

        // --- ZEILEN RENDERN ---
        groupScripts.forEach(s => {
            const row = document.createElement('div');
            row.className = 'script-row';
            row.title = s.description || `File: ${s.filename}`;
            row.onclick = () => openOrSwitchToTab(s.filename, s.icon);

            const icon = s.icon ? s.icon.split(':').pop() : 'script-text';
            let statusClass = s.running ? 'status-running' : (s.status === 'error' ? 'status-error' : 'status-stopped');
            const toggleIcon = s.running ? 'mdi-stop' : 'mdi-play';

            row.innerHTML = `
                <div class="script-icon">
                    <i class="mdi mdi-${icon} ${statusClass}"></i>
                </div>
                <div class="script-info">
                    <div class="script-name">${s.name}</div>
                    <div class="script-lower-row">
                        <span class="script-filename">${s.filename}</span>
                        <div class="row-actions">
                            <button class="btn-row" onclick="event.stopPropagation(); toggleScript('${s.filename}')" title="${i18next.t('script_action_toggle_title')}">
                                <i class="mdi ${toggleIcon}"></i>
                            </button>
                            <button class="btn-row" onclick="event.stopPropagation(); restartScript('${s.filename}')" title="${i18next.t('script_action_restart_title')}" ${!s.running?'disabled':''}>
                                <i class="mdi mdi-restart"></i>
                            </button>
                            <button class="btn-row" onclick="event.stopPropagation(); deleteScript('${s.filename}')" title="${i18next.t('script_action_delete_title')}">
                                <i class="mdi mdi-delete-outline"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
            contentDiv.appendChild(row);
        });

        groupDiv.appendChild(contentDiv);
        list.appendChild(groupDiv);
    });
}

// --- EDITOR & TABS ---

function renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    openTabs.forEach(tabData => {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.filename = tabData.filename;
        if (tabData.filename === activeTabFilename) {
            tabEl.classList.add('active');
        }
        if (tabData.isDirty) {
            tabEl.classList.add('dirty');
        }

        tabEl.onclick = () => switchToTab(tabData.filename);
        
        const iconName = tabData.icon ? tabData.icon.split(':').pop() : 'script-text';

        tabEl.innerHTML = `
            <i class="tab-icon mdi mdi-${iconName}"></i>
            <span class="tab-filename">${tabData.filename}</span>
            <div class="tab-close-container">
                <span class="tab-dirty-dot">●</span>
                <button class="tab-close-btn" onclick="event.stopPropagation(); closeTab('${tabData.filename}');">
                    <i class="mdi mdi-close"></i>
                </button>
            </div>
        `;
        tabBar.appendChild(tabEl);
    });
}

async function openOrSwitchToTab(filename, icon) {
    if (!isMonacoReady) { 
        setTimeout(() => openOrSwitchToTab(filename, icon), 500); 
        return; 
    }

    document.getElementById('editor-section').classList.remove('hidden');

    const existingTab = openTabs.find(t => t.filename === filename);
    if (existingTab) {
        switchToTab(filename);
        return;
    }

    try {
        const res = await apiFetch(`api/scripts/${filename}/content`);
        const data = await res.json();
        
        const newTab = {
            filename: filename,
            icon: icon,
            model: monaco.editor.createModel(data.content, 'javascript'),
            isDirty: false,
            originalContent: data.content,
            viewState: null,
        };

        newTab.model.onDidChangeContent(() => {
            const isNowDirty = newTab.model.getValue() !== newTab.originalContent;
            if (newTab.isDirty !== isNowDirty) {
                newTab.isDirty = isNowDirty;
                setDirtyUI(newTab.filename, isNowDirty);
            }
            updateIconDecorations(newTab.model);
        });

        openTabs.push(newTab);
        updateIconDecorations(newTab.model);
        switchToTab(filename);
    } catch(e) {
        console.error(`Failed to open script ${filename}`, e);
        document.getElementById('editor-section').classList.add('hidden');
    }
}

function switchToTab(filename) {
    if (!editor) return;

    // Save view state of the outgoing tab
    if (activeTabFilename) {
        const oldTab = openTabs.find(t => t.filename === activeTabFilename);
        if (oldTab) {
            oldTab.viewState = editor.saveViewState();
        }
    }

    activeTabFilename = filename;
    const newTab = openTabs.find(t => t.filename === filename);
    if (!newTab) return;

    // Switch model and restore view state
    editor.setModel(newTab.model);
    if (newTab.viewState) {
        editor.restoreViewState(newTab.viewState);
    }
    editor.focus();

    renderTabs();
    updateToolbarUI(newTab.filename, newTab.icon, newTab.isDirty);
}

function closeTab(filename) {
    const tabToClose = openTabs.find(t => t.filename === filename);
    if (!tabToClose) return;

    if (tabToClose.isDirty && !confirm(i18next.t('confirm_discard_changes', { filename }))) {
        return;
    }

    // Find index and remove tab
    const index = openTabs.findIndex(t => t.filename === filename);
    openTabs.splice(index, 1);
    
    // Clean up the model
    tabToClose.model.dispose();

    if (openTabs.length === 0) {
        // No tabs left, hide editor
        document.getElementById('editor-section').classList.add('hidden');
        activeTabFilename = null;
        editor.setModel(null);
    } else if (activeTabFilename === filename) {
        // Closed the active tab, switch to a new one
        const newIndex = Math.max(0, index - 1);
        switchToTab(openTabs[newIndex].filename);
    }

    renderTabs();
}

function setDirtyUI(filename, isDirty) {
    const tabData = openTabs.find(t => t.filename === filename);
    if (tabData) tabData.isDirty = isDirty;
    
    const tabEl = document.querySelector(`.tab[data-filename="${filename}"]`);
    if (tabEl) tabEl.classList.toggle('dirty', isDirty);

    if (filename === activeTabFilename) {
        updateToolbarUI(filename, tabData.icon, isDirty);
    }
}

function updateToolbarUI(filename, icon, isDirty) {
    document.querySelector('.btn-save').style.opacity = isDirty ? '1' : '0.4';
}

async function saveActiveTab() {
    if (!activeTabFilename) return;
    const activeTab = openTabs.find(t => t.filename === activeTabFilename);
    if (!activeTab || !activeTab.isDirty) return;

    const content = activeTab.model.getValue();
    await apiFetch(`api/scripts/${activeTabFilename}/content`, { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ content: content }) 
    });
    
    activeTab.originalContent = content;
    setDirtyUI(activeTabFilename, false);
    await loadScripts(); // Refresh script list in case metadata changed
}
window.saveActiveTab = saveActiveTab;

function closeAllTabs() { 
    if (openTabs.some(t => t.isDirty) && !confirm(i18next.t('confirm_discard_all_changes'))) {
        return;
    }
    openTabs.forEach(t => t.model.dispose());
    openTabs = [];
    activeTabFilename = null;
    editor.setModel(null);
    document.getElementById('editor-section').classList.add('hidden');
    renderTabs();
}
window.closeAllTabs = closeAllTabs;

function updateIconPreview(id, s) { const el=document.getElementById(id); if(el) el.className=`mdi mdi-${s?s.split(':').pop().trim():'script-text'}`; }

window.closeModal = () => document.getElementById('new-script-modal').classList.add('hidden');

async function createNewScript() {
    document.getElementById('new-script-modal').classList.remove('hidden');
    updateIconPreview('modal-icon-preview', 'mdi:script-text');
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            document.getElementById('new-script-area').innerHTML = `<option value="">${i18next.t('area_none')}</option>` + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
            document.getElementById('new-script-label').innerHTML = `<option value="">${i18next.t('label_none')}</option>` + labels.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
        }
    } catch (e) {}
}

async function submitNewScript() {
    const n = document.getElementById('new-script-name').value;
    if (!n) return;
    const p = { name: n, icon: document.getElementById('new-script-icon').value, description: document.getElementById('new-script-desc').value, area: document.getElementById('new-script-area').value, label: document.getElementById('new-script-label').value, loglevel: document.getElementById('new-script-loglevel').value };
    const res = await apiFetch('api/scripts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    if (res.ok) { 
        const data = await res.json(); 
        window.closeModal(); 
        await loadScripts(); 
        setTimeout(() => openOrSwitchToTab(data.filename, p.icon), 100); 
    }
}

// --- LOGGING SYSTEM ---
let logEntries = [];
let knownSources = new Set(['System']);

async function initLogs() {
    try {
        const res = await apiFetch('api/logs');
        if (res.ok) {
            const history = await res.json();
            const container = document.getElementById('console-output');
            if (container) container.innerHTML = '';
            logEntries = [];
            
            // Reset sources
            knownSources = new Set(['System']);
            const select = document.getElementById('logFilter');
            if (select) {
                select.innerHTML = `<option value="ALL">${i18next.t('log_filter_all')}</option><option value="System">System</option>`;
            }
            
            history.forEach(entry => appendLog(entry, false));
            scrollToBottom();
        }
    } catch (e) { console.error("Log load failed", e); }
}

async function clearLogs() {
    await apiFetch('api/logs', { method: 'DELETE' });
    const container = document.getElementById('console-output');
    if (container) container.innerHTML = '';
    logEntries = [];

    // Reset sources and filter dropdown
    knownSources = new Set(['System']);
    const select = document.getElementById('logFilter');
    if (select) {
        select.innerHTML = `<option value="ALL">${i18next.t('log_filter_all')}</option><option value="System">System</option>`;
    }
}
window.clearLogs = clearLogs;

function appendLog(entry, autoScroll = true) {
    if (typeof entry === 'string') {
        entry = { ts: Date.now(), level: 'info', source: 'System', message: entry };
    }
    logEntries.push(entry);

    const source = entry.source || 'System';
    if (!knownSources.has(source)) {
        knownSources.add(source);
        const select = document.getElementById('logFilter');
        if (select) {
            const opt = document.createElement('option');
            opt.value = source;
            opt.textContent = source;
            select.appendChild(opt);
        }
    }

    const out = document.getElementById('console-output');
    if (!out) return;

    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.source = source;

    // Colors
    let color = '#ddd'; 
    if (entry.level === 'error' || (entry.message && entry.message.includes('❌'))) color = '#ff5555'; 
    else if (entry.level === 'warn') color = '#ffb86c'; 
    else if (entry.level === 'debug') color = '#6272a4'; 
    else if (source === 'System') color = '#8be9fd'; 

    const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    div.innerHTML = `<span class="log-time" style="color:#666; margin-right:8px;">[${timeStr}]</span>` +
                    `<span style="color:#bd93f9; font-weight:bold; margin-right:8px;">[${source}]</span>` +
                    `<span style="color:${color}">${entry.message}</span>`;

    const currentFilter = document.getElementById('logFilter')?.value || 'ALL';
    if (currentFilter !== 'ALL' && source !== currentFilter) {
        div.style.display = 'none';
    }

    out.appendChild(div);
    if (autoScroll) scrollToBottom();
}

function filterLogs() {
    const filter = document.getElementById('logFilter').value;
    const container = document.getElementById('console-output');
    if (!container) return;
    
    Array.from(container.children).forEach(el => {
        if (filter === 'ALL' || el.dataset.source === filter) {
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    });
    scrollToBottom();
}
window.filterLogs = filterLogs;

function scrollToBottom() {
    const c = document.getElementById('console-output');
    if (c) c.scrollTop = c.scrollHeight;
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    await initI18next();

    socket = io({ path: BASE_PATH.replace(/\/$/, "") + "/socket.io" });
    socket.on('log', d => appendLog(d));
    socket.on('status_update', loadScripts);

    if (typeof require !== 'undefined') {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
            // --- CREATE EDITOR INSTANCE ---
            editor = monaco.editor.create(document.getElementById('monaco-container'), {
                model: null, // No model initially, will be set when a tab is opened
                language: 'javascript',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: false },
                suggest: { showWords: false }
            });

            // --- Restore Word Wrap Setting ---
            const savedWordWrap = localStorage.getItem('js_editor_wordwrap') || 'off';
            editor.updateOptions({ wordWrap: savedWordWrap });
            const wrapButton = document.getElementById('btn-word-wrap');
            if (wrapButton) {
                const icon = wrapButton.querySelector('i');
                if (icon) {
                    icon.className = `mdi mdi-wrap${savedWordWrap === 'on' ? '' : '-disabled'}`;
                }
            }

            // Add Ctrl+S save command
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveActiveTab);

            // --- LOAD INITIAL DATA ---
            configureMonaco();
            loadScripts();
            initResizer();
        });
    }
    loadHAMetadata();
    loadMDIIcons();
    loadHAServices();
    initLogs();
});
async function loadScripts() { const res = await apiFetch('api/scripts'); if (res.ok) renderScripts(await res.json()); }
window.loadScripts = loadScripts;
window.toggleScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'toggle' })}); };
window.restartScript = async (f) => { await apiFetch('api/scripts/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: f, action: 'restart' })}); };
window.deleteScript = async (f) => { if(confirm(i18next.t('confirm_delete_script', { filename: f }))) { await apiFetch(`api/scripts/${f}`, { method: 'DELETE' }); loadScripts(); } };

function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorSection = document.getElementById('editor-section');
    const mainContent = document.querySelector('.main-content');

    // Restore saved height from localStorage
    const savedEditorHeight = localStorage.getItem('js_editor_height_px');
    if (savedEditorHeight) {
        editorSection.style.height = `${savedEditorHeight}px`;
    }

    const handleMouseMove = (e) => {
        const mainContentRect = mainContent.getBoundingClientRect();
        let newEditorHeight = e.clientY - mainContentRect.top;

        // Constraints
        const minHeight = 90; // From CSS (tab-bar + editor-toolbar)
        const maxHeight = mainContent.clientHeight - 45 - resizer.offsetHeight; // 45px for log-header
        
        if (newEditorHeight < minHeight) newEditorHeight = minHeight;
        if (newEditorHeight > maxHeight) newEditorHeight = maxHeight;
        
        editorSection.style.height = `${newEditorHeight}px`;
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save the new height in pixels
        localStorage.setItem('js_editor_height_px', editorSection.clientHeight);
    };

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        document.body.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });
}

function toggleWordWrap() {
    if (!editor) return;

    const currentOptions = editor.getOptions();
    const currentWordWrap = currentOptions.get(monaco.editor.EditorOption.wordWrap);
    
    const newWordWrapValue = (currentWordWrap === 'off') ? 'on' : 'off';
    editor.updateOptions({ wordWrap: newWordWrapValue });
    localStorage.setItem('js_editor_wordwrap', newWordWrapValue);

    // Visual feedback on the button
    const wrapButton = document.getElementById('btn-word-wrap');
    if (wrapButton) {
        const icon = wrapButton.querySelector('i');
        if (icon) {
            icon.className = `mdi mdi-wrap${newWordWrapValue === 'on' ? '' : '-disabled'}`;
        }
    }
}
window.toggleWordWrap = toggleWordWrap;
window.insertCodeSnippet = insertCodeSnippet;