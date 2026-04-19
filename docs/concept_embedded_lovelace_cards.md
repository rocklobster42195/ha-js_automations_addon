# Script Packs — Embedded Lovelace Cards

* **Status:** Living Document
* **Last updated:** 2026-04-19

---

## 1. Vision

A **Script Pack** is a single `.js` file that is a complete, self-contained mini-integration for Home Assistant.

One file contains:
- **Backend logic** — polling APIs, registering HA entities, handling state changes
- **Frontend card** — a custom Lovelace card that displays the data
- **Metadata** — name, icon, version, dependencies, card config wizard

To install a Script Pack, a user pastes a GitHub Gist URL into the Import dialog. One click. The script runs, the card registers itself, and a Lovelace card is available to add to any dashboard. No HACS. No `custom_components`. No manual file placement. No restart.

**North star: exotic APIs in HA, with a proper card UI, as a single shareable file.**

---

## 2. Card Block Format

Card code is stored as a Base64-encoded comment block at the end of the script file. It is invisible to the JS runtime — the addon strips and decodes it before the script runs.

```js
// --- backend logic ---
ha.register('sensor.openligadb_7', { name: 'BVB', icon: 'mdi:soccer' });
ha.frontend.installCard();

/* __JSA_CARD__
Y2xhc3MgT3BlbkxpZ2FEQkNhcmQgZXh0ZW5kcyBIVE1MRWxlbWVudCB7...
__JSA_CARD_END__ */
```

| Part | Description |
|---|---|
| `/* __JSA_CARD__` | Opens the card block (block-comment form, not inline) |
| Base64 content | `Buffer.from(cardCode).toString('base64')` — binary-safe, no compression |
| `__JSA_CARD_END__ */` | Closes the block |

The block is always appended at the end of the file. It survives copy-paste, Gist sharing, and URL imports unchanged. The JS runtime never sees it. A version comment (e.g. `/* __JSA_CARD__ v2`) is optional and human-readable only — cache-busting uses content hashing.

### Hash-Based Change Detection

On each `ha.frontend.installCard()` call:

1. Decode `__JSA_CARD__` block → SHA-256 hash of decoded source.
2. Compare against stored hash for this script.
3. **Match:** return existing URL immediately — no I/O.
4. **Mismatch / first run:** write file, update Lovelace resource, store new hash.

Stored in `card-registry.json` per script:

```json
{
  "openligadb": {
    "hash": "a3f8c21b9d...",
    "resourceUrl": "/local/jsa-cards/openligadb-card.js?v=a3f8c21b",
    "resourceId": "5138934e9dbc4819a6895803ad0c93cf",
    "cardName": "openligadb-card"
  }
}
```

**Preamble changes don't change the hash** — the hash covers only the decoded card source. To force reinstall when only the preamble changes, bump a version comment inside the card source.

---

## 3. `@card` Script Header Tag

```js
/**
 * @name OpenLigaDB
 * @icon mdi:soccer
 * @card
 * @version 2.0.0
 */
```

| Value | Behavior |
|---|---|
| *(absent)* | No card. `ha.frontend.installCard()` throws. |
| `@card` | Card is active. `installCard()` installs and registers on script start. |
| `@card dev` | **Development mode.** `installCard()` skips file write and Lovelace registration. Card code is served live from memory to the preview panel. Script list shows a yellow **DEV** badge. Remove `dev` when ready to ship. |

---

## 4. `ha.frontend.installCard()`

```typescript
ha.frontend.installCard(options?: {
  config?: Record<string, unknown>; // Passed to the card's setConfig() on first connect
  force?: boolean;                   // Overwrite even if hash matches (default: false)
}): Promise<string>                  // Resolves to the installed resource URL
```

### What happens at install time

1. Decode `__JSA_CARD__` block.
2. Compute SHA-256 hash of decoded source.
3. If hash matches stored value and file exists: return existing URL.
4. Otherwise:
   - Prepend `window.customCards.push(...)` synchronously at top of file (required for HA card picker).
   - Prepend `__jsa__` preamble with `{{SCRIPT_ID}}` replaced.
   - Write `config/www/jsa-cards/<scriptName>-card.js`.
   - Register or update Lovelace resource via WebSocket (cache-busting hash in URL).
5. Return `/local/jsa-cards/<scriptName>-card.js?v=<hash8>`.

### Card Picker Registration

