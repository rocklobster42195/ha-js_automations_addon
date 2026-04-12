# Concept: GitHub Integration

## Motivation

Scripts written in JS Automations are valuable automations that deserve version control. By pointing the scripts directory at a GitHub repository, users get a full commit history, easy recovery of deleted scripts, and the ability to sync their scripts across installations — all without leaving the IDE.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  [▷][↺] | [💾][✎][⬇][⎘][⇔] | [✂…snippets…] | [⊞ commit][⬆ push] │
└──────────────────────────────────────────────────────────────────┘
                                                  ↑
                                    GitHub toolbar group (new)
                                    Only visible when gh_enabled: true
```

The existing toolbar groups remain unchanged. A new separator + two buttons are appended to `toolbar-left`: **Commit** and **Push**. Both are hidden unless GitHub is enabled in settings.

---

## Configuration

New section `github` in Settings (alongside General, Editor, MQTT, etc.):

| Key | Type | Description |
|---|---|---|
| `gh_enabled` | boolean | Enables the GitHub integration |
| `gh_repo` | text | Remote URL (`https://github.com/user/repo.git`) |
| `gh_token` | text (password) | GitHub Personal Access Token |
| `gh_author_name` | text | Commit author name |
| `gh_author_email` | text | Commit author email |

Empty `gh_repo` / `gh_token` disables push silently (commit still works locally).

---

## Commit Flow

```
User clicks [commit]
  → Modal opens: textarea for commit message
  → User types message, clicks OK
  → POST /api/github/commit { message }
  → Backend: git add --no-all .   ← new + modified only, NO deletions
  → git commit -m message --author "Name <email>"
  → Response logged: "Committed abc1234"
```

### Key detail: deletions are never auto-staged

`git add --no-all .` stages new and modified files but skips deleted files. This means:
- Deleting a script in JSA does **not** remove it from the repository.
- Deleted scripts remain in git history and are recoverable at any time.
- To explicitly delete a file from the repo, the user can opt-in via the delete dialog (see below).

---

## Push Flow

```
User clicks [push]
  → POST /api/github/push
  → Backend: injects token into remote URL at request time
    → https://TOKEN@github.com/user/repo.git
  → git push --set-upstream origin HEAD  (first push sets tracking)
  → Token is NEVER written to .git/config
  → Response logged: "Pushed to origin/main"
```

---

## Delete Dialog Extension

When `gh_enabled: true`, the script delete confirmation dialog gains an extra checkbox:

```
┌─────────────────────────────────────────┐
│  Delete "my-script.ts"?                 │
│                                         │
│  ☐ Also delete from git repository     │
│                                         │
│          [CANCEL]  [DELETE]             │
└─────────────────────────────────────────┘
```

- **Unchecked (default):** file is deleted from disk, stays in git → recoverable
- **Checked:** after local deletion, `POST /api/github/remove` is called
  - Backend: `git rm --cached <path>` — stages the deletion, ready for next commit
  - No auto-commit; user commits manually via toolbar

---

## Restore from Git (Creation Wizard)

When `gh_enabled: true` and a git repo exists, the Creation Wizard shows a second tab:

```
┌──────────────────────────────────────────────┐
│  New Script  |  Restore from Git             │
├──────────────────────────────────────────────┤
│  Files deleted locally but still in repo:    │
│                                              │
│  • backup-runner.ts            [Restore]     │
│  • old-notify.ts               [Restore]     │
│  • weather-fetch.ts            [Restore]     │
└──────────────────────────────────────────────┘
```

Clicking **Restore** calls `POST /api/github/checkout { path }` → `git checkout -- <path>` → file reappears in the script list.

---

## Backend API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/github/status` | `{ isRepo, branch, hasChanges, ahead, behind }` |
| `POST` | `/api/github/commit` | Stage new+modified, commit with message |
| `POST` | `/api/github/push` | Push to remote with token-injected URL |
| `POST` | `/api/github/remove` | Stage deletion of a specific file (`git rm --cached`) |
| `GET` | `/api/github/deleted` | List files tracked in git but missing on disk |
| `POST` | `/api/github/checkout` | Restore a deleted file from git |
| `GET` | `/api/github/log` | Recent commit history `[{ hash, shortHash, message, date, author }]` |
| `POST` | `/api/github/revert` | Undo last commit safely via `git revert HEAD` |
| `POST` | `/api/github/restore-file` | Restore single file to a past commit: `{ hash, path }` |

