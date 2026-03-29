/**
 * JS AUTOMATIONS - Unified Creation Wizard
 * Handles the creation, upload, and import of scripts.
 */

// Templates definition
const SCRIPT_TEMPLATES = {
    'empty': {
        labelKey: 'template_empty',
        code: 'const scriptName=ha.getHeader("name");\nha.log(`\'${scriptName}\' started...`);\n'
    },
    'interval': {
        labelKey: 'template_interval',
        code: `ha.log("Starting Interval Script");\n\nsetInterval(() => {\n    ha.log("Tick...");\n}, 60000);`
    },
    'trigger': {
        labelKey: 'template_trigger',
        code: `ha.log("Waiting for trigger...");\n\nconst state = ha.states['light.living_room'];\n`
    }
};

let currentWizardTab = 'new';
let wizardMode = 'create'; // 'create', 'edit', 'duplicate'
let wizardOriginalFilename = null; // Für Edit-Mode
let wizardDuplicateCode = null; // Für Duplicate-Mode
let wizardNpmModules = [];
let wizardIncludes = [];

function injectCreationWizard() {
    if (document.getElementById('creation-wizard-modal')) return;

    const css = `
    <style>
        /* Wizard specific overrides */
        .wizard-content .form-group { margin-bottom: 20px; }
        .wizard-tabs { display: flex; border-bottom: 1px solid #444; margin-bottom: 20px; }
        .wizard-tab { background: none; border: none; color: #888; padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; }
        .wizard-tab.active { color: var(--primary-color, #03a9f4); border-bottom-color: var(--primary-color, #03a9f4); font-weight: bold; }
        .wizard-content { min-height: 200px; }
        .drop-zone { border: 2px dashed #444; padding: 40px; text-align: center; color: #888; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        .drop-zone:hover, .drop-zone.dragover { border-color: var(--primary-color, #03a9f4); background: rgba(255,255,255,0.05); color: #fff; }
        .file-info { margin-top: 10px; font-weight: bold; color: #fff; }
        
        .field-hint { color: #666; font-size: 0.85em; margin-left: 5px; font-weight: normal; }
        .wizard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }

        /* Icon Preview adjustment for wizard */
        .icon-preview { font-size: 1.4rem; color: var(--accent); margin-right: 5px; }

        /* Language Badges & Cards */
        .lang-selection-container { display: flex; gap: 8px; margin-top: 4px; }
        .lang-card {
            padding: 4px 12px; background: #222; border: 1px solid #444; border-radius: 4px;
            font-weight: bold; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;
            color: #888; min-width: 45px; text-align: center;
        }
        .lang-card:hover { border-color: #666; color: #ccc; }
        .lang-card.active { color: #fff; }
        .lang-card.active#lang-card-js { border-color: #f7df1e; color: #f7df1e; background: rgba(247, 223, 30, 0.1); }
        .lang-card.active#lang-card-ts { border-color: #3178c6; color: #3178c6; background: rgba(49, 120, 198, 0.1); }
    </style>
    `;
    document.head.insertAdjacentHTML('beforeend', css);

    const html = `
    <div id="creation-wizard-modal" class="modal-overlay hidden">
        <div class="modal" style="width: 500px; max-width: 90vw;">
            <h3 style="margin-top:0;" data-i18n="new_script_title">Neues Skript</h3>
            
            <div class="wizard-tabs">
                <button class="wizard-tab active" onclick="switchWizardTab('new')" data-i18n="wizard_tab_new">Neu</button>
                <button class="wizard-tab" onclick="switchWizardTab('upload')" data-i18n="wizard_tab_upload">Upload</button>
                <button class="wizard-tab" onclick="switchWizardTab('import')" data-i18n="wizard_tab_import">Import</button>
            </div>

            <!-- TAB: NEW -->
            <div id="wizard-tab-new" class="wizard-content">
                <div class="form-group">
                    <label><span data-i18n="script_name">Name</span> <span class="field-hint">(@name)</span></label>
                    <input type="text" id="wizard-name" data-i18n="wizard_placeholder_name" data-i18n-placeholder placeholder="z.B. mein_skript" oninput="checkWizardScriptName()">
                </div>
                
                <div class="wizard-grid">
                    <div class="form-group">
                        <label><span data-i18n="script_type">Typ</span> <span class="field-hint">(@expose)</span> <i class="mdi mdi-information-outline" style="font-size:0.9em; opacity:0.7;" data-i18n="wizard_type_tooltip" data-i18n-title title="Info"></i></label>
                        <select id="wizard-type" onchange="handleWizardTypeChange()">
                            <option value="switch" data-i18n="wizard_option_switch">Schalter (Dauerläufer)</option>
                            <option value="button" data-i18n="wizard_option_button">Button (Aktion)</option>
                            <option value="hidden" data-i18n="wizard_option_hidden">Hintergrund (Unsichtbar)</option>
                            <option value="library" data-i18n="wizard_option_library">Library (Wird von anderen importiert)</option>
                        </select>
                    </div>
                    <div class="form-group hidden" id="wizard-group-template">
                        <label><span data-i18n="wizard_label_template">Template</span></label>
                        <select id="wizard-template">
                            ${Object.keys(SCRIPT_TEMPLATES).map(k => `<option value="${k}" data-i18n="${SCRIPT_TEMPLATES[k].labelKey}">${i18next.t(SCRIPT_TEMPLATES[k].labelKey)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" id="wizard-group-language">
                        <label><span data-i18n="wizard_label_language">Sprache</span></label>
                        <div class="lang-selection-container">
                            <div class="lang-card active" onclick="selectWizardLanguage('.js')" id="lang-card-js">JS</div>
                            <div class="lang-card" onclick="selectWizardLanguage('.ts')" id="lang-card-ts">TS</div>
                        </div>
                        <input type="hidden" id="wizard-language" value=".js">
                    </div>
                </div>

                <div class="wizard-grid">
                    <div class="form-group">
                        <label><span data-i18n="script_icon">Icon</span> <span class="field-hint">(@icon)</span></label>
                        <div class="icon-input-container">
                            <i id="wizard-icon-preview" class="mdi mdi-script-text icon-preview"></i>
                            <input type="text" id="wizard-icon" list="mdi-suggestions" data-i18n="wizard_placeholder_icon" data-i18n-placeholder placeholder="mdi:flash" oninput="updateWizardIconPreview(this.value)" style="border:none !important;">
                        </div>
                        <datalist id="mdi-suggestions"></datalist>
                    </div>
                    <div class="form-group">
                        <label><span data-i18n="script_area">Bereich</span> <span class="field-hint">(@area)</span></label>
                        <input type="text" id="wizard-area" list="wizard-areas" placeholder="Wohnzimmer">
                        <datalist id="wizard-areas"></datalist>
                    </div>
                </div>

                <div class="wizard-grid">
                    <div class="form-group">
                        <label><span data-i18n="script_label">Label</span> <span class="field-hint">(@label)</span></label>
                        <input type="text" id="wizard-label" list="wizard-labels" placeholder="Licht">
                        <datalist id="wizard-labels"></datalist>
                    </div>
                    <div class="form-group">
                        <label><span data-i18n="script_log_level">Log Level</span> <span class="field-hint">(@loglevel)</span></label>
                        <select id="wizard-loglevel">
                            <option value="debug" data-i18n="log_level_debug">Debug</option>
                            <option value="info" selected data-i18n="log_level_info">Info</option>
                            <option value="warn" data-i18n="log_level_warn">Warn</option>
                            <option value="error" data-i18n="log_level_error">Error</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label><span data-i18n="script_description">Beschreibung</span> <span class="field-hint">(@description)</span></label>
                    <textarea id="wizard-description" rows="2" data-i18n="description_placeholder" data-i18n-placeholder placeholder="..."></textarea>
                </div>

                <div class="form-group">
                    <label><span data-i18n="npm_packages">NPM Packages</span> <span class="field-hint">(@npm)</span></label>
                    <div class="npm-tags-input" onclick="document.getElementById('wizard-npm-input').focus()">
                        <div id="wizard-npm-list" style="display:contents"></div>
                        <input type="text" id="wizard-npm-input" data-i18n="npm_packages_placeholder" data-i18n-placeholder placeholder="Add package..." onkeydown="handleWizardTagInput(event, 'npm')">
                    </div>
                </div>

                <div class="form-group">
                    <label><span data-i18n="global_libraries">Global Libraries</span> <span class="field-hint">(@include)</span></label>
                    <div class="npm-tags-input" onclick="document.getElementById('wizard-includes-input').focus()">
                        <div id="wizard-includes-list" style="display:contents"></div>
                        <input type="text" id="wizard-includes-input" list="wizard-includes-suggestions" data-i18n="add_library_placeholder" data-i18n-placeholder placeholder="Add library..." onkeydown="handleWizardTagInput(event, 'includes')">
                        <datalist id="wizard-includes-suggestions"></datalist>
                    </div>
                </div>
            </div>

            <!-- TAB: UPLOAD -->
            <div id="wizard-tab-upload" class="wizard-content hidden">
                <div class="wizard-grid">
                    <div class="form-group">
                        <label data-i18n="wizard_label_target_type">Ziel-Typ</label>
                        <select id="wizard-upload-type">
                            <option value="automation" data-i18n="type_automation">Automation</option>
                            <option value="library" data-i18n="type_library">Library</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label data-i18n="script_name">Name</label>
                        <input type="text" id="wizard-upload-name" data-i18n="wizard_placeholder_optional_name" data-i18n-placeholder placeholder="Optional: Skriptname">
                    </div>
                </div>
                <div class="drop-zone" id="wizard-dropzone" onclick="document.getElementById('wizard-file-input').click()">
                    <i class="mdi mdi-cloud-upload" style="font-size: 48px;"></i>
                    <p data-i18n="wizard_dropzone_text">Datei hier ablegen oder klicken</p>
                    <input type="file" id="wizard-file-input" accept=".js,.ts" style="display:none" onchange="handleFileSelect(this)">
                    <div id="wizard-file-name" class="file-info"></div>
                </div>
            </div>

            <!-- TAB: IMPORT -->
            <div id="wizard-tab-import" class="wizard-content hidden">
                <div class="wizard-grid">
                    <div class="form-group">
                        <label data-i18n="wizard_label_target_type">Ziel-Typ</label>
                        <select id="wizard-import-type">
                            <option value="automation" data-i18n="type_automation">Automation</option>
                            <option value="library" data-i18n="type_library">Library</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label data-i18n="script_name">Name</label>
                        <input type="text" id="wizard-import-name" data-i18n="wizard_placeholder_optional_name" data-i18n-placeholder placeholder="Optional: Skriptname">
                    </div>
                </div>
                <div class="form-group">
                    <label data-i18n="wizard_label_url">URL (Raw GitHub / Gist)</label>
                    <input type="text" id="wizard-url" data-i18n="wizard_placeholder_url" data-i18n-placeholder placeholder="https://gist.githubusercontent.com/..." oninput="handleImportUrlInput()">
                    <small style="color:#666; display:block; margin-top:5px;" data-i18n="wizard_url_hint">Die URL muss direkt auf den Raw-Content (.js) zeigen.</small>
                    <div style="color:var(--danger, #f44336); display:flex; align-items:center; gap: 8px; margin-top:15px; padding: 8px; background: rgba(244, 67, 54, 0.1); border-radius: 4px;">
                        <i class="mdi mdi-alert" style="font-size: 1.2rem;"></i>
                        <small data-i18n="wizard_import_warning">Achtung: Importiere nur Code aus vertrauenswürdigen Quellen.</small>
                    </div>
                </div>
            </div>

            <div class="modal-btns">
                <div id="wizard-modal-error" class="modal-error"></div>
                <button id="btn-wizard-action" class="btn-primary" onclick="executeWizardAction()" data-i18n="button_create">Erstellen</button>
                <button class="btn-text" onclick="closeCreationWizard()" data-i18n="button_cancel">Abbrechen</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Drag & Drop Events
    const dropZone = document.getElementById('wizard-dropzone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            document.getElementById('wizard-file-input').files = e.dataTransfer.files;
            handleFileSelect(document.getElementById('wizard-file-input'));
        }
    });
}