The `window.customCards` block is prepended **synchronously** before all other code so HA reads it at module load time, before any async setup runs. This is required for the card to appear in both the legacy Lovelace picker and the Sections dashboard picker.

```js
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'openligadb-card',
  name: 'OpenLigaDB',
  description: 'Tracks football match data',
  preview: true,
});
```

`preview: true` means HA renders a live thumbnail in the picker using `getStubConfig()`. Use `preview: false` for cards that require real HA state to be meaningful.

### Sections Dashboard: `getGridOptions()` Required

The HA sections dashboard (default from HA 2025+) card picker **only shows cards that implement `static getGridOptions()`**. Without it the card is invisible to the picker even if correctly registered.

```js
static getGridOptions() {
  return { rows: 3, columns: 12, min_rows: 2, max_rows: 8, min_columns: 4, max_columns: 12 };
}
```

### Startup & Post-Install Cleanup

`CardManager.performStartupCleanup(knownCardNames)` removes orphaned card JS files and Lovelace resources — i.e., resources for scripts that no longer exist or no longer carry a `@card` header.

Called in two places:
1. **`kernel.start()`** — once at startup, after HA connects, before autostart.
2. **`worker-manager.js`** — fire-and-forget after each successful production `installCard()`, so dev iterations don't accumulate stale Lovelace entries.

---

## 5. `__jsa__` Preamble — Transport Architecture

`__jsa__` is prepended to the card code at install time. It bridges the Lovelace frontend and the addon backend without requiring any imports or knowledge of the addon's Ingress URL.

### The Transport Problem

The Lovelace card runs in the HA browser frontend. The addon runs as a separate Node.js process behind Ingress. The card **cannot** directly reach the addon's Socket.io server — it has no Ingress URL.

### Solution: HA Event Bus as Bidirectional Transport

```
Card (browser)             HA Event Bus              Addon (kernel.js)
──────────────             ────────────              ─────────────────
callAction('refresh')
  │
  ├─ subscribe ──────────► jsa_action_result ◄──────────────────────┐
  │                                                                  │
  ├─ hass.callWS ────────► jsa_action                               │
  │                        { script, action,                         │
  │                          payload, corr_id }                      │
  │                                    │                             │
  │                          workerManager.callAction()              │
  │                                    │ worker runs handler         │
  │                                    └──► fireEvent ──────────────┘
  │
  ◄─ event received ─────── jsa_action_result
      { corr_id, result }
  │
resolve(result)
```

### Reliability: Three-Layer Defense

Double-delivery of `jsa_action` events (caused by transient dual WS subscriptions on reconnect) is handled at three levels:

1. **`ha-connection.js`** — `_subscribed` guard prevents duplicate `subscribe_events` calls on reconnect.
2. **`kernel.js`** — `_seenCorrIds` Set deduplicates `jsa_action` events by correlation ID (30s TTL).
3. **`__jsa__` preamble** — `settled` flag + 1s error grace period: if an error arrives first but a success follows within 1s, the success wins.

### Unsubscribe Safety

The HA WebSocket library's unsubscribe function returns a Promise that may reject with an internal error. This is caught silently to prevent unhandled rejection crashes:

```js
Promise.resolve().then(() => u()).catch(() => {});
```

### Current Preamble Version: v5

Key behaviors:
- Stores `_hass` alongside `_conn` — required to use `hass.callWS()` (which handles `fire_event` response lifecycle correctly; `conn.sendMessage` leaves the response unhandled).
- Per-call `subscribeMessage` subscription created **before** firing the event to eliminate the subscription-registration vs. result-delivery race condition.
- 20s action timeout.

---

## 6. Card Editor & Live Preview

### Virtual Card Tab

When a script with `@card` is open, a card tab appears in the editor:

```
[ openligadb.js ]  [ 🃏 Card ]
```

- Coupled lifecycle: opens/closes with the script tab.
- Saving re-encodes the card source to Base64 and writes the `__JSA_CARD__` block back into the script file.
- First-time: if `@card` is declared but no `__JSA_CARD__` block exists, a template picker is shown.

### Card-Specific IntelliSense & Snippets

The card editor loads a separate type context: `HomeAssistant`, `LovelaceCard`, `LitElement`, HA CSS custom properties.

