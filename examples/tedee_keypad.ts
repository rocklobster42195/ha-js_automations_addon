/**
 * @name Tedee Keypad
 * @icon mdi:lock-smart
 * @description Mini-integration for Tedee Keypad via Tedee Cloud API.
 * @label Integration
 * @permission network
 */
ha.log('Script started...');

// ─── Types ───────────────────────────────────────────────────────────────────
interface TedeeConfig {
    personal_key: string;
    scan_interval: number;
    battery_threshold: number;
    notify_target: string;
}

interface TedeeKeypad {
    id: number;
    name: string;
    serialNumber: string;
    revision: number;
    softwareVersions: { version: string }[];
    deviceState: {
        batteryLevel: number;
        batteryLevelModifiedTime: string;
    };
    deviceSettings: {
        lockByButtonEnabled: boolean;
        bellButtonEnabled: boolean | null;
        soundLevel: number;
        backlightLevel: number;
        batteryType: number;
    };
}

// ─── Config Bootstrap ────────────────────────────────────────────────────────

const CONFIG_KEY = 'tedee_config';

// Global configuration persisted via JSA persistent proxy.
// This combines API credentials and integration settings into a single JSON object.
const config = ha.persistent<TedeeConfig>(CONFIG_KEY, {
    personal_key: '',
    scan_interval: 30,
    battery_threshold: 40,
    notify_target: 'notify.notify',
});

if (!config.personal_key) {
    ha.error(ha.localize({
        en: 'Please enter your Personal Key in the Global Store under "tedee_config" and restart the script.',
        de: 'Bitte Personal Key im Globalen Speicher unter "tedee_config" eintragen und Skript neu starten.',
    }));
    ha.stop();
}

// Sanitize values to prevent boot loops from corrupted states (e.g., NaN)
if (isNaN(config.scan_interval) || config.scan_interval < 1) config.scan_interval = 30;
if (isNaN(config.battery_threshold)) config.battery_threshold = 40;
if (config.notify_target === undefined) config.notify_target = 'notify.notify';

const API_BASE = 'https://api.tedee.com/api/v37';
const HEADERS = {
    Authorization: `PersonalKey ${config.personal_key}`,
    'Content-Type': 'application/json',
};
const SCAN_INTERVAL = `*/${config.scan_interval} * * * *`;

// ─── Runtime State ────────────────────────────────────────────────────────────

const warnedBattery = new Set<number>();
const keypadCache = new Map<number, TedeeKeypad>();
const slugCache = new Map<number, string>(); // Cached slug per keypad id
const lastChange = new Map<number, number>(); // Tracks last manual change to prevent API lag jumps
const patchDebounceTimers = new Map<number, any>();
const NOTIFY_NONE = ha.localize({ en: 'None', de: 'Keines' });
let pollTimeout: any = null;
let isStopped = false;

// Reconnect backoff state
let consecutiveErrors = 0;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 10_000; // 10s → 20s → 40s → 80s → 160s
let backoffUntil = 0;

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchKeypads(): Promise<TedeeKeypad[]> {
    const res = await fetch(`${API_BASE}/my/keypad`, { headers: HEADERS });
    if (res.status === 401) {
        ha.error(ha.localize({
            en: 'Invalid Personal Key (401). Please update "tedee_config" in JSA Store and restart the script.',
            de: 'Ungültiger Personal Key (401). Bitte „tedee_config" im JSA Store aktualisieren und Skript neu starten.',
        }),);
        ha.stop();
    }
    if (!res.ok) throw new Error(`Tedee API error: ${res.status}`);
    const body = await res.json();
    return body.result as TedeeKeypad[];
}

