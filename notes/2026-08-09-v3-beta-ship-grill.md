# 3.0.0 Beta Ship: Grill / Discovery Notes

Date: 2026-08-09 · Goal: decide what's left before shipping Blockly + LIT/TS as a real-world-testable 3.0.0 beta, resolve the panel_icon/app_icon question, and diagnose the `npm run dev` port-in-use problem.

## Summary / key decisions

**Status:** Blockly ("Helicopter") + full LIT frontend migration + backend TypeScript migration (RFC §8) are all 100% scope-complete. Sitting on `feature/backend-ts-migration`, 102 commits ahead of `main` / 0 behind, `lint`+`typecheck` clean (`tools/*.js` baseline excepted, by design). Nothing left to _build_ — what's left is release process + verification.

**Decisions made this session:**

1. **Merge:** open a PR from `feature/backend-ts-migration` → `main` first; user decides on the actual merge. Beta ships from `main` (single-track design), not directly off the feature branch.
2. **Changelog:** draft `CHANGELOG.md` entries now for the whole unreleased feature set (Blockly, Mobile View, Dev Tools panel, LIT UI, etc.) — backend-TS migration itself is internal, likely no user-facing line needed.
3. **Icons:** `mdi:robot-angry-outline` for both `panel_icon` and a regenerated `icon.png` — **beta channel only** (`js_automations_beta/config.yaml` + `js_automations_beta/icon.png`). Stable keeps `robot-happy`. Re-decide at 3.0.0 stable promotion. Need to confirm `robot-angry-outline` actually exists in HA's bundled MDI set (not just the CDN one this app's own UI uses) before calling it done.
4. **`npm run dev` port bug:** root cause is nodemon's `exec: "npm run build:backend && node js_automations/server.js"` (added today, commit `4184ca9`) — a `&&`-chained shell command whose full process tree isn't reliably killed by nodemon on Windows restarts, orphaning `node server.js` holding port 3000. Fix: split the `tsc` build out into its own `concurrently`-managed `--watch` process, nodemon spawns a bare `node server.js` with no children. Fix now, verify with repeated live restarts.
5. **Pre-ship checklist**, confirmed: (a) real `docker build` test — never re-run since backend-TS added its own build step, (b) one full end-to-end live pass (Playwright driver + real HA) covering Blockly + LIT UI + backend-TS _together_ — this exact combination has never been live-tested as a whole, (c) `npm test` (backend+frontend) green.
6. **Docs:** apply the already-drafted README beta callout ([[project_readme_beta_callout_and_ci_badge]]) now that its gate ("first real 3.x beta ships") is met. `TECH-README.md` needs a real content update to reflect the new architecture (LIT, backend TS + tsc build step, Blockly) — scope not yet defined. `API_REFERENCE` likely unaffected (no API surface changes).
7. **Release name:** "Helicopter" (Bloc Party) retired — too narrow now that scope is the whole 3.0.0 rewrite, not just Blockly. New pick: **"Harder, Better, Faster, Stronger" by Daft Punk** (rebuild/upgrade anthem, ties into the new robot_angry identity).
8. **Version:** not formally asked (unambiguous from context) — `npm run ship:beta:major` takes `2.57.9` → `3.0.0-beta.0`, matching the user's explicit "3.0.0 beta" framing and the existing `ship:beta:major` script.

## Open flags (pending input)

- Confirm `mdi:robot-angry-outline` exists in HA's bundled MDI icon set (not just the CDN set) -> verify visually after implementing, before calling icon work done.
- `TECH-README.md` update scope/content -> needs its own read-through of current file vs. actual architecture, not yet defined.
- Dev-port fix root cause is a well-grounded hypothesis (timing + known Windows/nodemon behavior), not a confirmed repro -> verify live after implementing.

## Q&A log

### Q0 — Status baseline (research, not asked)

