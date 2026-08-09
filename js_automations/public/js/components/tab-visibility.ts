/**
 * Dev-tools tab panels (WATCH/MQTT/WEBHOOKS/...) stay mounted at all times;
 * layout.js's tab switcher just toggles a `.hidden` class on whichever panel
 * isn't active. Components that only want to be subscribed to a live stream
 * while their tab is actually visible watch their own class list for that,
 * since connectedCallback/disconnectedCallback don't fire on a mere class
 * toggle. Mirrors the original observeTabVisibility() from event-inspector.js.
 */
export function observeTabVisibility(el: HTMLElement, cb: (visible: boolean) => void): MutationObserver {
  const observer = new MutationObserver(() => cb(!el.classList.contains('hidden')));
  observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  return observer;
}
