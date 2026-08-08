import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import './confirm-dialog';
import type { ConfirmDialog } from './confirm-dialog';

describe('confirm-dialog', () => {
  afterEach(() => {
    delete window.i18next;
  });

  it('registers window.confirmDialog on connect', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    expect(window.confirmDialog?.confirm).to.equal(el.confirm);
  });

  it('renders nothing until confirm() is called', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    expect(el.shadowRoot!.querySelector('.modal-overlay')).to.be.null;
  });

  it('shows the message and title, and resolves true on confirm click', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    const resultPromise = el.confirm('Delete this script?', { title: 'Are you sure?' });
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('h3')?.textContent).to.equal('Are you sure?');
    expect(el.shadowRoot!.querySelector('p')?.textContent).to.equal('Delete this script?');

    el.shadowRoot!.querySelector<HTMLElement>('.btn-primary')!.click();
    expect(await resultPromise).to.be.true;
  });

  it('resolves false on cancel click', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    const resultPromise = el.confirm('Delete this script?');
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>('.btn-text')!.click();
    expect(await resultPromise).to.be.false;
  });

  it('resolves false on Escape', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    const resultPromise = el.confirm('Delete this script?');
    await el.updateComplete;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await resultPromise).to.be.false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal-overlay')).to.be.null;
  });

  it('resolves false on backdrop click, but a click inside the modal itself does not close it', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    const resultPromise = el.confirm('Delete this script?');
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>('.modal')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal-overlay')).to.not.be.null;

    el.shadowRoot!.querySelector<HTMLElement>('.modal-overlay')!.click();
    expect(await resultPromise).to.be.false;
  });

  it('applies the danger class to the confirm button when opts.danger is set', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    void el.confirm('Delete this script?', { danger: true });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.btn-primary')?.classList.contains('danger')).to.be.true;
  });

  it('uses custom confirm/cancel labels over the i18next defaults', async () => {
    window.i18next = { t: () => 'SHOULD NOT BE USED', language: 'en' };
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    void el.confirm('Delete this script?', { confirmLabel: 'Yes, delete', cancelLabel: 'No, keep it' });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.btn-primary')?.textContent?.trim()).to.equal('Yes, delete');
    expect(el.shadowRoot!.querySelector('.btn-text')?.textContent?.trim()).to.equal('No, keep it');
  });

  it('resolves a stale pending prompt with false when a new confirm() call arrives first', async () => {
    const el = await fixture<ConfirmDialog>(html`<confirm-dialog></confirm-dialog>`);
    const first = el.confirm('First question');
    await aTimeout(0);
    const second = el.confirm('Second question');

    expect(await first).to.be.false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('p')?.textContent).to.equal('Second question');

    el.shadowRoot!.querySelector<HTMLElement>('.btn-primary')!.click();
    expect(await second).to.be.true;
  });
});
