import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { mdiStylesheetLink } from './mdi';

interface StoreItem {
  value: unknown;
  owner?: string;
  updated?: string | number;
  accessed?: string | number;
  isSecret?: boolean;
}

type StoreCache = Record<string, StoreItem | unknown>;
type SortColumn = 'key' | 'value' | 'owner' | 'updated' | 'accessed';

const STORE_TAB_ID = 'System: Store';

function isStoreItem(item: unknown): item is StoreItem {
  return !!item && typeof item === 'object' && 'value' in (item as object);
}

function itemValue(item: unknown): unknown {
  return isStoreItem(item) ? item.value : item;
}

function itemMeta(item: unknown): {
  owner: string;
  updated?: string | number;
  accessed?: string | number;
  isSecret: boolean;
} {
  if (isStoreItem(item)) {
    return {
      owner: item.owner || window.i18next?.t('store.system_owner', { defaultValue: 'System' }) || 'System',
      updated: item.updated,
      accessed: item.accessed,
      isSecret: item.isSecret || false,
    };
  }
  return { owner: window.i18next?.t('store.system_owner', { defaultValue: 'System' }) || 'System', isSecret: false };
}

function valueToString(val: unknown): string {
  return typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : String(val);
}

/**
 * "System: Store" tab (`ha.store`). Table + toolbar only — the create/edit
 * modal (`#store-modal`) stays a page-level vanilla overlay in store-modal.js
 * since it's slated to become its own `<store-item-modal>` LIT component
 * later (RFC Phase A item 6), not part of this migration.
 *
 * Mounted permanently at `#store-wrapper`; tab-manager.js toggles the
 * `.hidden` class on tab switches (same as the dev-tools tab panels).
 */
