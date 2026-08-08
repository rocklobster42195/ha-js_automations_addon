/**
 * Creates a GitHub Release for the current version and triggers the CI build.
 *
 * Prerequisites:
 *   - npm version patch/minor/major has been run (local commit + tag exist)
 *   - GITHUB_TOKEN env variable set (or stored in git credential manager)
 *
 * Usage:
 *   npm run release
 *   GITHUB_TOKEN=ghp_xxx npm run release
 *
 * What happens:
 *   1. Reads current version from package.json.
 *   2. Verifies the local git tag vX.X.X exists.
 *   3. Extracts the CHANGELOG.md entry for this version as release notes
 *      (beta versions always use the auto-collected commit log instead).
 *   4. Pushes commit + specific tag to origin (no other tags).
 *   5. Creates a GitHub Release via API (triggers the release.yml CI workflow).
 *      Beta versions (x.y.z-beta.n) are created as pre-releases.
 *   6. After a stable release: deletes all beta pre-releases, tags, and GHCR
 *      image versions — every stable release supersedes all existing betas.
 */

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const rootDir       = path.resolve(__dirname, '..');
const packagePath   = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

// --- Read version ---
const pkg     = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = pkg.version;
const tag     = `v${version}`;
const isBeta  = version.includes('-beta.');

console.log(`\n🚀 Releasing ${tag}${isBeta ? ' (beta channel → GitHub pre-release)' : ''}...\n`);

/**
 * Finds the most recent git tag before `tag`, optionally excluding beta tags.
 * Filtering is done in JS rather than via `git describe --exclude="<glob>"` —
 * the shell-quoted glob is fragile across shells and previously produced an
 * empty/wrong result, silently swallowed by the surrounding try/catch and
 * leaving release notes empty.
 * @param {boolean} excludeBeta
 * @returns {string|null}
 */
function findPreviousTag(excludeBeta) {
    const tags = execSync('git for-each-ref --sort=-creatordate --format=%(refname:short) refs/tags/v*', { stdio: 'pipe' })
        .toString().trim().split('\n').filter(Boolean);
    const match = tags.find(t => t !== tag && (!excludeBeta || !t.includes('-beta.')));
    return match || null;
}

// --- 1. Verify local tag exists ---
try {
    execSync(`git rev-parse ${tag}`, { stdio: 'pipe' });
    console.log(`  ✅ Git tag ${tag} found`);
} catch {
    console.error(`  ❌ Git tag ${tag} not found locally.`);
    console.error(`     Run "npm version patch" first to create the version commit and tag.`);
    process.exit(1);
}

// --- 2. Resolve GitHub repo (owner/repo) from remote URL ---
let owner = '', repo = '';
try {
    const remoteUrl = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim();
    // Supports https://github.com/owner/repo.git and git@github.com:owner/repo.git
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!m) throw new Error('Could not parse GitHub owner/repo from remote URL.');
    owner = m[1];
    repo  = m[2];
    console.log(`  ✅ Repo: ${owner}/${repo}`);
} catch (e) {
    console.error(`  ❌ ${e.message}`);
    process.exit(1);
}

// --- 3. Resolve GitHub token ---
const token = process.env.GITHUB_TOKEN || (() => {
    try {
        // Try to get token from gh CLI if available
        return execSync('gh auth token', { stdio: 'pipe' }).toString().trim();
    } catch {
        return null;
    }
})();

if (!token) {
    console.error(`  ❌ No GitHub token found.`);
    console.error(`     Set GITHUB_TOKEN env variable or install & authenticate the gh CLI.`);
    process.exit(1);
}

// --- 4. Extract CHANGELOG entry for this version ---
// Beta releases never have a CHANGELOG entry (the <!-- NEXT --> gate is reserved
// for the stable release) — they always use the auto-collected commit log.
let releaseNotes = '';
let releaseName  = tag;

if (!isBeta && fs.existsSync(changelogPath)) {
    // Normalize CRLF → LF: on Windows, git can check this file out with CRLF
    // line endings, which silently breaks the LF-only lookaheads below (the
    // capture then swallows a stray "\r\n---\r\n" as "content", producing a
    // release body of just "---").
    const content = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
    const m = content.match(
        new RegExp(`##\\s*\\[${version.replace(/\./g, '\\.')}\\][^\n]*\n([\\s\\S]*?)(?=\n---\n\n## |\\n## |$)`)
    );
    if (m && m[1].trim()) {
        releaseNotes = m[1].trim().replace(/\n---\s*$/, '').trim();
        console.log(`  ✅ CHANGELOG entry found`);
    } else {
        console.warn(`  ⚠️  No CHANGELOG entry for ${version} — release notes will be empty`);
    }
}

