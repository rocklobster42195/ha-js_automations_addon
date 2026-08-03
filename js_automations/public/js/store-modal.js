/**
 * JS AUTOMATIONS - Store Item Modal
 * Handles the "System: Store" tab's opening (tab lifecycle) and its
 * create/edit modal. The table/toolbar itself is the <store-explorer> LIT
 * component (js/components/store-explorer.ts); this file is the remaining
 * vanilla page-level overlay, until it becomes its own <store-item-modal>
 * LIT component (RFC Phase A item 6).
 */

const STORE_TAB_ID = 'System: Store';

// Öffnet den Store-Tab oder wechselt dorthin
function openStoreTab() {
  console.log('Opening Store Tab...');

  // FIX: Haupt-Container sichtbar machen (falls noch keine Tabs offen waren)
  const section = document.getElementById('editor-section');
  if (section) section.classList.remove('hidden');

  // Prüfen, ob Tab schon existiert
  const existing = openTabs.find((t) => t.filename === STORE_TAB_ID);
  if (!existing) {
    openTabs.push({
      filename: STORE_TAB_ID,
      icon: 'mdi:database-search',
      isDirty: false,
      type: 'store', // Markierung für switchToTab
      model: null, // Kein Monaco Model
    });
  }

  injectStoreModal(); // Sicherstellen, dass das Modal da ist
  if (window.renderTabs) window.renderTabs();
  if (window.switchToTab) window.switchToTab(STORE_TAB_ID);
}

async function editStoreItem(key) {
  const item = window.storeExplorer?.getItem(key);
  if (!item) return;
  const val = item && typeof item === 'object' && 'value' in item ? item.value : item;
  const isSecret = item.isSecret || false;

  // Value für Editor vorbereiten (JSON Stringify wenn Objekt)
  let valStr = val;
  if (typeof val === 'object') valStr = JSON.stringify(val, null, 2);

  // Typ ermitteln
  let type = typeof val;
  if (val === null) type = 'null';
  else if (Array.isArray(val))
    type = 'object'; // Wir gruppieren Array/Object im UI als JSON
  else if (type === 'object') type = 'json';

  openStoreModal(key, valStr, isSecret, type);
}

