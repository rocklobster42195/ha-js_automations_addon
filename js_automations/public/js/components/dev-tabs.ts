import type { JsaSettings } from './global';

/**
 * Dev-tools tab names, in tab-bar order. Keep in sync with the `devtab_*` items in
 * core/settings-schema.ts and the buttons/panels in index.html.
 */
export const DEV_TABS = ['watch', 'repl', 'mqtt', 'events', 'webhooks', 'mcp'] as const;

/**
 * Shows or hides dev-tools tabs according to the `devtab_<name>` switches in the general settings
 * (a missing key means "shown"). The tab button and its panel are hidden together; if the active
 * tab just disappeared, the first visible one takes over. layout.js still owns the click handling.
 */
export function applyDevTabVisibility(settings: JsaSettings | null | undefined, root: ParentNode = document): void {
  const bar = root.querySelector('.log-pane-tab-bar');
  if (!bar) return;

  const general = (settings?.general ?? {}) as Record<string, unknown>;
  const visible = DEV_TABS.filter((name) => general[`devtab_${name}`] !== false);

  for (const name of DEV_TABS) {
    const show = visible.includes(name);
    bar.querySelector(`.log-pane-tab[data-tab="${name}"]`)?.classList.toggle('hidden', !show);
    if (!show) root.querySelector(`#dev-tab-${name}`)?.classList.add('hidden');
  }

  const active = bar.querySelector<HTMLElement>('.log-pane-tab.active');
  if (active?.dataset.tab && (visible as readonly string[]).includes(active.dataset.tab)) return;

  const next = visible.length ? bar.querySelector<HTMLElement>(`.log-pane-tab[data-tab="${visible[0]}"]`) : null;
  if (next) next.click();
  else active?.classList.remove('active');
}

window.applyDevTabVisibility = applyDevTabVisibility;
