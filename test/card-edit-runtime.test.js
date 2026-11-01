const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createCardEditRuntime, CARD_EDIT_RUNTIME_SOURCE } = require('../js_automations/core/card-edit-runtime.js');

const META = { name: 'Trash Reminder', icon: 'mdi:trash-can' };

/** Minimal fake of the parts of the window the detection / hidden logic touches. */
function fakeWin({ search = '', display = 'block' } = {}) {
  return {
    location: { search },
    URLSearchParams,
    getComputedStyle: () => ({ display, visibility: 'visible' }),
    document: { documentElement: { lang: '' } },
    navigator: { language: 'en-US' },
    HTMLElement: class {},
  };
}

/** Builds a parent chain from outer to inner and returns the innermost node (the card host). */
function innermost(...outerToInner) {
  const nodes = [];
  let parent = null;
  for (const spec of outerToInner) {
    const node = { localName: 'div', parentNode: parent, ...(typeof spec === 'string' ? { localName: spec } : spec) };
    nodes.push(node);
    parent = node;
  }
  return nodes[nodes.length - 1];
}

test('source: the factory is self-contained and can be evaluated standalone', () => {
  const factory = new Function(`return (${CARD_EDIT_RUNTIME_SOURCE})`)();
  const rt = factory(fakeWin(), META);
  assert.equal(typeof rt.installDefineHook, 'function');
  assert.equal(rt.isEditing(innermost('div')), false);
});

test('detect: nothing special -> not editing', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.deepEqual(rt.detect(innermost('hui-root', 'hui-view', 'hui-card', 'my-card')), {
    editing: false,
    preview: false,
  });
});

test('detect: picker preview ancestor -> preview and editing', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  const host = innermost('hui-dialog-edit-card', 'hui-card-preview', 'hui-card', 'my-card');
  assert.deepEqual(rt.detect(host), { editing: true, preview: true });
  assert.equal(rt.isPreview(host), true);
  assert.equal(rt.isEditing(host), true);
});

test('detect: picker tile directly inside hui-card-picker (HA 2026.8, no hui-card-preview)', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  const host = innermost('hui-dialog-create-card', 'hui-card-picker', 'div', 'div', 'my-card');
  assert.deepEqual(rt.detect(host), { editing: true, preview: true });
});

test('detect: Masonry edit wrapper hui-card-options -> editing, not preview', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  const host = innermost('hui-view', 'hui-card-options', 'hui-card', 'my-card');
  assert.deepEqual(rt.detect(host), { editing: true, preview: false });
});

test('detect: Sections wrapper hui-card-edit-mode counts only while editMode is not false', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(
    rt.isEditing(innermost('hui-section', { localName: 'hui-card-edit-mode', editMode: true }, 'my-card')),
    true
  );
  assert.equal(
    rt.isEditing(innermost('hui-section', { localName: 'hui-card-edit-mode', editMode: false }, 'my-card')),
    false
  );
  assert.equal(rt.isEditing(innermost('hui-section', 'hui-card-edit-mode', 'my-card')), true);
});

test('detect: hui-card with preview=true (HA forces visibility in edit mode)', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(rt.isEditing(innermost('hui-view', { localName: 'hui-card', preview: true }, 'my-card')), true);
  assert.equal(rt.isEditing(innermost('hui-view', { localName: 'hui-card', preview: false }, 'my-card')), false);
});

test('detect: lovelace.editMode on an ancestor (hui-root / hui-view / hui-section)', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(
    rt.isEditing(innermost({ localName: 'hui-root', lovelace: { editMode: true } }, 'hui-view', 'my-card')),
    true
  );
  assert.equal(
    rt.isEditing(innermost({ localName: 'hui-root', lovelace: { editMode: false } }, 'hui-view', 'my-card')),
    false
  );
});

