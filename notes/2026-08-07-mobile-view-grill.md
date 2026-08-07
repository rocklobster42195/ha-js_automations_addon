# Mobile View: Grill / Discovery Notes

Date: 2026-08-07 · Goal: Nail down requirements for a responsive/mobile view of the JSA Lit/TS web UI — auto device detection with manual override toggle, mobile-first focus on start/stop + health, a script-list collapse button next to search, and search-by-code-content.

## Summary / key decisions

**Scope (Q1/Q1b):** Mobile v1 is a dashboard-first experience, not a fully responsive port of the whole app. Two mobile "screens": (1) **script dashboard** — the script list, start/stop/health focus; (2) **log viewer** — reused ~as-is from `<log-viewer>`, global stream, not per-script filtered (per-script log filtering deferred as a possible later refinement). Editor/tabs/other dev-tools tabs (store-explorer, settings-content, event-inspector, mqtt-monitor, watch-panel) are explicitly **out of scope** for this round.

**Status bar (Q2):** `<status-bar>` (heartbeat/MQTT/sparklines) stays visible on the dashboard screen, dropped on the log screen. `<status-bar-header-actions>` (custom entity buttons) stay in the mobile header; exact row layout (wrap to a second row if tight) is an implementation detail.

**Detection (Q3):** `matchMedia('(max-width: 768px)')`, live-reacting to resize/rotation — not one-shot `navigator.userAgent` sniffing.

**Manual toggle (Q4/Q4b):** A header-actions button flips mobile⇄desktop. A new `<settings-view>` toggle, "Hide in desktop mode" (default **off**), controls whether the button stays visible while in desktop layout — it's always shown while in mobile layout (need it to get back). The manual choice persists in `localStorage`, overriding auto-detection until toggled back.

**Collapse-all button (Q5):** Button next to the search field collapses **all script groups at once** (reuses the existing per-group `localStorage` collapse mechanism, applied to every group in one click; still individually re-expandable after). Driving use case: decluttering when there are many scripts. Applies on desktop too, not mobile-only. State persists across reloads.

**Code search (Q6):** New **backend search endpoint** (server searches script file contents), not a client-side prefetch-all. Code matches fold silently into the existing single search box alongside name/filename/description/area/label — no separate mode/toggle. Debounced (~300ms) before firing.

**Tap-on-row behavior (Q7):** Tapping a script row on mobile expands the existing tooltip content (RAM/last-started/capabilities/conflicts) inline in the row — hover doesn't exist on touch, so this replaces it 1:1.

