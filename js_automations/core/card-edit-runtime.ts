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
  }

  function removePlaceholder(inst: any): void {
    if (!inst.root) return;
    for (const n of ownNodes(inst.root)) n.remove();
    inst.shownLang = null;
  }

  // --- evaluation ------------------------------------------------------------

  /** Measures the card without our own nodes influencing the result. */
  function measureHidden(inst: any): boolean {
    const own = ownNodes(inst.root);
    for (const n of own) {
      if (n.localName === 'style') n.disabled = true;
      else n.hidden = true;
    }
    try {
      return isHidden(inst.host);
    } finally {
      for (const n of own) {
        if (n.localName === 'style') n.disabled = false;
        else n.hidden = false;
      }
    }
  }

  function evaluate(inst: any): void {
    if (!inst.attached) return;
    const root = inst.host.shadowRoot;
    if (!root) return;
    if (inst.root !== root) {
      observeRoot(inst, root);
    }
    if (!detect(inst.host).editing || !measureHidden(inst)) {
      removePlaceholder(inst);
    } else {
      showPlaceholder(inst);
    }
    // Drop the records of our own changes so they cannot retrigger the observer.
    if (inst.mo) inst.mo.takeRecords();
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

  function attach(host: any): void {
    let inst = host.__jsaEdit;
    if (!inst) {
      inst = { host, attached: false, root: null, mo: null, ho: null, queued: false, shownLang: null };
      host.__jsaEdit = inst;
    }
    if (inst.attached) return;
    inst.attached = true;
    instances.add(inst);
    if (!listening) {
      listening = true;
      win.addEventListener('location-changed', onNavigation);
      win.addEventListener('popstate', onNavigation);
    }
    inst.ho = new win.MutationObserver(() => schedule(inst));
    inst.ho.observe(host, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    if (host.shadowRoot) observeRoot(inst, host.shadowRoot);
    schedule(inst);
  }

  function detach(host: any): void {
    const inst = host.__jsaEdit;
    if (!inst || !inst.attached) return;
    inst.attached = false;
    if (inst.mo) inst.mo.disconnect();
    if (inst.ho) inst.ho.disconnect();
    inst.mo = null;
    inst.ho = null;
    removePlaceholder(inst);
    inst.root = null;
    instances.delete(inst);
    if (listening && instances.size === 0) {
      listening = false;
      win.removeEventListener('location-changed', onNavigation);
      win.removeEventListener('popstate', onNavigation);
    }
  }

  /** Hooks a card class so that every instance is managed. Must run before define(). */
  function decorate(Ctor: any): void {
    if (typeof Ctor !== 'function' || !Ctor.prototype || decorated.has(Ctor)) return;
    decorated.add(Ctor);
    const proto = Ctor.prototype;
    const connected = proto.connectedCallback;
    const disconnected = proto.disconnectedCallback;
    proto.connectedCallback = function (this: any, ...args: any[]) {
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
          if (this.__jsaEdit) schedule(this.__jsaEdit);
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
