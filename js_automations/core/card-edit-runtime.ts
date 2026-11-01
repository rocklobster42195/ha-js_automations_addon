/**
 * JS AUTOMATIONS - Card edit runtime
 *
 * Runs inside the browser as part of the `__jsa__` preamble of every Script Pack card
 * (see card-manager.ts). Two jobs:
 *   1. Detect "dashboard in edit mode" / "card inside the picker preview".
 *   2. Cards that hide themselves (`:host{display:none}`) stay visible there as a placeholder,
 *      otherwise they can neither be moved, edited nor previewed.
 *
 * The factory is injected via Function.prototype.toString(): it must stay completely
 * self-contained (no imports, no references to module scope) and use only ES2022 syntax
 * that tsc emits unchanged. All browser access goes through the `win` parameter so that
 * it can be driven with a fake window in tests.
 *
 * Detection fallback chain (first decisive answer wins):
 *   1. Ancestors of the card, walked through shadow roots and slots:
 *        - hui-card-preview, hui-card-picker         -> picker / editor preview
 *        - hui-card-options, hui-card-edit-mode      -> edit wrapper of Masonry / Sections
 *        - hui-card with `preview === true`          -> HA forces visibility in edit mode
 *        - any ancestor with `lovelace.editMode`     -> hui-root / hui-view / hui-section ...
 *          (authoritative, also when it says `false`)
 *   2. URL parameter `?edit=1`, only when no ancestor carrying `lovelace` was found
 *      (panel cards, wrappers that do not expose it).
 * `hass.editMode` is not part of the HA API and is deliberately not used.
 *
 * Visibility report: a card that hides itself also gets the hidden attribute / inline
 * display:none on its host and a `card-visibility-changed` event (what hui-card listens to),
 * so HA collapses the card's frame instead of leaving an empty gap. Only transitions are
 * reported; while a placeholder is shown the card counts as visible. Cards that already hide
 * themselves and fire the event are respected (no duplicate event).
 *
 * Re-evaluation triggers: connect/disconnect, `hass` setter, mutations of the card's shadow
 * tree, attribute changes of the host, and `location-changed` / `popstate` on the window
 * (HA navigates to `?edit=1` when the mode is toggled, no reload needed).
 */

export interface CardEditMeta {
  /** Name shown in the placeholder (script / card name). */
  name: string;
  /** mdi icon shown in the placeholder. */
  icon: string;
}

