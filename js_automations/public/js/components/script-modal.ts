import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaOpenScriptModalData, JsaTab } from './global';

type WizardMode = 'create' | 'edit' | 'duplicate';
type WizardTab = 'new' | 'upload' | 'import';
type NpmPkgStatus = 'loading' | 'valid' | 'invalid';
type Extension = '.js' | '.ts' | '.blocks';

interface NpmPkgTag {
  name: string;
  status: NpmPkgStatus;
  error?: string | null;
}

interface CapabilityPreviewData {
  name?: string;
  description?: string;
  capabilities?: { detected: string[]; undeclared: string[] };
}

// Only the 'empty' starter template was ever reachable — the wizard's Template picker (JS/TS
// interval/trigger snippets) was permanently hidden in both create and edit/duplicate mode in
// the vanilla version, and its selected value was read but never actually used when building
// the create payload. Dropped entirely rather than ported; only the one template that was ever
// live survives, inlined below.
const EMPTY_SCRIPT_CODE = 'const scriptName=ha.getHeader("name");\nha.log(`\'${scriptName}\' started...`);\n';

/**
 * Unified script creation/edit/duplicate/upload/import dialog (RFC Phase B item 7). Replaces
 * creation-wizard.js. Reaches into `<editor-view>`'s bridge globals (window.openTabs,
 * window.activeTabFilename, window.renderTabs, window.updateToolbarUI,
 * window.loadBlocklyWorkspace) for post-save tab sync, and into window.openOrSwitchToTab /
 * window.loadScripts — the window.* bridge pattern used throughout this migration for
 * cross-component calls that aren't worth a dedicated event for.
 */
