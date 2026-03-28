/**
 * JS AUTOMATIONS - Editor Configuration
 * Handles Monaco Editor setup, IntelliSense, and Snippets.
 */

var isMonacoReady = false;
var allEntities = [];
var allStoreKeys = [];
window._libDisposables = []; // Speicher für Monaco Lib-Referenzen

// --- MONACO CONFIG ---
function registerCompletionProviders() {
    const languages = ['javascript', 'typescript'];

    languages.forEach(lang => {
        // MDI Icons Provider
        monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['"', "'", ':', ' '],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            if (textUntilPosition.match(/(@icon\s+|icon["']?\s*[:=]\s*["'])(mdi:)?$/) || textUntilPosition.endsWith('mdi:')) {
                // mdiIcons is global from app.js
                const icons = (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0) ? mdiIcons : ['account', 'home', 'lightbulb', 'switch', 'bell', 'check', 'alert', 'calendar', 'clock', 'weather-sunny', 'water', 'thermometer', 'battery', 'wifi'];
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
        monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            // Match: ha.callService(' or ha.callService('dom - erlaubt Text nach dem Quote
            if (textUntilPosition.match(/ha\.callService\(\s*['"](?:[^'"]*)$/)) {
                // Dynamische Domains oder Fallback (haData is global from app.js)
                const domains = (typeof haData !== 'undefined' && haData.services && Object.keys(haData.services).length > 0) 
                    ? Object.keys(haData.services).sort() 
                    : ['light', 'switch', 'notify', 'media_player', 'climate', 'automation', 'script', 'scene', 'tts'];
                return { suggestions: domains.map(d => ({ label: d, kind: monaco.languages.CompletionItemKind.Module, insertText: d })) };
            }
            
            const serviceMatch = textUntilPosition.match(/ha\.callService\(\s*['"]([^'"]+)['"]\s*,\s*['"](?:[^'"]*)$/);
            if (serviceMatch) {
                const domain = serviceMatch[1]; 
                let services = [];
                let serviceData = {};

                if (typeof haData !== 'undefined' && haData.services && haData.services[domain]) {
                    services = Object.keys(haData.services[domain]).sort();
                    serviceData = haData.services[domain];
                } else {
                    // Fallback
                    services = ['turn_on', 'turn_off', 'toggle', 'reload'];
                    if (domain === 'media_player') services = ['play_media', 'media_pause', 'media_play', 'volume_set'];
                }

                const textAfter = model.getValueInRange({
                    startLineNumber: position.lineNumber, 
                    startColumn: position.column, 
                    endLineNumber: position.lineNumber, 
                    endColumn: model.getLineMaxColumn(position.lineNumber)
                });
                const hasArgs = textAfter.match(/^\s*['"]\s*,/);

                return { 
                    suggestions: services.map(s => {
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
        monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position, context) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            
            if (textUntilPosition.match(/ha\.(update|on|onStateChange|getState|getAttr|getStateValue)\(\s*['"]$/) || 
                textUntilPosition.match(/ha\.states\[\s*['"]$/) ||
                textUntilPosition.match(/ha\.on\(\s*\[[^\]]*['"]$/)) {
                return {
                    suggestions: allEntities.map(e => ({
                        label: e,
                        kind: monaco.languages.CompletionItemKind.Constant,
                        insertText: e,
                        detail: 'Entity'
                    }))
                };
            }

            if (textUntilPosition.match(/entity_id["']?\s*:\s*['"]$/)) {
                let domainFilter = null;
                const startLine = Math.max(1, position.lineNumber - 50);
                const range = {startLineNumber: startLine, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column};
                const textContext = model.getValueInRange(range);
                
                const matches = [...textContext.matchAll(/ha\.callService\s*\(\s*['"]([^'"]+)['"]/g)];
                if (matches.length > 0) {
                    const lastMatch = matches[matches.length - 1];
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

            // Manual Trigger (Ctrl+Space) inside any string
            // Allows inserting entities anywhere by pressing Ctrl+Space inside quotes
            if (context && context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke) {
                const singleQuotes = (textUntilPosition.match(/'/g) || []).length;
                const doubleQuotes = (textUntilPosition.match(/"/g) || []).length;
                if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) {
                    return {
                        suggestions: allEntities.map(e => ({
                            label: e,
                            kind: monaco.languages.CompletionItemKind.Constant,
                            insertText: e,
                            detail: 'Entity'
                        }))
                    };
                }
            }

            return { suggestions: [] };
        }
    });

        // HA Device Class Provider
        monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            if (textUntilPosition.match(/device_class["']?\s*:\s*['"]$/)) {
                const classes = ['aqi', 'battery', 'carbon_dioxide', 'carbon_monoxide', 'current', 'date', 'distance', 'duration', 'energy', 'frequency', 'gas', 'humidity', 'illuminance', 'monetary', 'motion', 'nitrogen_dioxide', 'occupancy', 'opening', 'ozone', 'pm1', 'pm10', 'pm25', 'power', 'power_factor', 'pressure', 'signal_strength', 'smoke', 'speed', 'temperature', 'timestamp', 'voltage', 'volume', 'water', 'weight', 'wind_speed'];
                return { suggestions: classes.map(c => ({ label: c, kind: monaco.languages.CompletionItemKind.EnumMember, insertText: c })) };
            }
            return { suggestions: [] };
        }
    });

        // HA Store Keys Provider
        monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["'", '"'],
        provideCompletionItems: function(model, position) {
            const textUntilPosition = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
            
            if (textUntilPosition.match(/ha\.store\.(get|set|delete)\(\s*['"]$/)) {
                return {
                    suggestions: (allStoreKeys || []).map(item => ({
                        label: item.key,
                        kind: monaco.languages.CompletionItemKind.Field,
                        insertText: item.key,
                        detail: item.type,
                        documentation: {
                            value: `**Store Key:** \`${item.key}\`\n\n**Type:** \`${item.type}\``,
                            isTrusted: true
                        }
                    }))
                };
            }
            return { suggestions: [] };
        }
    });

        // HA Change Filter Provider (gt, lt, etc.)
        monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: ["'", '"', ',', ' '],
            provideCompletionItems: function(model, position) {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: position.lineNumber, 
                    startColumn: 1, 
                    endLineNumber: position.lineNumber, 
                    endColumn: position.column
                });
                
                // Reagiert auf das zweite Argument in ha.on('entity', ' oder ha.waitFor('entity', '
                if (textUntilPosition.match(/ha\.(on|waitFor)\(\s*['"][^'"]+['"]\s*,\s*['"]$/)) {
                    const filters = [
                        { label: 'eq', doc: 'Equal to (==)' },
                        { label: 'ne', doc: 'Not equal to (!=)' },
                        { label: 'gt', doc: 'Greater than (>)' },
                        { label: 'ge', doc: 'Greater than or equal to (>=)' },
                        { label: 'lt', doc: 'Less than (<)' },
                        { label: 'le', doc: 'Less than or equal to (<=)' }
                    ];
                    return {
                        suggestions: filters.map(f => ({
                            label: f.label,
                            kind: monaco.languages.CompletionItemKind.EnumMember,
                            insertText: f.label,
                            documentation: f.doc,
                            detail: 'Change Filter'
                        }))
                    };
                }

                // Reagiert auf das dritte Argument (Threshold) nach einem mathematischen Filter
                // Match: ha.on('sensor.temp', 'gt', 
                const thresholdMatch = textUntilPosition.match(/ha\.(on|waitFor)\(\s*['"][^'"]+['"]\s*,\s*['"](gt|ge|lt|le|eq|ne)['"]\s*,\s*$/);
                if (thresholdMatch) {
                    const filter = thresholdMatch[2];
                    const isNumeric = ['gt', 'ge', 'lt', 'le'].includes(filter);
                    
                    const suggestions = isNumeric ? [
                        { label: '0', insertText: '0', detail: 'Numeric Threshold' },
                        { label: '10', insertText: '10', detail: 'Numeric Threshold' },
                        { label: '20', insertText: '20', detail: 'Numeric Threshold' },
                        { label: '50', insertText: '50', detail: 'Numeric Threshold' }
                    ] : [
                        { label: "'on'", insertText: "'on'", detail: 'State' },
                        { label: "'off'", insertText: "'off'", detail: 'State' }
                    ];

                    return {
                        suggestions: suggestions.map(s => ({
                            ...s,
                            kind: monaco.languages.CompletionItemKind.Value
                        }))
                    };
                }

                return { suggestions: [] };
            }
        });

        // HA @include Provider (Library names in header)
        monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: [' ', '@', ','],
            provideCompletionItems: function(model, position) {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: position.lineNumber, 
                    startColumn: 1, 
                    endLineNumber: position.lineNumber, 
                    endColumn: position.column
                });
                
                // 1. Suggest the 'include' tag itself after '@'
                if (textUntilPosition.endsWith('@')) {
                    return {
                        suggestions: [{
                            label: 'include',
                            kind: monaco.languages.CompletionItemKind.Keyword,
                            insertText: 'include ',
                            documentation: 'Include a global library from the libraries folder.'
                        }]
                    };
                }

                // 2. Suggest library files after '@include ' or after a comma in the list
                if (textUntilPosition.match(/@include\s+[^,]*$/) || textUntilPosition.match(/@include\s+.*,\s*[^,]*$/)) {
                    const libs = (typeof allScripts !== 'undefined') 
                        ? allScripts.filter(s => s.path && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\')))
                        : [];

                    return {
                        suggestions: libs.map(l => ({
                            label: l.filename,
                            kind: monaco.languages.CompletionItemKind.File,
                            insertText: l.filename,
                            detail: 'Library',
                            documentation: l.description || l.filename
                        }))
                    };
                }
                return { suggestions: [] };
            }
        });
    });
}

async function configureMonaco() {
    // Sync JS options with TS settings from app.js
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ 
        target: monaco.languages.typescript.ScriptTarget.ES2020, 
        allowNonTsExtensions: true, 
        checkJs: true, 
        allowJs: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        baseUrl: "file:///",
        paths: { "*": ["file:///node_modules/@types/*"] }
    });

    // Fix potential HTML entities (e.g. &lt; instead of <) that break TypeScript parsing
    const decodeEntities = (ts) => ts ? ts.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';

    try {
        // Use the centralized typings bundle to populate local search arrays
        const res = await fetch('api/scripts/typings');
        if (!res.ok) return;
        const typings = await res.json();

        const entitiesLib = typings.find(t => t.filename === 'entities.d.ts');

        // Update allEntities for the Picker and custom Completion Providers
        if (entitiesLib && entitiesLib.content) {
            const matches = entitiesLib.content.match(/"([a-z0-9_]+\.[a-z0-9_\-]+)"/g);
            if (matches) {
            allEntities = matches.map(m => m.replace(/"/g, '')).sort();
            console.log(`✅ Loaded ${allEntities.length} Entities.`);
            }
        }

        // Update allStoreKeys for completion
        allStoreKeys = [];
        const storeContent = entitiesLib ? entitiesLib.content : '';
        if (storeContent) {
            // Extrahiere Keys spezifisch aus dem GlobalStoreSchema Block in entities.d.ts
            const schemaMatch = storeContent.match(/interface GlobalStoreSchema \{([\s\S]*?)\}/);
            if (schemaMatch && schemaMatch[1]) {
                const storeRegex = /"([^"]+)"\s*:\s*([^;]+);/g;
                let match;
                while ((match = storeRegex.exec(schemaMatch[1])) !== null) {
                    allStoreKeys.push({ key: match[1], type: match[2].trim() });
                }
            }
            allStoreKeys.sort((a, b) => a.key.localeCompare(b.key));
        }
    } catch (e) { console.error("Error configuring Monaco:", e); }
    
    await loadLibraryDefinitions(); // NEU: Globale Libraries laden

    registerCompletionProviders();
    isMonacoReady = true;
}

function updateIconDecorations(model) {
    if (typeof monaco === 'undefined' || !model) return;
    const text = model.getValue();
    const regex = /(?:@icon\s+|["'])(mdi:([a-z0-9-]+))/g;
    const decorations = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const iconName = match[2];
        const matchIndex = match.index + match[0].indexOf(match[1]);
        const startPos = model.getPositionAt(matchIndex);
        decorations.push({
            range: new monaco.Range(startPos.lineNumber, startPos.column, startPos.lineNumber, startPos.column),
            options: { beforeContentClassName: `mdi mdi-${iconName} icon-preview-inline`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
        });
    }
    model._iconDecos = model.deltaDecorations(model._iconDecos || [], decorations);
}

function insertCodeSnippet(type) {
    // editor is global from app.js
    if (typeof editor === 'undefined' || !editor) return;
    const contribution = editor.getContribution('snippetController2');
    let template = '';
    
    if (type === 'log') template = 'ha.log("${1:Message}");';
    else if (type === 'service') template = "ha.callService('${1:domain}', '${2:service}', { entity_id: '${3}' });";
    else if (type === 'listener') template = "ha.on('${1:entity_id}', (e) => {\n\t${2:// code}\n});";
    else if (type === 'listener_array') template = "ha.on(['${1:entity_1}', '${2:entity_2}'], (e) => {\n\t${3:// code}\n});";
    else if (type === 'state') template = "ha.states['${1:entity_id}']";
    else if (type === 'register') template = "ha.register('sensor.${1:my_sensor}', {\n\tname: '${2:My Sensor}',\n\ticon: '${3:mdi:eye}',\n\tarea: '${4:Area}',\n\tlabels: ['${5:Label}'],\n\t// device: 'script' // optional: 'script' (default), 'system' or 'none'\n});";
    else if (type === 'update_state') template = "ha.update('${1:sensor.my_sensor}', '${2:state_value}', {\n\tfriendly_name: '${3:Name}',\n\tunit: '${4:EUR}',\n\ticon: '${5:mdi:robot}'\n});";
    else if (type === 'select') template = "ha.select('${1:light.*}').turnOff();";
    else if (type === 'on_stop') template = "ha.onStop(() => {\n\t${1:// cleanup code}\n});";
    else if (type === 'store_set') template = "ha.store.set('${1:key}', ${2:value});";
    else if (type === 'store_get') template = "const ${1:val} = ha.store.get('${2:key}');";
    else if (type === 'store_del') template = "ha.store.delete('${1:key}');";
    
    if (template) { editor.focus(); contribution.insert(template); }
}

function toggleWordWrap() {
    if (typeof editor === 'undefined' || !editor) return;
    const currentOptions = editor.getOptions();
    const currentWordWrap = currentOptions.get(monaco.editor.EditorOption.wordWrap);
    const newWordWrapValue = (currentWordWrap === 'off') ? 'on' : 'off';
    editor.updateOptions({ wordWrap: newWordWrapValue });
    localStorage.setItem('js_editor_wordwrap', newWordWrapValue);
    const wrapButton = document.getElementById('btn-word-wrap');
    if (wrapButton) {
        const icon = wrapButton.querySelector('i');
        if (icon) icon.className = `mdi mdi-wrap${newWordWrapValue === 'on' ? '' : '-disabled'}`;
    }
}

function openEntityPicker() {
    document.getElementById('entity-picker-modal').classList.remove('hidden');
    const input = document.getElementById('entity-search-input');
    input.value = '';
    input.focus();
    renderEntityList(allEntities);
}

function closeEntityPicker() {
    document.getElementById('entity-picker-modal').classList.add('hidden');
    if (editor) editor.focus();
}

function renderEntityList(list) {
    const container = document.getElementById('entity-list');
    if (!container) return;
    container.innerHTML = '';
    
    // Performance: Nur die ersten 200 anzeigen
    const limit = 200;
    const slice = list.slice(0, limit);

    slice.forEach(entityId => {
        const div = document.createElement('div');
        div.className = 'entity-row';
        div.textContent = entityId;
        div.onclick = () => {
            insertEntityToEditor(entityId);
            closeEntityPicker();
        };
        container.appendChild(div);
    });

    if (list.length > limit) {
        const info = document.createElement('div');
        info.style.padding = '10px';
        info.style.textAlign = 'center';
        info.style.color = '#666';
        info.textContent = `... ${list.length - limit} more`;
        container.appendChild(info);
    }
}

function filterEntityPicker() {
    const term = document.getElementById('entity-search-input').value.toLowerCase();
    const filtered = allEntities.filter(e => e.toLowerCase().includes(term));
    renderEntityList(filtered);
}

function insertEntityToEditor(text) {
    if (!editor) return;
    const selection = editor.getSelection();
    const op = { range: selection, text: text, forceMoveMarkers: true };
    editor.executeEdits("insert-entity", [op]);
}

async function loadLibraryDefinitions() {
    if (typeof monaco === 'undefined') return;
    try {
        const res = await apiFetch('api/scripts');
        if (!res.ok) return;
        const scripts = await res.json();
        
        // Filter: Nur Libraries
        const libs = scripts.filter(s => s.path && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\')));

        // Alte Definitionen aufräumen
        if (window._libDisposables) {
            window._libDisposables.forEach(d => d.dispose());
        }
        window._libDisposables = [];

        for (const lib of libs) {
            try {
                const cRes = await apiFetch(`api/scripts/${lib.filename}/content`);
                if (cRes.ok) {
                    const data = await cRes.json();
                    // Als virtuelle Datei hinzufügen. Monaco parst dann JSDoc & Signaturen.
                    const disposable = monaco.languages.typescript.javascriptDefaults.addExtraLib(
                        data.content, 
                        `file:///libraries/${lib.filename}`
                    );
                    window._libDisposables.push(disposable);
                }
            } catch (e) { }
        }
        if (libs.length > 0) console.log(`📚 IntelliSense: ${libs.length} Libraries loaded.`);
    } catch (e) { console.warn("IntelliSense Load Error", e); }
}

function loadEditorSettings() {
    if (typeof editor === 'undefined' || !editor) return;
    
    // Restore Word Wrap
    const savedWrap = localStorage.getItem('js_editor_wordwrap');
    if (savedWrap) {
        editor.updateOptions({ wordWrap: savedWrap });
        const wrapButton = document.getElementById('btn-word-wrap');
        if (wrapButton) {
            const icon = wrapButton.querySelector('i');
            if (icon) icon.className = `mdi mdi-wrap${savedWrap === 'on' ? '' : '-disabled'}`;
        }
    }

    // Restore Minimap Scale
    const savedScale = localStorage.getItem('js_editor_minimap_scale');
    if (savedScale) {
        editor.updateOptions({ minimap: { scale: parseInt(savedScale, 10) } });
    }
}

// Make globally available
window.registerCompletionProviders = registerCompletionProviders;
window.configureMonaco = configureMonaco;
window.updateIconDecorations = updateIconDecorations;
window.toggleWordWrap = toggleWordWrap;
window.openEntityPicker = openEntityPicker;
window.closeEntityPicker = closeEntityPicker;
window.filterEntityPicker = filterEntityPicker;
window.loadLibraryDefinitions = loadLibraryDefinitions;
window.loadEditorSettings = loadEditorSettings;