**Other header-action buttons on mobile (Q8):** New Script hidden (creation stays desktop-only, avoids dead-ending in the out-of-scope editor). Store Explorer hidden (dev-tools, out of scope). Settings stays (it's where the Q4b setting lives).

**Dashboard⇄log navigation (Q9):** A header-actions button, not a bottom tab bar — a bottom tab bar would collide with `<status-bar>`, which is itself bottom-anchored on the dashboard screen (Q2).

**Branch/release placement (Q10):** Built as a **new milestone/RFC item on the existing `feature/lint-prettier-ci-foundation` branch**, continuing the current LIT/TS migration sequence — not deferred to a separate later initiative. `docs/RFC_FRONTEND_MODERNIZATION.md` needs a new Phase A/B item inserted (ordering relative to item 6 `<card-preview>`/dialogs TBD at implementation time).

**Icons (Q11):** Since there are no real users yet, icons were freely reassigned app-wide for a cleaner fit rather than picked around existing usage:

| Element                                                                                     | Icon                                                                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Mobile dashboard screen / dashboard⇄log toggle (dashboard side)                             | `mdi-view-dashboard-outline` (reclaimed from Card Editor)                              |
| Card Editor / card-capability badges (`card-preview.ts`, `script-row.ts`, `tab-manager.js`) | `mdi-card-text-outline` (renamed — more correct anyway, these are HA Lovelace "cards") |
| Dashboard⇄log toggle (log side)                                                             | `mdi-text-box-outline`                                                                 |
| Mobile⇄desktop toggle                                                                       | `mdi-cellphone` (in desktop mode) / `mdi-monitor` (in mobile mode)                     |
| Collapse-all-groups button                                                                  | `mdi-unfold-less-horizontal` / `mdi-unfold-more-horizontal`                            |

**Incidental bug found, not fixed (Q11):** `tab-manager.js:362` has a dead ternary (`cardTabOpen ? 'mdi mdi-view-dashboard-edit-outline' : 'mdi mdi-view-dashboard-edit-outline'` — both branches identical). User wants to be **reminded about this specifically when the Q11 card-icon rename is implemented**, not now.

## Q&A log

### Context established up-front (via codebase exploration, not asked)

- No responsive/mobile handling exists anywhere today: no `@media` queries in `style.css`/`tokens.css`, no `matchMedia`/UA sniffing, no viewport detection utility. Layout is fixed flex row, sidebar fixed `width: 310px`.
- `<app-sidebar>` (RFC Phase A item 5) is already fully migrated to Lit/TS: covers header/brand, header-actions, search box, and the script list (`<script-group>`/`<script-row>`). Header-actions is a hardcoded `<button>` list inside `app-sidebar.ts`'s `render()` (New Script, Store Explorer, Settings, hidden Reference), not slot/config-driven — adding a new action means editing the template.
- Search (`app-sidebar.ts` `_visibleGroups()`/filter logic) currently matches `name`, `filename`, `description`, `area`, `label` — not source code. Script source is fetched on-demand server-side only (`GET /api/scripts/:filename/content`); nothing client-side holds script code today, so code-search needs either a new server-side search endpoint or a client-side prefetch-all-then-filter approach.
- Start/stop + health already fully exist in `script-row.ts`: `.status-running`/`.status-error` classes, tooltip (state/RAM/last-started), capability/conflict badges, toggle (play/stop) + restart buttons, dismiss-error button. Actions bubble as `jsa-toggle-script`/`jsa-restart-script`/etc. composed events up to `<app-sidebar>`.
- Group-collapse (expand/collapse a folder of scripts) already persists via `localStorage` (`js_collapsed_sections`) — different from the new "collapse the whole list" button being asked for here.
- `tokens.css` is dark-only, no light-mode/HA-theme-sync (deliberate prior decision, addon runs in an HA ingress iframe that doesn't inherit HA's CSS vars).

### Q1 — Scope of "mobile view"

- Asked: Should mobile v1 be a script-dashboard only (sidebar/script-list fills the screen, start/stop/health focus), with editor/tabs/dev-tools panel out of scope for now — or should the editor also be reachable somehow (read-only, or stacked layout)?
- Captured: **Dashboard-only confirmed as the base**, but user wants one dev-tools piece included after all: **the log viewer should also be visible/reachable in mobile view**, specifically because it's useful for judging script health (errors, crash reasons) beyond just the running/error status dot.
- Flags: exact mechanics of how the log fits into the mobile dashboard -> follow-up question (Q1b)

### Q1b — How the log fits into the mobile dashboard

- Asked: `<log-viewer>` today is the full DEV-TOOLS tab log stream (header/filter/clear/console, all scripts interleaved, imperative append-only). For mobile, should it be: (a) the same global log stream, reachable as a second mobile "screen" you swipe/tap to (dashboard ⇄ log), (b) a collapsible section stacked below the script list on the same screen, or (c) per-script — tapping a script's health/error badge reveals just _that_ script's recent log lines (would need new filtering, not just reusing `<log-viewer>` as-is)?
- Captured: **(a) — separate screen/tab.** Dashboard and log are two views the user switches between on mobile; log stays the same global stream as today (reuse `<log-viewer>` largely as-is). Per-script log filtering (option c) deferred as a possible later refinement, not v1.
- Flags: none

### Q2 — What happens to `<status-bar>` / `<status-bar-header-actions>` on mobile?

- Asked: `<status-bar>` is the sidebar-footer component (heartbeat, MQTT connection indicator, 3 configurable stat slots w/ sparklines) — already compact, was already designed to fit inside a 310px-wide sidebar. `<status-bar-header-actions>` is up to 3 configurable HA-entity action buttons rendered in the header-actions row. Given mobile v1 = dashboard (script list) ⇄ log (two screens): should `<status-bar>` (system health footer) stay visible on the dashboard screen (arguably relevant to "health" focus, and already narrow-width-friendly), stay on both screens, or be dropped/deferred for v1? And should `<status-bar-header-actions>` (custom entity buttons) still render in the mobile header, given the header now also needs to fit the new mobile/desktop toggle?
- Captured: **Accepted as recommended.** `<status-bar>` (heartbeat/MQTT/sparklines) stays visible on the dashboard screen (health-relevant, already narrow-width-friendly), dropped on the log screen (give the log stream the space). `<status-bar-header-actions>` (custom entity buttons) stay in the mobile header too — exact layout (single row vs. wrapping to a second row if tight) is an implementation detail, not decided now.
- Flags: none

### Q3 — Mobile detection mechanism & breakpoint

- Asked: How should "mobile device detected" actually be determined? Options: (a) viewport-width media query / `matchMedia` (e.g. `max-width: 768px`), simple, works for phones and narrow windows/split-screen alike, re-evaluates live on resize/rotate; (b) `navigator.userAgent` sniffing (targets real phones specifically, doesn't react to just resizing a desktop browser window, more brittle/spoofable); (c) both (UA for initial guess, width as override signal). Also: what breakpoint value — plain phones only (~480-600px) or phones+small tablets (~768-900px)?
- Captured: **Confirmed as recommended.** `matchMedia`, `max-width: 768px` breakpoint, live-reacting to resize/rotation (not one-shot UA sniffing).
- Flags: none

### Q4 — Manual toggle: visibility & persistence

- Asked: The header-action toggle (mobile ⇄ desktop) — should it always be visible/available regardless of actual screen size (so someone on a desktop browser can preview mobile mode, or someone on a phone can force desktop layout e.g. for a wide external display), or only appear once the device is near/at the mobile breakpoint (pure override, not a general-purpose preview toggle)? And once toggled, does the manual choice persist across reloads (`localStorage`, same pattern as `js_collapsed_sections`) and override the automatic `matchMedia` detection until explicitly toggled back, or is it session-only / resets on next visit (auto-detection re-applies every fresh load)?
- Captured: **New settings option instead of always-on-always-visible.** User's proposal: a `<settings-view>` toggle, e.g. "Hide in desktop mode" — when enabled, the mobile⇄desktop toggle button is hidden while the app is currently rendering in desktop layout (still shown while in mobile layout, since that's where you need it to get back). Rejects my "always visible everywhere" recommendation in favor of a user-controlled, off-by-default-clutter option. Persists via the existing settings system (`window.currentSettings`/`settings-changed`), not a separate localStorage key.
- Flags: default value of the new setting (on or off by default) and the reload-persistence-of-manual-choice sub-question from Q4 are still open -> Q4b

### Q4b — Setting default & manual-choice persistence

- Asked: (1) Should the new "Hide in desktop mode" setting default to **off** (toggle visible everywhere out of the box, matches current no-config-needed philosophy of other settings) or **on** (toggle hidden by default on desktop, opt-in to reveal — cleaner default UI, since most desktop users never need it)? (2) Once someone manually flips mobile⇄desktop, does that choice persist across reloads via `localStorage` (overrides auto-detection until toggled back) or reset every fresh load (auto-`matchMedia` always wins on load)?
- Captured: **Yes to both.** Setting defaults to off (toggle visible everywhere until user chooses to hide it on desktop). Manual mobile⇄desktop choice persists in `localStorage`, overrides auto-`matchMedia` detection until explicitly toggled back.
- Flags: none

### Q5 — "Collapse the whole script list" button next to search

- Asked: User wants a button right next to the search field that "minimizes/completely collapses" the script list — independent of mobile (applies to desktop too, per "unabhängig davon"). Need to clarify exact behavior: (a) collapse **all groups at once** (reuse the existing per-group collapse mechanism — `js_collapsed_sections` — just apply it to every group in one click, groups still show as headers, can be individually re-expanded after), or (b) hide the **entire list area** including group headers, leaving just the sidebar header/search bar visible and an empty space below (a "get it out of my way entirely" declutter mode, not a grouped/collapsed state)? Also: what's the actual use case driving this — decluttering when you have many scripts, or freeing vertical space for something else? And should the collapsed/hidden state persist across reloads (`localStorage`, same pattern as group-collapse)?
- Captured: **(a) — collapse all groups at once**, reusing the existing per-group `localStorage` collapse mechanism applied to every group in one click (still individually re-expandable after). Driving use case: **decluttering when you have many scripts** (not freeing space for something else). Persistence not explicitly re-confirmed in this exact reply but matches the recommended default (`localStorage`, survives reload) — treat as accepted unless corrected later.
- Flags: none

### Q6 — Code-content search: implementation approach

- Asked: Script source isn't held client-side today (fetched on-demand via `GET /api/scripts/:filename/content`). To search inside code, either (a) a **new backend search endpoint** (server greps/searches script file contents, returns matching filenames — scales fine regardless of script count/size, one extra network round-trip per search), or (b) **client-side prefetch-all-and-filter** (fetch every script's content once, e.g. on sidebar load or lazily, then filter locally — zero extra round-trips per keystroke, but wastes bandwidth/memory if there are many/large scripts and needs cache invalidation when a script is saved). Also: should code-match be silently OR'd into the existing single search box (matches name/filename/description/area/label/**code**, no mode switch), or a separate explicit toggle/mode ("search in code")? And should the search be debounced (e.g. 300ms) before triggering, especially relevant if it's a server round-trip?
- Captured: **Accepted as recommended, full bundle.** (a) new backend search endpoint. Code-match folds silently into the existing single search box (no separate mode/toggle — matches name/filename/description/area/label/code all at once). Debounced (~300ms) before firing.
- Flags: none

