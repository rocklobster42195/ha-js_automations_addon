/**
 * Creates a GitHub Release for the current version and triggers the CI build.
 *
 * Prerequisites:
 *   - npm version patch/minor/major has been run (local commit + tag exist)
 *   - gh CLI is installed and authenticated (gh auth login)
 *
 * Usage:
 *   npm run release
 *
 * What happens:
 *   1. Reads current version from package.json.
 *   2. Verifies the local git tag vX.X.X exists.
 *   3. Extracts the CHANGELOG.md entry for this version as release notes.
 *   4. Pushes commit + tag to origin.
 *   5. Creates a GitHub Release (triggers the release.yml CI workflow).
 */

const fs = require('fs');
const path = require('path');
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

// --- 2. Extract CHANGELOG entry for this version ---
let releaseNotes = '';
if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf8');
    // Match the section for this specific version: ## [X.X.X] - date  ...until the next ## heading
    const match = content.match(
        new RegExp(`##\\s*\\[${version.replace(/\./g, '\\.')}\\][^\n]*\n([\\s\\S]*?)(?=\n## |$)`)
    );
    if (match) {
        releaseNotes = match[1].trim();
    }
}

if (!releaseNotes) {
    console.warn(`  ⚠️  No CHANGELOG entry found for ${version} — release will have no notes.`);
}

// --- 3. Push commit + tag ---
console.log(`  📤 Pushing to origin...`);
try {
    execSync('git push', { stdio: 'inherit' });
    execSync('git push --tags', { stdio: 'inherit' });
    console.log(`  ✅ Pushed commit and tag ${tag}`);
} catch (e) {
    console.error(`  ❌ git push failed: ${e.message}`);
    process.exit(1);
}

// --- 4. Create GitHub Release ---
console.log(`  🏷️  Creating GitHub Release ${tag}...`);
try {
    // Write notes to a temp file to avoid shell escaping issues
    const notesFile = path.join(rootDir, '.release-notes.tmp');
    fs.writeFileSync(notesFile, releaseNotes || `Release ${version}`);

    execSync(
        `gh release create ${tag} --title "${tag}" --notes-file "${notesFile}"`,
        { stdio: 'inherit', cwd: rootDir }
    );

    fs.unlinkSync(notesFile);
    console.log(`  ✅ GitHub Release ${tag} created`);
} catch (e) {
    console.error(`  ❌ gh release create failed: ${e.message}`);
    console.error(`     Make sure the gh CLI is installed and authenticated (gh auth login).`);
    process.exit(1);
}

console.log(`\n✔  ${tag} released. CI build has been triggered.\n`);
