import { fixture, html, expect, oneEvent } from '@open-wc/testing';
import './proposal-row';
import './script-row';
import type { ProposalRow } from './proposal-row';
import type { ScriptRow } from './script-row';
import type { JsaProposal, JsaScript } from './global';

const proposal = (over: Partial<JsaProposal> = {}): JsaProposal => ({
  id: 3,
  kind: 'script',
  filename: 'garage.ts',
  card: null,
  isNew: true,
  message: 'mcp: garage watch',
  warnings: [],
  status: 'open',
  reason: null,
  updatedAt: 1,
  ...over,
});

const script: JsaScript = { filename: 'garage.ts', name: 'Garage', status: 'stopped' };

describe('proposal-row (new file that exists only as a proposal)', () => {
  it('shows the file name greyed out with a "not created yet" note', async () => {
    const el = await fixture<ProposalRow>(html`<proposal-row .proposal=${proposal()}></proposal-row>`);
    expect(el.shadowRoot!.querySelector('.name')!.textContent).to.equal('garage.ts');
    expect(el.shadowRoot!.querySelector('.note')!.textContent!.trim()).to.equal('New proposal');
    expect(el.shadowRoot!.querySelector('.proposal')!.classList.contains('stale')).to.equal(false);
  });

  it('has review, apply and reject instead of start/stop; each bubbles an event with the id', async () => {
    const el = await fixture<ProposalRow>(html`<proposal-row .proposal=${proposal()}></proposal-row>`);
    for (const [selector, event] of [
      ['.review', 'jsa-proposal-review'],
      ['.apply', 'jsa-proposal-apply'],
      ['.reject', 'jsa-proposal-reject'],
    ]) {
      setTimeout(() => (el.shadowRoot!.querySelector(selector) as HTMLElement).click());
      const e = (await oneEvent(el, event)) as CustomEvent<{ id: number }>;
      expect(e.detail.id).to.equal(3);
    }
  });

  it('a click on the row opens the review', async () => {
    const el = await fixture<ProposalRow>(html`<proposal-row .proposal=${proposal()}></proposal-row>`);
    setTimeout(() => (el.shadowRoot!.querySelector('.proposal') as HTMLElement).click());
    const e = (await oneEvent(el, 'jsa-proposal-review')) as CustomEvent<{ id: number }>;
    expect(e.detail.id).to.equal(3);
  });

  it('an outdated proposal says so and cannot be applied', async () => {
    const el = await fixture<ProposalRow>(html`<proposal-row .proposal=${proposal({ stale: true })}></proposal-row>`);
    expect(el.shadowRoot!.querySelector('.note')!.textContent).to.contain('Outdated');
    expect((el.shadowRoot!.querySelector('.apply') as HTMLButtonElement).disabled).to.equal(true);
    expect((el.shadowRoot!.querySelector('.reject') as HTMLButtonElement).disabled).to.equal(false);
  });
});

describe('script-row with a proposed change', () => {
  it('shows no proposal line for a script without proposals', async () => {
    const el = await fixture<ScriptRow>(html`<script-row .script=${script}></script-row>`);
    expect(el.shadowRoot!.querySelector('.proposal-line')).to.equal(null);
  });

  it('keeps the normal row and adds a marker line with review, apply and reject', async () => {
    const el = await fixture<ScriptRow>(
      html`<script-row
        .script=${script}
        .proposals=${[proposal({ isNew: false, change: 'update garage.ts: +4/-1 lines' })]}
      ></script-row>`
    );
    const line = el.shadowRoot!.querySelector('.proposal-line')!;
    expect(line.textContent).to.contain('Change proposed');
    expect(el.shadowRoot!.querySelector('.script-row .btn-row')).to.not.equal(null); // start/stop stay
    setTimeout(() => (el.shadowRoot!.querySelector('.p-apply') as HTMLElement).click());
    const e = (await oneEvent(el, 'jsa-proposal-apply')) as CustomEvent<{ id: number }>;
    expect(e.detail.id).to.equal(3);
  });

  it('names a card proposal and counts further ones', async () => {
    const el = await fixture<ScriptRow>(
      html`<script-row
        .script=${script}
        .proposals=${[
          proposal({ id: 4, kind: 'card', isNew: false }),
          proposal({ id: 5, kind: 'card', card: 'garage-day-card', isNew: false }),
        ]}
      ></script-row>`
    );
    const text = el.shadowRoot!.querySelector('.proposal-line .proposal-text')!.textContent!;
    expect(text).to.contain('Card change proposed');
    expect(text).to.contain('(+1)');
  });

  it('an outdated proposal is marked and cannot be applied', async () => {
    const el = await fixture<ScriptRow>(
      html`<script-row .script=${script} .proposals=${[proposal({ isNew: false, stale: true })]}></script-row>`
    );
    expect(el.shadowRoot!.querySelector('.proposal-line')!.classList.contains('stale')).to.equal(true);
    expect((el.shadowRoot!.querySelector('.p-apply') as HTMLButtonElement).disabled).to.equal(true);
  });

  it('closed proposals are not shown on the row', async () => {
    const el = await fixture<ScriptRow>(
      html`<script-row .script=${script} .proposals=${[proposal({ isNew: false, status: 'rejected' })]}></script-row>`
    );
    expect(el.shadowRoot!.querySelector('.proposal-line')).to.equal(null);
  });
});