async function patchKeypad(keypadId: number, settings: Record<string, unknown>, retryCount = 0): Promise<void> {
    if (isStopped) return;

    const keypad = keypadCache.get(keypadId);
    if (!keypad) throw new Error(`No cache entry for keypad ${keypadId}`);

    // Verify if the settings we are about to patch are still the desired state.
    // If a newer event has already updated the cache, this patch call is stale.
    for (const key in settings) {
        if ((keypad.deviceSettings as any)[key] !== settings[key]) {
            ha.debug(`Patch for ${key} on keypad ${keypadId} is stale, skipping.`);
            return;
        }
    }

    triggerDelayedPoll(); // Schedule a verification poll

    let res: Response;
    try {
        res = await fetch(`${API_BASE}/my/keypad/${keypadId}`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({ revision: keypad.revision, deviceSettings: settings }),
        });
    } catch (err) {
        ha.error(`Network error patching keypad ${keypadId}: ${err}`);
        return;
    }

    if (res.status === 429) {
        ha.warn(`Rate limit exceeded (429) for keypad ${keypadId}. Please wait.`);
        return;
    }

    if (res.status === 409 && retryCount < 3) {
        // Conflict: revision stale -> refresh and retry once
        ha.debug(`Revision conflict for keypad ${keypadId} (attempt ${retryCount + 1}) – refreshing.`);
        const keypads = await fetchKeypads();
        const fresh = keypads.find(k => k.id === keypadId);
        const cached = keypadCache.get(keypadId);
        if (fresh && cached) {
            // Synchronize the revision to resolve the conflict while keeping optimistic settings
            cached.revision = fresh.revision;
            return patchKeypad(keypadId, settings, retryCount + 1);
        }
        return;
    }

    if (!res.ok) ha.error(`PATCH error ${res.status} for keypad ${keypadId}`);
}

/**
 * Debounces API patches to prevent flooding the cloud and MQTT discovery.
 */