function openStoreModal(key = null, value = '', isSecret = false, type = 'string') {
  const modal = document.getElementById('store-modal');
  if (!modal) return;

  const titleEl = document.getElementById('store-modal-title');
  const keyInput = document.getElementById('store-key-input');
  const valInput = document.getElementById('store-value-input');
  const typeSelect = document.getElementById('store-type-input');
  const secretCheck = document.getElementById('store-secret-check');
  const toggleIcon = document.getElementById('store-value-toggle');

  // Reset UI
  modal.classList.remove('hidden');
  valInput.style.webkitTextSecurity = isSecret ? 'disc' : 'none';
  toggleIcon.className = isSecret ? 'mdi mdi-eye' : 'mdi mdi-eye-off';

  // Reset Validation & UI
  [keyInput, valInput].forEach((el) => el.classList.remove('invalid'));
  ['store-key-error', 'store-value-error'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  if (key) {
    // Edit Mode
    titleEl.textContent = i18next.t('store.modal.title_edit');
    keyInput.value = key;
    keyInput.disabled = true; // Key cannot be changed (it's the ID)
  } else {
    // Create Mode
    titleEl.textContent = i18next.t('store.modal.title_new');
    keyInput.value = '';
    keyInput.disabled = false;
  }

  valInput.value = value;
  secretCheck.checked = isSecret;
  if (typeSelect) typeSelect.value = type;

  updateStoreModalUI();
}

function closeStoreModal() {
  document.getElementById('store-modal').classList.add('hidden');
}

function toggleStoreValueVisibility() {
  const input = document.getElementById('store-value-input');
  const icon = document.getElementById('store-value-toggle');
  const isMasked = input.style.webkitTextSecurity === 'disc';

  if (isMasked) {
    input.style.webkitTextSecurity = 'none';
    icon.className = 'mdi mdi-eye-off';
  } else {
    input.style.webkitTextSecurity = 'disc';
    icon.className = 'mdi mdi-eye';
  }
}

function toggleStoreSecretState() {
  const isSecret = document.getElementById('store-secret-check').checked;
  const input = document.getElementById('store-value-input');
  const icon = document.getElementById('store-value-toggle');

  input.style.webkitTextSecurity = isSecret ? 'disc' : 'none';
  icon.className = isSecret ? 'mdi mdi-eye' : 'mdi mdi-eye-off';
}

function updateStoreModalUI() {
  const type = document.getElementById('store-type-input').value;
  const prettifyBtn = document.getElementById('store-value-prettify');
  if (prettifyBtn) {
    prettifyBtn.style.display = type === 'json' ? 'block' : 'none';
  }
  validateStoreValueInput();
}

function validateStoreKeyInput(showEmptyError = false) {
  const keyInput = document.getElementById('store-key-input');
  const errorEl = document.getElementById('store-key-error');
  if (!keyInput || !errorEl) return false;

  const key = keyInput.value.trim();

  if (!key) {
    if (showEmptyError) {
      keyInput.classList.add('invalid');
      errorEl.textContent = i18next.t('store.messages.key_required');
    } else {
      keyInput.classList.remove('invalid');
      errorEl.textContent = '';
    }
    return false;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(key)) {
    keyInput.classList.add('invalid');
    errorEl.textContent = i18next.t('store.messages.error_invalid_key');
    return false;
  }

  if (!keyInput.disabled && window.storeExplorer?.hasKey(key)) {
    keyInput.classList.add('invalid');
    errorEl.textContent = i18next.t('store.messages.error_duplicate_key');
    return false;
  }

  keyInput.classList.remove('invalid');
  errorEl.textContent = '';
  return true;
}

function validateStoreValueInput() {
  const valInput = document.getElementById('store-value-input');
  const typeSelect = document.getElementById('store-type-input');
  const errorEl = document.getElementById('store-value-error');
  if (!valInput || !typeSelect || !errorEl) return true;

  const val = valInput.value.trim();
  const type = typeSelect.value;

  // Nur validieren, wenn Typ JSON ist und etwas im Feld steht
  if (type === 'json' && val) {
    try {
      JSON.parse(val);
      valInput.classList.remove('invalid');
      errorEl.textContent = '';
      return true;
    } catch (e) {
      valInput.classList.add('invalid');
      errorEl.textContent = i18next.t('store.messages.invalid_json', { error: e.message });
      return false;
    }
  }

  valInput.classList.remove('invalid');
  errorEl.textContent = '';
  return true;
}

function prettifyStoreJson() {
  const valInput = document.getElementById('store-value-input');
  const typeSelect = document.getElementById('store-type-input');
  if (!valInput || !typeSelect || typeSelect.value !== 'json') return;

  try {
    const obj = JSON.parse(valInput.value);
    valInput.value = JSON.stringify(obj, null, 2);
    validateStoreValueInput();
  } catch (e) {
    // Falls ungültig, macht validateStoreValueInput() bereits die Fehlermeldung
  }
}

async function saveStoreItemFromModal() {
  if (!validateStoreKeyInput(true) || !validateStoreValueInput()) return;

  const keyInput = document.getElementById('store-key-input');
  const key = keyInput.value.trim();
  let valStr = document.getElementById('store-value-input').value;
  const selectedType = document.getElementById('store-type-input').value;
  const isSecret = document.getElementById('store-secret-check').checked;

  let value = valStr;

  try {
    const isTrimmedEmpty = valStr.trim() === '';

    if (selectedType === 'number') {
      if (isTrimmedEmpty) throw new Error(i18next.t('store.messages.error_number_empty'));
      value = Number(valStr);
      if (isNaN(value)) throw new Error(i18next.t('store.messages.error_invalid_number'));
    } else if (selectedType === 'boolean') {
      if (isTrimmedEmpty) value = false;
      value = valStr.toLowerCase() === 'true' || valStr === '1';
    } else if (selectedType === 'json') {
      const trimmedVal = valStr.trim();
      if (trimmedVal.startsWith('{') || trimmedVal.startsWith('[')) {
        value = JSON.parse(trimmedVal);
      } else {
        throw new Error(i18next.t('store.messages.error_invalid_json_start'));
      }
    }
  } catch (e) {
    alert(i18next.t('store.messages.invalid_json', { error: e.message }));
    return;
  }

  try {
    await apiFetch('api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, isSecret }),
    });
    closeStoreModal();
    // The server echoes this write back via the 'store_changed' socket event, which
    // patches <store-explorer> in place. Only fall back to a full reload if that
    // channel is down.
    window.storeExplorer?.refreshIfSocketDown();
  } catch (e) {
    alert(i18next.t('store.messages.save_error', { error: e.message }));
  }
}

