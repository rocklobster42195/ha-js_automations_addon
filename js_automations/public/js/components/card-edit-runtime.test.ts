import { expect, aTimeout } from '@open-wc/testing';
// The runtime is browser code that the backend injects into every Script Pack card;
// here it runs in real Chromium (Shadow DOM, computed style, MutationObserver).
// The explicit .ts extension makes the test runner pick the source, not the compiled CommonJS twin.
// @ts-expect-error TS5097: only the esbuild test pipeline resolves it, tsc never emits this file
import { createCardEditRuntime } from '../../../core/card-edit-runtime.ts';

const META = { name: 'Trash Reminder', icon: 'mdi:trash-can' };
let counter = 0;

type CardOptions = { hidden?: boolean; preview?: string };

/** Defines a throw-away card that hides itself like trash_reminder does. */
function defineCard(options: CardOptions = {}) {
  const rt = createCardEditRuntime(window, META);
  const tag = `jsa-test-card-${++counter}`;
  class TestCard extends HTMLElement {
    hidden_ = options.hidden !== false;
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.render();
    }
    render() {
      this.shadowRoot!.innerHTML = this.hidden_
        ? '<style>:host{display:none}</style>'
        : '<style>:host{display:block}</style><div id="content" style="height:40px">content</div>';
    }
    set hass(_v: unknown) {
      /* the runtime wraps this setter */
    }
    static getPreview?: () => string;
  }
  if (options.preview) TestCard.getPreview = () => options.preview as string;
  rt.installDefineHook();
  customElements.define(tag, TestCard);
  return { tag, rt, TestCard };
}

function mount(tag: string, wrapperTag?: string) {
  const card = document.createElement(tag) as HTMLElement & { render(): void; hidden_: boolean };
  let root: HTMLElement = card;
  if (wrapperTag) {
    root = document.createElement(wrapperTag);
    root.appendChild(card);
  }
  document.body.appendChild(root);
  return { card, root };
}

const placeholder = (card: HTMLElement) => card.shadowRoot!.querySelector('[data-jsa-edit].jsa-ph');
const settle = () => aTimeout(30);

describe('card-edit-runtime (real browser)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    history.replaceState(null, '', location.pathname);
  });

  it('leaves a self-hiding card alone in normal operation', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag);
    await settle();
    expect(placeholder(card)).to.be.null;
    expect(getComputedStyle(card).display).to.equal('none');
  });

  it('shows a generic placeholder with name, icon and localized text inside hui-card-options', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    const ph = placeholder(card)!;
    expect(ph).to.exist;
    expect(getComputedStyle(card).display).to.equal('block');
    expect(ph.querySelector('.jsa-ph-name')!.textContent).to.equal('Trash Reminder');
    expect(ph.querySelector('.jsa-ph-text')!.textContent).to.match(/hidden|ausgeblendet/);
    expect(ph.querySelector('ha-icon')!.getAttribute('icon')).to.equal('mdi:trash-can');
    expect(getComputedStyle(ph).opacity).to.equal('0.6');
    expect(getComputedStyle(ph).borderTopStyle).to.equal('dashed');
  });

  it('does not touch a visible card in edit mode', async () => {
    const { tag } = defineCard({ hidden: false });
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    expect(placeholder(card)).to.be.null;
  });

  it('uses getPreview() instead of the generic placeholder', async () => {
    const { tag } = defineCard({ preview: '<b id="rich">Rich preview</b>' });
    const { card } = mount(tag, 'hui-card-preview');
    await settle();
    expect(card.shadowRoot!.querySelector('#rich')).to.exist;
    expect(card.shadowRoot!.querySelector('.jsa-ph-name')).to.be.null;
  });

  it('falls back to the generic placeholder when getPreview() throws', async () => {
    const { tag, TestCard } = defineCard();
    TestCard.getPreview = () => {
      throw new Error('boom');
    };
    const { card } = mount(tag, 'hui-card-preview');
    await settle();
    expect(card.shadowRoot!.querySelector('.jsa-ph-name')).to.exist;
  });

  it('follows ?edit=1 and location-changed without a reload', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag);
    await settle();
    expect(placeholder(card)).to.be.null;

    history.replaceState(null, '', `${location.pathname}?edit=1`);
    window.dispatchEvent(new Event('location-changed'));
    await settle();
    expect(placeholder(card)).to.exist;

    history.replaceState(null, '', location.pathname);
    window.dispatchEvent(new Event('location-changed'));
    await settle();
    expect(placeholder(card)).to.be.null;
  });

  it('follows lovelace.editMode of an ancestor', async () => {
    const { tag } = defineCard();
    const { card, root } = mount(tag, 'hui-view');
    (root as any).lovelace = { editMode: false };
    await settle();
    expect(placeholder(card)).to.be.null;

    (root as any).lovelace = { editMode: true };
    window.dispatchEvent(new Event('location-changed'));
    await settle();
    expect(placeholder(card)).to.exist;
  });

  it('removes the placeholder once the card renders real content', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    expect(placeholder(card)).to.exist;

    card.hidden_ = false;
    card.render();
    await settle();
    expect(placeholder(card)).to.be.null;
    expect(card.shadowRoot!.querySelector('#content')).to.exist;
    expect(getComputedStyle(card).display).to.equal('block');
  });

  it('brings the placeholder back when the card hides itself again', async () => {
    const { tag } = defineCard({ hidden: false });
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    expect(placeholder(card)).to.be.null;

    card.hidden_ = true;
    card.render();
    await settle();
    expect(placeholder(card)).to.exist;
  });

  it('re-adds the placeholder when the card re-renders itself hidden (no stale gap)', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    card.render();
    // The observer callback runs as a microtask, i.e. before the next paint.
    await Promise.resolve();
    expect(placeholder(card)).to.exist;
  });

  it('does not loop: the placeholder stays a single instance across evaluations', async () => {
    const { tag } = defineCard();
    const { card } = mount(tag, 'hui-card-options');
    await settle();
    const first = placeholder(card);
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event('location-changed'));
      (card as any).hass = {};
    }
    await settle();
    expect(card.shadowRoot!.querySelectorAll('[data-jsa-edit]').length).to.equal(2);
    expect(placeholder(card)).to.equal(first);
  });

  it('cleans up on disconnect and stops listening once the last card is gone', async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: any[]) => {
      added.push(type);
      return (add as any)(type, ...rest);
    }) as any;
    window.removeEventListener = ((type: string, ...rest: any[]) => {
      removed.push(type);
      return (remove as any)(type, ...rest);
    }) as any;
    try {
      const { tag } = defineCard();
      const { card, root } = mount(tag, 'hui-card-options');
      await settle();
      expect(placeholder(card)).to.exist;
      expect(added).to.include('location-changed');

      root.remove();
      expect(placeholder(card)).to.be.null;
      expect(removed).to.include('location-changed');
      expect(removed).to.include('popstate');
    } finally {
      window.addEventListener = add as any;
      window.removeEventListener = remove as any;
    }
  });

  it('releases customElements.define after the card file ran', async () => {
    const original = customElements.define;
    defineCard();
    await Promise.resolve();
    await Promise.resolve();
    expect(customElements.define).to.equal(original);
  });
});