test('detect: URL ?edit=1 is the fallback when no ancestor exposes lovelace', () => {
  const rt = createCardEditRuntime(fakeWin({ search: '?edit=1' }), META);
  assert.equal(rt.isEditing(innermost('ha-panel-lovelace', 'my-card')), true);
  assert.equal(rt.isEditing(), true, 'without a host the URL alone decides');
  const none = createCardEditRuntime(fakeWin({ search: '?foo=1' }), META);
  assert.equal(none.isEditing(innermost('my-card')), false);
  assert.equal(createCardEditRuntime(fakeWin({ search: '?edit=0' }), META).isEditing(), false);
});

test('detect: an authoritative lovelace.editMode=false beats a stale ?edit=1', () => {
  const rt = createCardEditRuntime(fakeWin({ search: '?edit=1' }), META);
  assert.equal(rt.isEditing(innermost({ localName: 'hui-root', lovelace: { editMode: false } }, 'my-card')), false);
});

test('detect: walks out of shadow roots (host) and through slots (assignedSlot)', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  const preview = { localName: 'hui-card-preview', parentNode: null };
  const shadowRoot = { localName: undefined, parentNode: null, host: preview };
  const card = { localName: 'my-card', parentNode: shadowRoot };
  assert.equal(rt.isPreview(card), true);

  const options = { localName: 'hui-card-options', parentNode: null };
  const slot = { localName: 'slot', parentNode: options };
  const slotted = { localName: 'my-card', parentNode: { localName: 'div', parentNode: null }, assignedSlot: slot };
  assert.equal(rt.isEditing(slotted), true);
});

test('detect: survives cyclic parent chains', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  const a = { localName: 'a' };
  a.parentNode = a;
  assert.equal(rt.isEditing(a), false);
});

function fakeHost({ hidden = false, connected = true, rects = [{ width: 100, height: 40 }], rendered = true } = {}) {
  return {
    isConnected: connected,
    hidden,
    hasAttribute: (n) => n === 'hidden' && hidden,
    getClientRects: () => rects,
    shadowRoot: { children: rendered ? [{ hasAttribute: () => false }] : [] },
  };
}

test('isHidden: visible card is not hidden', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(rt.isHidden(fakeHost()), false);
});

test('isHidden: hidden attribute, computed display:none, collapsed visibility', () => {
  assert.equal(createCardEditRuntime(fakeWin(), META).isHidden(fakeHost({ hidden: true })), true);
  assert.equal(createCardEditRuntime(fakeWin({ display: 'none' }), META).isHidden(fakeHost({ rects: [] })), true);
  const collapsed = fakeWin();
  collapsed.getComputedStyle = () => ({ display: 'block', visibility: 'collapse' });
  assert.equal(createCardEditRuntime(collapsed, META).isHidden(fakeHost()), true);
});

test('isHidden: zero-size box counts, but only once the card has rendered something', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(rt.isHidden(fakeHost({ rects: [{ width: 300, height: 0 }] })), true);
  assert.equal(rt.isHidden(fakeHost({ rects: [{ width: 0, height: 20 }] })), true);
  assert.equal(rt.isHidden(fakeHost({ rects: [{ width: 300, height: 0 }], rendered: false })), false, 'still loading');
});

test('isHidden: no boxes without display:none means an ancestor is hidden, not the card', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.equal(rt.isHidden(fakeHost({ rects: [] })), false);
});

test('isHidden: a disconnected host is never reported as hidden', () => {
  const rt = createCardEditRuntime(fakeWin({ display: 'none' }), META);
  assert.equal(rt.isHidden(fakeHost({ connected: false })), false);
});

test('localize: ha.localize rules (exact code, short code, English fallback)', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  assert.match(rt.localize('de'), /ausgeblendet/);
  assert.match(rt.localize('de-AT'), /ausgeblendet/);
  assert.match(rt.localize('en'), /hidden/);
  assert.match(rt.localize('fr'), /hidden/);
});

