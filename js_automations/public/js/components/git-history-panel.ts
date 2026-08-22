import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';

interface CommitEntry {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
}

/**
 * Per-script commit list, toggled from editor-view.ts's toolbar. Not a file tab (the editor's
 * tabs are open-file tabs) and not a modal — a side panel next to the Monaco editor, matching the
 * app's only other split-pane precedent (public/js/layout.js's log/dev-tools pane) in spirit,
 * reimplemented as plain Lit state since that one is imperative vanilla JS.
 *
 * Purely a commit list + restore action — the diff itself opens as a full-width tab (see
 * editor-view.ts's openDiffTab) rather than rendering inline here, since a Monaco diff editor
 * squeezed into this panel's 380px width was reported as too cramped to be useful once past
 * trivial diffs. "Load into editor" still fetches a single commit's content directly (unrelated
 * to the diff view) for reviewing/restoring one historical version into the active tab.
 */
@customElement('git-history-panel')
export class GitHistoryPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 380px;
      flex-shrink: 0;
      background: var(--surface-1);
      border-left: 1px solid var(--border);
    }

    .header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .header .title {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close-btn {
      margin-left: auto;
      color: var(--text-muted);
      background: none;
      border: none;
      cursor: pointer;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: #252525;
    }

    .commit-list {
      max-height: 200px;
      overflow-y: auto;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .empty {
      padding: 16px 14px;
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
    }
    .commit-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 14px;
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .commit-row:hover {
      background: #1c1c1c;
    }
    .commit-row.active {
      background: var(--surface-2);
      border-left-color: var(--accent);
    }
    .commit-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
      margin-top: 6px;
      flex-shrink: 0;
    }
    .commit-row.active .commit-dot {
      background: var(--accent);
    }
    .commit-info {
      min-width: 0;
      flex: 1;
    }
    .commit-message {
      font-size: 0.8rem;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit-meta {
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 2px;
      font-family: monospace;
    }

    .diff-actions {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .open-diff-btn,
    .restore-btn {
      flex: 1;
      min-width: 0;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text-primary);
      border-radius: 6px;
      padding: 8px;
      font-size: 0.82rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: inherit;
      overflow: hidden;
      white-space: nowrap;
    }
    .open-diff-btn:hover,
    .restore-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
    .restore-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  @property({ type: String }) filename = '';

  @state() private _commits: CommitEntry[] = [];
  @state() private _loading = false;
  @state() private _selectedHash: string | null = null;
  @state() private _restoring = false;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadCommits();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('filename')) this._loadCommits();
  }

  private async _loadCommits(): Promise<void> {
    if (!this.filename) return;
    this._loading = true;
    this._commits = [];
    this._selectedHash = null;
    try {
      const res = await window.apiFetch!(`api/git/log?file=${encodeURIComponent(this.filename)}`);
      this._commits = await res.json();
      if (this._commits.length > 0) this._selectCommit(this._commits[0].hash);
    } catch (e) {
      console.error('[git-history-panel] Failed to load history', e);
    } finally {
      this._loading = false;
    }
  }

  private _selectCommit(hash: string): void {
    this._selectedHash = hash;
  }

  /** Dispatched up to editor-view.ts's openDiffTab — the diff itself renders as a full-width
   * tab, not inline here (see class doc comment). */
  private _openDiffTab(): void {
    if (!this._selectedHash) return;
    const commit = this._commits.find((c) => c.hash === this._selectedHash);
    this.dispatchEvent(
      new CustomEvent('open-diff-tab', {
        detail: {
          filename: this.filename,
          hash: this._selectedHash,
          shortHash: commit?.shortHash,
          message: commit?.message,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async _restoreSelected(): Promise<void> {
    if (!this._selectedHash) return;
    this._restoring = true;
    try {
      const res = await window.apiFetch!(
        `api/git/show?hash=${encodeURIComponent(this._selectedHash)}&file=${encodeURIComponent(this.filename)}`
      );
      if (!res.ok) throw new Error((await res.text()) || `Status ${res.status}`);
      const { content } = await res.json();
      this.dispatchEvent(new CustomEvent('restore-into-editor', { detail: { content } }));
    } catch (e) {
      window.alertToast?.show(
        this._t('history_restore_error', 'Failed to load version: {{error}}', {
          error: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      this._restoring = false;
    }
  }

  render() {
    return html`
      ${mdiStylesheetLink}
      <div class="header">
        <i class="mdi mdi-history"></i>
        <span class="title">${this._t('history_panel_title', 'History')} &mdash; ${this.filename}</span>
        <button class="close-btn" @click=${() => this.dispatchEvent(new CustomEvent('close'))}>
          <i class="mdi mdi-close"></i>
        </button>
      </div>

      <div class="commit-list">
        ${
          this._loading
            ? html`<div class="empty"><i class="mdi mdi-loading mdi-spin"></i></div>`
            : this._commits.length === 0
              ? html`<div class="empty">${this._t('history_no_commits', 'No commits yet.')}</div>`
              : this._commits.map(
                  (c) => html`
                    <div
                      class="commit-row ${c.hash === this._selectedHash ? 'active' : ''}"
                      @click=${() => this._selectCommit(c.hash)}
                    >
                      <div class="commit-dot"></div>
                      <div class="commit-info">
                        <div class="commit-message">${c.message}</div>
                        <div class="commit-meta">${new Date(c.date).toLocaleString()} &middot; ${c.shortHash}</div>
                      </div>
                    </div>
                  `
                )
        }
      </div>

      ${
        this._selectedHash
          ? html`
              <div class="diff-actions">
                <button
                  class="open-diff-btn"
                  title=${this._t('history_open_diff_tab_button', 'Open diff in tab')}
                  @click=${() => this._openDiffTab()}
                >
                  <i class="mdi mdi-file-compare"></i>
                  ${this._t('history_open_diff_tab_button_short', 'Diff')}
                </button>
                <button
                  class="restore-btn"
                  ?disabled=${this._restoring}
                  title=${this._t('history_restore_hint')}
                  @click=${() => this._restoreSelected()}
                >
                  <i class="mdi mdi-history"></i>
                  ${this._t('history_load_into_editor_short', 'Load')}
                </button>
              </div>
            `
          : nothing
      }
    `;
  }
}