async function openCreationWizard(mode = 'create', data = null) {
    injectCreationWizard();
    // The modal is now in the DOM, translate its contents
    if (window.updateUIWithTranslations) window.updateUIWithTranslations(document.getElementById('creation-wizard-modal'));

    const modal = document.getElementById('creation-wizard-modal');
    modal.classList.remove('hidden');
    
    wizardMode = mode;
    wizardOriginalFilename = null;
    wizardDuplicateCode = null;
    
    // Reset fields
    document.getElementById('wizard-name').value = '';

    // Fix: Detect extension from existing data if editing or duplicating to preserve TS status
    const initialExt = (data && data.filename && data.filename.endsWith('.ts')) ? '.ts' : '.js';
    selectWizardLanguage(initialExt);

    document.getElementById('wizard-icon').value = '';
    updateWizardIconPreview('');
    document.getElementById('wizard-area').value = '';
    document.getElementById('wizard-label').value = '';
    document.getElementById('wizard-description').value = '';
    document.getElementById('wizard-loglevel').value = 'info';
    document.getElementById('wizard-url').value = '';
    document.getElementById('wizard-file-name').textContent = '';
    document.getElementById('wizard-file-input').value = '';
    document.getElementById('wizard-upload-name').value = '';
    document.getElementById('wizard-import-name').value = '';
    
    // Reset Tags
    wizardNpmModules = [];
    wizardIncludes = [];
    renderWizardTags('npm');
    renderWizardTags('includes');

    // UI Anpassungen je nach Mode
    const tabs = document.querySelector('.wizard-tabs');
    const templateGroup = document.getElementById('wizard-group-template');
    const languageGroup = document.getElementById('wizard-group-language');
    const title = modal.querySelector('h3');
    const btn = document.getElementById('btn-wizard-action');

    if (mode === 'create') {
        tabs.style.display = 'flex';
        if (templateGroup) templateGroup.style.display = 'none'; // Keep templates hidden
        if (languageGroup) languageGroup.style.display = 'block';
        title.textContent = i18next.t('new_script_title');
        btn.textContent = i18next.t('button_create');
        switchWizardTab('new');
    } else {
        // Edit oder Duplicate
        tabs.style.display = 'none'; // Keine Tabs (Upload/Import macht hier keinen Sinn)
        if (templateGroup) templateGroup.style.display = 'none'; // Template Auswahl verstecken
        if (languageGroup) languageGroup.style.display = 'none'; // Sprach Auswahl verstecken
        switchWizardTab('new'); // Erzwinge den Formular-Tab

        if (mode === 'edit') {
            title.textContent = i18next.t('modal_edit_script_title');
            btn.textContent = i18next.t('save_title');
            wizardOriginalFilename = data.filename;
        } else {
            title.textContent = i18next.t('modal_duplicate_script_title');
            btn.textContent = i18next.t('button_duplicate');
            wizardDuplicateCode = data.code;
        }

        // Felder befüllen
        document.getElementById('wizard-name').value = mode === 'duplicate' ? (data.name + ' (Copy)') : data.name;
        
        // Typ Mapping für Edit Mode
        let typeVal = 'hidden';
        if (data.path && data.path.includes('libraries')) typeVal = 'library';
        else if (data.expose === 'switch') typeVal = 'switch';
        else if (data.expose === 'button') typeVal = 'button';
        document.getElementById('wizard-type').value = typeVal;

        document.getElementById('wizard-icon').value = data.icon || '';
        updateWizardIconPreview(data.icon);
        document.getElementById('wizard-area').value = data.area || '';
        document.getElementById('wizard-label').value = data.label || '';
        document.getElementById('wizard-loglevel').value = data.loglevel || 'info';
        document.getElementById('wizard-description').value = data.description || '';

        if (data.dependencies) data.dependencies.forEach(d => addWizardNpmTag(d));
        if (data.includes) data.includes.forEach(i => { if (!wizardIncludes.includes(i)) wizardIncludes.push(i); });
        renderWizardTags('includes');
    }

    // Validation triggern (nach dem Befüllen)
    checkWizardScriptName();

    // Populate Datalists (Area/Label)
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const { areas, labels } = await res.json();
            
            document.getElementById('wizard-areas').innerHTML = areas.map(a => `<option value="${a.name}">`).join('');
            document.getElementById('wizard-labels').innerHTML = labels.map(l => `<option value="${l.name}">`).join('');
        }
    } catch (e) {
        console.warn("Failed to load suggestions", e);
    }
    updateWizardLibrarySuggestions();

    // Populate MDI Icons Datalist (from global mdiIcons array)
    if (typeof mdiIcons !== 'undefined' && mdiIcons.length > 0) {
        const dl = document.getElementById('mdi-suggestions');
        if (dl) dl.innerHTML = mdiIcons.map(i => `<option value="mdi:${i}">`).join('');
    }
}