### Q7 — Tapping a script row on mobile (editor is out of scope, per Q1)

- Asked: On desktop, clicking a script row opens it in the Monaco editor tab. Since the editor is explicitly out of scope for mobile v1 (Q1), what should tapping a script row actually do on the mobile dashboard? Options: (a) **nothing / no-op** — only the existing per-row action buttons (toggle/restart/dismiss-error) are interactive, tapping the row itself does nothing; (b) tapping the row **expands inline details** (e.g. full tooltip content — RAM/last-started/capabilities/conflicts — currently only a hover tooltip, which doesn't exist on touch) directly in the list; (c) tapping the row **opens the log screen prefiltered to that script** — ties into Q1b's log screen and would double as the "health drill-down" affordance.
- Captured: **(b) — tap expands inline details** (the existing hover-tooltip content — RAM/last-started/capabilities/conflicts — becomes tap-to-expand inline in the row, since hover doesn't exist on touch).
- Flags: none

### Q8 — Fate of the other header-action buttons on mobile (New Script / Store Explorer / Settings)

- Asked: Today's header-actions row (`app-sidebar.ts`) has New Script, Store Explorer, Settings, plus the (still-hidden) Reference button, and will gain the new mobile⇄desktop toggle. Store Explorer opens a dev-tools tab — out of scope per Q1, so presumably hidden on mobile. Settings is needed on mobile too (it's literally where the new "Hide in desktop mode" setting from Q4b lives), so presumably stays. New Script opens the creation wizard, which itself opens into the (out-of-scope) editor once a script is created — does creating a new script from a phone make sense at all for v1, or should that button also be hidden on mobile (creation stays a desktop-only workflow for now, mobile is control/monitoring only)?
- Captured: **Accepted as recommended.** New Script hidden on mobile (creation stays desktop-only, avoids dead-ending in the out-of-scope editor). Store Explorer hidden on mobile (dev-tools, out of scope). Settings stays visible.
- Flags: none

### Q9 — Navigation affordance between dashboard and log screens (Q1b)

- Asked: Q1b settled on two mobile screens (dashboard ⇄ log) but not _how_ you switch between them. Options: (a) a small **bottom tab bar** (2 tabs: Dashboard/Log) — most conventional mobile pattern, always-visible, discoverable; (b) a **button in the header-actions row** that flips between the two (consistent with how the mobile⇄desktop toggle also lives in header-actions, but header-actions is already gaining/losing several buttons per Q8 so it's getting crowded); (c) **swipe gesture** between the two screens — no persistent chrome needed, but undiscoverable without a visual hint and easy to trigger by accident while scrolling a long script list.
- Captured: **(b) — header-actions button**, not a bottom tab bar. Reason: a bottom tab bar would collide with `<status-bar>` (Q2 decided it stays visible on the dashboard screen, and status-bar is itself a sidebar-footer/bottom-anchored element) — two competing bottom-anchored UI elements. Header-actions button avoids that clash even though the row is already getting crowded per Q8.
- Flags: none

### Q10 — Where this fits in the existing RFC / branch / release plan

- Asked: All prior LIT migration work ([[project_lit_migration]]) lives on `feature/lint-prettier-ci-foundation` (not yet merged to main), following `docs/RFC_FRONTEND_MODERNIZATION.md`'s Phase A component order (currently at item 6: `<card-preview>` + dialogs, next up). Should mobile view be added as a new RFC Phase A/B item and built on the same branch (continuing the existing migration sequence before it merges), or treated as a separate, later initiative (its own branch/release, after the current migration branch merges to main)? This affects sequencing — e.g. whether mobile-view CSS/layout work risks colliding with not-yet-built `<card-preview>`/dialog components on the same branch.
- Captured: **Rejected my recommendation.** Mobile view is added as a **new milestone/RFC item on the same `feature/lint-prettier-ci-foundation` branch**, continuing the existing LIT/TS migration sequence rather than becoming a separate later initiative. User was looking forward to it and wants it now, not deferred. → Update `docs/RFC_FRONTEND_MODERNIZATION.md` to insert this as a new Phase A/B item (exact ordering relative to item 6 `<card-preview>`/dialogs TBD at implementation time) and update `[[project_lit_migration]]` memory accordingly.
- Flags: RFC document update + memory update needed once this session's decisions are finalized -> implementation follow-up, not a question

### Q11 — Icon choices for the new buttons

- Asked: Proposed MDI icons for the three new interactive elements, checked against what's already used elsewhere in the codebase to avoid semantic clashes: (1) mobile⇄desktop toggle: `mdi-cellphone` (shown in desktop mode, taps to mobile) / `mdi-monitor` (shown in mobile mode, taps to desktop) — target-state convention, matches the plain-glyph style of existing header-actions icons (`mdi-plus`/`mdi-database-search`/`mdi-cog`, no `-outline` suffix); (2) dashboard⇄log toggle: `mdi-view-list` (dashboard, shown on log screen) / `mdi-text-box-outline` (log, shown on dashboard screen) — deliberately avoids `mdi-view-dashboard*` family (already means "Card Editor"/HA dashboard cards elsewhere in this app: `tab-manager.js`, `card-preview.ts`) and avoids reusing `mdi-console` (already the "exec" capability badge icon in `script-row.ts`/`creation-wizard.js`); (3) collapse-all-groups button (next to search): `mdi-unfold-less-horizontal` / `mdi-unfold-more-horizontal` (target-state toggle) — distinct from the per-group `mdi-chevron-up/down` already used in `script-group.ts`, so the two mechanisms don't look identical.
- Captured: **Refined and confirmed.** User pointed out there are no real users yet, so icons can be freely reassigned across the whole app, not just picked to avoid clashing with existing usage. Final scheme:
  - Mobile "Script Dashboard" screen: `mdi-view-dashboard-outline` (reclaimed — the natural fit).
  - Card Editor / card-related badges (currently `mdi-view-dashboard-outline`/`mdi-view-dashboard-edit-outline` in `card-preview.ts`, `script-row.ts` card-capability badges, `tab-manager.js`): **renamed to `mdi-card-text-outline`** — arguably more correct anyway, since these represent HA Lovelace "cards" specifically, not a generic dashboard concept.
  - Dashboard⇄log header-actions toggle (Q9): `mdi-view-dashboard-outline` (dashboard) / `mdi-text-box-outline` (log) — supersedes the earlier `mdi-view-list` proposal.
  - Mobile⇄desktop toggle (`mdi-cellphone`/`mdi-monitor`) and collapse-all button (`mdi-unfold-less-horizontal`/`mdi-unfold-more-horizontal`) unchanged from the original proposal — no clash there.
- Incidental bug found while checking this (not fixed now, flagged per [[feedback_flag_bugs_found_incidentally]]): `tab-manager.js:362` — `icon.className = cardTabOpen ? 'mdi mdi-view-dashboard-edit-outline' : 'mdi mdi-view-dashboard-edit-outline'` — both ternary branches are identical, looks like a dead/never-finished state distinction. User explicitly asked to be **reminded about this when the card-icon rename is actually implemented** — not decided/fixed as part of this grill session.
- Flags: `tab-manager.js:362` dead ternary -> remind user + decide fix scope when implementing the card-icon rename

## Open flags (pending input)

- `tab-manager.js:362` dead ternary (`mdi-view-dashboard-edit-outline` both branches identical) — surface again when implementing the Q11 card-icon rename, not decided yet whether/how to fix