- Captured: Blockly ("Helicopter") 100% done, merged to `main` 2026-08-08 (PR #21, `52c28ca`). LIT Phase A+B 100% done. Backend TS migration (RFC §8) 100% done as of today (`d0b92d5`). `feature/backend-ts-migration` is 102 commits ahead of `main`, 0 behind — clean fast-forward-mergeable, no PR open yet. `npm run lint` clean, `npm run typecheck` clean except accepted `tools/*.js` baseline (out of RFC scope by explicit user decision). `CHANGELOG.md`'s `<!-- NEXT -->` section is currently empty. Current version 2.57.9, not yet bumped.
- Flags: none, purely observational.

### Q1 — Merge feature/backend-ts-migration to main first?

- Asked: PR first + merge to main before building the beta, or ship directly off this branch?
- Captured: User chose **PR first, then merge to main** — keeps main as the single-track source the beta channel design assumes. I create the PR; user decides on the actual merge.
- Flags: none.

### Q2 — Draft CHANGELOG entries now?

- Asked: draft CHANGELOG entries for the huge unreleased feature set now (before shipping), or ship first and backfill later?
- Captured: User wants entries **drafted now**. Backend-TS migration itself is internal/invisible, likely doesn't need its own line. To do (separate step after this interview): pull user-visible features from memory/commits (Blockly visual editor, Mobile View, Dev Tools panel, entity-picker state preview, etc.) and propose changelog text.
- Flags: drafting the actual entries -> follow-up task, not part of this interview itself.

### Q3 — panel_icon + app_icon scope: beta-only or permanent stable rebrand?

- Asked: apply `mdi:robot-angry-outline` (panel_icon) + a regenerated `icon.png` (app_icon) to beta only, or as a permanent identity change for stable too?
- Captured: **Beta-only**, decided. Change `js_automations_beta/config.yaml`'s `panel_icon` to `mdi:robot-angry-outline`, and generate a new `js_automations_beta/icon.png` (angry-robot glyph, same green-circle style as today's). Stable's `config.yaml`/`icon.png` (robot-happy) stay untouched. Re-decide at 3.0.0 stable-promotion time whether robot_angry carries over permanently.
- Research: confirmed `js_automations_beta/icon.png` and root `icon.png` are byte-identical today (both robot-happy on green circle) — beta was previously only distinguishable via `panel_icon` in the HA sidebar, not in the Add-on Store listing itself. This fixes that.
- Flags: need to verify `mdi:robot-angry-outline` actually exists in the MDI set HA ships (this app loads MDI from a CDN for its own UI, but HA's sidebar renders `panel_icon` from its own bundled icon set, which can lag the CDN version) -> verify after implementing, before calling it done.

### Q4 — `npm run dev` port-already-in-use: diagnose only, or fix now?

- Asked: root cause found (see below) — fix now as part of today's batch, or just note it for later?
- Captured: **Fix now**, decided.
- Root cause (research, high confidence not certain): `nodemon.json`'s `exec` became `npm run build:backend && node js_automations/server.js` today (commit `4184ca9`, backend-TS migration) — exact same day the user started seeing the problem. On Windows this spawns a `cmd.exe → npm.cmd → tsc` chain, then a separate `node server.js` further down the tree. Windows/`cmd.exe` signal propagation through `&&`-chained commands is a known weak spot for killing the full process tree on nodemon restart — the actual `node server.js` holding port 3000 can survive as an orphan, causing the next restart's `EADDRINUSE`.
- Checked live: 5 `node.exe` processes currently running on this machine, all unrelated (Elgato Stream Deck plugins) — confirms no leftover dev-server process _right now_, and rules out a "just kill all node.exe" workaround (would kill Stream Deck integrations too).
- Planned fix: stop routing the `tsc` build through nodemon's `exec` chain. Run `tsc --watch` as its own always-on process via `concurrently` (new devDependency), nodemon spawns only a bare `node js_automations/server.js` — no process tree under it for a kill signal to fail to reach. Verify live with several forced restarts that the port never sticks.
- Flags: this is the most likely cause based on the timing + known Windows/nodemon behavior, not a 100%-confirmed repro — verify the fix actually resolves it live before considering this closed.

### Q5 — Pre-ship checklist: anything missing?

- Asked: proposed checklist (Docker build verification, one full end-to-end live pass across Blockly+LIT+backend-TS together via the Playwright driver + real HA, full `npm test` green) — confirm or extend?
- Captured: **Confirmed as-is**, nothing to add.
- Why each item: (1) Docker build — `RUN npm run build` in the Dockerfile already covers frontend+backend build generically, but hasn't been re-run as a real `docker build` since backend-TS landed (last confirmed real docker build/run test was M4-era, before the backend TS build step existed). (2) Full combined live pass — Blockly's PR merge explicitly skipped a fresh live smoke test ("each feature was already live-verified individually"), and backend-TS was then layered on top of that merge — so the exact combination now on `feature/backend-ts-migration` (Blockly + full LIT UI + backend TS) has never been driven end-to-end in one go. (3) `npm test` (backend+frontend) hasn't been run this session.
- Flags: none — this is the agreed scope for "what's left."

### Q6 — Completeness backstop: anything not yet covered?

- Asked: anything missing, e.g. doc updates per CLAUDE.md's rules (README/API_REFERENCE/i18n)?
- Captured: Yes, two doc items surfaced:
  1. **README.md** needs the beta callout added — already drafted in [[project_readme_beta_callout_and_ci_badge]] 2026-08-03, was gated on "first real 3.x beta actually ships" — that gate is now met, apply it.
  2. **API_REFERENCE** is probably still fine as-is (no API surface changed by this migration).
  3. **TECH-README.md** needs an actual update — it documents runtime architecture, and the architecture materially changed (LIT components, backend now TypeScript+tsc build step, Blockly). Not yet touched to reflect this.
  - i18n not flagged as needing changes this round (no new user-facing strings identified beyond what's already localized during the migration itself, per [[project_lit_migration]]'s notes on translated strings along the way).
- Flags: TECH-README.md update -> scope/content not yet defined, needs its own pass reading the current file against actual architecture.

### Q7 — Release name: "Helicopter" (Bloc Party) no longer feels right

- Asked: (raised by user, not asked by me) — scope grew far beyond just Blockly (full LIT+TS+Blockly rewrite bundled as 3.0.0), so the Bloc Party/Blockly-only pun feels too narrow now. Requested alternative suggestions.
- Captured: user's own words — "Mit dem Liedtitel bzw Bandnamen (Blocparty) bin ich noch nicht ganz zufrieden. Hast du noch Vorschläge? Ist ja doch noch eine Menge dazu gekommen." Open, pending a suggestion + user pick (see below, asked as follow-up).
- Flags: [[feedback_release_naming]] (song titles) and [[feedback_release_language]] (English) still apply — need a title that captures the _whole_ 3.0.0 scope (total rewrite/modernization + new robot_angry identity), not just Blockly.

### Q8 — Release name pick

- Asked: presented 4 candidates (Daft Punk "Harder, Better, Faster, Stronger", Daft Punk "Robot Rock", David Bowie "Changes", Bloc Party "This Modern Love").
- Captured: **"Harder, Better, Faster, Stronger" by Daft Punk** — decided. Supersedes "Helicopter"/Bloc Party as the 3.0.0 release title.
- Flags: none.