function updateWizardLibrarySuggestions() {
    const datalist = document.getElementById('wizard-includes-suggestions');
    if (!datalist) return;
    datalist.innerHTML = '';
    
    if (typeof allScripts === 'undefined') return;

    const libs = allScripts.filter(s => s.path && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\')));
    libs.forEach(lib => {
        const opt = document.createElement('option');
        opt.value = lib.filename;
        datalist.appendChild(opt);
    });
}

function closeCreationWizard() {
    document.getElementById('creation-wizard-modal').classList.add('hidden');
}

function switchWizardTab(tab) {
    currentWizardTab = tab;
    document.querySelectorAll('.wizard-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.wizard-tab[onclick="switchWizardTab('${tab}')"]`).classList.add('active');
    document.querySelectorAll('.wizard-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`wizard-tab-${tab}`).classList.remove('hidden');
    
    const btn = document.getElementById('btn-wizard-action');
    if (tab === 'new') btn.textContent = i18next.t('button_create');
    if (tab === 'upload') btn.textContent = i18next.t('wizard_btn_upload');
    if (tab === 'import') btn.textContent = i18next.t('wizard_btn_import');
    
    validateWizardState();
}

function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        document.getElementById('wizard-file-name').textContent = input.files[0].name;
        // Auto-fill name input
        const nameInput = document.getElementById('wizard-upload-name');
        if (nameInput && !nameInput.value) {
            nameInput.value = input.files[0].name.replace(/\.(js|ts)$/i, '');
        }
    }
    validateWizardState();
}

function handleImportUrlInput() {
    const url = document.getElementById('wizard-url').value;
    const nameInput = document.getElementById('wizard-import-name');
    if (url && !nameInput.value) {
        try {
            // Improved extraction: handles Gist raw URLs better
            const parts = url.split('/');
            const lastPart = parts.pop() || parts.pop(); // Handle trailing slashes
            const basename = lastPart.split('?')[0];
            if (basename && basename !== 'raw') {
                nameInput.value = basename.replace(/\.(js|ts)$/i, '');
            }
        } catch (e) { }
    }
    validateWizardState(); // Trigger validation
}

function handleWizardTagInput(e, type) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
            if (type === 'npm') addWizardNpmTag(val);
            if (type === 'includes' && !wizardIncludes.includes(val)) {
                wizardIncludes.push(val);
                renderWizardTags('includes');
            }
            e.target.value = '';
        }
    } else if (e.key === 'Backspace' && e.target.value === '') {
        if (type === 'npm' && wizardNpmModules.length > 0) {
            wizardNpmModules.pop();
            renderWizardTags('npm');
        }
        if (type === 'includes' && wizardIncludes.length > 0) {
            wizardIncludes.pop();
            renderWizardTags('includes');
        }
    }
}