---

## First-Time Setup

If no `.git` exists in `SCRIPTS_DIR`, the first commit automatically:
1. Runs `git init`
2. Sets `user.name` and `user.email` from settings
3. Adds all files and creates the initial commit

The remote is added on first push (using `gh_repo` from settings).

---

## Rollback

### History Panel

A `mdi-history` button in the toolbar opens a modal listing the last N commits:

```
┌──────────────────────────────────────────────────────────┐
│  History                                          [✕]    │
├──────────────────────────────────────────────────────────┤
│  abc1234  Fix sensor threshold         2026-04-11  [↩]   │
│  def5678  Add weather script           2026-04-10  [↩]   │
│  ghi9012  Initial commit               2026-04-09  [↩]   │
└──────────────────────────────────────────────────────────┘
```

`GET /api/github/log?limit=20` → `git log --oneline --format="%H|%h|%s|%ai|%an" -N`

### Revert (safe)

Clicking **[↩]** next to a commit opens a confirmation:

> "Revert commit 'Fix sensor threshold'? This creates a new commit that undoes the changes."

- `POST /api/github/revert` → `git revert HEAD --no-edit`
- Only HEAD is supported (reverts the most recent commit)
- Non-destructive: history is preserved, a new "Revert …" commit is added
- `git reset --hard` is intentionally **not** offered — it would destroy history

### Per-File Restore

In addition to full revert, each commit entry can expand to list affected files.
Clicking a file → `POST /api/github/restore-file { hash, path }` → `git checkout <hash> -- <path>`

- Restores only that one file to its state at the selected commit
- Does not create a commit automatically — user reviews the change and commits manually
- Safe: no other files are touched

### Safety Matrix

| Action | Destructive? | Recommended |
|---|---|---|
| `git revert HEAD` | No — new commit | ✅ |
| `git checkout <hash> -- <file>` | No — working tree only | ✅ |
| `git reset --hard` | Yes — loses commits | ❌ not offered |

---

## Security

- The GitHub token is stored in `settings.json` (same security level as MQTT password).
- The token is **never written to `.git/config`** or `.gitconfig`.
- It is injected per-request into the remote URL: `https://TOKEN@github.com/user/repo.git`.
- After the request, the URL with token is discarded — not cached.

---

## i18n

New keys under `settings.sections.github` and `settings.github.*`:

| Key | EN | DE |
|---|---|---|
| `settings.sections.github` | GitHub | GitHub |
| `settings.github.enabled` | Enable GitHub Integration | GitHub-Integration aktivieren |
| `settings.github.repo` | Repository URL | Repository-URL |
| `settings.github.repo_desc` | HTTPS URL of your GitHub repository | HTTPS-URL deines GitHub-Repositories |
| `settings.github.token` | Personal Access Token | Personal Access Token |
| `settings.github.token_desc` | GitHub PAT with repo write access | GitHub PAT mit Schreibzugriff auf das Repo |
| `settings.github.author_name` | Author Name | Autorenname |
| `settings.github.author_email` | Author Email | Autoren-E-Mail |
| `git_commit_title` | Commit | Commit |
| `git_push_title` | Push to GitHub | Zu GitHub pushen |
| `git_commit_placeholder` | Commit message... | Commit-Nachricht... |
| `git_restore_tab` | Restore from Git | Aus Git wiederherstellen |
| `git_also_delete_repo` | Also delete from git repository | Auch aus dem Repo löschen |

---

## Implementation Roadmap

| Phase | Files | Change |
|---|---|---|
| 1 — Dependency | `package.json` | Add `simple-git` |
| 2 — Settings | `core/settings-schema.js` | New `github` section |
| 3 — Backend | `routes/github-route.js` | All 6 API endpoints |
| 4 — Server | `server.js` | Register `githubRouter` |
| 5 — Toolbar | `public/index.html` | Commit + Push buttons |
| 6 — JS | `public/js/github.js` | Frontend logic |
| 7 — Delete Dialog | `public/js/script-list.js` | Checkbox extension |
| 8 — Wizard | `public/js/creation-wizard.js` | Restore tab |
| 9 — i18n | `locales/en/` + `locales/de/` | All new keys |

---

## Not in Scope

- Pull / sync from remote
- Branch switching or creation
- Merge conflict resolution
- Diff viewer inside the IDE
- Auto-commit on save
- `.gitignore` management
