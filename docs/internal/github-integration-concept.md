# Concept: Script Versioning (Git / GitHub)

Redesigned 2026-08-19 (see `notes/2026-08-19-backup-versioning-grill.md` for the full discovery session). Replaces the previous version of this document.

## Motivation

Scripts deserve version history: recovering from "I broke this script" should be a fast, granular, in-editor action — not a full disaster-recovery zip restore (see `backup-concept.md`, which is deliberately scoped to that rarer case). Monaco itself has no built-in history — that's a VS Code workbench feature, not part of the bare `monaco-editor` npm package this app uses ([monaco-editor.ts](../../js_automations/public/js/components/monaco-editor.ts)), so this needs to be built.

## Repository model

`SCRIPTS_DIR` becomes **one** real local git repository — not one repo per script. Works fully offline, no account required. Per-script history is just git's normal per-path log (`git log -- scripts/x.ts`) filtered within that single repo.

A GitHub remote is **optional**, same pattern as the WebDAV backup target: configured in Settings > Versioning (repo URL + PAT), and if set, every commit is additionally pushed there, best-effort — giving an offsite copy and GitHub's own browsing UI. One GitHub repo overall, holding all scripts — not one per script.

Only `scripts/*.ts` and `libraries/*.ts` are versioned. `settings.json` and `data/` are excluded — they change constantly at runtime (sensor values, counters) and would flood history with noise instead of real code changes. That data stays the responsibility of the zip backup (`backup-concept.md`), not git.

## Commit trigger — explicit button, NOT save or deploy

**Important correction made during the design session:** the first pass of this concept assumed commits could ride on "deploy." That turned out to be wrong — `POST /:filename/content` (the save endpoint, [scripts-routes.ts:707](../../js_automations/routes/scripts-routes.ts#L707)) **is** the deploy/activation mechanism for a running script: saving a live script immediately stops and hot-reloads the worker ([scripts-routes.ts:717-722](../../js_automations/routes/scripts-routes.ts#L717-L722)). There is no separate "deploy" step. Tying commits to it would have meant a commit on every single save of an active script — exactly the noise a meaningful history is supposed to avoid.

Instead: committing is a **fully separate, explicit user action** via a dedicated Commit button in the script editor toolbar (next to Save). Save keeps behaving exactly as it does today, completely unchanged.

### Commit flow

```
User clicks [Commit]
  → Dialog opens: text field prefilled with a default message (e.g. "update: smart_watering.ts")
  → User can overwrite it or just confirm as-is — never forced to type
  → POST /api/github/commit { message }
  → Backend: git add <changed source files>; git commit -m message --author "Name <email>"
```

Deletions are not auto-staged by a blanket commit — carried forward from the prior design as a sensible default: deleting a script in the JSA UI does not by itself remove it from git history, so accidentally deleted scripts stay recoverable. An explicit opt-in (e.g. a checkbox in the delete dialog) is needed to actually stage a deletion.

## UI placement

Grounded in the app's existing component structure rather than invented from scratch:

- **Global git status** — ONE icon in the sidebar status bar (`status-bar.ts`), next to the existing HA-heartbeat and MQTT indicators, which is already the home for this kind of connection/sync state. Color alone signals the state (green connected / gray no-remote-configured / red push-failed) — no second icon needed, color already carries it. Click opens Settings > Versioning.
  - **Open risk, needs testing in the real app, not resolved here:** the sidebar is only 310px wide (`app-sidebar.ts` `:host { width: 310px }`), and with 3 stat slots + sparklines active, room for a new icon + separator next to heartbeat/MQTT is genuinely tight. `status-bar.ts` already has a `hide_sparkline_on_dense` fallback for the 3-slot case, but it only affects the stat slots, not this new icon/separator, so it doesn't automatically solve the fit problem. If it doesn't fit: drop the separator before the git icon, or move the git icon to a different position (e.g. before the stat slots) instead of next to heartbeat/MQTT.
- **Per-script history** — NOT a file tab (the editor's existing tabs are open-file tabs, VS Code style, and a "History" tab would collide with that concept). Instead, a toggle icon in the script editor's toolbar (next to Save/Commit) opens a **side panel**: commit list with timestamps, diff view against the current content. Note: the VS Code Source Control sidebar (changes list, commit box, graph — as seen in code-server) is workbench + extension-host chrome, not part of the `monaco-editor` npm package this app embeds, so it can't be reused directly and this panel needs to be built custom. Monaco's diff editor (`monaco.editor.createDiffEditor`), however, IS part of that package already in use elsewhere in the app and is the natural fit for rendering the diff view itself.
- **Restore an old version** — clicking a commit in the history panel loads that version's content into the editor for review/editing. It does **not** commit automatically. The user then commits explicitly via the Commit button, same as any other change.

## Creation Wizard: "Restore from repo" tab

A 4th tab alongside the existing `new` / `upload` / `import` tabs ([script-modal.ts:7](../../js_automations/public/js/components/script-modal.ts#L7)), rendered only when a git repo exists in `SCRIPTS_DIR`.

Scoped deliberately narrow: it lists only scripts that are **deleted from disk but still present in git history** — not a full repo browser. "Reviving a deleted script" is conceptually the same job as "create a new script," so it belongs in the Creation Wizard. Older versions of scripts that still exist on disk are handled by the per-script History panel in the editor (above) instead — keeping one place per purpose rather than two paths to the same outcome.

```
┌──────────────────────────────────────────────┐
│  New  |  Upload  |  Import  |  Aus Repo       │
├──────────────────────────────────────────────┤
│  In Git, aber nicht mehr auf Platte:         │
│                                                │
│  • backup-runner.ts            [Wiederherstellen] │
│  • old-notify.ts               [Wiederherstellen] │
└──────────────────────────────────────────────┘
```

Clicking "Wiederherstellen" writes the file back to disk from its last committed content (`git show HEAD:<path>` or `git checkout HEAD -- <path>` after re-adding the path) — does not auto-commit; the file just reappears as an uncommitted-clean script, same as anything restored from history.

## Carried-forward implementation details (not re-litigated in the redesign session, still sound)

These come from the prior version of this concept and don't conflict with anything decided above — kept here as implementation guidance:

- **First-time setup:** if no `.git` exists in `SCRIPTS_DIR`, the first commit runs `git init`, sets `user.name`/`user.email` from settings, and creates the initial commit. The GitHub remote is added on first push.
- **Push:** token is injected into the remote URL per-request (`https://TOKEN@github.com/user/repo.git`) and never written to `.git/config` or cached.
- **Token storage:** in `settings.json`, same security level as the existing MQTT password field.
- **Revert safety matrix** — only non-destructive git operations are exposed in the UI:

  | Action                           | Destructive?            | Offered? |
  | --------------------------------- | ------------------------ | -------- |
  | `git revert HEAD`                 | No — creates a new commit | Yes      |
  | `git checkout <hash> -- <file>`   | No — working tree only    | Yes      |
  | `git reset --hard`                | Yes — loses commits       | No       |

- **Per-file restore-to-commit:** in addition to loading a version into the editor (the primary flow above), a commit entry can expose "restore this file to this commit" directly, via `git checkout <hash> -- <path>` — still requires an explicit commit afterward, never auto-commits.

## Not in scope

- Pull / sync from remote
- Branch switching or creation
- Merge conflict resolution
- A full diff/merge UI beyond the simple version-vs-current view
- Auto-commit on save
- `.gitignore` management

## Open implementation details

Not blocking, decide at build time:

- Whether the Commit button also saves first if the editor has unsaved changes.
- Exact commit-author identity mechanism (fixed bot identity vs. Settings-configured name/email).
