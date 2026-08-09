# Sidebar / Script List LIT Migration: Grill / Discovery Notes

Date: 2026-08-03 · Goal: Capture design decisions for migrating `<app-sidebar>` + script list (RFC Phase A item 5) to LIT, based on Claude's improvement proposals from reading the current `script-list.js` + sidebar markup.

## Summary / key decisions

Migrating RFC Phase A item 5 (`<app-sidebar>` + `<script-row>`/`<script-group>`) with these decisions:

1. **Scope:** `<app-sidebar>` covers the entire sidebar — header/brand, action buttons, search box, and script list. `<status-bar>`/`<status-bar-header-actions>` stay separate, already-migrated children nested inside.
2. **Component boundary:** `<script-row>` and `<script-group>` are real separate custom elements (per RFC wording), not internal templates — a deliberate choice against Claude's initial "keep it simple" recommendation. Data flows down as properties; actions bubble up via custom events.
3. **Reactive rendering:** replace the current full-DOM-teardown-on-every-`status_update` + fragile name-text-matching stats patch with one reactive `@state` array and `repeat()` keyed by `filename`, cascading through `<script-group>`/`<script-row>`. Fixes scroll-position loss and the display-name-collision risk in the current stats-patch hack.
4. **Backend stays untouched:** `status_update`/`system_stats` remain payload-less invalidation pings; the frontend still does a full `api/scripts` refetch on every ping, just renders it reactively. No backend diff-payload work this round.
5. **New feature added:** highlight the sidebar row of the currently-open editor tab (doesn't exist today). Needs a bridge from not-yet-migrated `tab-manager.js` into the new component — first case of vanilla code reaching into a new LIT component to support a feature that didn't exist before, not just preserving old behavior.
6. **Unchanged:** group collapse/expand state persistence stays exactly as-is via `localStorage`.

No open flags — every question was resolved during the session.

## Q&A log

### Q1 — Migration scope

- Asked: Should `<app-sidebar>` cover the whole sidebar (header + search + script list), or just the script list?
- Captured: **Whole sidebar.** Header (brand/logo, action buttons), search box, and script list all become part of `<app-sidebar>`. `<status-bar>`/`<status-bar-header-actions>` stay separate, already-migrated child components nested inside. Confirmed via grep: nothing outside `script-list.js` reaches into `#search-input`, `#clear-search-btn`, `#script-list`, `.script-row`, `.script-group`, `.section-header` — safe to move all of it behind one Shadow DOM boundary.
- Flags: none

### Q2 — Component boundary for rows/groups

- Asked: Should `<script-row>`/`<script-group>` be actual separate custom elements (own Shadow DOM, per RFC wording), or internal render templates inside `<app-sidebar>` (like store-explorer's rows)?
- Captured: **Separate custom elements**, following the RFC literally — not Claude's initial recommendation (which was internal templates only, to match the store-explorer precedent and avoid per-row Shadow DOM overhead). User chose to keep them as real components.
- Implementation implication: `<app-sidebar>` renders `<script-group>` elements via `repeat()` keyed by group key; each `<script-group>` renders its own `<script-row>` elements via `repeat()` keyed by filename. Data flows down as properties (script object, group metadata); actions (toggle/restart/delete/dismiss/open-tab) need to bubble back up — via custom events (`@toggle-script`, etc.) rather than the rows reaching back into global window bridges directly, to keep the components composable. Exact event-bubbling mechanism to nail down during implementation.
- Flags: none

### Q3 — Reactive re-render vs. full-rebuild-on-every-status-update

- Asked: Replace the current full-rebuild-on-every-`status_update` + fragile name-text-matching stats patch with reactive, keyed `repeat()` (same pattern as store-explorer)?
- Captured: **Yes.** One reactive `@state` scripts array (in `<app-sidebar>`), `repeat()` keyed by `filename` down through `<script-group>`/`<script-row>`, handles both `status_update` (full refetch still happens against the API, but DOM patches in place instead of full teardown) and `system_stats`/RAM updates (`updateScriptStats`'s current row-lookup-by-rendered-name-text hack goes away entirely — becomes a normal reactive property update keyed by filename). Preserves scroll position, avoids the fragile name-matching (display names aren't guaranteed unique across groups).
- Flags: none

### Q3b — Backend payload diffs vs. keep full refetch

- Asked: Should backend `status_update`/`system_stats` events be upgraded to carry real diffs (like `store_changed` does), or keep the current no-payload "something changed, refetch everything" signal and only make the frontend rendering reactive?
- Captured: **Keep full refetch.** `status_update` stays a bare invalidation ping (many emit call-sites across `scripts-routes.js`/`kernel.js` — not worth touching for this round). The frontend still calls the full `api/scripts` GET on every ping, but renders the result through keyed `repeat()` instead of tearing down the DOM. This already fixes the real user-facing problem (scroll position, hover state, flicker); backend diff payloads are a separate, later optimization if ever needed.
- Flags: none

### Q5 — Highlight the currently-open script's row (new feature)

- Asked: Add a visual indicator on the sidebar row for whichever script's tab is currently open in the editor — doesn't exist today (confirmed via grep, no `.script-row.active`-style CSS or logic anywhere)?
- Captured: **Yes, add it.** New affordance, not in the original. Needs `activeTabFilename` (tab-manager.js global) piped into `<app-sidebar>` reactively — tab-manager.js isn't itself migrated yet (Phase B), so this will need a small bridge: either `<app-sidebar>` listens for the same event/timing tab-manager already fires (`renderTabs()`/`switchToTab()` calls), or tab-manager.js gains one more explicit call into a new `window.appSidebar`-style bridge (mirroring the `window.storeExplorer` pattern) telling it which filename is now active. Exact wiring TBD at implementation time — note this is the first cross-component reach from not-yet-migrated vanilla code (tab-manager.js) into a new LIT component for a brand-new feature, not just preserving old behavior.
- Flags: none

### Q6 — Group collapse-state persistence

- Asked: Keep persisting group collapse/expand state via `localStorage` (`js_collapsed_sections`) exactly as today, or change strategy (e.g. server-side per-user)?
- Captured: **Keep localStorage**, unchanged. Becomes a private field synced with `localStorage` inside `<app-sidebar>`, no behavior change.
- Flags: none
