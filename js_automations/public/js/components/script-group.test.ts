import { fixture, html, expect, oneEvent } from '@open-wc/testing';
import './script-group';
import type { ScriptGroup } from './script-group';
import type { JsaScript } from './global';

describe('script-group', () => {
  afterEach(() => {
    delete window.i18next;
    delete window.haData;
  });

  it('renders the group key as a fallback display name when displayName is empty', async () => {
    const el = await fixture<ScriptGroup>(html`<script-group group-key="lighting"></script-group>`);
    const label = el.shadowRoot!.querySelector('.header-left span');
    expect(label?.textContent).to.equal('lighting');
  });

  it('prefers displayName over groupKey when both are set', async () => {
    const el = await fixture<ScriptGroup>(
      html`<script-group group-key="lighting" display-name="Lighting"></script-group>`
    );
    const label = el.shadowRoot!.querySelector('.header-left span');
    expect(label?.textContent).to.equal('Lighting');
  });

  it('shows the "no group" label via i18next when is-none is set', async () => {
    window.i18next = {
      t: (key: string, opts?: Record<string, unknown>) =>
        key === 'group_none' ? 'Unassigned' : ((opts?.defaultValue as string) ?? key),
      language: 'en',
    };
    const el = await fixture<ScriptGroup>(html`<script-group is-none></script-group>`);
    const label = el.shadowRoot!.querySelector('.header-left span');
    expect(label?.textContent).to.equal('Unassigned');
  });

  it('overrides name/icon/color from a matching HA label, case-insensitively', async () => {
    window.haData = {
      areas: [],
      labels: [{ name: 'Lighting', icon: 'mdi:lightbulb', color: '#ffaa00' }],
      services: {},
      language: null,
    };
    const el = await fixture<ScriptGroup>(html`<script-group group-key="lighting"></script-group>`);
    const label = el.shadowRoot!.querySelector('.header-left span');
    const icon = el.shadowRoot!.querySelector('.header-left i') as HTMLElement;
    expect(label?.textContent).to.equal('Lighting');
    expect(icon.className).to.contain('mdi-lightbulb');
    expect(icon.getAttribute('style')).to.contain('#ffaa00');
  });

  it('resolves HA theme-color slugs (e.g. "light-green") to their hex value', async () => {
    window.haData = {
      areas: [],
      labels: [{ name: 'Garden', icon: 'mdi:flower', color: 'light-green' }],
      services: {},
      language: null,
    };
    const el = await fixture<ScriptGroup>(html`<script-group group-key="garden"></script-group>`);
    const icon = el.shadowRoot!.querySelector('.header-left i') as HTMLElement;
    expect(icon.getAttribute('style')).to.contain('#8bc34a');
  });

  it('dispatches jsa-toggle-group with the group key on header click', async () => {
    const el = await fixture<ScriptGroup>(html`<script-group group-key="lighting"></script-group>`);
    const header = el.shadowRoot!.querySelector<HTMLElement>('.section-header')!;
    setTimeout(() => header.click());
    const event = await oneEvent(el, 'jsa-toggle-group');
    expect(event.detail.key).to.equal('lighting');
  });

  it('does not dispatch jsa-toggle-group while search is active', async () => {
    const el = await fixture<ScriptGroup>(html`<script-group group-key="lighting" search-active></script-group>`);
    const header = el.shadowRoot!.querySelector<HTMLElement>('.section-header')!;
    let dispatched = false;
    el.addEventListener('jsa-toggle-group', () => (dispatched = true));
    header.click();
    await el.updateComplete;
    expect(dispatched).to.be.false;
  });

  it('reflects collapsed state onto the header/content classes and chevron direction', async () => {
    const el = await fixture<ScriptGroup>(html`<script-group group-key="lighting" collapsed></script-group>`);
    const header = el.shadowRoot!.querySelector('.section-header');
    const content = el.shadowRoot!.querySelector('.group-content');
    const chevron = el.shadowRoot!.querySelector('.chevron');
    expect(header?.classList.contains('collapsed')).to.be.true;
    expect(content?.classList.contains('collapsed')).to.be.true;
    expect(chevron?.className).to.contain('mdi-chevron-down');
  });

  it('renders one script-row per script and passes the active flag correctly', async () => {
    const scripts = [{ filename: 'a.js', name: 'A' } as JsaScript, { filename: 'b.js', name: 'B' } as JsaScript];
    const el = await fixture<ScriptGroup>(
      html`<script-group .scripts=${scripts} active-filename="b.js"></script-group>`
    );
    const rows = el.shadowRoot!.querySelectorAll('script-row');
    expect(rows.length).to.equal(2);
    expect((rows[0] as unknown as { active: boolean }).active).to.be.false;
    expect((rows[1] as unknown as { active: boolean }).active).to.be.true;
  });
});
