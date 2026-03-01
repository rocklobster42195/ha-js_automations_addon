/**
 * Reference Manager
 * Parses ha-api.d.ts and renders a documentation UI.
 */

const REFERENCE_TAB_ID = 'System: Reference';

const referenceManager = {
    cachedData: null,
    
    async open() {
        this.injectUI();
        
        // UI umschalten
        document.getElementById('editor-section').classList.add('hidden');
        const settingsWrapper = document.getElementById('settings-wrapper');
        if (settingsWrapper) settingsWrapper.classList.add('hidden');
        const storeWrapper = document.getElementById('store-wrapper');
        if (storeWrapper) storeWrapper.classList.add('hidden');
        
        const refWrapper = document.getElementById('reference-wrapper');
        if (refWrapper) refWrapper.classList.remove('hidden');

        // Tab Management
        if (typeof openTabs !== 'undefined') {
            const existing = openTabs.find(t => t.filename === REFERENCE_TAB_ID);
            if (!existing) {
                openTabs.push({
                    filename: REFERENCE_TAB_ID,
                    icon: 'mdi:book-open-variant',
                    isDirty: false,
                    type: 'reference',
                    model: null
                });
            }
            if (window.renderTabs) window.renderTabs();
            // Wir setzen den aktiven Tab manuell im UI, da switchToTab evtl. den Type nicht kennt
            const tabs = document.querySelectorAll('.tab');
            tabs.forEach(t => t.classList.remove('active'));
            const refTab = Array.from(tabs).find(t => t.innerText.includes('Reference'));
            if (refTab) refTab.classList.add('active');
        }

        // Inhalt laden
        const container = document.getElementById('reference-content');
        if (!this.cachedData) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading definitions...</div>';
            try {
                const text = await this.fetchDefinitions();
                this.cachedData = this.parseDefinitions(text);
                this.renderUI(this.cachedData, container);
            } catch (e) {
                container.innerHTML = `<div style="padding:20px; color:var(--danger);">Failed to load definitions: ${e.message}</div>`;
            }
        } else {
            // Falls schon gerendert, nichts tun (DOM bleibt erhalten)
            if (container.innerHTML === '') this.renderUI(this.cachedData, container);
        }
    },

    injectUI() {
        if (document.getElementById('reference-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'reference-wrapper';
        wrapper.className = 'hidden'; // Start hidden
        wrapper.style.display = 'flex';
        wrapper.style.height = '100%';
        wrapper.style.width = '100%';
        wrapper.style.overflow = 'hidden';
        wrapper.style.backgroundColor = '#1e1e1e';

        wrapper.innerHTML = `
            <div id="reference-content" style="flex: 1; display: flex; height: 100%; overflow: hidden;">
                <!-- Content injected here -->
            </div>
        `;

        const section = document.getElementById('editor-section');
        if (section && section.parentNode) {
            section.parentNode.insertBefore(wrapper, section.nextSibling);
        }
    },

    async fetchDefinitions() {
        const res = await fetch('/types/ha-api.d.ts');
        if (!res.ok) throw new Error(res.statusText);
        return await res.text();
    },

    parseDefinitions(dtsText) {
        const definitions = [];
        
        const cleanDoc = (doc) => {
            if (!doc) return '';
            return doc.replace(/\/\*\*|\*\/|\*/g, '').split('\n').map(l => l.trim()).filter(l => l).join('\n');
        };

        // 1. Parse Interface HA methods
        const haInterfaceMatch = dtsText.match(/interface HA \{([\s\S]*?)\}/);
        if (haInterfaceMatch) {
            const body = haInterfaceMatch[1];
            const methodRegex = /(?:\/\*\*([\s\S]*?)\*\/)?\s*(\w+)(?:<[^>]+>)?\(([^)]*)\):\s*([^;]+);/g;
            let match;
            while ((match = methodRegex.exec(body)) !== null) {
                definitions.push({
                    name: `ha.${match[2]}`,
                    doc: cleanDoc(match[1]),
                    params: match[3],
                    ret: match[4].trim(),
                    type: 'method'
                });
            }

            // Special handling for 'store' object
            const storeMatch = body.match(/store:\s*\{([\s\S]*?)\};/);
            if (storeMatch) {
                const storeBody = storeMatch[1];
                while ((match = methodRegex.exec(storeBody)) !== null) {
                    definitions.push({
                        name: `ha.store.${match[2]}`,
                        doc: cleanDoc(match[1]),
                        params: match[3],
                        ret: match[4].trim(),
                        type: 'method'
                    });
                }
            }
        }

        // 2. Parse Global Functions
        const globalRegex = /(?:\/\*\*([\s\S]*?)\*\/)?\s*declare function\s+(\w+)\(([^)]*)\):\s*([^;]+);/g;
        let globalMatch;
        while ((globalMatch = globalRegex.exec(dtsText)) !== null) {
            definitions.push({
                name: globalMatch[2],
                doc: cleanDoc(globalMatch[1]),
                params: globalMatch[3],
                ret: globalMatch[4].trim(),
                type: 'function'
            });
        }

        // 3. Parse Types & Interfaces (excluding HA)
        const typeRegex = /type\s+(\w+)\s*=\s*([^;]+);/g;
        let typeMatch;
        while ((typeMatch = typeRegex.exec(dtsText)) !== null) {
            definitions.push({
                name: typeMatch[1],
                doc: '',
                params: typeMatch[2].trim(),
                ret: 'type',
                type: 'typedef'
            });
        }

        const interfaceRegex = /interface\s+(\w+)(?:<[^>]+>)?\s*\{([\s\S]*?)\}/g;
        let intMatch;
        while ((intMatch = interfaceRegex.exec(dtsText)) !== null) {
            if (intMatch[1] === 'HA') continue; // Skip main HA interface
            definitions.push({
                name: intMatch[1],
                doc: '',
                params: intMatch[2].trim(),
                ret: 'interface',
                type: 'typedef'
            });
        }

        // 3. Categorize
        const categories = {
            'Logging': ['ha.log', 'ha.warn', 'ha.error', 'ha.debug'],
            'Events & Triggers': ['ha.on', 'ha.onStop', 'schedule'],
            'State Management': ['ha.getState', 'ha.update', 'ha.register', 'ha.getAttr', 'ha.getStateValue'],
            'Services': ['ha.callService'],
            'Data Store': ['ha.store'],
            'Utilities': ['sleep', 'axios', 'ha.getHeader', 'ha.getGroupMembers'],
            'Selectors': ['ha.select'],
            'Types & Interfaces': ['HAAttributes', 'HAState', 'EntitySelector', 'ServiceMap', 'ChangeFilter', 'EntityID']
        };

        const result = {};
        definitions.forEach(def => {
            let cat = 'Other';
            
            if (def.type === 'typedef') {
                cat = 'Types & Interfaces';
            } else {
            for (const [c, keywords] of Object.entries(categories)) {
                if (keywords.some(k => def.name === k || def.name.startsWith(k))) {
                    cat = c;
                    break;
                }
            }
            }
            
            if (!result[cat]) result[cat] = [];
            result[cat].push(def);
        });

        return result;
    },

    renderUI(data, container) {
        let html = `<div class="ref-container">`;
        html += `<div class="ref-sidebar">`;
        Object.keys(data).forEach(cat => html += `<a href="#cat-${cat.replace(/\s+/g, '-')}" class="ref-link">${cat}</a>`);
        html += `</div><div class="ref-content">`;
        
        Object.entries(data).forEach(([cat, items]) => {
            html += `<div id="cat-${cat.replace(/\s+/g, '-')}" class="ref-category"><h2>${cat}</h2>`;
            items.forEach(item => {
                if (item.type === 'typedef') {
                    // Rendering für Typen/Interfaces
                    html += `
                    <div class="ref-item ref-type-item">
                        <div class="ref-header">
                            <span class="ref-keyword">${item.ret}</span> <span class="ref-name">${item.name}</span>
                        </div>
                        <pre class="ref-type-body">${item.params}</pre>
                    </div>`;
                } else {
                    // Rendering für Funktionen/Methoden
                    const snippet = this.generateSnippet(item.name, item.params);
                    html += `
                    <div class="ref-item">
                        <button class="ref-copy-btn" onclick="copyRefSnippet(this, '${snippet.replace(/'/g, "\\'")}')" title="Copy Snippet">
                            <i class="mdi mdi-content-copy"></i>
                        </button>
                        <div class="ref-header">
                            <span class="ref-name">${item.name}</span><span class="ref-params">(${item.params})</span><span class="ref-return">: ${item.ret}</span>
                        </div>
                        <div class="ref-doc">${item.doc.replace(/\n/g, '<br>')}</div>
                    </div>`;
                }
            });
            html += `</div>`;
        });
        html += `</div></div>`;
        container.innerHTML = html;
    },

    generateSnippet(name, params) {
        // Simple heuristic to generate a usable snippet
        // e.g. "message: any" -> "message"
        const cleanParams = params.split(',').map(p => {
            const parts = p.split(':');
            return parts[0].trim().replace(/\?$/, ''); // remove optional marker
        }).filter(p => p).join(', ');
        
        return `${name}(${cleanParams});`;
    }
};

window.openReferenceTab = () => referenceManager.open();

window.copyRefSnippet = (btn, code) => {
    navigator.clipboard.writeText(code);
    const icon = btn.querySelector('i');
    const originalClass = icon.className;
    
    icon.className = 'mdi mdi-check';
    btn.style.color = 'var(--success)';
    
    setTimeout(() => {
        icon.className = originalClass;
        btn.style.color = '';
    }, 1500);
};