@customElement('store-explorer')
export class StoreExplorer extends LitElement {
  static styles = css`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--surface-0);
      min-height: 0;
      overflow: hidden;
    }
    :host(.hidden) {
      display: none;
    }

    .store-toolbar {
      background: #111;
      height: 45px;
      padding: 0 15px;
      display: flex;
      align-items: center;
      gap: 15px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .store-toolbar button {
      color: var(--text-secondary);
      font-size: 1.3rem;
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .store-toolbar button:hover {
      color: #fff;
      background: #252525;
    }
    .store-toolbar h4 {
      margin: 0;
      font-weight: 500;
      color: #fff;
      margin-right: auto;
    }

    .store-search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .store-search-input {
      background: #222;
      border: 1px solid #333;
      color: #fff;
      padding: 5px 30px 5px 10px;
      border-radius: 4px;
      font-size: 0.85rem;
      width: 200px;
      outline: none;
    }
    .store-search-input:focus {
      border-color: var(--accent);
    }
    .store-search-clear {
      position: absolute !important;
      right: 2px;
      width: 24px !important;
      height: 24px !important;
      font-size: 1rem !important;
      color: #888 !important;
    }
    .store-search-clear:hover {
      color: #fff !important;
      background: transparent !important;
    }
    .store-search-clear.hidden {
      display: none !important;
    }

    .store-content {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }
    .store-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .store-table th {
      background: #1a1a1a;
      color: var(--text-secondary);
      text-align: center;
      padding: 10px 15px;
      font-weight: bold;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      cursor: pointer;
      user-select: none;
    }
    .store-table td {
      padding: 10px 15px;
      border-bottom: 1px solid #1a1a1a;
      vertical-align: middle;
    }
    .store-table tbody tr:hover {
      background: #161616;
    }
    .store-placeholder td {
      text-align: center;
      padding: 20px;
      color: #666;
    }
    .store-placeholder.error td {
      color: var(--danger);
    }

    .sort-icon {
      margin-left: 5px;
    }

    .key-cell-wrapper {
      display: flex;
      align-items: center;
    }
    .copy-btn-inline {
      cursor: pointer;
      opacity: 0.3;
      margin-right: 8px;
      font-size: 14px;
      transition:
        opacity 0.2s,
        color 0.2s;
    }
    .key-cell-wrapper:hover .copy-btn-inline {
      opacity: 0.8;
    }
    .copy-btn-inline:hover {
      opacity: 1;
      color: #fff;
    }
    .copy-btn-inline.success {
      color: var(--success) !important;
      opacity: 1;
    }

    .store-type-badge {
      font-size: 0.65rem;
      padding: 2px 5px;
      border-radius: 4px;
      background: #3c3c3c;
      color: #aaa;
      margin-left: 8px;
      vertical-align: middle;
      border: 1px solid #555;
      font-family: monospace;
      letter-spacing: 0.5px;
    }
    .store-dirty-dot {
      color: var(--warning, #f59e0b);
      font-size: 1rem;
    }

    .store-key {
      font-family: monospace;
      color: var(--accent);
      font-weight: bold;
      width: 20%;
    }
    .store-val-cell {
      color: #ddd;
    }
    .store-val-cell.store-cell-flash {
      animation: store-cell-flash 1s ease-out;
    }
    @keyframes store-cell-flash {
      from {
        background-color: rgba(3, 169, 244, 0.25);
      }
      to {
        background-color: transparent;
      }
    }
    .store-value {
      overflow-wrap: anywhere;
    }
    .store-value-masked {
      font-family: monospace;
      color: #888;
      letter-spacing: 2px;
      font-size: 1.1em;
    }
    .store-value-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .store-json {
      margin: 0;
      font-family: monospace;
      font-size: 0.8rem;
      color: #a5d6ff;
      background: #111;
      padding: 5px;
      border-radius: 4px;
      white-space: pre-wrap;
    }
    .store-json-toggle {
      margin-top: 4px;
      font-size: 0.75em;
      opacity: 0.7;
      display: flex;
      align-items: center;
      gap: 3px;
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .btn-row {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
    }

    .store-owner {
      width: 120px;
      color: var(--text-muted);
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .store-updated,
    .store-accessed {
      width: 150px;
      color: var(--text-muted);
      font-size: 0.85rem;
      white-space: nowrap;
      text-align: right;
    }
    .store-actions {
      text-align: right;
      width: 90px;
      white-space: nowrap;
    }
    .store-actions button {
      display: inline-flex;
      width: 28px;
      height: 28px;
      color: var(--text-muted);
      font-size: 1.2rem;
      margin-left: 4px;
      vertical-align: middle;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .store-actions button:hover {
      color: #fff;
      background: #333;
    }
    .store-actions button.btn-danger:hover {
      color: var(--danger);
      background: rgba(244, 67, 54, 0.1);
    }
  `;