// --- INJECTION HELPER ---
function injectStoreModal() {
  if (document.getElementById('store-modal')) return;

  const modalHtml = `
        <style>
            .form-error-msg {
                color: var(--danger, #f44336);
                font-size: 0.75rem;
                margin-top: 4px;
                min-height: 1.2em;
            }
            #store-key-input.invalid {
                border-color: var(--danger, #f44336) !important;
                background-color: rgba(244, 67, 54, 0.1);
            }
            #store-value-input {
                min-height: 42px;
                max-height: 300px;
                resize: vertical;
                line-height: 1.4;
                padding-top: 10px !important;
            }
        </style>
        <div id="store-modal" class="modal-overlay hidden">
            <div class="modal">
                <h3 id="store-modal-title">${i18next.t('store.modal.title_new')}</h3>
                <div style="display: grid; grid-template-columns: 1fr 140px; gap: 15px;">
                    <div class="form-group">
                        <label>${i18next.t('store.modal.label_key')}</label>
                        <input type="text" id="store-key-input" placeholder="${i18next.t('store.modal.placeholder_key')}" oninput="validateStoreKeyInput()">
                        <div id="store-key-error" class="form-error-msg"></div>
                    </div>
                    <div class="form-group">
                        <label>${i18next.t('store.modal.label_type')}</label>
                        <select id="store-type-input" style="width: 100%;" onchange="updateStoreModalUI()">
                            <option value="string">${i18next.t('store.types.string', { defaultValue: 'String' })}</option>
                            <option value="number">${i18next.t('store.types.number', { defaultValue: 'Number' })}</option>
                            <option value="boolean">${i18next.t('store.types.boolean', { defaultValue: 'Boolean' })}</option>
                            <option value="json">${i18next.t('store.types.object', { defaultValue: 'JSON / Object' })}</option>
                        </select>
                    </div>
                </div>
                <div class="form-group" style="margin-top:15px;">
                    <label>${i18next.t('store.modal.label_value')}</label>
                    <div class="icon-input-container" style="align-items: flex-start; gap: 5px;">
                        <textarea id="store-value-input" placeholder="${i18next.t('store.modal.placeholder_value')}" oninput="validateStoreValueInput()"></textarea>
                        <div style="display: flex; flex-direction: column; gap: 12px; padding-top: 10px;">
                            <i id="store-value-prettify" class="mdi mdi-format-indent-increase" style="cursor:pointer; opacity:0.7; display:none;" onclick="prettifyStoreJson()" title="${i18next.t('store.actions.prettify')}"></i>
                            <i id="store-value-toggle" class="mdi mdi-eye-off" style="cursor:pointer; opacity:0.7;" onclick="toggleStoreValueVisibility()"></i>
                        </div>
                    </div>
                    <div id="store-value-error" class="form-error-msg"></div>
                </div>
                <div class="form-group" style="margin-top:15px; flex-direction:row; align-items:center; gap:10px;">
                    <input type="checkbox" id="store-secret-check" style="width:auto !important;" onchange="toggleStoreSecretState()">
                    <label for="store-secret-check" style="margin:0; cursor:pointer; font-size:0.9rem; color:#ddd; text-transform:none;">${i18next.t('store.modal.label_secret')}</label>
                </div>
                <div class="modal-btns">
                    <button class="btn-primary" onclick="saveStoreItemFromModal()">${i18next.t('store.btn_save', { defaultValue: 'SAVE' })}</button>
                    <button class="btn-text" onclick="closeStoreModal()">${i18next.t('store.btn_cancel', { defaultValue: 'CANCEL' })}</button>
                </div>
            </div>
        </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Make globally available
window.openStoreTab = openStoreTab;
window.editStoreItem = editStoreItem;
window.openStoreModal = openStoreModal;
window.closeStoreModal = closeStoreModal;
window.saveStoreItemFromModal = saveStoreItemFromModal;
window.validateStoreKeyInput = validateStoreKeyInput;
window.validateStoreValueInput = validateStoreValueInput;
window.updateStoreModalUI = updateStoreModalUI;
window.prettifyStoreJson = prettifyStoreJson;
window.toggleStoreValueVisibility = toggleStoreValueVisibility;
window.toggleStoreSecretState = toggleStoreSecretState;
