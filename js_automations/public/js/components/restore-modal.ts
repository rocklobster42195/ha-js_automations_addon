import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface RestoreDiff {
  added: string[];
  changed: string[];
  deleted: string[];
}

type Step = 'upload' | 'uploading' | 'diff' | 'confirm' | 'applying' | 'success' | 'error';

/**
 * App-level restore wizard (separate from script-modal.ts — this is about the whole app's
 * state, not one script). Deliberately a rare, disaster-recovery flow: upload -> diff review
 * (selective, per-file checkboxes) -> confirm -> apply. Day-to-day single-file recovery is
 * git-manager.ts's job instead (see docs/internal/backup-concept.md).
 */
@customElement('restore-modal')
export class RestoreModal extends LitElement {
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
      width: 560px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      box-sizing: border-box;
    }

    h3 {
      margin: 0 0 16px 0;
      font-size: 1.1rem;
      color: var(--text-primary);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    p {
      margin: 0 0 14px;
      color: var(--text-primary);
      font-size: 0.9rem;
      line-height: 1.6;
    }

    .drop-zone {
      border: 2px dashed var(--border);
      border-radius: 8px;
      padding: 30px;
      text-align: center;
      cursor: pointer;
      color: var(--text-secondary);
    }
    .drop-zone:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }
    .drop-zone .mdi {
      font-size: 2rem;
      display: block;
      margin-bottom: 8px;
    }

    .center-status {
      text-align: center;
      padding: 30px 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .center-status .mdi {
      font-size: 1.6rem;
      display: block;
      margin-bottom: 10px;
    }

    .diff-toggle-all {
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 4px;
      font-weight: 500;
    }

    .diff-group-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin: 16px 0 6px;
    }
    .diff-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .diff-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.85rem;
    }
    .diff-row:hover {
      background: #1c1c1c;
    }
    .diff-row.deleted span {
      text-decoration: line-through;
      color: var(--text-secondary);
    }
    .diff-empty {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 20px 0;
    }

    .info-box {
      background: #0d2a1f;
      border-left: 3px solid var(--success);
      padding: 10px 12px;
      border-radius: 4px;
      font-size: 0.82rem;
      color: #a8d5b8;
      line-height: 1.5;
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
    }

    .modal-btns {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin-top: 20px;
    }
    .modal-btns-right {
      display: flex;
      gap: 15px;
      margin-left: auto;
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
    .btn-primary.warn {
      background: var(--warn);
      color: #1a1200;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .btn-text {
      background: transparent;
      color: var(--text-secondary);
      font-size: 0.85rem;
      padding: 10px;
    }
    .btn-text:hover {
      color: var(--text-primary);
    }
  `;

  @state() private _open = false;
  @state() private _step: Step = 'upload';
  @state() private _restoreId: string | null = null;
  @state() private _diff: RestoreDiff | null = null;
  @state() private _selected = new Set<string>();
  @state() private _errorMessage = '';
  @state() private _resultSnapshot = '';

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    window.restoreModal = { open: this.open };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (window.restoreModal?.open === this.open) delete window.restoreModal;
  }

  open = (): void => {
    this._step = 'upload';
    this._restoreId = null;
    this._diff = null;
    this._selected = new Set();
    this._errorMessage = '';
    this._open = true;
  };

  close = (): void => {
    if (this._restoreId && this._step !== 'success') {
      window.apiFetch!(`api/restore/${this._restoreId}`, { method: 'DELETE' }).catch(() => {});
    }
    this._open = false;
  };

  private async _onFileSelected(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    this._step = 'uploading';
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await window.apiFetch!('api/restore/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const { restoreId, diff } = await res.json();
      this._restoreId = restoreId;
      this._diff = diff;
      this._selected = new Set([...diff.added, ...diff.changed, ...diff.deleted]);
      this._step = 'diff';
    } catch (e) {
      this._errorMessage = e instanceof Error ? e.message : String(e);
      this._step = 'error';
    }
  }

  private _toggle(path: string): void {
    const next = new Set(this._selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._selected = next;
  }

  private get _allDiffPaths(): string[] {
    if (!this._diff) return [];
    return [...this._diff.changed, ...this._diff.added, ...this._diff.deleted];
  }

  private _toggleAll(): void {
    this._selected = this._selected.size === this._allDiffPaths.length ? new Set() : new Set(this._allDiffPaths);
  }

  private async _apply(): Promise<void> {
    if (!this._restoreId) return;
    this._step = 'applying';
    try {
      const res = await window.apiFetch!(`api/restore/${this._restoreId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedPaths: [...this._selected] }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const result = await res.json();
      this._resultSnapshot = result.preRestoreSnapshot;
      this._step = 'success';
    } catch (e) {
      this._errorMessage = e instanceof Error ? e.message : String(e);
      this._step = 'error';
    }
  }

  private _renderDiffGroup(title: string, color: string, paths: string[], strike: boolean) {
    if (paths.length === 0) return nothing;
    return html`
      <div class="diff-group-head">
        <span class="diff-dot" style="background: ${color}"></span>
        ${title} (${paths.length})
      </div>
      ${paths.map(
        (p) => html`
          <label class="diff-row ${strike ? 'deleted' : ''}">
            <input type="checkbox" .checked=${this._selected.has(p)} @change=${() => this._toggle(p)} />
            <span>${p}</span>
          </label>
        `
      )}
    `;
  }

  render() {
    if (!this._open) return html``;

    return html`
      ${mdiStylesheetLink}
      <div class="modal-overlay" @click=${() => (this._step === 'applying' ? null : this.close())}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <h3>
            <i class="mdi mdi-backup-restore"></i>
            ${this._t('restore_title', 'Backup wiederherstellen')}
          </h3>

          ${
            this._step === 'upload'
              ? html`
                  <p>${this._t('restore_upload_prompt', 'Lade eine Backup-ZIP-Datei hoch.')}</p>
                  <div
                    class="drop-zone"
                    @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#restore-file-input')?.click()}
                  >
                    <i class="mdi mdi-cloud-upload"></i>
                    ${this._t('restore_upload_prompt', 'Datei hier auswählen')}
                    <input
                      type="file"
                      id="restore-file-input"
                      accept=".zip"
                      style="display:none"
                      @change=${(e: Event) => this._onFileSelected((e.target as HTMLInputElement).files)}
                    />
                  </div>
                  <div class="modal-btns">
                    <button class="btn-text" @click=${() => this.close()}>
                      ${this._t('button_cancel', 'Abbrechen')}
                    </button>
                  </div>
                `
              : nothing
          }
          ${
            this._step === 'uploading'
              ? html`<div class="center-status">
                  <i class="mdi mdi-loading mdi-spin"></i>${this._t('restore_uploading', 'Lade hoch...')}
                </div>`
              : nothing
          }
          ${
            this._step === 'diff' && this._diff
              ? html`
                  <p>
                    ${this._t('restore_diff_intro', 'Unterschiede zum aktuellen Stand — wähle aus, was übernommen werden soll.')}
                  </p>
                  ${
                    this._allDiffPaths.length > 0
                      ? html`
                          <label class="diff-row diff-toggle-all">
                            <input
                              type="checkbox"
                              .checked=${this._selected.size === this._allDiffPaths.length}
                              .indeterminate=${this._selected.size > 0 && this._selected.size < this._allDiffPaths.length}
                              @change=${() => this._toggleAll()}
                            />
                            <span>${this._t('restore_diff_toggle_all', 'Alle auswählen / abwählen')}</span>
                          </label>
                        `
                      : nothing
                  }
                  ${this._renderDiffGroup(this._t('restore_diff_changed', 'Geändert'), 'var(--warn)', this._diff.changed, false)}
                  ${this._renderDiffGroup(this._t('restore_diff_added', 'Neu'), 'var(--success)', this._diff.added, false)}
                  ${this._renderDiffGroup(this._t('restore_diff_deleted', 'Gelöscht'), 'var(--danger)', this._diff.deleted, true)}
                  ${
                    this._diff.added.length + this._diff.changed.length + this._diff.deleted.length === 0
                      ? html`<div class="diff-empty">
                          ${this._t('restore_diff_empty', 'Keine Unterschiede gefunden.')}
                        </div>`
                      : nothing
                  }
                  <div class="modal-btns">
                    <button class="btn-text" @click=${() => this.close()}>
                      ${this._t('button_cancel', 'Abbrechen')}
                    </button>
                    <div class="modal-btns-right">
                      <button
                        class="btn-primary"
                        ?disabled=${this._selected.size === 0}
                        @click=${() => (this._step = 'confirm')}
                      >
                        ${this._t('button_next', 'Weiter')}
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            this._step === 'confirm'
              ? html`
                  <p>
                    ${this._t('restore_confirm_summary', '{{count}} Änderungen werden angewendet. Der Server startet dabei kurz neu.', { count: this._selected.size })}
                  </p>
                  <div class="info-box">
                    <i class="mdi mdi-shield-check"></i>
                    <span
                      >${this._t('restore_confirm_snapshot_hint', 'Vor dem Anwenden wird automatisch ein Snapshot des aktuellen Stands erstellt — jederzeit rückgängig machbar.')}</span
                    >
                  </div>
                  <div class="modal-btns">
                    <button class="btn-text" @click=${() => (this._step = 'diff')}>
                      ${this._t('button_back', 'Zurück')}
                    </button>
                    <div class="modal-btns-right">
                      <button class="btn-primary warn" @click=${() => this._apply()}>
                        ${this._t('restore_confirm_btn', 'Wiederherstellen')}
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            this._step === 'applying'
              ? html`<div class="center-status">
                  <i class="mdi mdi-loading mdi-spin"></i
                  >${this._t('restore_in_progress', 'Wiederherstellung läuft...')}
                </div>`
              : nothing
          }
          ${
            this._step === 'success'
              ? html`
                  <div class="info-box">
                    <i class="mdi mdi-check-circle"></i>
                    <span
                      >${this._t('restore_success_body', 'Wiederherstellung abgeschlossen. Sicherheits-Snapshot: {{filename}}.', { filename: this._resultSnapshot })}</span
                    >
                  </div>
                  <p>
                    ${this._t('restore_success_restart_hint', 'Ein Neustart des Addons wird empfohlen, damit MQTT/Webhooks die wiederhergestellte Konfiguration vollständig übernehmen.')}
                  </p>
                  <div class="modal-btns">
                    <div class="modal-btns-right">
                      <button class="btn-primary" @click=${() => (this._open = false)}>OK</button>
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            this._step === 'error'
              ? html`
                  <p style="color: var(--danger)">${this._t('restore_error_title', 'Fehler')}: ${this._errorMessage}</p>
                  <div class="modal-btns">
                    <div class="modal-btns-right">
                      <button class="btn-text" @click=${() => this.close()}>
                        ${this._t('button_cancel', 'Abbrechen')}
                      </button>
                      <button class="btn-primary" @click=${() => this.open()}>
                        ${this._t('button_retry', 'Erneut versuchen')}
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
        </div>
      </div>
    `;
  }
}
