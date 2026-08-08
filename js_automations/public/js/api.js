/**
 * JS AUTOMATIONS - API & Data Layer
 * Handles backend communication and global data loading.
 */

// Robust calculation of the Ingress path: take everything up to the last slash.
var BASE_PATH = window.location.pathname;
if (BASE_PATH.endsWith('.html')) {
    BASE_PATH = BASE_PATH.substring(0, BASE_PATH.lastIndexOf('/') + 1);
} else if (!BASE_PATH.endsWith('/')) {
    BASE_PATH += '/';
}
console.log("I18N: Base Path detected as:", BASE_PATH);

var haData = { areas: [], labels: [], services: {}, language: null };
var mdiIcons = [];

async function apiFetch(endpoint, options = {}) {
    const url = BASE_PATH + endpoint.replace(/^\//, '');
    return fetch(url, options);
}

// Guards against overlapping retry chains: integration_status can broadcast
// repeatedly (e.g. MQTT reconnecting every 5s) while areas/labels are still
// empty. Without this, each broadcast would spawn its own independent
// 20-attempt/3s retry chain, stacking dozens of concurrent chains within a
// minute of flapping.
let _metadataLoadInFlight = false;

async function loadHAMetadata(retryCount = 0) {
    if (retryCount === 0) {
        if (_metadataLoadInFlight) return;
        _metadataLoadInFlight = true;
    }
    try {
        const res = await apiFetch('api/ha/metadata');
        if (res.ok) {
            const data = await res.json();
            // TIMING FIX: If HA returns an empty list (during boot), retry in 3s.
            // Checked independently — on a slow/congested boot, areas can already be
            // populated while labels are still catching up (or vice versa), and requiring
            // *both* to be empty let a not-yet-ready list silently through as "no labels".
            // Capped at 20 attempts: some installs genuinely have zero areas or zero
            // labels configured, which must not retry forever.
            if ((data.areas.length === 0 || data.labels.length === 0) && retryCount < 20) {
                console.log(`⏳ HA Registry not ready (Attempt ${retryCount + 1}/20). Retrying in 3s...`);
                setTimeout(() => loadHAMetadata(retryCount + 1), 3000);
                return;
            }
            haData.areas = data.areas || [];
            haData.labels = data.labels || [];
            haData.language = data.language || null;
            console.log(`✅ HA Metadata loaded. Language: ${haData.language}`);
            // allScripts and renderScripts are in script-list.js
            if (typeof allScripts !== 'undefined' && allScripts.length > 0 && typeof renderScripts === 'function') {
                renderScripts(allScripts, false);
            }
            _metadataLoadInFlight = false;
        } else {
            throw new Error(`Status ${res.status}`);
        }
    } catch (e) {
        console.warn("HA Metadata failed", e);
        if (retryCount < 20) { // Retry for ~1 minute
            console.log(`⏳ Metadata load failed. Retrying in 3s... (${retryCount + 1}/20)`);
            setTimeout(() => loadHAMetadata(retryCount + 1), 3000);
        } else {
            _metadataLoadInFlight = false;
        }
    }
}

async function loadHAServices() {
    try {
        const res = await apiFetch('api/ha/services');
        if (res.ok) {
            haData.services = await res.json();
            console.log(`✅ Loaded Services for ${Object.keys(haData.services).length} Domains.`);
        }
    } catch (e) { console.warn("HA Services load failed", e); }
}

async function loadMDIIcons() {
    try {
        // Sucht den Link zur CSS-Datei im DOM
        const link = document.querySelector('link[href*="materialdesignicons.min.css"]');
        if (!link) return;

        const res = await fetch(link.href);
        if (res.ok) {
            const css = await res.text();
            // Extrahiert alle Klassennamen wie .mdi-account::before
            const regex = /\.mdi-([a-z0-9-]+)::before/g;
            let match;
            const iconSet = new Set();
            while ((match = regex.exec(css)) !== null) {
                iconSet.add(match[1]);
            }
            mdiIcons = Array.from(iconSet).sort();
            console.log(`✅ Loaded ${mdiIcons.length} MDI Icons.`);
            
            // Datalist im Modal befüllen
            const dl = document.getElementById('mdi-suggestions');
            if (dl) dl.innerHTML = mdiIcons.map(i => `<option value="mdi:${i}">`).join('');
        }
    } catch (e) { console.warn("MDI Load failed", e); }
}

window.apiFetch = apiFetch;
window.loadHAMetadata = loadHAMetadata;
window.loadHAServices = loadHAServices;
window.loadMDIIcons = loadMDIIcons;