| Snippet | Inserts |
|---|---|
| `Wizard-Card` | Full editor boilerplate using `__jsa__.wizard()` |
| `HTMLElement Card` | Minimal `set hass()`, `setConfig()`, `getCardSize()` |
| `Heartbeat Setup` | Instance ID reading from config + auto-tracking call |
| `Non-blocking Action` | `ha.register()` + fire-and-forget `updateData()` pattern |
| `Entity Naming` | `sensor.${SCRIPT_NAME}_${id}` convention |
| `Live Badge` | Pulsing dot CSS animation for live states |
| `config-changed` | Correct dispatch including required `type` field |
| `getGridOptions` | Sections dashboard sizing declaration |

### Live Preview Panel

A floating, draggable panel that positions itself alongside the editor. Position and size persist in `localStorage` per script.

**Width presets:**

| Preset | Width | Represents |
|---|---|---|
| **1col** | ~180 px | Narrow column |
| **2col** | ~380 px | Standard single card |
| **4col** | ~760 px | Full-width card |
| **↔ Free** | drag | Any custom width |

**`@card dev` live data loop:**
1. Script calls `ha.update('sensor.openligadb_7', 'live', { score: '2:1' })`.
2. Addon captures state update, forwards as mock `hass` state change to preview iframe.
3. Card re-renders with real backend data — no file install, no browser refresh.

**Error forwarding:** Card runtime errors are caught via `window.onerror` / `unhandledrejection` in the preview iframe and forwarded to the JSA log stream.

---

## 7. `ha.action()` — Card ↔ Script Communication

```js
// Script — define named handlers
ha.action('refresh', async ({ entityId }) => { await updateMatchData(); });
ha.action('get_leagues', async () => KNOWN_LEAGUES);
ha.action('get_teams', async ({ league, season }) => fetchTeams(league, season));
ha.action('heartbeat', async ({ instanceId, entityId, autoDelete }) => {
  updateInstanceLastSeen(instanceId, entityId, autoDelete);
});
```

```js
// Card — call via __jsa__
refreshBtn.onclick = () => __jsa__.callAction('refresh', { entityId: this._entityId });
```

### Error Handling

| Scenario | Behavior |
|---|---|
| Action not registered | Addon logs `warn: Unknown action "x"` |
| Script not running | `callAction()` rejects after 20s timeout |
| Handler throws | Caught and logged at `error` level in script log stream |

---

## 8. Developer Experience — Abstractions & Helpers

These are the lessons from building the OpenLigaDB card, translated into framework improvements. Each addresses a concrete pain point.

### 8.1 Declarative Config Wizard — `__jsa__.wizard()`

**Problem:** Every configurable card needs a multi-step setup wizard with loading states, back navigation, error handling, and a correct `config-changed` dispatch. The OpenLigaDB editor class was ~130 lines of boilerplate for this alone — including the non-obvious `type` field requirement that crashes HA if missing.

**Solution:** Inject a wizard builder into the `__jsa__` preamble:

```js
// In OpenligadbCardEditor.connectedCallback():
__jsa__.wizard(this, {
  steps: [
    {
      id: 'league',
      label: 'Liga wählen',
      action: 'get_leagues',
      valueKey: 'short',
      labelKey: 'name',
      // Optional: season field shown alongside this step
      seasonField: true,
    },
    {
      id: 'team',
      label: 'Team wählen',
      action: 'get_teams',
      // Passes the previous step's selected value as payload
      depends: { league: 'league', season: 'season' },
      valueKey: 'teamId',
      labelKey: 'teamName',
    },
  ],
  onComplete: (values, instanceId) => ({
    entityId: values.entityId,
    instanceId,
    autoDelete: true,
  }),
});
```

The framework:
- Renders each step as a styled `<select>` with loading spinner and error state.
- Generates a `instanceId` (UUID) on first run, re-uses it on reconfigure.
- Dispatches `config-changed` with the correct `type` field on completion.
- Dispatches `jsa-editor-close` to close the editor panel.
- Editor class shrinks from ~130 lines to ~10 lines.

### 8.2 Auto-Heartbeat via `connect()`

**Problem:** Every card with instance tracking must send periodic heartbeats — this is mandatory boilerplate that card authors shouldn't have to implement.

**Solution:** `__jsa__.connect(hass)` handles it automatically:

```js
set hass(hass) {
  __jsa__.connect(hass); // triggers heartbeat automatically — no extra code needed
  this._hass = hass;
  this._render();
}
```