@customElement('script-modal')
export class ScriptModal extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.85);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(3px);
    }

    .modal {
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 25px;
      width: 500px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      box-sizing: border-box;
    }

    h3 {
      margin: 0 0 15px 0;
      font-size: 1.1rem;
      color: var(--text-primary);
      font-weight: 500;
    }

    .wizard-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }

    .wizard-tab {
      background: none;
      border: none;
      color: var(--text-secondary);
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-family: inherit;
      font-size: 0.9rem;
    }

    .wizard-tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: bold;
    }

    .form-group {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .wizard-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }

    .wizard-grid .form-group {
      margin-bottom: 0;
    }

    /* Name/Icon share one row instead of Name alone taking the full width — name values are
       short, a full-width input for them is mostly empty space. Tried folding the language
       picker in here too (a third column) — didn't work at any reasonable modal width, Icon +
       three pill buttons ate enough room to squeeze Name down to an unusable ~100px. Language
       pairs with Label instead, further down (create mode only — see the Label row). */
    .name-icon-row {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }

    .name-icon-row .form-group {
      margin-bottom: 0;
    }

    /* 0 basis (not 'auto') so the split is governed purely by the flex-grow ratio, not by each
       field's own content/placeholder width — with 'auto' a wide placeholder can claim more
       than its "fair share" before the ratio ever gets applied to the leftover space. */
    .name-field {
      flex: 3 1 0;
      min-width: 0;
    }

    .icon-field {
      flex: 2 1 0;
      min-width: 0;
    }

    label {
      font-size: 0.7rem;
      color: var(--text-secondary);
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .field-hint {
      color: var(--text-muted);
      font-weight: normal;
      text-transform: none;
      letter-spacing: normal;
    }

    input,
    textarea,
    select {
      background: var(--surface-2);
      border: 1px solid #383838;
      color: var(--text-primary);
      padding: 10px;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      width: 100%;
    }

    input:focus,
    textarea:focus,
    select:focus {
      border-color: var(--accent);
    }

    textarea {
      min-height: 42px;
      resize: vertical;
      line-height: 1.4;
    }

    .icon-input-container {
      display: flex;
      align-items: center;
      background: var(--surface-2);
      border: 1px solid #383838;
      border-radius: 6px;
      padding: 0 8px;
    }

    .icon-input-container:focus-within {
      border-color: var(--accent);
    }

    .icon-input-container input {
      border: none !important;
      background: transparent !important;
      padding: 10px 5px !important;
    }

    .icon-preview {
      font-size: 1.4rem;
      color: var(--accent);
      margin-right: 5px;
    }

    .lang-selection-container {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .lang-card {
      padding: 4px 12px;
      background: var(--surface-2);
      border: 1px solid #444;
      border-radius: 4px;
      font-weight: bold;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
      color: var(--text-secondary);
      min-width: 45px;
      text-align: center;
    }

    .lang-card:hover {
      border-color: #666;
      color: #ccc;
    }

    .lang-card.active {
      color: #fff;
    }

    .lang-card.active.js {
      border-color: #f7df1e;
      color: #f7df1e;
      background: rgba(247, 223, 30, 0.1);
    }

    .lang-card.active.ts {
      border-color: #3178c6;
      color: #3178c6;
      background: rgba(49, 120, 198, 0.1);
    }

    .lang-card.active.blocks {
      border-color: var(--success);
      color: var(--success);
      background: rgba(76, 175, 80, 0.1);
    }

    .duplicate-as-js-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--text-secondary);
      margin-right: auto;
    }

    .duplicate-as-js-toggle input[type='checkbox'] {
      width: auto;
    }

    .npm-tags-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      background: var(--surface-2);
      border: 1px solid #383838;
      border-radius: 6px;
      padding: 5px;
      min-height: 42px;
      cursor: text;
    }

    .npm-tags-input:focus-within {
      border-color: var(--accent);
    }

    .npm-tags-input input {
      border: none !important;
      background: transparent !important;
      outline: none !important;
      flex: 1;
      min-width: 80px;
      padding: 5px !important;
      width: auto;
    }

    .npm-tag {
      background: #333;
      color: #fff;
      border-radius: 4px;
      padding: 2px 6px 2px 8px;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 5px;
      border: 1px solid transparent;
    }

    .npm-tag.valid {
      border-color: var(--success);
      color: var(--success);
      background: rgba(76, 175, 80, 0.1);
    }

    .npm-tag.invalid {
      border-color: var(--danger);
      color: var(--danger);
      background: rgba(244, 67, 54, 0.1);
      cursor: help;
    }

    .npm-tag.loading {
      color: #aaa;
      border-color: #555;
      border-style: dashed;
    }

    .npm-tag-close {
      cursor: pointer;
      opacity: 0.7;
      font-size: 1rem;
      line-height: 1;
    }

    .npm-tag-close:hover {
      opacity: 1;
      color: #fff;
    }

    .drop-zone {
      border: 2px dashed #444;
      padding: 40px;
      text-align: center;
      color: var(--text-secondary);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .drop-zone:hover,
    .drop-zone.dragover {
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }

    .drop-zone .mdi-cloud-upload {
      font-size: 48px;
    }

    .file-info {
      margin-top: 10px;
      font-weight: bold;
      color: #fff;
    }

    .import-warning {
      color: var(--danger);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 15px;
      padding: 8px;
      background: rgba(244, 67, 54, 0.1);
      border-radius: 4px;
    }

    .import-warning .mdi {
      font-size: 1.2rem;
    }

    .url-hint {
      color: var(--text-muted);
      display: block;
      margin-top: 5px;
      font-size: 0.8rem;
    }

    .cap-preview-panel {
      margin-top: 14px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid #333;
      border-radius: 6px;
      font-size: 0.85rem;
    }

    .cap-preview-name {
      font-weight: bold;
      margin-bottom: 3px;
      color: var(--text-primary);
    }

    .cap-preview-desc {
      color: var(--text-secondary);
      margin-bottom: 8px;
      font-size: 0.8rem;
    }

    .cap-preview-caps-label {
      color: var(--text-muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 5px;
      margin-top: 6px;
    }

    .cap-preview-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      color: var(--text-secondary);
    }

    .cap-preview-item-warn {
      color: var(--warn);
    }

    .cap-preview-item-exec {
      color: var(--danger);
    }

    .cap-preview-none {
      color: var(--success);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cap-preview-warning {
      margin-top: 8px;
      padding: 7px 9px;
      background: rgba(240, 165, 0, 0.1);
      border: 1px solid rgba(240, 165, 0, 0.3);
      border-radius: 4px;
      color: var(--warn);
      font-size: 0.8rem;
    }

    .cap-preview-loading {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .modal-btns {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-top: 10px;
    }

    .modal-error {
      color: var(--danger);
      font-size: 0.85rem;
      text-align: left;
      margin: 0 auto 0 0;
      max-width: 50%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    button {
      cursor: pointer;
      border: none;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--accent);
      color: #000;
      font-weight: bold;
      padding: 10px 30px;
      border-radius: 6px;
    }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .btn-text {
      background: transparent;
      color: var(--text-secondary);
      padding: 10px;
    }

    .btn-text:hover {
      color: var(--text-primary);
    }
  `;

  @state() private _open = false;
  @state() private _mode: WizardMode = 'create';
  @state() private _activeTab: WizardTab = 'new';
  @state() private _busy = false;

  // "New" tab fields
  @state() private _name = '';
  @state() private _type: 'hidden' | 'switch' | 'button' | 'library' = 'hidden';
  @state() private _extension: Extension = '.js';
  @state() private _icon = '';
  @state() private _area = '';
  @state() private _label = '';
  @state() private _loglevel = 'debug' as string;
  @state() private _description = '';
  @state() private _npmPackages: NpmPkgTag[] = [];
  @state() private _npmInput = '';
  @state() private _includes: string[] = [];
  @state() private _includesInput = '';

  @state() private _originalFilename: string | null = null;
  @state() private _duplicateCode: string | null = null;
  @state() private _duplicateJsCode: string | null = null;
  @state() private _duplicateAsJs = false;

  // Upload tab
  @state() private _uploadType: 'automation' | 'library' = 'automation';
  @state() private _uploadName = '';
  @state() private _uploadFile: File | null = null;
  @state() private _uploadPreview: CapabilityPreviewData | null = null;
  @state() private _dragOver = false;

  // Import tab
  @state() private _importType: 'automation' | 'library' = 'automation';
  @state() private _importName = '';
  @state() private _importUrl = '';
  @state() private _importPreviewed = false;
  @state() private _importPreview: CapabilityPreviewData | null = null;
  @state() private _importLoading = false;

  @state() private _areas: string[] = [];
  @state() private _labels: string[] = [];

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.scriptModal = { open: this.open };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.scriptModal?.open === this.open) delete window.scriptModal;
  }

  open = async (mode: WizardMode = 'create', data: JsaOpenScriptModalData | null = null): Promise<void> => {
    this._mode = mode;
    this._activeTab = 'new';
    this._busy = false;
    this._originalFilename = null;
    this._duplicateCode = null;
    this._duplicateJsCode = null;
    this._duplicateAsJs = false;

    let initialExt: Extension = '.js';
    if (data?.filename) {
      if (data.filename.endsWith('.ts')) initialExt = '.ts';
      else if (data.filename.endsWith('.blocks')) initialExt = '.blocks';
    }
    this._extension = initialExt;

    this._icon = '';
    this._area = '';
    this._label = '';
    this._loglevel = 'info';
    this._description = '';
    this._npmPackages = [];
    this._npmInput = '';
    this._includes = [];
    this._includesInput = '';

    this._uploadType = 'automation';
    this._uploadName = '';
    this._uploadFile = null;
    this._uploadPreview = null;
    this._dragOver = false;

    this._importType = 'automation';
    this._importName = '';
    this._importUrl = '';
    this._importPreviewed = false;
    this._importPreview = null;
    this._importLoading = false;

    if (mode === 'create') {
      this._name = '';
      this._type = 'hidden';
    } else if (data) {
      this._name = mode === 'duplicate' ? `${data.name} (Copy)` : (data.name ?? '');
      this._originalFilename = mode === 'edit' ? (data.filename ?? null) : null;

      let typeVal: 'hidden' | 'switch' | 'button' | 'library' = 'hidden';
      if (data.path && data.path.includes('libraries')) typeVal = 'library';
      else if (data.expose === 'switch') typeVal = 'switch';
      else if (data.expose === 'button') typeVal = 'button';
      this._type = typeVal;

      this._icon = data.icon || '';
      this._area = data.area || '';
      this._label = data.label || '';
      this._loglevel = data.loglevel || 'info';
      this._description = data.description || '';

      if (mode === 'duplicate') {
        this._duplicateCode = data.code ?? null;
        // Only offer the checkbox when duplicating a .blocks script AND a compiled version
        // actually exists (app-sidebar.ts's _duplicateScript() leaves jsCode null if nothing's
        // been compiled yet, e.g. a script that was never saved).
        if (initialExt === '.blocks' && data.jsCode) {
          this._duplicateJsCode = data.jsCode;
        }
      }

      if (data.dependencies) {
        this._npmPackages = data.dependencies.map((name) => ({ name, status: 'loading' as NpmPkgStatus }));
        for (const pkg of this._npmPackages) this._validateNpmPackage(pkg);
      }
      if (data.includes) {
        this._includes = [...new Set(data.includes)];
      }
    }

    this._open = true;

    try {
      const res = await window.apiFetch!('api/ha/metadata');
      if (res.ok) {
        const { areas, labels } = (await res.json()) as {
          areas: { name: string }[];
          labels: { name: string }[];
        };
        this._areas = areas.map((a) => a.name);
        this._labels = labels.map((l) => l.name);
      }
    } catch (e) {
      console.warn('Failed to load suggestions', e);
    }
  };

  close = (): void => {
    this._open = false;
    this._importPreviewed = false;
  };

  private _switchTab(tab: WizardTab): void {
    this._activeTab = tab;
    this._importPreviewed = false;
    this._importPreview = null;
    this._uploadPreview = null;
  }

  private get _librarySuggestions(): string[] {
    const scripts = window.allScripts ?? [];
    return scripts
      .filter((s) => typeof s.path === 'string' && (s.path.includes('/libraries/') || s.path.includes('\\libraries\\')))
      .map((s) => s.filename);
  }

  /** Mirrors checkWizardScriptName()'s validation: empty name is "invalid but silent", a
   * filename collision (except the file's own original name in edit mode) shows an error. */
  private _computeNameError(): { error: string; disabled: boolean } {
    const name = this._name.trim();
    if (!name) return { error: '', disabled: true };

    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const filename = slug + this._extension;

    if (this._mode === 'edit' && filename === this._originalFilename) {
      return { error: '', disabled: false };
    }

    const exists = (window.allScripts ?? []).some((s) => s.filename === filename);
    return { error: exists ? this._t('error_file_exists', undefined, { filename }) : '', disabled: exists };
  }

  private _selectLanguage(ext: Extension): void {
    this._extension = ext;
  }

  private _onDuplicateAsJsToggle(checked: boolean): void {
    this._duplicateAsJs = checked;
    this._selectLanguage(checked ? '.js' : '.blocks');
  }

  private _onTypeChange(e: Event): void {
    this._type = (e.target as HTMLSelectElement).value as 'hidden' | 'switch' | 'button' | 'library';
    if (this._type === 'library') {
      this._icon = 'mdi:book-open-variant';
    } else if (this._icon === 'mdi:book-open-variant' || !this._icon) {
      this._icon = 'mdi:script-text';
    }
  }

  private _addNpmTag(pkgName: string): void {
    if (this._npmPackages.some((p) => p.name === pkgName)) return;
    const pkg: NpmPkgTag = { name: pkgName, status: 'loading' };
    this._npmPackages = [...this._npmPackages, pkg];
    this._validateNpmPackage(pkg);
  }

  private async _validateNpmPackage(pkg: NpmPkgTag): Promise<void> {
    let cleanName = pkg.name;
    const lastAt = cleanName.lastIndexOf('@');
    if (lastAt > 0) cleanName = cleanName.substring(0, lastAt);

    let status: NpmPkgStatus;
    let error: string | null = null;
    try {
      const res = await window.apiFetch!(`api/npm/check/${cleanName}`);
      const data = (await res.json()) as { ok: boolean; error?: string };
      status = data.ok ? 'valid' : 'invalid';
      if (!data.ok) error = data.error || 'Unknown error';
    } catch (e) {
      status = 'invalid';
      error = 'Backend connection failed';
    }

    this._npmPackages = this._npmPackages.map((p) => (p === pkg ? { ...p, status, error } : p));
  }

  private _removeNpmTag(name: string): void {
    this._npmPackages = this._npmPackages.filter((p) => p.name !== name);
  }

  private _removeInclude(name: string): void {
    this._includes = this._includes.filter((i) => i !== name);
  }

  private _onNpmInputKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLInputElement;
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      const val = target.value.trim();
      if (val) {
        this._addNpmTag(val);
        this._npmInput = '';
      }
    } else if (e.key === 'Backspace' && target.value === '') {
      if (this._npmPackages.length > 0) {
        this._npmPackages = this._npmPackages.slice(0, -1);
      }
    }
  }

  private _onIncludesInputKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLInputElement;
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      const val = target.value.trim();
      if (val && !this._includes.includes(val)) {
        this._includes = [...this._includes, val];
      }
      this._includesInput = '';
    } else if (e.key === 'Backspace' && target.value === '') {
      if (this._includes.length > 0) {
        this._includes = this._includes.slice(0, -1);
      }
    }
  }

  private _renderCapPreview(data: CapabilityPreviewData) {
    const CAP_ICONS: Record<string, string> = {
      network: 'mdi-web',
      'fs:read': 'mdi-file-eye-outline',
      'fs:write': 'mdi-file-edit-outline',
      exec: 'mdi-console',
    };
    const detected = data.capabilities?.detected ?? [];
    const undeclared = data.capabilities?.undeclared ?? [];
    const hasFsWrite = detected.includes('fs:write');
    const visible = detected.filter((t) => !(t === 'fs:read' && hasFsWrite));

    return html`
      <div class="cap-preview-panel">
        ${
          data.name
            ? html`<div class="cap-preview-name">
                <i class="mdi mdi-script-text"></i> <strong>${data.name}</strong>
              </div>`
            : nothing
        }
        ${data.description ? html`<div class="cap-preview-desc">${data.description}</div>` : nothing}
        ${
          detected.length === 0
            ? html`<div class="cap-preview-none">
                <i class="mdi mdi-check-circle-outline"></i> ${this._t('cap_preview_none')}
              </div>`
            : html`
                <div class="cap-preview-caps-label">${this._t('cap_preview_capabilities')}</div>
                ${visible.map((t) => {
                  const icon = CAP_ICONS[t] || 'mdi-circle-small';
                  const isWarn = undeclared.includes(t);
                  const cls = isWarn ? (t === 'exec' ? 'cap-preview-item-exec' : 'cap-preview-item-warn') : '';
                  const label = this._t(`cap_${t.replace(':', '_')}`, t);
                  return html`<div class="cap-preview-item ${cls}"><i class="mdi ${icon}"></i> ${label}</div>`;
                })}
                ${
                  undeclared.length > 0
                    ? html`<div class="cap-preview-warning">
                        <i class="mdi mdi-alert-outline"></i> ${this._t('cap_preview_undeclared_warning')}<br /><small
                          >${this._t('cap_preview_undeclared_list')} <code>${undeclared.join(', ')}</code></small
                        >
                      </div>`
                    : nothing
                }
              `
        }
      </div>
    `;
  }

  private _onFileSelected(files: FileList | null): void {
    this._uploadPreview = null;
    const file = files?.[0];
    if (!file) return;

    this._uploadFile = file;
    if (!this._uploadName) {
      this._uploadName = file.name.replace(/\.(js|ts)$/i, '');
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const res = await window.apiFetch!('api/scripts/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: e.target?.result }),
        });
        if (res.ok) this._uploadPreview = (await res.json()) as CapabilityPreviewData;
      } catch (_) {
        // preview unavailable, upload proceeds normally
      }
    };
    reader.readAsText(file);
  }

  private _onImportUrlInput(url: string): void {
    this._importUrl = url;
    if (url && !this._importName) {
      try {
        const parts = url.split('/');
        const lastPart = parts.pop() || parts.pop();
        const basename = lastPart?.split('?')[0];
        if (basename && basename !== 'raw') {
          this._importName = basename.replace(/\.(js|ts)$/i, '');
        }
      } catch (e) {
        // ignore malformed URL
      }
    }
  }

  private get _showDuplicateAsJs(): boolean {
    return this._mode === 'duplicate' && this._duplicateJsCode !== null;
  }

  private get _actionDisabled(): boolean {
    if (this._busy) return true;
    if (this._activeTab === 'new') return this._computeNameError().disabled;
    if (this._activeTab === 'upload') return !this._uploadFile;
    if (this._activeTab === 'import') return !this._importUrl.trim();
    return false;
  }

  private get _actionLabel(): string {
    if (this._busy) return '...';
    if (this._mode === 'edit') return this._t('save_title', 'Save');
    if (this._mode === 'duplicate') return this._t('button_duplicate', 'Duplicate');
    if (this._activeTab === 'upload') return this._t('wizard_btn_upload', 'Upload');
    if (this._activeTab === 'import')
      return this._importPreviewed ? this._t('cap_preview_confirm') : this._t('wizard_btn_import', 'Import');
    return this._t('button_create', 'Create');
  }

  private _execute = async (): Promise<void> => {
    this._busy = true;
    let newFilename: string | null = null;

    try {
      if (this._activeTab === 'new') {
        newFilename = await this._executeNewTab();
      } else if (this._activeTab === 'upload') {
        newFilename = await this._executeUpload();
      } else if (this._activeTab === 'import') {
        newFilename = await this._executeImport();
        if (newFilename === null && this._importPreviewed) {
          // Step 1 (dry-run) just completed — stay open, wait for the confirm click.
          this._busy = false;
          return;
        }
      }

      this.close();
      if (window.loadScripts) await window.loadScripts();

      if (newFilename && window.openOrSwitchToTab) {
        const filename = newFilename;
        const newScript = (window.allScripts ?? []).find((s) => s.filename === filename);
        const icon = newScript ? newScript.icon : 'mdi:script-text';
        await window.openOrSwitchToTab(filename, icon);

        if (this._mode === 'edit') {
          const tab = window.openTabs?.find((t) => t.filename === filename);
          if (tab) {
            tab.icon = icon ?? tab.icon;
            window.renderTabs?.();
            if (window.activeTabFilename === filename) {
              window.updateToolbarUI?.(filename, tab.icon, tab.isDirty);
            }
          }
        }
      }
    } catch (e) {
      window.alertToast?.show(`${this._t('error_create_failed')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this._busy = false;
    }
  };

  /** Handles the "New" tab's create/edit/duplicate submit. Returns the resulting filename. */
  private async _executeNewTab(): Promise<string> {
    const name = this._name.trim();
    if (!name) throw new Error(this._t('error_wizard_name_required'));

    if (this._npmInput.trim()) {
      this._addNpmTag(this._npmInput.trim());
      this._npmInput = '';
    }
    if (this._includesInput.trim() && !this._includes.includes(this._includesInput.trim())) {
      this._includes = [...this._includes, this._includesInput.trim()];
      this._includesInput = '';
    }

    let type: 'automation' | 'library' = 'automation';
    let expose: 'switch' | 'button' | null = null;
    if (this._type === 'switch') expose = 'switch';
    else if (this._type === 'button') expose = 'button';
    else if (this._type === 'library') type = 'library';

    const payload: Record<string, unknown> = {
      name,
      type,
      expose,
      icon: this._icon.trim(),
      area: this._area.trim(),
      label: this._label.trim(),
      loglevel: this._loglevel,
      description: this._description.trim(),
      extension: this._extension,
      npmModules: this._npmPackages.map((p) => p.name),
      includes: this._includes,
    };

    if (this._mode === 'edit') {
      const res = await window.apiFetch!(`api/scripts/${this._originalFilename}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || this._t('error_update_failed', 'Update failed'));
      }
      const data = (await res.json()) as { filename: string };
      const newFilename = data.filename;

      if (this._originalFilename && newFilename !== this._originalFilename) {
        const tab = window.openTabs?.find((t) => t.filename === this._originalFilename);
        if (tab) tab.filename = newFilename;
        if (window.activeTabFilename === this._originalFilename) {
          window.activeTabFilename = newFilename;
        }
        window.renderTabs?.();
      }

      const tab = window.openTabs?.find((t) => t.filename === newFilename) as (JsaTab & { model?: any }) | undefined;
      if (tab?.model) {
        // Cache-busting timestamp so the browser doesn't serve a stale cached response.
        const cRes = await window.apiFetch!(`api/scripts/${newFilename}/content?_t=${Date.now()}`);
        if (cRes.ok) {
          const cData = await cRes.json();
          tab.model.setValue(cData.content);
          (tab as unknown as { originalContent: string }).originalContent = cData.content;
          tab.isDirty = false;
        }
      } else if (tab && tab.type === 'blockly') {
        // Metadata edits only touch the file's `jsa` key server-side — pull that in without
        // clobbering unsaved visual edits sitting in tab.blocksState.
        const cRes = await window.apiFetch!(`api/scripts/${newFilename}/content?_t=${Date.now()}`);
        if (cRes.ok) {
          const cData = await cRes.json();
          try {
            tab.jsa = (JSON.parse(cData.content || '{}') as { jsa?: Record<string, unknown> }).jsa || {};
          } catch (e) {
            // keep existing jsa on parse failure
          }
          if (window.activeTabFilename === newFilename && window.loadBlocklyWorkspace && tab.blocksState) {
            window.loadBlocklyWorkspace({
              jsa: tab.jsa ?? {},
              blocks: tab.blocksState.blocks,
              variables: tab.blocksState.variables,
            });
          }
        }
      }

      return newFilename;
    }

    // CREATE or DUPLICATE
    if (this._mode === 'duplicate' && this._extension === '.js' && this._duplicateJsCode) {
      // "Duplicate as JavaScript" checkbox (.blocks source only). The original .blocks file is
      // untouched; this just creates an independent .js copy of its last-compiled output.
      payload.code = this._duplicateJsCode;
    } else if (this._mode === 'duplicate' && this._duplicateCode) {
      payload.code = this._duplicateCode;
    } else if (this._extension === '.blocks') {
      // Let the backend write its own minimal empty-workspace default.
      payload.code = '';
    } else {
      payload.code = EMPTY_SCRIPT_CODE;
    }

    const res = await window.apiFetch!('api/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || this._t('error_create_failed', 'Creation failed'));
    }
    const data = (await res.json()) as { filename: string };
    return data.filename;
  }

  private async _executeUpload(): Promise<string> {
    if (!this._uploadFile) throw new Error(this._t('error_wizard_no_file'));
    const formData = new FormData();
    formData.append('file', this._uploadFile);
    formData.append('type', this._uploadType);
    if (this._uploadName) formData.append('name', this._uploadName);
    // Bug fix vs. the vanilla version: this used to call the bare fetch() global, bypassing
    // apiFetch()'s BASE_PATH prefix — would 404 under a real HA ingress path.
    const res = await window.apiFetch!('api/scripts/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `${this._t('wizard_btn_upload', 'Upload')} fehlgeschlagen`);
    }
    const data = (await res.json()) as { filename: string };
    return data.filename;
  }

  /** Two-step: first call previews (dry run) and returns null; second call (after the user
   * reviews the preview and clicks confirm) actually imports and returns the filename. */
  private async _executeImport(): Promise<string | null> {
    const url = this._importUrl.trim();
    if (!url) throw new Error(this._t('error_wizard_url_required'));

    if (!this._importPreviewed) {
      this._importLoading = true;
      this._importPreview = null;
      try {
        const res = await window.apiFetch!('api/scripts/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, type: this._importType, name: this._importName, dryRun: true }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || this._t('error_import_failed', 'Import failed'));
        }
        this._importPreview = (await res.json()) as CapabilityPreviewData;
        this._importPreviewed = true;
      } finally {
        this._importLoading = false;
      }
      return null;
    }

    const res = await window.apiFetch!('api/scripts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: this._importType, name: this._importName }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || this._t('error_import_failed', 'Import failed'));
    }
    const data = (await res.json()) as { filename: string };
    return data.filename;
  }

  private _renderNewTab() {
    const { error: nameError } = this._computeNameError();
    const mdiIcons = window.mdiIcons ?? [];
    const showLanguagePicker = this._mode === 'create';

    return html`
      <div class="name-icon-row">
        <div class="form-group name-field">
          <label>${this._t('script_name', 'Name')} <span class="field-hint">(@name)</span></label>
          <input
            type="text"
            placeholder=${this._t('wizard_placeholder_name', 'z.B. mein_skript')}
            .value=${this._name}
            @input=${(e: InputEvent) => (this._name = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-group icon-field">
          <label>${this._t('script_icon', 'Icon')} <span class="field-hint">(@icon)</span></label>
          <div class="icon-input-container">
            <i class="mdi ${this._icon ? `mdi-${this._icon.split(':').pop()}` : 'mdi-script-text'} icon-preview"></i>
            <input
              type="text"
              list="script-modal-mdi-suggestions"
              placeholder=${this._t('wizard_placeholder_icon', 'mdi:flash')}
              .value=${this._icon}
              @input=${(e: InputEvent) => (this._icon = (e.target as HTMLInputElement).value)}
            />
          </div>
          <datalist id="script-modal-mdi-suggestions">
            ${mdiIcons.map((i) => html`<option value="mdi:${i}"></option>`)}
          </datalist>
        </div>
      </div>

      <div class="form-group">
        <label>${this._t('script_description', 'Beschreibung')} <span class="field-hint">(@description)</span></label>
        <textarea
          rows="2"
          placeholder=${this._t('description_placeholder', '...')}
          .value=${this._description}
          @input=${(e: InputEvent) => (this._description = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div class="wizard-grid" style="margin-bottom: 20px;">
        ${
          showLanguagePicker
            ? html`
                <div class="form-group">
                  <label>${this._t('wizard_label_language', 'Sprache')}</label>
                  <div class="lang-selection-container">
                    <div
                      class="lang-card js ${this._extension === '.js' ? 'active' : ''}"
                      @click=${() => this._selectLanguage('.js')}
                    >
                      JS
                    </div>
                    <div
                      class="lang-card ts ${this._extension === '.ts' ? 'active' : ''}"
                      @click=${() => this._selectLanguage('.ts')}
                    >
                      TS
                    </div>
                    <div
                      class="lang-card blocks ${this._extension === '.blocks' ? 'active' : ''}"
                      title=${this._t('wizard_option_blockly', 'Visual')}
                      @click=${() => this._selectLanguage('.blocks')}
                    >
                      BLK
                    </div>
                  </div>
                </div>
              `
            : html`
                <div class="form-group">
                  <label>${this._t('script_area', 'Bereich')} <span class="field-hint">(@area)</span></label>
                  <input
                    type="text"
                    list="script-modal-areas"
                    placeholder=${this._t('wizard_placeholder_area', 'Wohnzimmer')}
                    .value=${this._area}
                    @input=${(e: InputEvent) => (this._area = (e.target as HTMLInputElement).value)}
                  />
                  <datalist id="script-modal-areas">
                    ${this._areas.map((a) => html`<option value=${a}></option>`)}
                  </datalist>
                </div>
              `
        }
        <div class="form-group">
          <label>
            ${this._t('script_type', 'Typ')} <span class="field-hint">(@expose)</span>
            <i class="mdi mdi-information-outline" title=${this._t('wizard_type_tooltip', 'Info')}></i>
          </label>
          <select .value=${this._type} @change=${(e: Event) => this._onTypeChange(e)}>
            <option value="hidden">${this._t('wizard_option_hidden', 'Hintergrund (Unsichtbar)')}</option>
            <option value="switch">${this._t('wizard_option_switch', 'Schalter (Dauerläufer)')}</option>
            <option value="button">${this._t('wizard_option_button', 'Button (Aktion)')}</option>
            <option value="library">
              ${this._t('wizard_option_library', 'Library (Wird von anderen importiert)')}
            </option>
          </select>
        </div>
      </div>

      <div class="wizard-grid" style="margin-bottom: 20px;">
        <div class="form-group">
          <label>${this._t('script_label', 'Label')} <span class="field-hint">(@label)</span></label>
          <input
            type="text"
            list="script-modal-labels"
            placeholder=${this._t('wizard_placeholder_label', 'Licht')}
            .value=${this._label}
            @input=${(e: InputEvent) => (this._label = (e.target as HTMLInputElement).value)}
          />
          <datalist id="script-modal-labels">${this._labels.map((l) => html`<option value=${l}></option>`)}</datalist>
        </div>
        ${
          showLanguagePicker
            ? html`
                <div class="form-group">
                  <label>${this._t('script_area', 'Bereich')} <span class="field-hint">(@area)</span></label>
                  <input
                    type="text"
                    list="script-modal-areas"
                    placeholder=${this._t('wizard_placeholder_area', 'Wohnzimmer')}
                    .value=${this._area}
                    @input=${(e: InputEvent) => (this._area = (e.target as HTMLInputElement).value)}
                  />
                  <datalist id="script-modal-areas">
                    ${this._areas.map((a) => html`<option value=${a}></option>`)}
                  </datalist>
                </div>
              `
            : html`
                <div class="form-group">
                  <label>${this._t('script_log_level', 'Log Level')} <span class="field-hint">(@loglevel)</span></label>
                  <select
                    .value=${this._loglevel}
                    @change=${(e: Event) => (this._loglevel = (e.target as HTMLSelectElement).value)}
                  >
                    <option value="debug">${this._t('log_level_debug', 'Debug')}</option>
                    <option value="info">${this._t('log_level_info', 'Info')}</option>
                    <option value="warn">${this._t('log_level_warn', 'Warn')}</option>
                    <option value="error">${this._t('log_level_error', 'Error')}</option>
                  </select>
                </div>
              `
        }
      </div>

      <div class="form-group">
        <label>${this._t('npm_packages', 'NPM Packages')} <span class="field-hint">(@npm)</span></label>
        <div class="npm-tags-input" @click=${(e: Event) => this._focusSibling(e, 'input')}>
          ${this._npmPackages.map((pkg) => {
            return html`
              <div class="npm-tag ${pkg.status}" title=${pkg.error || ''}>
                ${
                  pkg.status === 'loading'
                    ? html`<i class="mdi mdi-loading mdi-spin"></i>`
                    : pkg.status === 'valid'
                      ? html`<i class="mdi mdi-check"></i>`
                      : html`<i class="mdi mdi-alert-circle-outline"></i>`
                }
                <span>${pkg.name}</span>
                <span class="npm-tag-close" @click=${() => this._removeNpmTag(pkg.name)}>&times;</span>
              </div>
            `;
          })}
          <input
            type="text"
            placeholder=${this._t('npm_packages_placeholder', 'Add package...')}
            .value=${this._npmInput}
            @input=${(e: InputEvent) => (this._npmInput = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => this._onNpmInputKeydown(e)}
          />
        </div>
      </div>

      <div class="form-group">
        <label>${this._t('global_libraries', 'Global Libraries')} <span class="field-hint">(@include)</span></label>
        <div class="npm-tags-input" @click=${(e: Event) => this._focusSibling(e, 'input')}>
          ${this._includes.map((libName) => {
            const script = (window.allScripts ?? []).find(
              (s) => s.filename === libName || s.filename === `${libName}.js`
            );
            const statusClass = script ? 'valid' : 'invalid';
            let iconName = 'book-open-variant';
            const mdiList = window.mdiIcons ?? [];
            if (script?.icon) {
              const customIcon = script.icon.split(':').pop() as string;
              if (mdiList.length === 0 || mdiList.includes(customIcon)) iconName = customIcon;
            }
            return html`
              <div class="npm-tag ${statusClass}">
                <i class="mdi mdi-${iconName}"></i>
                <span>${libName}</span>
                <span class="npm-tag-close" @click=${() => this._removeInclude(libName)}>&times;</span>
              </div>
            `;
          })}
          <input
            type="text"
            list="script-modal-includes-suggestions"
            placeholder=${this._t('add_library_placeholder', 'Add library...')}
            .value=${this._includesInput}
            @input=${(e: InputEvent) => (this._includesInput = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => this._onIncludesInputKeydown(e)}
          />
          <datalist id="script-modal-includes-suggestions">
            ${this._librarySuggestions.map((f) => html`<option value=${f}></option>`)}
          </datalist>
        </div>
      </div>
      ${nameError ? html`<div class="modal-error" style="margin-bottom: 10px;">${nameError}</div>` : nothing}
    `;
  }

  /** Native <input>/<textarea> click-through-container-to-focus-input pattern (npm-tags-input). */
  private _focusSibling(e: Event, selector: string): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(selector)?.focus();
  }

  private _renderUploadTab() {
    return html`
      <div class="wizard-grid" style="margin-bottom: 20px;">
        <div class="form-group">
          <label>${this._t('wizard_label_target_type', 'Ziel-Typ')}</label>
          <select
            .value=${this._uploadType}
            @change=${(e: Event) => (this._uploadType = (e.target as HTMLSelectElement).value as 'automation' | 'library')}
          >
            <option value="automation">${this._t('type_automation', 'Automation')}</option>
            <option value="library">${this._t('type_library', 'Library')}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${this._t('script_name', 'Name')}</label>
          <input
            type="text"
            placeholder=${this._t('wizard_placeholder_optional_name', 'Optional: Skriptname')}
            .value=${this._uploadName}
            @input=${(e: InputEvent) => (this._uploadName = (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div
        class="drop-zone ${this._dragOver ? 'dragover' : ''}"
        @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#script-modal-file-input')?.click()}
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
          this._dragOver = true;
        }}
        @dragleave=${(e: DragEvent) => {
          e.preventDefault();
          this._dragOver = false;
        }}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          this._dragOver = false;
          if (e.dataTransfer?.files.length) this._onFileSelected(e.dataTransfer.files);
        }}
      >
        <i class="mdi mdi-cloud-upload"></i>
        <p>${this._t('wizard_dropzone_text', 'Datei hier ablegen oder klicken')}</p>
        <input
          type="file"
          id="script-modal-file-input"
          accept=".js,.ts"
          style="display:none"
          @change=${(e: Event) => this._onFileSelected((e.target as HTMLInputElement).files)}
        />
        <div class="file-info">${this._uploadFile?.name ?? ''}</div>
      </div>
      ${this._uploadPreview ? this._renderCapPreview(this._uploadPreview) : nothing}
    `;
  }

  private _renderImportTab() {
    return html`
      <div class="wizard-grid" style="margin-bottom: 20px;">
        <div class="form-group">
          <label>${this._t('wizard_label_target_type', 'Ziel-Typ')}</label>
          <select
            .value=${this._importType}
            @change=${(e: Event) => (this._importType = (e.target as HTMLSelectElement).value as 'automation' | 'library')}
          >
            <option value="automation">${this._t('type_automation', 'Automation')}</option>
            <option value="library">${this._t('type_library', 'Library')}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${this._t('script_name', 'Name')}</label>
          <input
            type="text"
            placeholder=${this._t('wizard_placeholder_optional_name', 'Optional: Skriptname')}
            .value=${this._importName}
            @input=${(e: InputEvent) => (this._importName = (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="form-group">
        <label>${this._t('wizard_label_url', 'URL (Raw GitHub / Gist)')}</label>
        <input
          type="text"
          placeholder=${this._t('wizard_placeholder_url', 'https://gist.githubusercontent.com/...')}
          .value=${this._importUrl}
          @input=${(e: InputEvent) => this._onImportUrlInput((e.target as HTMLInputElement).value)}
        />
        <small class="url-hint"
          >${this._t('wizard_url_hint', 'Die URL muss direkt auf den Raw-Content (.js) zeigen.')}</small
        >
        <div class="import-warning">
          <i class="mdi mdi-alert"></i>
          <small
            >${this._t('wizard_import_warning', 'Achtung: Importiere nur Code aus vertrauenswürdigen Quellen.')}</small
          >
        </div>
        ${
          this._importLoading
            ? html`<div class="cap-preview-panel cap-preview-loading">
                <i class="mdi mdi-loading mdi-spin"></i> ${this._t('cap_preview_loading')}
              </div>`
            : this._importPreview
              ? this._renderCapPreview(this._importPreview)
              : nothing
        }
      </div>
    `;
  }

  render() {
    if (!this._open) return html``;
    const isEdit = this._mode === 'edit';
    const isDuplicate = this._mode === 'duplicate';
    const showTabs = this._mode === 'create';

    const title = isEdit
      ? this._t('modal_edit_script_title')
      : isDuplicate
        ? this._t('modal_duplicate_script_title')
        : this._t('new_script_title', 'Neues Skript');

    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => this.close()}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${title}</h3>

          ${
            showTabs
              ? html`
                  <div class="wizard-tabs">
                    <button
                      class="wizard-tab ${this._activeTab === 'new' ? 'active' : ''}"
                      @click=${() => this._switchTab('new')}
                    >
                      ${this._t('wizard_tab_new', 'Neu')}
                    </button>
                    <button
                      class="wizard-tab ${this._activeTab === 'upload' ? 'active' : ''}"
                      @click=${() => this._switchTab('upload')}
                    >
                      ${this._t('wizard_tab_upload', 'Upload')}
                    </button>
                    <button
                      class="wizard-tab ${this._activeTab === 'import' ? 'active' : ''}"
                      @click=${() => this._switchTab('import')}
                    >
                      ${this._t('wizard_tab_import', 'Import')}
                    </button>
                  </div>
                `
              : nothing
          }
          ${
            this._activeTab === 'new'
              ? this._renderNewTab()
              : this._activeTab === 'upload'
                ? this._renderUploadTab()
                : this._renderImportTab()
          }
          ${
            this._showDuplicateAsJs
              ? html`
                  <label class="duplicate-as-js-toggle">
                    <input
                      type="checkbox"
                      .checked=${this._duplicateAsJs}
                      @change=${(e: Event) => this._onDuplicateAsJsToggle((e.target as HTMLInputElement).checked)}
                    />
                    <span>${this._t('wizard_duplicate_as_js', 'Duplicate as JavaScript')}</span>
                  </label>
                `
              : nothing
          }

          <div class="modal-btns">
            <button class="btn-primary" ?disabled=${this._actionDisabled} @click=${() => this._execute()}>
              ${this._actionLabel}
            </button>
            <button class="btn-text" @click=${() => this.close()}>${this._t('button_cancel', 'Abbrechen')}</button>
          </div>
        </div>
      </div>
    `;
  }
}
