# Script Versioning (Git)

Your scripts live in a local Git repository inside the add-on's scripts folder. No account, no setup — it works out of the box. A remote repository is optional and only used for pushing a copy elsewhere.

## Committing

Use the **Commit** button in the editor toolbar to save the current state of a script as a commit. Commits are always explicit — nothing is committed behind your back. The button is disabled while the active tab has nothing to commit.

The author name and email used for commits can be changed under **Settings → Versioning**.

## History and diffs

The **History** panel next to the Commit button lists every commit for the current script.

- **Load** puts an older version into the editor for review. It does not commit anything — you decide whether to keep it.
- **Diff** opens a side-by-side comparison against the current version in its own full-width editor tab.

## Getting things back

- **Restore a file** to any earlier commit from the History panel.
- **Revert a commit** to undo exactly what it changed. This creates a new commit, so nothing in the history is lost.
- **Restore a deleted script** — deleted scripts stay in the history and can be brought back. Whether a deletion is committed automatically is controlled by the commit-on-delete checkbox.

For disaster recovery of the whole add-on (not just one file) see [Backup & Restore](./backup-restore.md).

## Pushing to a remote (optional)

Under **Settings → Versioning** you can add a remote repository. It works with GitHub, GitLab, Gitea, Bitbucket, or any HTTPS Git host.

1. Create an empty repository on your host and a personal access token with write access.
2. Enter the **Repository URL** and the **Access Token**, then use **Test Connection**.
3. Use **Push** to send everything that is not pushed yet.

Push is deliberately separate from Commit, so a flaky connection never blocks you from committing. The status bar shows how many commits are still unpushed.

> **Token format differs by host.** GitHub takes the bare token. GitLab and Bitbucket usually expect `oauth2:TOKEN` or `username:TOKEN`.

The token is injected into the push URL per request and never written to the repository's `.git/config`. In Settings it is masked — use the eye icon to reveal it.