Internally, `connect()`:
1. Calls `callAction('heartbeat', { instanceId, entityId, autoDelete })` on first connect.
2. Repeats every 60 minutes via a local `setInterval`.
3. Reads `instanceId` and `autoDelete` from `this._config` (set via `setConfig()`).
4. Is idempotent — safe to call on every `set hass()` update.

The card author only needs to store the config: `setConfig(cfg) { this._cfg = cfg; }`.

### 8.3 Error Boundary → JSA Log

**Problem:** Card runtime errors disappear silently in the browser unless the developer has DevTools open.

**Solution:** Inject a global error handler into the card file at install time:

```js
// Injected once per card file, before the card class
window.__jsa_errors__ = window.__jsa_errors__ || (() => {
  const forward = (msg, src, line) =>
    fetch('/_jsa_card_error', { method: 'POST', body: JSON.stringify({ msg, src, line,
      script: document.currentScript?.src }) }).catch(() => {});
  window.addEventListener('error', e => forward(e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', e => forward(e.reason?.message, '', 0));
})();
```

Errors appear in the JSA log stream tagged with the script name — no browser DevTools required.

### 8.4 High-Level API: `ha.frontend.defineCard()` *(Planned)*

The most ambitious abstraction — eliminates all Custom Element boilerplate:

```js
ha.frontend.defineCard({
  wizard: [
    { id: 'league', label: 'Liga wählen', action: 'get_leagues',
      valueKey: 'short', labelKey: 'name', seasonField: true },
    { id: 'team', label: 'Team wählen', action: 'get_teams',
      depends: { league: 'league', season: 'season' },
      valueKey: 'teamId', labelKey: 'teamName' },
  ],

  render({ state, attr, config }) {
    return `
      <div class="header">${state === 'live' ? '🔴 LIVE' : 'Nächstes Spiel'}</div>
      <div class="score">${attr.score_home ?? 'VS'} : ${attr.score_away ?? ''}</div>
    `;
  },

  styles: `
    .header { font-size: .85em; color: var(--secondary-text-color); }
    .score  { font-size: 2.2em; font-weight: 900; }
  `,

  onTap({ entityId }) {
    return __jsa__.callAction('refresh', { entityId });
  },

  gridOptions: { rows: 3, columns: 12, min_rows: 2, max_rows: 8 },
});
```

The framework generates the full Custom Element: `set hass()`, `setConfig()`, `getGridOptions()`, `getConfigElement()`, Shadow DOM, heartbeat, error boundary, config-changed dispatch. The developer writes only render logic and action handlers.

This is **non-breaking** — existing cards using the manual approach continue to work. `defineCard()` is an optional higher-level alternative.

---

## 9. Instance Tracking & Cleanup

Multiple displays in a home may show the same team card. The backend tracks which card instances are active and cleans up team entities when all instances are gone.

### 9.1 Registry Schema

```json
{
  "sensor.openligadb_7": {
    "teamId": 7,
    "teamName": "Borussia Dortmund",
    "leagueShort": "bl1",
    "season": 2025,
    "skipMatchId": null,
    "instances": {
      "uuid-abc123": { "lastSeen": 1713456789, "autoDelete": true },
      "uuid-def456": { "lastSeen": 1713456789, "autoDelete": false }
    }
  }
}
```

One entity per team (`sensor.openligadb_<teamId>`). Multiple card instances (on different dashboards or displays) share the entity but have independent instance records.

### 9.2 Instance ID Lifecycle

- **Generated** by `__jsa__.wizard()` on first card configuration (UUID v4).
- **Preserved** on reconfigure — same display, same UUID.
- **Stored** in Lovelace card YAML alongside `entityId` and `autoDelete`.

```yaml
type: custom:openligadb-card
entityId: sensor.openligadb_7
instanceId: uuid-abc123
autoDelete: true
```

### 9.3 Heartbeat Mechanism

The card calls `callAction('heartbeat', { instanceId, entityId, autoDelete })`:
- On first `connect(hass)`.
- Every 60 minutes thereafter (local `setInterval`).

The `heartbeat` action handler updates `registry.teams[entityId].instances[instanceId].lastSeen` and `autoDelete`.

### 9.4 Auto-Delete Logic

Run in the script's scheduled polling tick (or a dedicated interval):

```
For each entityId in registry.teams:
  instances = registry.teams[entityId].instances
  if instances is empty → delete entity immediately
  if ALL instances have autoDelete=true:
    if ALL instances have lastSeen > threshold → delete entity
  if ANY instance has autoDelete=false → never auto-delete
```