function addWizardNpmTag(pkgName) {
    if (wizardNpmModules.some(p => p.name === pkgName)) return;
    const pkg = { name: pkgName, status: 'loading' };
    wizardNpmModules.push(pkg);
    renderWizardTags('npm');
    validateWizardNpmPackage(pkg);
}

async function validateWizardNpmPackage(pkg) {
    let cleanName = pkg.name;
    const lastAt = cleanName.lastIndexOf('@');
    if (lastAt > 0) cleanName = cleanName.substring(0, lastAt);

    try {
        const res = await apiFetch(`api/npm/check/${encodeURIComponent(cleanName)}`);
        const data = await res.json();
        pkg.status = data.ok ? 'valid' : 'invalid';
        pkg.error = data.ok ? null : (data.error || 'Unknown error');
    } catch (e) {
        pkg.status = 'invalid';
        pkg.error = 'Backend connection failed';
    }
    renderWizardTags('npm');
}

function removeWizardTag(type, value) {
    if (type === 'npm') wizardNpmModules = wizardNpmModules.filter(x => x.name !== value);
    if (type === 'includes') wizardIncludes = wizardIncludes.filter(x => x !== value);
    renderWizardTags(type);
}

function renderWizardTags(type) {
    if (type === 'npm') {
        const container = document.getElementById('wizard-npm-list');
        if (!container) return;
        container.innerHTML = wizardNpmModules.map(pkg => {
            let statusClass = pkg.status; // loading, valid, invalid
            let icon = '';
            if (statusClass === 'loading') icon = '<i class="mdi mdi-loading mdi-spin"></i>';
            else if (statusClass === 'valid') icon = '<i class="mdi mdi-check"></i>';
            else if (statusClass === 'invalid') icon = '<i class="mdi mdi-alert-circle-outline"></i>';
            
            return `
                <div class="npm-tag ${statusClass}" title="${pkg.error || ''}">
                    ${icon}
                    <span>${pkg.name}</span>
                    <span class="npm-tag-close" onclick="removeWizardTag('npm', '${pkg.name}')">&times;</span>
                </div>
            `;
        }).join('');
    } else { // includes
        const container = document.getElementById('wizard-includes-list');
        if (!container) return;
        container.innerHTML = wizardIncludes.map(libName => {
            const script = typeof allScripts !== 'undefined' ? allScripts.find(s => s.filename === libName || s.filename === libName + '.js') : null;
            const statusClass = script ? 'valid' : 'invalid';
            let iconName = 'book-open-variant';
            if (script && script.icon) {
                const customIcon = script.icon.split(':').pop();
                if (typeof mdiIcons === 'undefined' || mdiIcons.length === 0 || mdiIcons.includes(customIcon)) {
                    iconName = customIcon;
                }
            }
            const icon = `<i class="mdi mdi-${iconName}"></i>`;

            return `
                <div class="npm-tag ${statusClass}">
                    ${icon}
                    <span>${libName}</span>
                    <span class="npm-tag-close" onclick="removeWizardTag('includes', '${libName}')">&times;</span>
                </div>
            `;
        }).join('');
    }
}