  @state() private _storeCache: StoreCache = {};
  @state() private _dirtyKeys: Set<string> = new Set();
  @state() private _filter = '';
  @state() private _sortColumn: SortColumn = 'key';
  @state() private _sortDirection: 'asc' | 'desc' = 'asc';
  @state() private _expandedKeys: Set<string> = new Set();
  @state() private _revealedSecrets: Set<string> = new Set();
  @state() private _flashKeys: Set<string> = new Set();
  @state() private _copyFeedback: { key: string; kind: 'key' | 'value' } | null = null;
  @state() private _loading = false;
  @state() private _loadError: string | null = null;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.storeExplorer = this;
    window.loadStoreData = this._load;
    window.onStoreChanged = this._onStoreChanged;
    this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.storeExplorer === this) delete window.storeExplorer;
    if (window.loadStoreData === this._load) delete window.loadStoreData;
    if (window.onStoreChanged === this._onStoreChanged) delete window.onStoreChanged;
  }

  /** Read access for the vanilla store-modal.js overlay (edit/copy/duplicate-key check). */
  getItem(key: string): StoreItem | unknown {
    return this._storeCache[key];
  }

  hasKey(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._storeCache, key);
  }

  /** Fallback for callers that just wrote via the modal: the server echoes writes back
   * via 'store_changed', so only force a reload if that channel is currently down. */
  refreshIfSocketDown = (): void => {
    if (!window.socket || !window.socket.connected) this._load();
  };

  private _load = async (): Promise<void> => {
    this._loading = true;
    this._loadError = null;
    try {
      const [storeRes, dirtyRes] = await Promise.all([
        window.apiFetch!('api/store'),
        window.apiFetch!('api/store/dirty'),
      ]);
      if (storeRes.ok) {
        this._storeCache = await storeRes.json();
        this._dirtyKeys = dirtyRes.ok ? new Set(await dirtyRes.json()) : new Set();
      } else {
        this._loadError = this._t('store.load_error', 'Failed to load store data.');
      }
    } catch (e) {
      this._loadError = e instanceof Error ? e.message : String(e);
    } finally {
      this._loading = false;
    }
  };

  private _onStoreChanged = (data: { cleared?: boolean; deleted?: boolean; key?: string; item?: unknown }): void => {
    if (!data) return;

    if (data.cleared) {
      this._storeCache = {};
      return;
    }
    if (data.deleted && data.key) {
      const next = { ...this._storeCache };
      delete next[data.key];
      this._storeCache = next;
      return;
    }
    if (data.key) {
      this._storeCache = { ...this._storeCache, [data.key]: data.item };
      const flashed = new Set(this._flashKeys);
      flashed.add(data.key);
      this._flashKeys = flashed;
      const key = data.key;
      setTimeout(() => {
        const next = new Set(this._flashKeys);
        next.delete(key);
        this._flashKeys = next;
      }, 1000);
    }
  };

  private _sortedKeys(): string[] {
    const cache = this._storeCache;
    const column = this._sortColumn;
    const direction = this._sortDirection;

    const sortValue = (key: string): string | number => {
      const item = cache[key];
      if (column === 'key') return key.toLowerCase();
      if (column === 'value') return valueToString(itemValue(item)).toLowerCase();
      const meta = itemMeta(item);
      if (column === 'owner') return (meta.owner || '').toLowerCase();
      if (column === 'updated') return meta.updated ? new Date(meta.updated).getTime() : 0;
      return meta.accessed ? new Date(meta.accessed).getTime() : 0;
    };

    return Object.keys(cache).sort((a, b) => {
      const valA = sortValue(a);
      const valB = sortValue(b);
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  private _matchesFilter(key: string, item: unknown): boolean {
    const filter = this._filter.toLowerCase();
    if (!filter) return true;
    const meta = itemMeta(item);
    const searchInVal = meta.isSecret ? '' : valueToString(itemValue(item)).toLowerCase();
    return (
      key.toLowerCase().includes(filter) ||
      searchInVal.includes(filter) ||
      (meta.owner || '').toLowerCase().includes(filter)
    );
  }

  private _sort(column: SortColumn): void {
    if (this._sortColumn === column) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortColumn = column;
      this._sortDirection = 'asc';
    }
  }

  private _onFilterInput = (e: Event): void => {
    this._filter = (e.target as HTMLInputElement).value;
  };

  private _clearFilter(): void {
    this._filter = '';
    const input = this.renderRoot.querySelector<HTMLInputElement>('.store-search-input');
    if (input) input.value = '';
  }

  private async _clearAll(): Promise<void> {
    if (!confirm(this._t('store.messages.confirm_clear'))) return;
    try {
      await window.apiFetch!('api/store', { method: 'DELETE' });
      this.refreshIfSocketDown();
    } catch (e) {
      alert(this._t('store.messages.generic_error', undefined, { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private async _deleteKey(key: string): Promise<void> {
    if (!confirm(this._t('store.messages.confirm_delete', undefined, { key }))) return;
    try {
      await window.apiFetch!(`api/store/${key}`, { method: 'DELETE' });
      this.refreshIfSocketDown();
    } catch (e) {
      alert(this._t('store.messages.delete_error', undefined, { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private _editKey(key: string): void {
    window.openStoreModal?.(key);
  }

  private async _copyValue(key: string): Promise<void> {
    const valStr = valueToString(itemValue(this._storeCache[key]));
    try {
      await navigator.clipboard.writeText(valStr);
      this._copyFeedback = { key, kind: 'value' };
      setTimeout(() => {
        if (this._copyFeedback?.key === key && this._copyFeedback.kind === 'value') this._copyFeedback = null;
      }, 1500);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  private async _copyKey(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this._copyFeedback = { key, kind: 'key' };
      setTimeout(() => {
        if (this._copyFeedback?.key === key && this._copyFeedback.kind === 'key') this._copyFeedback = null;
      }, 1500);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  private _toggleSecret(key: string): void {
    const next = new Set(this._revealedSecrets);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._revealedSecrets = next;
  }

  private _toggleExpanded(key: string): void {
    const next = new Set(this._expandedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._expandedKeys = next;
  }

  private _renderSortIcon(column: SortColumn) {
    if (this._sortColumn !== column) {
      return html`<i class="mdi mdi-sort sort-icon" style="opacity:0.3;"></i>`;
    }
    return html`<i
      class="mdi mdi-chevron-${this._sortDirection === 'asc' ? 'up' : 'down'} sort-icon"
      style="opacity:1;"
    ></i>`;
  }

  private _renderValue(key: string, item: unknown) {
    const val = itemValue(item);
    const meta = itemMeta(item);
    const valStr = valueToString(val);

    if (meta.isSecret) {
      const revealed = this._revealedSecrets.has(key);
      return html`
        <div class="store-value-row">
          ${
            revealed
              ? typeof val === 'object'
                ? html`<pre class="store-json" style="margin:0;">${valStr}</pre>`
                : html`<span class="store-value">${valStr}</span>`
              : html`<span class="store-value-masked">••••••••</span>`
          }
          <button class="btn-row" @click=${() => this._toggleSecret(key)} title=${this._t('store.actions.show_hide')}>
            <i class="mdi mdi-eye${revealed ? '-off' : ''}"></i>
          </button>
        </div>
      `;
    }

    if (typeof val === 'object' && val !== null) {
      const lines = valStr.split('\n');
      if (lines.length > 5) {
        const collapsed = !this._expandedKeys.has(key);
        const content = collapsed ? lines.slice(0, 5).join('\n') + '\n…' : valStr;
        return html`
          <pre class="store-json">${content}</pre>
          <button class="store-json-toggle" @click=${() => this._toggleExpanded(key)}>
            <i class="mdi mdi-chevron-${collapsed ? 'down' : 'up'}"></i><span>${lines.length} lines</span>
          </button>
        `;
      }
      return html`<pre class="store-json">${valStr}</pre>`;
    }

    return html`<div class="store-value">${valStr}</div>`;
  }

  private _renderRow(key: string) {
    const item = this._storeCache[key];
    const val = itemValue(item);
    const meta = itemMeta(item);
    const isDirty = this._dirtyKeys.has(key);

    let type: string = typeof val;
    if (val === null) type = 'null';
    else if (Array.isArray(val)) type = 'array';
    const typeLabel = this._t(`store.types.${type}`, type.toUpperCase().substring(0, 3));

    const keyCopied = this._copyFeedback?.key === key && this._copyFeedback.kind === 'key';
    const valueCopied = this._copyFeedback?.key === key && this._copyFeedback.kind === 'value';

    return html`
      <tr title=${isDirty ? this._t('store.dirty_tooltip', 'Unsaved in-memory changes (ha.persistent)') : nothing}>
        <td class="store-key">
          <div class="key-cell-wrapper">
            <i
              class="mdi ${keyCopied ? 'mdi-check success' : 'mdi-content-copy'} copy-btn-inline"
              @click=${() => this._copyKey(key)}
              title=${this._t('store.actions.copy_key')}
            ></i>
            ${key}
            <span class="store-type-badge" title="${this._t('store.types.type_label')}: ${type}">${typeLabel}</span>
            ${
              isDirty
                ? html`<i class="mdi mdi-circle-medium store-dirty-dot" title=${this._t('store.dirty_tooltip')}></i>`
                : nothing
            }
          </div>
        </td>
        <td class=${classMap({ 'store-val-cell': true, 'store-cell-flash': this._flashKeys.has(key) })}>
          ${this._renderValue(key, item)}
        </td>
        <td class="store-owner">${meta.owner}</td>
        <td class="store-updated">
          ${meta.updated ? new Date(meta.updated).toLocaleString(window.i18next?.language) : '-'}
        </td>
        <td class="store-accessed">
          ${meta.accessed ? new Date(meta.accessed).toLocaleString(window.i18next?.language) : '-'}
        </td>
        <td class="store-actions">
          <button @click=${() => this._copyValue(key)} title=${this._t('store.actions.copy')}>
            <i class="mdi ${valueCopied ? 'mdi-check' : 'mdi-content-copy'}"></i>
          </button>
          <button @click=${() => this._editKey(key)} title=${this._t('store.actions.edit')}>
            <i class="mdi mdi-pencil"></i>
          </button>
          <button class="btn-danger" @click=${() => this._deleteKey(key)} title=${this._t('store.actions.delete')}>
            <i class="mdi mdi-delete-forever"></i>
          </button>
        </td>
      </tr>
    `;
  }

  render() {
    const keys = this._sortedKeys().filter((key) => this._matchesFilter(key, this._storeCache[key]));
    const totalKeys = Object.keys(this._storeCache).length;

    const columns: { id: SortColumn; label: string }[] = [
      { id: 'key', label: this._t('store.headers.key', 'Key') },
      { id: 'value', label: this._t('store.headers.value', 'Value') },
      { id: 'owner', label: this._t('store.headers.owner', 'Owner') },
      { id: 'updated', label: this._t('store.headers.updated', 'Updated') },
      { id: 'accessed', label: this._t('store.headers.accessed', 'Accessed') },
    ];

    return html`
      ${mdiStylesheetLink}
      <div class="store-toolbar">
        <h4>${this._t('store.title', 'Global Store (ha.store)')}</h4>
        <div class="store-search-box">
          <input
            type="text"
            class="store-search-input"
            placeholder=${this._t('store.actions.filter_placeholder', 'Filter...')}
            .value=${this._filter}
            @input=${this._onFilterInput}
          />
          <button
            class="store-search-clear ${this._filter ? '' : 'hidden'}"
            @click=${() => this._clearFilter()}
            title=${this._t('store.actions.clear_filter')}
          >
            <i class="mdi mdi-close"></i>
          </button>
        </div>
        <button title=${this._t('store.actions.add_variable')} @click=${() => window.openStoreModal?.()}>
          <i class="mdi mdi-plus"></i>
        </button>
        <button
          title=${this._t('store.actions.clear_all')}
          style="color: var(--danger)"
          @click=${() => this._clearAll()}
        >
          <i class="mdi mdi-delete-alert"></i>
        </button>
        <button title=${this._t('store.actions.refresh')} @click=${() => this._load()}>
          <i class="mdi mdi-refresh"></i>
        </button>
      </div>
      <div class="store-content">
        <table class="store-table">
          <thead>
            <tr>
              ${columns.map(
                (col) => html` <th @click=${() => this._sort(col.id)}>${col.label}${this._renderSortIcon(col.id)}</th> `
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              this._loading
                ? html`<tr class="store-placeholder">
                    <td colspan="6">${this._t('store.loading')}</td>
                  </tr>`
                : this._loadError
                  ? html`<tr class="store-placeholder error">
                      <td colspan="6">${this._loadError}</td>
                    </tr>`
                  : keys.length === 0
                    ? html`<tr class="store-placeholder">
                        <td colspan="6">${totalKeys === 0 ? this._t('store.empty') : this._t('store.no_results')}</td>
                      </tr>`
                    : repeat(
                        keys,
                        (key) => key,
                        (key) => this._renderRow(key)
                      )
            }
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'store-explorer': StoreExplorer;
  }
}