function debouncedPatch(keypad: TedeeKeypad, settings: Record<string, any>, slug: string): void {
    if (isStopped) return;

    // Set cooldown immediately to block polling interference during user interaction
    lastChange.set(keypad.id, Date.now());

    if (patchDebounceTimers.has(keypad.id)) {
        clearTimeout(patchDebounceTimers.get(keypad.id));
    }

    const timer = setTimeout(async () => {
        if (isStopped) return;

        // Verify if the settings are still relevant compared to cache
        let stale = true;
        for (const key in settings) {
            if ((keypad.deviceSettings as any)[key] === settings[key]) {
                stale = false;
                break;
            }
        }
        if (stale) return;

        // Publish the final state (including icon discovery) and call the API
        publishStates(keypad);
        await patchKeypad(keypad.id, settings);

        patchDebounceTimers.delete(keypad.id);
    }, 500);

    patchDebounceTimers.set(keypad.id, timer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Returns the appropriate MDI icon for the given sound level.
 * @param level The sound level (0-2).
 * @returns MDI icon string.
 */
function getSoundLevelIcon(level: number): string {
    if (level === 0) return 'mdi:volume-off';
    if (level === 1) return 'mdi:volume-low';
    return 'mdi:volume-high'; // Default for level 2 and above
}

// ─── Entity Registration ──────────────────────────────────────────────────────

function registerEntities(keypad: TedeeKeypad): void {
    const s = slug(keypad.name);
    slugCache.set(keypad.id, s);

    const device = {
        identifiers: [`tedee_keypad_${keypad.serialNumber}`],
        name: `Tedee ${keypad.name}`,
        manufacturer: 'Tedee',
        model: 'Keypad',
        icon: 'mdi:lock-smart',
        sw_version: keypad.softwareVersions?.[0]?.version ?? 'unknown',
    };

    ha.register(`sensor.tedee_${s}_battery`, {
        name: ha.localize({ en: 'Battery', de: 'Batterie' }),
        device_class: 'battery',
        unit_of_measurement: '%',
        state_class: 'measurement',
        initial_state: keypad.deviceState.batteryLevel,
        device,
    });

    ha.register(`sensor.tedee_${s}_battery_updated`, {
        name: ha.localize({ en: 'Battery last updated', de: 'Batterie zuletzt aktualisiert' }),
        device_class: 'timestamp',
        entity_category: 'diagnostic',
        initial_state: keypad.deviceState.batteryLevelModifiedTime ?? new Date().toISOString(),
        device,
    });

    ha.register(`sensor.tedee_${s}_last_sync`, {
        name: ha.localize({ en: 'Last sync', de: 'Letzte Synchronisation' }),
        device_class: 'timestamp',
        entity_category: 'diagnostic',
        initial_state: new Date().toISOString(),
        device,
    });

    ha.register(`switch.tedee_${s}_lock_by_button`, {
        name: ha.localize({ en: 'Lock by button', de: 'Sperren per Taste' }),
        icon: 'mdi:lock',
        initial_state: keypad.deviceSettings.lockByButtonEnabled ? 'ON' : 'OFF',
        device,
    });

    if (keypad.deviceSettings.bellButtonEnabled !== null) {
        ha.register(`switch.tedee_${s}_bell_button`, {
            name: ha.localize({ en: 'Bell button', de: 'Klingeltaste' }),
            icon: 'mdi:bell',
            initial_state: keypad.deviceSettings.bellButtonEnabled ? 'ON' : 'OFF',
            device,
        });
    }

    ha.register(`number.tedee_${s}_sound_level`, {
        name: ha.localize({ en: 'Sound level', de: 'Lautstärke' }),
        icon: getSoundLevelIcon(keypad.deviceSettings.soundLevel), // Dynamic icon based on initial state
        min: 0,
        max: 2,
        step: 1,
        mode: 'slider',
        initial_state: keypad.deviceSettings.soundLevel,
        device,
    });

    ha.register(`number.tedee_${s}_backlight`, {
        name: ha.localize({ en: 'Backlight', de: 'Helligkeit' }),
        icon: 'mdi:brightness-6',
        min: 0,
        max: 3,
        step: 1,
        mode: 'slider',
        enabled_by_default: false, // Entity is registered but hidden until manually enabled in HA
        initial_state: keypad.deviceSettings.backlightLevel,
        device,
    });

    ha.register(`select.tedee_${s}_battery_type`, {
        name: ha.localize({ en: 'Battery type', de: 'Batterietyp' }),
        icon: 'mdi:battery-charging',
        options: ['Alkaline', 'NiMH'],
        entity_category: 'config',
        initial_state: keypad.deviceSettings.batteryType === 1 ? 'NiMH' : 'Alkaline',
        device,
    });

    ha.register(`button.tedee_${s}_sync`, {
        name: ha.localize({ en: 'Sync now', de: 'Jetzt synchronisieren' }),
        icon: 'mdi:cloud-sync',
        device,
    });

    // --- Integration Settings (attached to the Keypad device) ---

    ha.register(`number.tedee_${s}_scan_interval`, {
        name: ha.localize({ en: 'Scan interval (Global)', de: 'Scan-Intervall (Global)' }),
        icon: 'mdi:timer-cog',
        unit: 'min',
        min: 1,
        max: 1440,
        entity_category: 'config',
        initial_state: config.scan_interval,
        device,
    });

    ha.register(`number.tedee_${s}_battery_threshold`, {
        name: ha.localize({ en: 'Battery warn threshold (Global)', de: 'Batterie-Warnschwelle (Global)' }),
        icon: 'mdi:battery-alert',
        unit: '%',
        min: 1,
        max: 100,
        entity_category: 'config',
        initial_state: config.battery_threshold,
        device,
    });

    // Discover mobile_app notification targets via device_tracker entities.
    // mobile_app always creates a device_tracker with source_type='gps', and its
    // object_id directly matches the notify service slug (notify.mobile_app_<object_id>).
    const discoveredServices = ha.select(/^device_tracker\..*$/)
        .toArray()
        .filter(e => e.attributes?.source_type === 'gps')
        .map(e => `notify.mobile_app_${e.entity_id.split('.')[1]}`);

    // Combine discovered services with defaults and ensure unique entries via Set
    const notifyServices = [...new Set([...discoveredServices, 'notify.notify', NOTIFY_NONE])].sort();

    ha.register(`select.tedee_${s}_notify_target`, {
        name: ha.localize({ en: 'Notification target', de: 'Benachrichtigungsziel' }),
        icon: 'mdi:comment-alert',
        entity_category: 'config',
        initial_state: config.notify_target,
        options: notifyServices,
        device,
    });
}

// ─── State Publishing ─────────────────────────────────────────────────────────

function publishStates(keypad: TedeeKeypad): void {
    const s = slugCache.get(keypad.id) ?? slug(keypad.name);
    const ds = keypad.deviceState;
    const cfg = keypad.deviceSettings;

    ha.update(`sensor.tedee_${s}_battery`, ds.batteryLevel);
    ha.update(`sensor.tedee_${s}_battery_updated`, ds.batteryLevelModifiedTime ?? new Date().toISOString());
    ha.update(`sensor.tedee_${s}_last_sync`, new Date().toISOString());

    ha.update(`switch.tedee_${s}_lock_by_button`, cfg.lockByButtonEnabled ? 'ON' : 'OFF');
    if (cfg.bellButtonEnabled !== null) {
        ha.update(`switch.tedee_${s}_bell_button`, cfg.bellButtonEnabled ? 'ON' : 'OFF');
    }

    ha.update(`number.tedee_${s}_sound_level`, cfg.soundLevel, { icon: getSoundLevelIcon(cfg.soundLevel) });
    ha.update(`number.tedee_${s}_backlight`, cfg.backlightLevel);
    ha.update(`select.tedee_${s}_battery_type`, cfg.batteryType === 1 ? 'NiMH' : 'Alkaline');
    // Config entities (scan_interval, battery_threshold, notify_target) are NOT published here.
    // Their values are set once via initial_state on ha.register() and updated by ha.on() handlers.
    // Re-publishing them every poll would cause unnecessary echoes back through ha.on().
}

// ─── Battery Warning ──────────────────────────────────────────────────────────

async function checkBattery(keypad: TedeeKeypad): Promise<void> {
    if (warnedBattery.has(keypad.id)) return;

    if (keypad.deviceState.batteryLevel > config.battery_threshold) return;

    // Skip notification if target is set to None or empty
    if (!config.notify_target || config.notify_target === 'None' || config.notify_target === NOTIFY_NONE) return;

    warnedBattery.add(keypad.id);

    const answer = await ha.ask(
        ha.localize({
            en: `Tedee "${keypad.name}": Battery at ${keypad.deviceState.batteryLevel}%. Replace soon.`,
            de: `Tedee „${keypad.name}": Batterie bei ${keypad.deviceState.batteryLevel} %. Bitte bald wechseln.`,
        }),
        {
            title: ha.localize({ en: '🔋 Low Battery', de: '🔋 Schwache Batterie' }),
            target: config.notify_target,
            timeout: 3600000, // 1h — auto-dismiss + snooze
            defaultAction: 'SNOOZE',
            actions: [
                { action: 'SNOOZE', title: ha.localize({ en: 'Remind me', de: 'Erinnern' }) },
                { action: 'IGNORE', title: ha.localize({ en: 'Ignore', de: 'Ignorieren' }) },
            ],
        }
    );

    if (answer === 'SNOOZE' || answer === null) {
        warnedBattery.delete(keypad.id); // Re-enable warning for next poll
    }
    // IGNORE: warnedBattery keeps the id → no further warning this session
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

function registerCommands(keypad: TedeeKeypad): void {
    const s = slugCache.get(keypad.id) ?? slug(keypad.name);

    ha.on(`switch.tedee_${s}_lock_by_button`, async ({ state }) => {
        if (state !== 'ON' && state !== 'OFF') return;

        // Only update if state actually changed to avoid API loops
        if (keypad.deviceSettings.lockByButtonEnabled === (state === 'ON')) return;

        keypad.deviceSettings.lockByButtonEnabled = (state === 'ON');
        ha.update(`switch.tedee_${s}_lock_by_button`, state);
        debouncedPatch(keypad, { lockByButtonEnabled: state === 'ON' }, s);
    });

    if (keypad.deviceSettings.bellButtonEnabled !== null) {
        ha.on(`switch.tedee_${s}_bell_button`, async ({ state }) => {
            if (state !== 'ON' && state !== 'OFF') return;
            if (keypad.deviceSettings.bellButtonEnabled === (state === 'ON')) return;

            keypad.deviceSettings.bellButtonEnabled = (state === 'ON');
            ha.update(`switch.tedee_${s}_bell_button`, state);
            debouncedPatch(keypad, { bellButtonEnabled: state === 'ON' }, s);
        });
    }

    ha.on(`number.tedee_${s}_sound_level`, async ({ state }) => {
        const value = parseInt(state, 10);
        if (isNaN(value) || value < 0 || value > 2) return;
        if (keypad.deviceSettings.soundLevel === value) return;

        keypad.deviceSettings.soundLevel = value;
        ha.update(`number.tedee_${s}_sound_level`, value); // Snap UI state (value only)
        debouncedPatch(keypad, { soundLevel: value }, s);
    });

    ha.on(`number.tedee_${s}_backlight`, async ({ state }) => {
        const value = parseInt(state, 10);
        if (isNaN(value) || value < 0 || value > 3) return;
        if (keypad.deviceSettings.backlightLevel === value) return;

        keypad.deviceSettings.backlightLevel = value;
        ha.update(`number.tedee_${s}_backlight`, value);
        debouncedPatch(keypad, { backlightLevel: value }, s);
    });

    ha.on(`select.tedee_${s}_battery_type`, async ({ state }) => {
        if ((keypad.deviceSettings.batteryType === 1 ? 'NiMH' : 'Alkaline') === state) return;

        keypad.deviceSettings.batteryType = (state === 'NiMH' ? 1 : 0);
        ha.update(`select.tedee_${s}_battery_type`, state);
        debouncedPatch(keypad, { batteryType: state === 'NiMH' ? 1 : 0 }, s);
    });

    ha.on(`button.tedee_${s}_sync`, async () => {
        ha.log('Manual synchronization triggered.');
        await poll();
    });

    // --- Settings Handlers ---

    ha.on(`number.tedee_${s}_scan_interval`, ({ state }) => {
        const val = parseInt(state, 10);
        if (isNaN(val) || val === config.scan_interval) return;

        lastChange.set(keypad.id, Date.now()); // Block polling interference
        config.scan_interval = val;
        ha.update(`number.tedee_${s}_scan_interval`, val);
        ha.restart(`Scan interval updated to ${val} min via ${keypad.name}. Restarting script.`);
    });

    ha.on(`number.tedee_${s}_battery_threshold`, ({ state }) => {
        const val = parseInt(state, 10);
        if (isNaN(val) || val === config.battery_threshold) return;

        config.battery_threshold = val;
        ha.debug(`Battery threshold updated to ${val}% via ${keypad.name}.`);
        ha.update(`number.tedee_${s}_battery_threshold`, val);
    });

    ha.on(`select.tedee_${s}_notify_target`, ({ state }) => {
        if (state === config.notify_target) return;

        config.notify_target = state;
        ha.debug(`Notification target updated to ${state} via ${keypad.name}.`);
        ha.update(`select.tedee_${s}_notify_target`, state);
    });
}

/**
 * Triggers a single poll after the cooldown period to verify 
 * that the cloud has accepted and processed the changes.
 */
function triggerDelayedPoll(): void {
    if (isStopped) return;
    if (pollTimeout) clearTimeout(pollTimeout);

    // 16 seconds: Ensure we are just outside the 15s cooldown
    pollTimeout = setTimeout(async () => {
        await poll();
    }, 16000);
}

// ─── Poll ──────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
    if (isStopped) return;

    // During backoff: skip scheduled (cron) calls, but let eager retries through
    if (Date.now() < backoffUntil) return;

    try {
        const keypads = await fetchKeypads();

        // Success — reset error counter
        consecutiveErrors = 0;
        backoffUntil = 0;

        for (const keypad of keypads) {
            let cached = keypadCache.get(keypad.id);
            const inCooldown = Date.now() - (lastChange.get(keypad.id) || 0) < 15000;

            if (!cached) {
                keypadCache.set(keypad.id, keypad);
                cached = keypad;
                registerEntities(cached);
                registerCommands(cached);
            } else if (!inCooldown) {
                // Update existing object properties to keep references in listeners valid
                Object.assign(cached, keypad);
            }

            if (!inCooldown) {
                publishStates(cached);
            }

            await checkBattery(cached);
        }
        ha.debug(`${keypads.length} keypad(s) synchronized.`);

    } catch (err: any) {
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_RETRIES) {
            ha.error(ha.localize({
                en: `Tedee API unreachable after ${MAX_RETRIES} retries – giving up. Restart the script to retry.`,
                de: `Tedee API nach ${MAX_RETRIES} Versuchen nicht erreichbar – Aufgabe. Skript neu starten zum Wiederholen.`,
            }));
            isStopped = true;
            return;
        }

        const delay = Math.min(BASE_BACKOFF_MS * (2 ** (consecutiveErrors - 1)), 30 * 60_000);
        backoffUntil = Date.now() + delay;

        if (err.message?.includes('429')) {
            ha.warn(`Rate limited (429). Backing off ${delay / 1000}s (retry ${consecutiveErrors}/${MAX_RETRIES - 1}).`);
        } else {
            ha.error(`Poll failed: ${err.message}. Backing off ${delay / 1000}s (retry ${consecutiveErrors}/${MAX_RETRIES - 1}).`);
        }

        // Eager retry after backoff — no need to wait for the next cron tick
        if (pollTimeout) clearTimeout(pollTimeout);
        pollTimeout = setTimeout(poll, delay);
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

ha.onError((err) => {
    ha.error(`Unhandled error – ${err.message}\n${err.stack}`);
});

ha.onStop(() => {
    isStopped = true;
    if (pollTimeout) clearTimeout(pollTimeout);
    for (const timer of patchDebounceTimers.values()) clearTimeout(timer);
    patchDebounceTimers.clear();
    slugCache.clear();
    ha.log('Script stopped.');
});

poll();
schedule(SCAN_INTERVAL, poll);
