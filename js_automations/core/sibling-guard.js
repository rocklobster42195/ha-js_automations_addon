// core/sibling-guard.js
//
// The stable and beta addons share the same /config/js-automations directory
// (scripts, libraries, data, JSA store) and the same host port 3001. Running
// both at the same time would mean duplicate script execution and races on
// store.json. This guard asks the Supervisor whether the sibling addon is
// currently running and, if so, holds this addon in a blocked state until
// the sibling stops — instead of crash-looping on the port bind.

const SUPERVISOR_URL = 'http://supervisor';
const STABLE_SUFFIX = 'js_automations';
const BETA_SUFFIX = 'js_automations_beta';
const POLL_INTERVAL_MS = 15000;

class SiblingGuard {
    constructor() {
        this.token = process.env.SUPERVISOR_TOKEN;
        this.ownSlug = null;
        this.siblingSlug = null;
        this.siblingName = null;
        this.isBeta = false;
    }

    async _supervisorGet(path) {
        const res = await fetch(`${SUPERVISOR_URL}${path}`, {
            headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!res.ok) {
            const err = new Error(`Supervisor API ${path} returned ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const json = await res.json();
        return json.data;
    }

    /**
     * Resolves the own and sibling addon slugs via the Supervisor API.
     * Repository-installed addons carry a repository-hash prefix
     * (e.g. "a1b2c3d4_js_automations"), so the sibling slug is derived by
     * swapping the suffix while keeping the prefix.
     * @returns {boolean} true if a sibling slug could be resolved.
     */
    async _resolveSlugs() {
        const self = await this._supervisorGet('/addons/self/info');
        this.ownSlug = self.slug;

        if (this.ownSlug.endsWith(BETA_SUFFIX)) {
            this.isBeta = true;
            this.siblingSlug = this.ownSlug.slice(0, -BETA_SUFFIX.length) + STABLE_SUFFIX;
        } else if (this.ownSlug.endsWith(STABLE_SUFFIX)) {
            this.siblingSlug = this.ownSlug.slice(0, -STABLE_SUFFIX.length) + BETA_SUFFIX;
        } else {
            // Unexpected slug (e.g. local dev install with a custom name) — no guard possible.
            return false;
        }
        return true;
    }

    /**
     * @returns {boolean} true if the sibling addon is installed and running.
     */
    async isSiblingRunning() {
        try {
            const info = await this._supervisorGet(`/addons/${this.siblingSlug}/info`);
            this.siblingName = info.name || this.siblingSlug;
            return info.state === 'started';
        } catch (e) {
            // 400/404 → sibling not installed. Any other error: fail open —
            // the EADDRINUSE handler on the webhook port is the last safety net,
            // and blocking the addon on a Supervisor hiccup would be worse.
            return false;
        }
    }

    /**
     * Checks whether the sibling addon is running. Never throws.
     * @returns {Promise<{blocked: boolean, siblingName: string|null, isBeta: boolean}>}
     */
    async check() {
        if (!this.token) {
            // Local development — no Supervisor, nothing to guard.
            return { blocked: false, siblingName: null, isBeta: false };
        }
        try {
            if (!this.ownSlug && !(await this._resolveSlugs())) {
                return { blocked: false, siblingName: null, isBeta: this.isBeta };
            }
            const running = await this.isSiblingRunning();
            return { blocked: running, siblingName: this.siblingName, isBeta: this.isBeta };
        } catch (e) {
            console.warn(`[SiblingGuard] Check failed (${e.message}) — proceeding without guard.`);
            return { blocked: false, siblingName: null, isBeta: this.isBeta };
        }
    }

    /**
     * Resolves once the sibling addon is no longer running.
     * Polls the Supervisor API; logs while waiting.
     */
    async waitUntilFree() {
        for (;;) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const { blocked } = await this.check();
            if (!blocked) return;
            console.log(`[SiblingGuard] Still waiting: "${this.siblingName}" is running. Stop it to activate this addon.`);
        }
    }
}

module.exports = new SiblingGuard();