export function createCardEditRuntime(win: any, meta: CardEditMeta) {
  const OWN_ATTR = 'data-jsa-edit';
  // HA 2026.8 renders the picker tiles straight inside hui-card-picker (no hui-card-preview wrapper);
  // older versions and the card editor use hui-card-preview.
  const PREVIEW_TAGS = ['hui-card-preview', 'hui-card-picker'];
  const EDIT_TAGS = ['hui-card-options', 'hui-card-edit-mode'];
  const MAX_DEPTH = 500;
  const TEXT: Record<string, string> = {
    en: 'Currently hidden: nothing to show',
    de: 'Aktuell ausgeblendet: nichts anzuzeigen',
  };

  const instances = new Set<any>();
  const decorated = new WeakSet<object>();
  let lastHass: any = null;
  let listening = false;
  let urlTimer: any = null;
  let lastSearch = '';

  // --- detection -------------------------------------------------------------

  function urlEditFlag(): boolean {
    try {
      return new win.URLSearchParams(win.location.search).get('edit') === '1';
    } catch {
      return false;
    }
  }

  /** @returns editing = edit mode OR picker preview; preview = picker/editor preview only. */
  function detect(host?: any): { editing: boolean; preview: boolean } {
    let preview = false;
    let edit = false;
    let lovelaceSeen = false;
    let node = host;
    for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
      const tag = node.localName;
      if (PREVIEW_TAGS.includes(tag)) preview = true;
      if (EDIT_TAGS.includes(tag) && node.editMode !== false) edit = true;
      if (tag === 'hui-card' && node.preview === true) edit = true;
      if (node.lovelace && typeof node.lovelace === 'object') {
        lovelaceSeen = true;
        if (node.lovelace.editMode === true) edit = true;
      }
      node = node.assignedSlot || node.parentNode || node.host;
    }
    if (!edit && !preview && !lovelaceSeen) edit = urlEditFlag();
    return { editing: edit || preview, preview };
  }

  // --- hidden check ----------------------------------------------------------

  /** True when the card hides itself (hidden attribute, display:none, zero size). */
  function isHidden(host: any): boolean {
    if (!host || !host.isConnected) return false;
    if (host.hidden || (host.hasAttribute && host.hasAttribute('hidden'))) return true;
    const cs = win.getComputedStyle(host);
    if (cs.display === 'none' || cs.visibility === 'collapse') return true;
    const rects = host.getClientRects();
    // No boxes at all while the host itself is not display:none means an ancestor is not
    // rendered (inactive tab, collapsed section) - that is not the card's doing.
    if (rects.length === 0) return false;
    // A card that has not rendered anything yet is not "hiding", it is still loading.
    const root = host.shadowRoot;
    if (root && !Array.from(root.children as any[]).some((c: any) => !c.hasAttribute(OWN_ATTR))) return false;
    for (const r of Array.from(rects) as any[]) {
      if (r.width > 0 && r.height > 0) return false;
    }
    return true;
  }

  // --- localisation (same lookup rules as ha.localize) -----------------------

  function language(host?: any): string {
    const hass = (host && host.hass) || (host && host._hass) || lastHass;
    const lang =
      (hass && ((hass.locale && hass.locale.language) || hass.language)) ||
      (win.document && win.document.documentElement && win.document.documentElement.lang) ||
      (win.navigator && win.navigator.language) ||
      'en';
    return String(lang);
  }

  function localize(lang: string): string {
    return TEXT[lang] || TEXT[lang.split('-')[0]] || TEXT.en;
  }

  // --- placeholder -----------------------------------------------------------

  const PLACEHOLDER_CSS =
    ':host{display:block!important}' +
    '.jsa-ph{display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:64px;padding:12px 16px;' +
    'border:2px dashed var(--divider-color,#9e9e9e);border-radius:var(--ha-card-border-radius,12px);' +
    'color:var(--secondary-text-color,#727272);opacity:.6;font-family:inherit}' +
    '.jsa-ph-icon{--mdc-icon-size:28px;flex:none}' +
    '.jsa-ph-name{font-weight:500;color:var(--primary-text-color,#212121)}' +
    '.jsa-ph-text{font-size:.9em}' +
    '.jsa-ph-custom{display:block;border:0;padding:0;min-height:0;opacity:1}';

  function ownNodes(root: any): any[] {
    return Array.from(root.querySelectorAll('[' + OWN_ATTR + ']'));
  }

  function isOwn(node: any, root: any): boolean {
    for (let n = node; n && n !== root; n = n.parentNode) {
      if (n.nodeType === 1 && n.hasAttribute(OWN_ATTR)) return true;
    }
    return false;
  }

  /** ha-icon is a Lit element: the attribute alone does not reach its property. */
  function applyIcon(el: any, icon: string): void {
    const apply = () => {
      el.icon = icon;
    };
    if (win.customElements.get('ha-icon')) apply();
    else win.customElements.whenDefined('ha-icon').then(apply);
  }

  function fixPreviewIcons(container: any): void {
    for (const el of Array.from(container.querySelectorAll('ha-icon[icon]')) as any[]) {
      applyIcon(el, el.getAttribute('icon'));
    }
  }

  function buildPreview(host: any): any {
    const getPreview = host.constructor && host.constructor.getPreview;
    if (typeof getPreview !== 'function') return null;
    let result: any;
    try {
      result = getPreview.call(host.constructor);
    } catch {
      return null;
    }
    if (result == null || result === '') return null;
    const doc = win.document;
    const box = doc.createElement('div');
    box.className = 'jsa-ph jsa-ph-custom';
    if (typeof result === 'string') box.innerHTML = result;
    else if (result.nodeType) box.appendChild(result);
    else return null;
    fixPreviewIcons(box);
    return box;
  }

  function buildGeneric(lang: string): any {
    const doc = win.document;
    const box = doc.createElement('div');
    box.className = 'jsa-ph';
    const icon = doc.createElement('ha-icon');
    icon.className = 'jsa-ph-icon';
    icon.setAttribute('icon', meta.icon);
    const body = doc.createElement('div');
    const name = doc.createElement('div');
    name.className = 'jsa-ph-name';
    name.textContent = meta.name;
    const text = doc.createElement('div');
    text.className = 'jsa-ph-text';
    text.textContent = localize(lang);
    body.append(name, text);
    box.append(icon, body);
    applyIcon(icon, meta.icon);
    return box;
  }

  function showPlaceholder(inst: any): void {
    const root = inst.root;
    const lang = language(inst.host);
    // Keep the existing placeholder untouched: rebuilding it would restart the paint.
    if (inst.shownLang === lang && ownNodes(root).length === 2) return;
    removePlaceholder(inst);
    const doc = win.document;
    const style = doc.createElement('style');
    style.setAttribute(OWN_ATTR, '');
    style.textContent = PLACEHOLDER_CSS;
    const box = buildPreview(inst.host) || buildGeneric(lang);
    box.setAttribute(OWN_ATTR, '');
    root.append(style, box);
    inst.shownLang = lang;
    startPolling();
  }

  function removePlaceholder(inst: any): void {
    if (!inst.root) return;
    for (const n of ownNodes(inst.root)) n.remove();
    inst.shownLang = null;
  }

  // --- evaluation ------------------------------------------------------------

  /**
   * Measures whether the card hides itself, without our own changes (placeholder nodes,
   * the hidden attribute / inline display we set on the host) influencing the result.
   */
  function measureHidden(inst: any): boolean {
    const host = inst.host;
    const own = ownNodes(inst.root);
    for (const n of own) {
      if (n.localName === 'style') n.disabled = true;
      else n.hidden = true;
    }
    if (inst.ownHidden) {
      host.removeAttribute('hidden');
      host.style.display = inst.prevDisplay;
    }
    try {
      return isHidden(host);
    } finally {
      if (inst.ownHidden) {
        host.hidden = true;
        host.style.display = 'none';
      }
      for (const n of own) {
        if (n.localName === 'style') n.disabled = false;
        else n.hidden = false;
      }
    }
  }

  /**
   * Tells Home Assistant's hui-card about a visibility change so that it hides its own frame
   * (and with it the frame's margins) too. Only transitions are reported.
   */
  function report(inst: any, visible: boolean): void {
    if (inst.reported === visible) return;
    inst.reported = visible;
    inst.firing = true;
    try {
      inst.host.dispatchEvent(
        new win.CustomEvent('card-visibility-changed', { detail: { value: visible }, bubbles: true, composed: true })
      );
    } finally {
      inst.firing = false;
    }
  }

  /**
   * Mirrors the visibility onto the host and reports it. A host the card has already hidden
   * itself (hidden attribute / inline display:none) is left alone, only the report is added.
   */
  function applyVisibility(inst: any, visible: boolean): void {
    const host = inst.host;
    if (visible) {
      if (inst.ownHidden) {
        host.removeAttribute('hidden');
        host.style.display = inst.prevDisplay;
        inst.ownHidden = false;
      }
    } else if (!inst.ownHidden && !host.hidden && host.style.display !== 'none') {
      inst.prevDisplay = host.style.display;
      host.hidden = true;
      host.style.display = 'none';
      inst.ownHidden = true;
    }
    report(inst, visible);
  }

  function evaluate(inst: any): void {
    if (!inst.attached) {
      if (inst.ownHidden) wake(inst);
      return;
    }
    const root = inst.host.shadowRoot;
    if (!root) return;
    if (inst.root !== root) {
      observeRoot(inst, root);
    }
    const selfHidden = measureHidden(inst);
    // In edit mode / picker a hidden card is shown as placeholder and must count as visible,
    // otherwise Home Assistant collapses its frame and the card can neither be moved nor edited.
    const showPlaceholderNow = selfHidden && detect(inst.host).editing;
    if (showPlaceholderNow) showPlaceholder(inst);
    else removePlaceholder(inst);
    applyVisibility(inst, !selfHidden || showPlaceholderNow);
    // Drop the records of our own changes so they cannot retrigger the observers.
    if (inst.mo) inst.mo.takeRecords();
    if (inst.ho) inst.ho.takeRecords();
  }

  function schedule(inst: any): void {
    if (inst.queued) return;
    inst.queued = true;
    Promise.resolve().then(() => {
      inst.queued = false;
      evaluate(inst);
    });
  }

  function evaluateAll(): void {
    for (const inst of instances) evaluate(inst);
  }

  /** Window-level events: HA updates its wrappers a moment after the URL changes. */
  function onNavigation(): void {
    evaluateAll();
    if (win.requestAnimationFrame) win.requestAnimationFrame(evaluateAll);
    win.setTimeout(evaluateAll, 300);
  }

  function observeRoot(inst: any, root: any): void {
    if (inst.mo) inst.mo.disconnect();
    inst.root = root;
    inst.mo = new win.MutationObserver((records: any[]) => {
      if (
        records.every(
          (r) => isOwn(r.target, root) && [...r.addedNodes, ...r.removedNodes].every((n: any) => isOwn(n, root))
        )
      ) {
        return;
      }
      evaluate(inst);
    });
    inst.mo.observe(root, { childList: true, subtree: true });
  }

  // --- lifecycle -------------------------------------------------------------

  /** Creates the per-card state; listens for the card's own visibility reports from the start. */
  function track(host: any): any {
    let inst = host.__jsaEdit;
    if (!inst) {
      inst = {
        host,
        attached: false,
        root: null,
        mo: null,
        ho: null,
        queued: false,
        shownLang: null,
        // visibility state: what we set on the host, what Home Assistant was told last
        ownHidden: false,
        prevDisplay: '',
        reported: true,
        firing: false,
        listening: false,
        onVisibility: null,
      };
      // Reports of the card itself (cards that already fire the event) count as "told".
      inst.onVisibility = (ev: any) => {
        if (!inst.firing && ev.detail && typeof ev.detail.value === 'boolean') inst.reported = ev.detail.value;
      };
      host.__jsaEdit = inst;
    }
    if (!inst.listening) {
      inst.listening = true;
      host.addEventListener('card-visibility-changed', inst.onVisibility);
    }
    return inst;
  }

  function attach(host: any): void {
    const inst = track(host);
    if (inst.attached) return;
    inst.attached = true;
    instances.add(inst);
    if (!listening) {
      listening = true;
      win.addEventListener('location-changed', onNavigation);
      win.addEventListener('popstate', onNavigation);
    }
    if (inst.ho) inst.ho.disconnect();
    inst.ho = new win.MutationObserver(() => schedule(inst));
    inst.ho.observe(host, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    if (host.shadowRoot) observeRoot(inst, host.shadowRoot);
    schedule(inst);
  }

  /**
   * HA toggles the edit mode with history.replaceState, which fires no event. Cards that are not
   * in the DOM (dormant) get no re-render, and a card showing its placeholder has to notice when
   * the edit mode ends, so the URL is polled while at least one of them exists.
   */
  function needsPolling(inst: any): boolean {
    return !inst.attached || inst.shownLang !== null;
  }

  function pollUrl(): void {
    const search = win.location.search;
    if (search !== lastSearch) {
      lastSearch = search;
      onNavigation();
    }
    stopPollingIfIdle();
  }

  function startPolling(): void {
    if (urlTimer) return;
    lastSearch = win.location.search;
    urlTimer = win.setInterval(pollUrl, 400);
  }

  function stopPollingIfIdle(): void {
    if (urlTimer && ![...instances].some(needsPolling)) {
      win.clearInterval(urlTimer);
      urlTimer = null;
    }
  }

  /** Releases everything a tracked card holds (observers, listeners, host changes). */
  function release(inst: any): void {
    const host = inst.host;
    if (inst.mo) inst.mo.disconnect();
    if (inst.ho) inst.ho.disconnect();
    inst.mo = null;
    inst.ho = null;
    removePlaceholder(inst);
    host.removeEventListener('card-visibility-changed', inst.onVisibility);
    inst.listening = false;
    if (inst.ownHidden) {
      host.removeAttribute('hidden');
      host.style.display = inst.prevDisplay;
      inst.ownHidden = false;
    }
    inst.reported = true;
    inst.root = null;
    instances.delete(inst);
    stopPollingIfIdle();
    if (listening && instances.size === 0) {
      listening = false;
      win.removeEventListener('location-changed', onNavigation);
      win.removeEventListener('popstate', onNavigation);
    }
  }

  function detach(host: any): void {
    const inst = host.__jsaEdit;
    if (!inst || !inst.attached) return;
    inst.attached = false;
    removePlaceholder(inst);
    // hui-card removes a card reported as hidden from the DOM and keeps passing it `hass`. Such a
    // card stays armed ("dormant", hidden state kept): resetting it would make hui-card re-add the
    // card on the next hass update, which hides again, and so on. Dormant cards are woken only by
    // changes of their own content or by a navigation (see wake()).
    if (!inst.ownHidden) {
      release(inst);
    } else {
      startPolling();
    }
  }

  /**
   * A dormant card (detached while hidden by us) may have something to show now, or the dashboard
   * switched to edit mode. Layout can't be measured while detached, so show it again: hui-card
   * re-attaches a visible card, our attach() then measures and hides it again if it still has
   * nothing to show. All of that happens before the next paint. Without a re-attach (the card is
   * gone for good) the tracking ends here.
   */
  function wake(inst: any): void {
    applyVisibility(inst, true);
    if (inst.mo) inst.mo.takeRecords();
    if (inst.ho) inst.ho.takeRecords();
    if (!inst.attached) release(inst);
  }

  /** Hooks a card class so that every instance is managed. Must run before define(). */
  function decorate(Ctor: any): void {
    if (typeof Ctor !== 'function' || !Ctor.prototype || decorated.has(Ctor)) return;
    decorated.add(Ctor);
    const proto = Ctor.prototype;
    const connected = proto.connectedCallback;
    const disconnected = proto.disconnectedCallback;
    proto.connectedCallback = function (this: any, ...args: any[]) {
      // The listener must exist before the card runs its own connectedCallback (it may report there).
      track(this);
      const result = connected ? connected.apply(this, args) : undefined;
      attach(this);
      return result;
    };
    proto.disconnectedCallback = function (this: any, ...args: any[]) {
      detach(this);
      return disconnected ? disconnected.apply(this, args) : undefined;
    };
    let owner = proto;
    let desc: PropertyDescriptor | undefined;
    while (owner && owner !== win.HTMLElement.prototype && !(desc = Object.getOwnPropertyDescriptor(owner, 'hass'))) {
      owner = Object.getPrototypeOf(owner);
    }
    if (desc && desc.set) {
      const origSet = desc.set;
      Object.defineProperty(proto, 'hass', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(this: any, value: any) {
          origSet.call(this, value);
          if (value) lastHass = value;
          // Not for dormant cards: every hass update would wake them for nothing.
          if (this.__jsaEdit && this.__jsaEdit.attached) schedule(this.__jsaEdit);
        },
      });
    }
  }

  /**
   * Wraps customElements.define for the synchronous evaluation of the card file only
   * (cards are loaded one script at a time); the hook unhooks itself afterwards.
   */
  function installDefineHook(): void {
    const registry = win.customElements;
    const original = registry.define;
    let active = true;
    const hook = function (this: any, name: string, ctor: any, options?: any) {
      if (active) {
        try {
          decorate(ctor);
        } catch {
          // A broken hook must never keep the card from registering.
        }
      }
      return original.call(this, name, ctor, options);
    };
    registry.define = hook;
    Promise.resolve().then(() => {
      active = false;
      if (registry.define === hook) registry.define = original;
    });
  }

  return {
    installDefineHook,
    decorate,
    detect,
    isHidden,
    localize,
    isEditing: (host?: any) => detect(host).editing,
    isPreview: (host?: any) => detect(host).preview,
    setHass(hass: any) {
      if (hass) lastHass = hass;
    },
  };
}

/** Source of the factory, ready to be embedded as `(<source>)(window, <meta>)`. */
export const CARD_EDIT_RUNTIME_SOURCE = createCardEditRuntime.toString();