function updateWizardIconPreview(val) {
    const el = document.getElementById('wizard-icon-preview');
    const icon = val ? val.split(':').pop() : 'script-text';
    if (el) el.className = `mdi mdi-${icon} icon-preview`;
}

function handleWizardTypeChange() {
    const type = document.getElementById('wizard-type').value;
    const iconInput = document.getElementById('wizard-icon');
    
    if (type === 'library') {
        iconInput.value = 'mdi:book-open-variant';
    } else {
        if (iconInput.value === 'mdi:book-open-variant' || !iconInput.value) {
            iconInput.value = 'mdi:script-text';
        }
    }
    updateWizardIconPreview(iconInput.value);
}

/**
 * Updates the visual selection of language cards and sets the hidden input value.
 */
function selectWizardLanguage(ext) {
    document.getElementById('wizard-language').value = ext;
    document.querySelectorAll('.lang-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`lang-card-${ext.substring(1)}`);
    if (card) card.classList.add('active');
    checkWizardScriptName();
}

function checkWizardScriptName() {
    const nameInput = document.getElementById('wizard-name');
    const errEl = document.getElementById('wizard-modal-error');
    const createBtn = document.getElementById('btn-wizard-action');

    const name = nameInput.value.trim();
    if (!name) {
        if (errEl) errEl.textContent = '';
        if (createBtn) createBtn.disabled = true;
        return;
    }
    const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const ext = document.getElementById('wizard-language').value || '.js';
    const filename = slug + ext;

    // Im Edit-Modus ist der eigene Dateiname erlaubt (keine Änderung)
    if (wizardMode === 'edit' && filename === wizardOriginalFilename) {
        if (errEl) errEl.textContent = '';
        if (createBtn) createBtn.disabled = false;
        return;
    }

    const exists = typeof allScripts !== 'undefined' && allScripts.some(s => s.filename === filename);
    if (errEl) errEl.textContent = exists ? i18next.t('error_file_exists', { filename }) : '';
    if (createBtn) createBtn.disabled = exists;
}

function validateWizardState() {
    const btn = document.getElementById('btn-wizard-action');
    if (!btn) return;

    if (currentWizardTab === 'new') {
        checkWizardScriptName();
    } else if (currentWizardTab === 'upload') {
        const fileInput = document.getElementById('wizard-file-input');
        btn.disabled = !fileInput.files || !fileInput.files[0];
        const errEl = document.getElementById('wizard-modal-error');
        if (errEl) errEl.textContent = '';
    } else if (currentWizardTab === 'import') {
        const urlInput = document.getElementById('wizard-url');
        btn.disabled = !urlInput.value || !urlInput.value.trim();
        const errEl = document.getElementById('wizard-modal-error');
        if (errEl) errEl.textContent = '';
    }
}

async function executeWizardAction() {
    const btn = document.getElementById('btn-wizard-action');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    let newFilename = null; // To store the filename of the created script

    try {
        if (currentWizardTab === 'new') {
            const name = document.getElementById('wizard-name').value.trim();
            const wizardType = document.getElementById('wizard-type').value;
            const icon = document.getElementById('wizard-icon').value.trim();
            const templateKey = document.getElementById('wizard-template').value;
            const extension = document.getElementById('wizard-language').value;
            const area = document.getElementById('wizard-area').value.trim();
            const label = document.getElementById('wizard-label').value.trim();
            const loglevel = document.getElementById('wizard-loglevel').value;
            const description = document.getElementById('wizard-description').value.trim();

            // Mapping Wizard Type -> Backend Fields
            let type = 'automation';
            let expose = null;
            if (wizardType === 'switch') { expose = 'switch'; }
            else if (wizardType === 'button') { expose = 'button'; }
            else if (wizardType === 'library') { type = 'library'; }
            // hidden: type=automation, expose=null

            const npmInput = document.getElementById('wizard-npm-input');
            if (npmInput && npmInput.value.trim()) {
                addWizardNpmTag(npmInput.value.trim());
                npmInput.value = '';
            }
            const includesInput = document.getElementById('wizard-includes-input');
            if (includesInput && includesInput.value.trim() && !wizardIncludes.includes(includesInput.value.trim())) {
                wizardIncludes.push(includesInput.value.trim());
                renderWizardTags('includes');
                includesInput.value = '';
            }

            if (!name) throw new Error(i18next.t('error_wizard_name_required'));
            
            // Payload bauen
            const payload = { name, type, expose, icon, area, label, loglevel, description, extension, npmModules: wizardNpmModules.map(p => p.name), includes: wizardIncludes };

            if (wizardMode === 'edit') {
                // UPDATE
                const res = await apiFetch(`api/scripts/${wizardOriginalFilename}/metadata`, { 
                    method: 'PUT', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(payload) 
                });
                if (!res.ok) { const err = await res.json(); throw new Error(err.error || i18next.t('error_update_failed', { defaultValue: 'Update failed' })); }
                const data = await res.json();
                newFilename = data.filename;

                // Handle Rename Side-Effects (Tabs aktualisieren)
                if (wizardOriginalFilename && newFilename && wizardOriginalFilename !== newFilename) {
                    if (typeof openTabs !== 'undefined') {
                        const tab = openTabs.find(t => t.filename === wizardOriginalFilename);
                        if (tab) tab.filename = newFilename;
                    }
                    if (typeof activeTabFilename !== 'undefined' && activeTabFilename === wizardOriginalFilename) {
                        activeTabFilename = newFilename;
                    }
                    if (typeof renderTabs === 'function') renderTabs();
                }

                // FIX: Editor-Inhalt aktualisieren, damit der neue Header sichtbar wird
                if (typeof openTabs !== 'undefined') {
                    const tab = openTabs.find(t => t.filename === newFilename);
                    if (tab && tab.model) {
                        // Cache-Busting: Zeitstempel anhängen, damit Browser nicht cached
                        const cRes = await apiFetch(`api/scripts/${newFilename}/content?_t=${Date.now()}`);
                        if (cRes.ok) {
                            const cData = await cRes.json();
                            tab.model.setValue(cData.content);
                            tab.originalContent = cData.content;
                            tab.isDirty = false;
                        }
                    }
                }
            } else {
                // CREATE or DUPLICATE
                payload.code = (wizardMode === 'duplicate' && wizardDuplicateCode) ? wizardDuplicateCode : (SCRIPT_TEMPLATES['empty'] ? SCRIPT_TEMPLATES['empty'].code : '');
                
                const res = await apiFetch('api/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!res.ok) { const err = await res.json(); throw new Error(err.error || i18next.t('error_create_failed', { defaultValue: 'Creation failed' })); }
                const data = await res.json();
                newFilename = data.filename;
            }
        } else if (currentWizardTab === 'upload') {
            const fileInput = document.getElementById('wizard-file-input');
            const type = document.getElementById('wizard-upload-type').value;
            const name = document.getElementById('wizard-upload-name').value.trim();
            if (!fileInput.files || !fileInput.files[0]) throw new Error(i18next.t('error_wizard_no_file'));
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('type', type);
            if (name) formData.append('name', name);
            const res = await fetch('api/scripts/upload', { method: 'POST', body: formData });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || i18next.t('wizard_btn_upload') + ' fehlgeschlagen'); }
            const data = await res.json();
            newFilename = data.filename;
        } else if (currentWizardTab === 'import') {
            const url = document.getElementById('wizard-url').value.trim();
            const type = document.getElementById('wizard-import-type').value;
            const name = document.getElementById('wizard-import-name').value.trim();
            if (!url) throw new Error(i18next.t('error_wizard_url_required'));
            const res = await apiFetch('api/scripts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, type, name }) });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || i18next.t('error_import_failed', { defaultValue: 'Import failed' })); }
            const data = await res.json();
            newFilename = data.filename;
        }
        closeCreationWizard();
        if (window.loadScripts) await window.loadScripts(); // Await to ensure list is updated
        
        if (newFilename && (window.openOrSwitchToTab || window.openTab)) {
            // Find the newly created script in the updated list to get its parsed icon
            const newScript = (typeof allScripts !== 'undefined') ? allScripts.find(s => s.filename === newFilename) : null;
            const icon = newScript ? newScript.icon : 'mdi:script-text';
            if (window.openOrSwitchToTab) {
                window.openOrSwitchToTab(newFilename, icon);
                
                // Wenn wir im Edit-Modus waren, aktualisieren wir auch das Icon im Tab sofort
                if (wizardMode === 'edit') {
                    const tab = openTabs.find(t => t.filename === newFilename);
                    if (tab) {
                        tab.icon = icon;
                        if (typeof renderTabs === 'function') renderTabs();
                        // Toolbar aktualisieren falls aktiv
                        if (typeof activeTabFilename !== 'undefined' && activeTabFilename === newFilename && typeof updateToolbarUI === 'function') {
                            updateToolbarUI(newFilename, icon, tab.isDirty);
                        }
                    }
                }
            } else {
                window.openTab(newFilename);
            }
        }
    } catch (e) { alert(i18next.t('error_create_failed') + ": " + e.message); } finally { btn.disabled = false; btn.textContent = originalText; }
}

window.openCreationWizard = openCreationWizard;
window.handleWizardTagInput = handleWizardTagInput;
window.removeWizardTag = removeWizardTag;
window.updateWizardIconPreview = updateWizardIconPreview;
window.handleWizardTypeChange = handleWizardTypeChange;
window.checkWizardScriptName = checkWizardScriptName;
window.validateWizardState = validateWizardState;
window.handleImportUrlInput = handleImportUrlInput;
window.selectWizardLanguage = selectWizardLanguage;