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
 *   3. Extracts the CHANGELOG.md entry for this version as release notes.
 *   4. Pushes commit + specific tag to origin (no other tags).
 *   5. Creates a GitHub Release via API (triggers the release.yml CI workflow).
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { execSync } = require('child_process');

const rootDir       = path.resolve(__dirname, '..');
const packagePath   = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

// --- Read version ---
const pkg     = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = pkg.version;
const tag     = `v${version}`;

console.log(`\n🚀 Releasing ${tag}...\n`);

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
let releaseNotes = `Release ${version}`;
if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf8');
    const m = content.match(
        new RegExp(`##\\s*\\[${version.replace(/\./g, '\\.')}\\][^\n]*\n([\\s\\S]*?)(?=\n## |$)`)
    );
    if (m && m[1].trim()) {
        releaseNotes = m[1].trim();
        console.log(`  ✅ CHANGELOG entry found`);
    } else {
        console.warn(`  ⚠️  No CHANGELOG entry for ${version} — using default notes`);
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

// --- 6. Create GitHub Release via API ---
console.log(`  🏷️  Creating GitHub Release ${tag}...`);

const body = JSON.stringify({
    tag_name: tag,
    name:     tag,
    body:     releaseNotes,
    draft:    false,
    prerelease: false
});

const options = {
    hostname: 'api.github.com',
    path:     `/repos/${owner}/${repo}/releases`,
    method:   'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':    'ha-js-automations-release-script'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        if (res.statusCode === 201) {
            const release = JSON.parse(data);
            console.log(`  ✅ GitHub Release created: ${release.html_url}`);
            console.log(`\n✔  ${tag} released. CI build has been triggered.\n`);
        } else {
            console.error(`  ❌ GitHub API error ${res.statusCode}: ${data}`);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(`  ❌ Request failed: ${e.message}`);
    process.exit(1);
});

req.write(body);
req.end();