**Threshold:** Configurable in JSA Settings (e.g. `card_instance_timeout_days`, default: **7 days**). 7 days survives short holidays; catches cards removed from dashboards within a week.

**On delete:**
- Remove entity from `registry.teams`.
- Call `ha.unregister(entityId)` to remove the HA entity.
- Log at `info` level.

### 9.5 Manual Cleanup

A "Manage Teams" view in the card editor (accessible via the gear icon on a configured card) shows all tracked teams with a delete button — for users with `autoDelete=false` or who want immediate cleanup.

---

## 10. Liga List & Season Detection

Lessons from the OpenLigaDB implementation.

### Liga Selection in Wizard

**Wizard shows** only main leagues (BL1, BL2, BL3, + "Sonstige" custom input). DFB-Pokal, Champions League, Europa League, Conference League are **not** in the selector — a team rarely wants to track only their cup matches.

**Backend checks all** known competitions regardless: `updateMatchData()` fetches all leagues in `KNOWN_LEAGUES` (including UCL, UEL, UECL, DFB) so that multi-competition teams (e.g. BVB in BL1 + UCL simultaneously) always get their next upcoming match regardless of which competition it's in.

### Season Detection — Visible & Editable

`detectSeason()` is a heuristic (`month >= 6 ? year : year - 1`) that works for regular club football but breaks for tournaments like WM/EM (e.g. WM2026 runs in summer 2026 but `detectSeason()` would return 2025 in April 2026).

**Fix:** Show the auto-detected season in the wizard as an editable field, not a hidden value:

```
Liga: [ 1. Bundesliga ▼ ]
Saison: [ 2025 ↕ ]    ← auto-detected, user can correct
```

The user sees what will be used and can override before confirming. The script stores the user-confirmed season, not a re-calculated one.

---

## 11. Distribution

### As Author

1. Write the script with `@card dev`.
2. Develop the card in the virtual card tab with live preview.
3. Remove `@card dev` (change to `@card`) → card installs and registers on next run.
4. Paste the `.js` file to GitHub Gist or any raw URL host.
5. Share the raw URL.

### As User

1. Open JS Automations → Import tab.
2. Paste the raw URL.
3. Click Import.

The addon downloads the file, detects the `__JSA_CARD__` block, runs the script, and installs the card. The Lovelace resource appears. The user adds the card to their dashboard. Done.

---

## 12. Security

| Concern | Mitigation |
|---|---|
| Path traversal | Card file write target is always `config/www/jsa-cards/` — no user-controlled path segment |
| Overwriting user files | `force: false` default; hash-based skip |
| WebSocket auth | Uses the existing authenticated `haConnection` |
| `jsa_action` spoofing | Only authenticated HA users can send WebSocket events |
| Card code execution | Runs in the browser, sandboxed to the Lovelace frontend — no server-side execution |
| Import from URL | Warning shown in import dialog. User must confirm |

---

## 13. Implementation Status

| Phase | Status | Delivers |
|---|---|---|
| **0** | ✅ Done | `ha.action()` — named action handlers, button entity routing |
| **1** | ✅ Done | `__JSA_CARD__` block, `ha.frontend.installCard()`, hash detection, Lovelace registration |
| **2** | ✅ Done | Virtual card tab in Monaco, coupled tab lifecycle, card IntelliSense, snippet library |
| **3** | ✅ Done | Live preview panel (draggable, width presets, auto-reload), mock `hass` injection |
| **4** | ✅ Done | `__jsa__` preamble v5, event bus transport, `@card dev`, DEV/CARD badges, live HA state in preview |
| **5** | ✅ Done | Configurable cards, wizard pattern, `getConfigElement()`, startup + post-install cleanup |
| **6** | 🔲 Planned | `__jsa__.wizard()` declarative wizard builder, auto-heartbeat in `connect()`, error boundary → JSA log |
| **7** | 🔲 Planned | Instance tracking registry, auto-delete with configurable threshold, "Manage Teams" UI |
| **8** | 🔲 Planned | `ha.frontend.defineCard()` high-level API, season field in wizard, liga list refinement |

### Phase 6 Priority

Phase 6 delivers the highest developer experience improvement per implementation effort:
- `__jsa__.wizard()` eliminates ~120 lines of wizard boilerplate per card.
- Auto-heartbeat makes instance tracking transparent.
- Error boundary removes the biggest debugging friction point.

None of these are breaking changes — existing cards continue to work unchanged.