test('installDefineHook: decorates classes defined synchronously, then releases customElements.define', async () => {
  const defined = [];
  const win = fakeWin();
  win.customElements = {
    define(name, ctor) {
      defined.push([name, ctor]);
    },
  };
  const original = win.customElements.define;
  const rt = createCardEditRuntime(win, META);
  rt.installDefineHook();
  assert.notEqual(win.customElements.define, original);

  class Card {
    connectedCallback() {}
  }
  const before = Card.prototype.connectedCallback;
  win.customElements.define('my-card', Card);
  assert.notEqual(Card.prototype.connectedCallback, before, 'connectedCallback is wrapped');
  assert.equal(typeof Card.prototype.disconnectedCallback, 'function');
  assert.equal(defined.length, 1);

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(win.customElements.define, original, 'hook released after the card file ran');

  class Later {
    connectedCallback() {}
  }
  const laterBefore = Later.prototype.connectedCallback;
  win.customElements.define('other-card', Later);
  assert.equal(Later.prototype.connectedCallback, laterBefore, 'later defines are untouched');
});

test('installDefineHook: a throwing decorate never blocks registration', () => {
  const defined = [];
  const win = fakeWin();
  win.customElements = { define: (n) => defined.push(n) };
  createCardEditRuntime(win, META).installDefineHook();
  const frozen = Object.freeze(class {});
  Object.freeze(frozen.prototype);
  win.customElements.define('frozen-card', frozen);
  assert.deepEqual(defined, ['frozen-card']);
});

test('decorate: wraps a hass setter and keeps the original behaviour', () => {
  const win = fakeWin();
  win.HTMLElement = class {};
  const rt = createCardEditRuntime(win, META);
  const seen = [];
  class Card extends win.HTMLElement {
    set hass(v) {
      seen.push(v);
    }
  }
  rt.decorate(Card);
  const card = new Card();
  card.hass = { id: 1 };
  assert.deepEqual(seen, [{ id: 1 }]);
});

test('decorate: leaves classes without a hass setter alone and ignores non-classes', () => {
  const rt = createCardEditRuntime(fakeWin(), META);
  class Card {}
  rt.decorate(Card);
  assert.equal(Object.getOwnPropertyDescriptor(Card.prototype, 'hass'), undefined);
  assert.doesNotThrow(() => rt.decorate(null));
  assert.doesNotThrow(() => rt.decorate({}));
});

const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const CardManager = require('../js_automations/core/card-manager.js');

test('installCard: every placeholder of the preamble is resolved, edit meta carries name and icon', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsa-edit-install-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storage = path.join(dir, 'storage');
  const www = path.join(dir, 'www');
  mkdirSync(storage);
  mkdirSync(www);
  const script = path.join(dir, 'trash.ts');
  const header = ['/**', ' * @name Trash "Reminder"', ' * @icon mdi:trash-can', ' * @card', ' */', 'ha.log(1);', ''];
  writeFileSync(script, header.join('\n'));
  const ha = {
    isReady: true,
    sendCommand: async (type) => (type === 'lovelace/resources' ? { resources: [] } : { id: 'r1' }),
  };
  const manager = new CardManager(storage, www, ha, null);
  manager._extractCardBlock = () => "customElements.define('trash-card', class extends HTMLElement {});";
  const log = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = log;
  });
  await manager.installCard(script, { force: true });
  const code = readFileSync(path.join(www, 'trash-card.js'), 'utf8');
  assert.equal(code.includes('{{'), false, 'no unresolved {{...}} placeholder');
  assert.equal(code.split("'trash'").length - 1, 2, 'script id in __jsa__.scriptId and in the error boundary');
  assert.ok(code.includes(JSON.stringify({ name: 'Trash "Reminder"', icon: 'mdi:trash-can' })));
  assert.match(code, /isEditing\(hostEl\)/);
  assert.doesNotThrow(() => new Function(code));
});
