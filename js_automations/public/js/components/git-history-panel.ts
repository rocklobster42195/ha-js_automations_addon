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

interface DiffModels {
  original: import('monaco-editor').editor.ITextModel;
  modified: import('monaco-editor').editor.ITextModel;
}

/**
 * Per-script commit history + diff, toggled from editor-view.ts's toolbar. Not a file tab (the
 * editor's tabs are open-file tabs) and not a modal — a side panel next to the Monaco editor,
 * matching the app's only other split-pane precedent (public/js/layout.js's log/dev-tools pane)
 * in spirit, reimplemented as plain Lit state since that one is imperative vanilla JS.
 *
 * Diffs are always rendered against the PREVIOUS commit, not the live (possibly unsaved) editor
 * buffer — keeps this component self-contained (it only talks to /api/git/*, no coupling to
 * editor-view's Monaco model reference) at the cost of not reflecting uncommitted edits, which
 * matches its purpose anyway: browsing what was actually committed.
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

    .diff-header {
      padding: 8px 14px;
      font-size: 0.7rem;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .diff-container {
      flex: 1;
      min-height: 0;
    }
    /* Monaco's inline diff view creates a "..." actions button (reusing the lightbulb icon
     * purely for styling) in the margin of every deleted-line region, revealed on hover — no
     * construction option gates it, only CSS. Not useful in a read-only viewer (this panel's
     * own "Load into editor" button is the one recovery action offered), and its 16px icon in a
     * ~40px-wide margin reads as a broken glyph at this panel's narrow width. */
    .diff-container .lightbulb-glyph {
      display: none !important;
    }
    /* renderSideBySide: false still keeps a separate ".editor.original" pane alive internally —
     * a redundant ~33px gutter sliver showing the original file's own line numbers (e.g. a stray
     * "1" for an otherwise-empty original) plus a diagonal no-content hatch. The actual deleted
     * line text is rendered inline inside the modified pane's view zones, so this sliver is pure
     * visual noise here (confirmed live: hiding it leaves the red/green inline diff intact). */
    .diff-container .editor.original {
      display: none !important;
    }
    /* Monaco's "moved code" connector-line overlay — only ever populated when
     * renderSideBySide is true (see diffEditorOptions.js's showMoves derivation), which this
     * panel disables, so it's always empty of content. Its <svg> element still gets a non-zero
     * position/size from general layout metrics even with nothing to draw, though. Hidden
     * defensively since it has no function in this read-only, inline-only view either way. */
    .diff-container .moved-blocks-lines {
      display: none !important;
    }

    .restore-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .restore-btn {
      width: 100%;
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
      gap: 8px;
      font-family: inherit;
    }
    .restore-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
    .restore-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .restore-hint {
      font-size: 0.68rem;
      color: var(--text-muted);
      margin-top: 6px;
      text-align: center;
      line-height: 1.4;
    }
  `;

  @property({ type: String }) filename = '';

  @state() private _commits: CommitEntry[] = [];
  @state() private _loading = false;
  @state() private _selectedHash: string | null = null;
  @state() private _restoring = false;

  private _diffBefore = '';
  private _diffAfter = '';
  private _diffEditor: import('monaco-editor').editor.IStandaloneDiffEditor | null = null;

  private _t(key: string, fallback?: string, options?: Record<string, unknown>): string {
    return window.i18next?.t(key, { defaultValue: fallback, ...options }) ?? fallback ?? key;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadCommits();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    const models = this._diffEditor?.getModel() as DiffModels | null | undefined;
    models?.original?.dispose();
    models?.modified?.dispose();
    this._diffEditor?.dispose();
    this._diffEditor = null;
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
      if (this._commits.length > 0) await this._selectCommit(this._commits[0].hash);
    } catch (e) {
      console.error('[git-history-panel] Failed to load history', e);
    } finally {
      this._loading = false;
    }
  }

  private async _selectCommit(hash: string): Promise<void> {
    this._selectedHash = hash;
    try {
      const res = await window.apiFetch!(
        `api/git/diff?hash1=${encodeURIComponent(hash + '~1')}&hash2=${encodeURIComponent(hash)}&file=${encodeURIComponent(this.filename)}`
      );
      const { before, after } = await res.json();
      this._diffBefore = before ?? '';
      this._diffAfter = after ?? '';
      await this.updateComplete;
      this._renderDiff();
    } catch (e) {
      console.error('[git-history-panel] Failed to load diff', e);
    }
  }

  private _renderDiff(): void {
    if (!window.monaco) return;
    const container = this.renderRoot.querySelector<HTMLElement>('#diff-container');
    if (!container) return;

    if (!this._diffEditor) {
      this._diffEditor = window.monaco.editor.createDiffEditor(container, {
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: false,
        minimap: { enabled: false },
        theme: 'vs-dark',
        fontSize: 12,
        // This is a compact, read-only glance at one commit's diff — Monaco's interactive chrome
        // for editing a diff (copy/revert arrows in the gutter, +/- indicator glyphs, collapsible
        // unchanged-region widget, quick-fix lightbulb) has no use in a read-only viewer and was
        // reported as visibly broken (stray gutter icons, a broken-looking glyph) at this panel's
        // narrow width. Disabled outright rather than just hidden via CSS, so nothing half-renders.
        renderMarginRevertIcon: false,
        renderIndicators: false,
        hideUnchangedRegions: { enabled: false },
        folding: false,
      });
      // The diff editor doesn't forward `lightbulb`/`folding` from its own construction options
      // down to the two inner standalone editors (reproduced live for lightbulb — the glyph
      // stayed even with it set above), so they have to be disabled directly on each side too.
      this._diffEditor.getOriginalEditor().updateOptions({ lightbulb: { enabled: false }, folding: false });
      this._diffEditor.getModifiedEditor().updateOptions({ lightbulb: { enabled: false }, folding: false });
    }

    const language = this.filename.endsWith('.ts') ? 'typescript' : 'javascript';
    const oldModels = this._diffEditor.getModel() as DiffModels | null;
    const original = window.monaco.editor.createModel(this._diffBefore, language);
    const modified = window.monaco.editor.createModel(this._diffAfter, language);
    this._diffEditor.setModel({ original, modified });
    oldModels?.original?.dispose();
    oldModels?.modified?.dispose();

    // The panel mounts this while the commit list above it is still showing its loading
    // spinner (a single short row) — the moment loading finishes, the real commit list is
    // taller and pushes/resizes this container. automaticLayout's own ResizeObserver doesn't
    // always recover cleanly from a resize that happens in the same tick as initial mount
    // (garbled/overlapping line positions, reproduced live). Force a fresh layout pass a
    // couple of frames later, once the surrounding layout has actually settled.
    requestAnimationFrame(() => requestAnimationFrame(() => this._diffEditor?.layout()));
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
              <div class="diff-header">${this._t('history_diff_label', 'Diff vs. previous commit')}</div>
              <div id="diff-container" class="diff-container"></div>
              <div class="restore-footer">
                <button class="restore-btn" ?disabled=${this._restoring} @click=${() => this._restoreSelected()}>
                  <i class="mdi mdi-history"></i>
                  ${this._t('history_load_into_editor', 'Load into editor')}
                </button>
                <div class="restore-hint">${this._t('history_restore_hint')}</div>
              </div>
            `
          : nothing
      }
    `;
  }
}