// Use ### Song Title from release notes as GitHub Release name if present
const titleMatch = releaseNotes.match(/^###\s+(.+)$/m);
if (titleMatch) {
    releaseName  = titleMatch[1].trim();
    releaseNotes = releaseNotes.replace(titleMatch[0], '').replace(/^\n+/, '').trim();
    console.log(`  ✅ Release name: "${releaseName}"`);
}

// No release notes written → auto-collect commits since previous tag.
// Stable releases skip beta tags so the notes cover everything since the last
// stable release; beta releases include them (notes since the previous beta).
if (!releaseNotes) {
    try {
        const prevTag = findPreviousTag(!isBeta);
        const log     = prevTag ? execSync(`git log ${prevTag}..${tag} --oneline --no-decorate`, { stdio: 'pipe' }).toString().trim() : '';
        if (log) {
            const lines  = log.split('\n')
                .map(l => l.replace(/^[a-f0-9]+ /, ''))
                .filter(l => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(l)) // skip version bump commits (incl. beta)
                .map(l => `- ${l}`);
            releaseNotes = lines.join('\n');
            console.log(`  ✅ Auto-collected ${lines.length} commit(s) from ${prevTag}..${tag}`);
        }
    } catch {
        console.warn(`  ⚠️  Could not collect commits — release notes will be empty`);
    }
}

// --- 5. Push commit + tag (only the specific tag, not all local tags) ---
console.log(`  📤 Pushing to origin...`);
try {
    execSync('git push', { stdio: 'pipe' });
    execSync(`git push origin ${tag}`, { stdio: 'pipe' });
    console.log(`  ✅ Pushed commit and tag ${tag}`);
} catch (e) {
    console.error(`  ❌ git push failed: ${e.message}`);
    process.exit(1);
}

// --- GitHub API helper ---
async function githubApi(method, apiPath, jsonBody) {
    const res = await fetch(`https://api.github.com${apiPath}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
            'User-Agent':    'ha-js-automations-release-script'
        },
        body: jsonBody ? JSON.stringify(jsonBody) : undefined
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { status: res.status, ok: res.ok, data };
}

// --- 6b. Beta cleanup (after a stable release) ---
// Any stable release supersedes all existing betas (single-track main branch),
// so their GitHub pre-releases, git tags, and GHCR image versions are deleted
// to keep the Releases and Packages pages tidy. Failures here only warn —
// the stable release itself has already succeeded at this point.
async function cleanupBetaArtifacts() {
    console.log(`  🧹 Cleaning up beta artifacts...`);

    // 1. Delete beta pre-releases
    try {
        const { ok, data } = await githubApi('GET', `/repos/${owner}/${repo}/releases?per_page=100`);
        if (ok && Array.isArray(data)) {
            for (const rel of data.filter(r => r.tag_name.includes('-beta.'))) {
                const del = await githubApi('DELETE', `/repos/${owner}/${repo}/releases/${rel.id}`);
                console.log(del.ok
                    ? `     ✅ Deleted pre-release ${rel.tag_name}`
                    : `     ⚠️  Could not delete pre-release ${rel.tag_name} (${del.status})`);
            }
        }
    } catch (e) {
        console.warn(`     ⚠️  Pre-release cleanup failed: ${e.message}`);
    }

    // 2. Delete beta git tags (remote via API, then local)
    try {
        const { ok, data } = await githubApi('GET', `/repos/${owner}/${repo}/git/matching-refs/tags/v`);
        if (ok && Array.isArray(data)) {
            for (const ref of data.filter(r => r.ref.includes('-beta.'))) {
                const tagName = ref.ref.replace('refs/tags/', '');
                const del = await githubApi('DELETE', `/repos/${owner}/${repo}/git/${ref.ref}`);
                console.log(del.ok
                    ? `     ✅ Deleted remote tag ${tagName}`
                    : `     ⚠️  Could not delete remote tag ${tagName} (${del.status})`);
            }
        }
        const localBetaTags = execSync('git tag -l "*-beta.*"', { stdio: 'pipe' }).toString().trim();
        for (const t of localBetaTags ? localBetaTags.split('\n') : []) {
            execSync(`git tag -d ${t.trim()}`, { stdio: 'pipe' });
            console.log(`     ✅ Deleted local tag ${t.trim()}`);
        }
    } catch (e) {
        console.warn(`     ⚠️  Tag cleanup failed: ${e.message}`);
    }

    // 3. Delete beta image versions from GHCR (one package per architecture).
    // Requires the token to have the read:packages + delete:packages scopes;
    // without them this step warns and the images simply remain.
    const archs = ['amd64', 'aarch64'];
    for (const arch of archs) {
        const pkgName = encodeURIComponent(`${repo}/${arch}`);
        try {
            const { ok, status, data } = await githubApi('GET', `/users/${owner}/packages/container/${pkgName}/versions?per_page=100`);
            if (!ok) {
                console.warn(`     ⚠️  Could not list GHCR versions for ${arch} (${status}) — token may lack read:packages scope.`);
                continue;
            }
            const betaVersions = data.filter(v => (v.metadata?.container?.tags || []).some(t => t.includes('-beta.')));
            for (const v of betaVersions) {
                const tags = v.metadata.container.tags.join(', ');
                const del = await githubApi('DELETE', `/users/${owner}/packages/container/${pkgName}/versions/${v.id}`);
                console.log(del.ok
                    ? `     ✅ Deleted GHCR image ${arch}:${tags}`
                    : `     ⚠️  Could not delete GHCR image ${arch}:${tags} (${del.status}) — token may lack delete:packages scope.`);
            }
        } catch (e) {
            console.warn(`     ⚠️  GHCR cleanup for ${arch} failed: ${e.message}`);
        }
    }
}

// --- 6. Create GitHub Release via API ---
(async () => {
    console.log(`  🏷️  Creating GitHub ${isBeta ? 'Pre-Release' : 'Release'} ${tag}...`);

    const { status, ok, data } = await githubApi('POST', `/repos/${owner}/${repo}/releases`, {
        tag_name: tag,
        name:     releaseName,
        body:     releaseNotes,
        draft:    false,
        prerelease: isBeta
    });

    if (!ok) {
        console.error(`  ❌ GitHub API error ${status}: ${JSON.stringify(data)}`);
        process.exit(1);
    }

    console.log(`  ✅ GitHub ${isBeta ? 'Pre-Release' : 'Release'} created: ${data.html_url}`);

    if (!isBeta) {
        await cleanupBetaArtifacts();
    }

    console.log(`\n✔  ${tag} released. CI build has been triggered.\n`);
})().catch((e) => {
    console.error(`  ❌ Request failed: ${e.message}`);
    process.exit(1);
});
