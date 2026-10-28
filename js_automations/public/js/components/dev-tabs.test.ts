import { fixture, html, expect } from '@open-wc/testing';
import { applyDevTabVisibility, DEV_TABS } from './dev-tabs';
import type { JsaSettings } from './global';

/** Same markup and click behavior as index.html + layout.js's initDevPanelTabs(). */
async function mountDevTools(): Promise<HTMLElement> {
  const root = await fixture<HTMLElement>(html`
    <div>
      <div class="log-pane-tab-bar">
        ${DEV_TABS.map(
          (name, i) => html`<button class="log-pane-tab ${i === 0 ? 'active' : ''}" data-tab=${name}>${name}</button>`
        )}
      </div>
      <div>
        ${DEV_TABS.map(
          (name, i) => html`<div id="dev-tab-${name}" class="dev-tab-panel ${i === 0 ? '' : 'hidden'}"></div>`
        )}
      </div>
    </div>
  `);
  root.querySelector('.log-pane-tab-bar')!.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.log-pane-tab');
    if (!tab) return;
    root.querySelectorAll('.log-pane-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    root
      .querySelectorAll('.dev-tab-panel')
      .forEach((p) => p.classList.toggle('hidden', p.id !== `dev-tab-${tab.dataset.tab}`));
  });
  return root;
}

const off = (...names: string[]): JsaSettings => ({
  general: Object.fromEntries(names.map((n) => [`devtab_${n}`, false])),
});
const button = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLElement>(`.log-pane-tab[data-tab="${name}"]`)!;
const panel = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`#dev-tab-${name}`)!;
const activeTab = (root: HTMLElement) => root.querySelector<HTMLElement>('.log-pane-tab.active')?.dataset.tab;

describe('dev-tabs: switching dev-tools tabs off', () => {
  it('shows every tab when nothing is configured', async () => {
    const root = await mountDevTools();
    applyDevTabVisibility(undefined, root);
    applyDevTabVisibility({}, root);
    for (const name of DEV_TABS) expect(button(root, name).classList.contains('hidden')).to.equal(false);
    expect(activeTab(root)).to.equal('watch');
  });

  it('hides the button and the panel of a switched-off tab, leaving the others alone', async () => {
    const root = await mountDevTools();
    applyDevTabVisibility(off('repl', 'mqtt'), root);

    expect(button(root, 'repl').classList.contains('hidden')).to.equal(true);
    expect(button(root, 'mqtt').classList.contains('hidden')).to.equal(true);
    expect(panel(root, 'repl').classList.contains('hidden')).to.equal(true);
    for (const name of ['watch', 'events', 'webhooks', 'mcp']) {
      expect(button(root, name).classList.contains('hidden')).to.equal(false);
    }
    expect(activeTab(root)).to.equal('watch');
    expect(panel(root, 'watch').classList.contains('hidden')).to.equal(false);
  });

  it('moves to the first visible tab when the active one is switched off', async () => {
    const root = await mountDevTools();
    applyDevTabVisibility(off('watch', 'repl'), root);

    expect(activeTab(root)).to.equal('mqtt');
    expect(panel(root, 'mqtt').classList.contains('hidden')).to.equal(false);
    expect(panel(root, 'watch').classList.contains('hidden')).to.equal(true);
  });

  it('keeps a still-visible active tab selected', async () => {
    const root = await mountDevTools();
    button(root, 'events').click();
    applyDevTabVisibility(off('watch'), root);
    expect(activeTab(root)).to.equal('events');
  });

  it('brings a tab back when it is switched on again', async () => {
    const root = await mountDevTools();
    applyDevTabVisibility(off('repl'), root);
    applyDevTabVisibility({}, root);
    expect(button(root, 'repl').classList.contains('hidden')).to.equal(false);
    button(root, 'repl').click();
    expect(panel(root, 'repl').classList.contains('hidden')).to.equal(false);
  });

  it('copes with all tabs off, and recovers when one comes back', async () => {
    const root = await mountDevTools();
    applyDevTabVisibility(off(...DEV_TABS), root);
    expect(activeTab(root)).to.equal(undefined);
    for (const name of DEV_TABS) expect(panel(root, name).classList.contains('hidden')).to.equal(true);

    applyDevTabVisibility(off('watch', 'repl', 'mqtt', 'events', 'webhooks'), root);
    expect(activeTab(root)).to.equal('mcp');
    expect(panel(root, 'mcp').classList.contains('hidden')).to.equal(false);
  });

  it('does nothing without a tab bar', async () => {
    const empty = await fixture<HTMLElement>(html`<div></div>`);
    expect(() => applyDevTabVisibility(off('watch'), empty)).to.not.throw();
  });
});
