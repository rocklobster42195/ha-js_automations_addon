import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { mdiStylesheetLink } from './mdi';
import type { JsaProposal } from './global';

/**
 * A script that exists only as a proposal of an AI assistant (access level "propose"): shown in the
 * sidebar block "Proposals", greyed out because it is not on disk yet. Pure presentation — the actions
 * bubble up as `jsa-proposal-review|apply|reject` events that `<app-sidebar>` handles.
 */
@customElement('proposal-row')
export class ProposalRow extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .proposal {
      padding: 8px 15px;
      border-bottom: 1px solid #1a1a1a;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 15px;
      width: 100%;
      box-sizing: border-box;
      opacity: 0.6;
    }
    .proposal:hover {
      background: #1c1c1c;
      opacity: 0.85;
    }
    .proposal.stale {
      opacity: 0.4;
    }
    .icon {
      font-size: 24px;
      color: #555;
      min-width: 24px;
      text-align: center;
    }
    .info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: 0.95rem;
      font-weight: 500;
      color: #aaa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-style: italic;
    }
    .note {
      font-size: 0.75rem;
      color: #777;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .note.stale-note {
      color: #f0a500;
    }
    .actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    button {
      width: 28px;
      height: 28px;
      color: var(--text-secondary);
      border-radius: 4px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    button i {
      font-size: 1.2rem;
    }
    button:hover:not(:disabled) {
      color: #fff;
      background: #333;
    }
    button:disabled {
      opacity: 0.35;
      cursor: default;
    }
  `;

  @property({ type: Object }) proposal!: JsaProposal;

  private _t(key: string, fallback?: string): string {
    return window.i18next?.t(key, { defaultValue: fallback }) ?? fallback ?? key;
  }

  private _emit(name: 'review' | 'apply' | 'reject', e?: Event): void {
    e?.stopPropagation();
    this.dispatchEvent(
      new CustomEvent(`jsa-proposal-${name}`, { detail: { id: this.proposal.id }, bubbles: true, composed: true })
    );
  }

  render() {
    const p = this.proposal;
    const stale = !!p.stale;
    return html`
      ${mdiStylesheetLink}
      <div
        class="proposal ${stale ? 'stale' : ''}"
        title=${p.message}
        data-proposal-id=${p.id}
        @click=${() => this._emit('review')}
      >
        <div class="icon"><i class="mdi mdi-file-plus-outline"></i></div>
        <div class="info">
          <div class="name">${p.filename}</div>
          <div class="note ${stale ? 'stale-note' : ''}">
            ${
              stale
                ? this._t('proposal_row_stale', 'Outdated: the file changed since. Ask the assistant again.')
                : this._t('proposal_row_new', 'New proposal')
            }
          </div>
        </div>
        <div class="actions">
          <button
            class="review"
            @click=${(e: Event) => this._emit('review', e)}
            title=${this._t('proposal_row_review', 'Review')}
          >
            <i class="mdi mdi-file-compare"></i>
          </button>
          <button
            class="apply"
            ?disabled=${stale}
            @click=${(e: Event) => this._emit('apply', e)}
            title=${this._t('proposal_apply', 'Apply')}
          >
            <i class="mdi mdi-check"></i>
          </button>
          <button
            class="reject"
            @click=${(e: Event) => this._emit('reject', e)}
            title=${this._t('proposal_reject', 'Reject')}
          >
            <i class="mdi mdi-close"></i>
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'proposal-row': ProposalRow;
  }
}
