# Concept: Script Packs — Self-Contained Mini-Integrations

* **Status:** Proposal
* **Date:** 2026-04-12

---

## 1. The Problem

Home Assistant is powerful, but integrating exotic APIs — a regional energy provider, a custom sports data feed, a local IoT device with a proprietary protocol — still requires significant overhead:

- Write a custom component in Python (HACS, manifest.json, config_flow, translations, …)
- Or use a REST sensor and write a Lovelace card separately
- Manually place JS files in `config/www/`, register Lovelace resources, manage cache-busting
- Ship all of this as multiple files scattered across different directories

This overhead is a barrier. Many integrations never get written — or never get shared.

---

## 2. The Vision: Script Packs

**A Script Pack is a single `.js` file that is a complete, self-contained mini-integration.**

One file contains:
- The **backend logic** — polling APIs, registering HA entities, handling state changes
- The **frontend card** — a custom Lovelace card that displays the data
- The **metadata** — name, icon, version, dependencies

To install a Script Pack, a user pastes a GitHub Gist URL into the Import dialog. One click. The script runs, the card registers itself, and a Lovelace card is available to add to any dashboard. No HACS. No `custom_components`. No manual file placement. No restart.

To share a Script Pack, the author pastes the single `.js` file anywhere — GitHub Gist, raw URL, a forum post — and it works.

**This is the north star: exoctic APIs in HA, with a proper card UI, as a single shareable file.**

---

## 3. The Embedded Card Block

Card code is stored as a Base64-encoded comment block at the end of the script file. It is invisible to the JS runtime — the addon strips and decodes it before the script runs.

### Format

```js
// --- backend logic ---
ha.register('sensor.openligadb_bvb', { ... });
ha.frontend.installCard({ config: { entity_id: 'sensor.openligadb_bvb' } });

/* __JSA_CARD__
Y2xhc3MgT3BlbkxpZ2FEQkNhcmQgZXh0ZW5kcyBIVE1MRWxlbWVudCB7...
__JSA_CARD_END__ */
```

| Part | Description |
|---|---|
| `__JSA_CARD__` | Opens the card block. One card per script. |
| Base64 content | `Buffer.from(cardCode).toString('base64')` — binary-safe, no compression. |
| `__JSA_CARD_END__` | Closes the block. |

The block is always appended at the end of the file. It survives copy-paste, Gist sharing, and URL imports unchanged. The JS runtime never sees it.

### Version Tag (optional)

```js
/* __JSA_CARD__ v1.2.0
...
__JSA_CARD_END__ */
```

The version tag is used for human-readable changelog tracking. Cache-busting uses content hashing, not version numbers.

---

## 4. `@card` Script Header Tag

```js
/**
 * @name OpenLigaDB — BVB
 * @icon mdi:soccer
 * @card dev
 * @version 1.2.0
 */
```

| Value | Behavior |
|---|---|
| *(absent)* | No card. `ha.frontend.installCard()` throws. |
| `@card` | Card is active. `installCard()` installs and registers on script start. |
| `@card dev` | **Development mode.** `installCard()` skips file write and Lovelace registration. Card code is served live from memory to the preview panel. Script list shows a yellow **DEV** badge. Remove when ready to ship. |

---

## 5. API: `ha.frontend.installCard(options?)`

### Signature

```typescript
ha.frontend.installCard(options?: {
  config?: Record<string, unknown>; // Passed to the card's setConfig() on first connect
  force?: boolean;                   // Overwrite even if hash matches (default: false)
}): Promise<string>                  // Resolves to the installed resource URL
```

### Behavior

1. Decodes the `__JSA_CARD__` block from the current script file.
2. Computes a SHA-256 hash of the decoded card source.
3. Compares against the stored hash for this script.
4. **Hash unchanged:** returns the existing resource URL immediately — no file write, no Lovelace API call.
5. **Hash changed or first install:**
   - Writes `config/www/jsa-cards/<script-name>-card.js`
   - Updates (or creates) the Lovelace resource entry via WebSocket, including a cache-busting hash in the URL
6. Returns `/local/jsa-cards/<script-name>-card.js?v=<hash8>`.

### Cache-Busting

```
/local/jsa-cards/openligadb-card.js?v=a3f8c21b
```

When the card source changes, the hash changes, the URL changes, and all connected HA browser sessions fetch the new version automatically. No manual cache clearing.

### Config Injection

The `config` option is passed to the card's `setConfig()` on first connect via a thin wrapper injected at install time:

```js
// Injected by the addon — transparent to the card author
const __jsa_config__ = { entity_id: 'sensor.openligadb_bvb', title: 'BVB' };
const __orig_define__ = customElements.define.bind(customElements);
customElements.define = (name, cls) => {
  class WrappedCard extends cls {
    connectedCallback() {
      super.connectedCallback?.();
      if (__jsa_config__ && this.setConfig) this.setConfig(__jsa_config__);
    }
  }
  __orig_define__(name, WrappedCard);
};
```

The card author writes a normal `setConfig(config)` — no addon-specific code required.

### Error Handling

```
throws: 'No @card block found in script.'       // __JSA_CARD__ block missing
throws: 'Script has no @card header tag.'        // @card not declared
throws: 'File write failed: <reason>'
throws: 'Lovelace resource registration failed: <reason>'
```

---

## 6. Card Editor: Virtual Tab

Although the card code lives inside the script file, the editor treats it as a **separate virtual tab** — with its own Monaco instance, its own IntelliSense context, and its own snippet set. The card author never sees Base64. They see their card code.

### Tab Coupling

When a script with `@card` is open, a card tab appears attached to it:

```
[ openligadb.js ] [ 🃏 Card ]   ← tabs in the editor header
```

- Opening the script tab also shows the card tab in the tab bar.
- Clicking the card tab opens the virtual card editor.
- Saving the card tab re-encodes the card code to Base64 and writes the `__JSA_CARD__` block back into the script file. The script file's modification time updates — it's a single file save.
- Closing the script tab closes the card tab.

### First-Time Card Creation

When `@card` is declared but no `__JSA_CARD__` block exists yet, the card tab shows a creation prompt:

```
No card found in this script yet.

Choose a starting template:
[ LitElement (recommended) ]  [ HTMLElement (minimal) ]  [ Empty ]
```

Selecting a template encodes the boilerplate, appends the `__JSA_CARD__` block to the script file, and opens the editor.

### Card-Specific IntelliSense

The virtual card editor loads a separate type context:

- `HomeAssistant` — `hass.states`, `hass.callService`, `hass.user`, `hass.themes`, etc.
- `LovelaceCard` — `setConfig()`, `getCardSize()`, `getConfigElement()`
- `LitElement`, `html`, `css` (if LitElement template was used)
- HA CSS custom properties — auto-complete for `var(--primary-color)`, `var(--card-background-color)`, etc. inside template literals

### Card-Specific Snippets

The snippet toolbar in the card editor shows a different set than the automation editor:

| Snippet | Inserts |
|---|---|
| `LitElement Card` | Full boilerplate: `properties`, `render()`, `styles`, `setConfig()`, `getCardSize()` |
| `HTMLElement Card` | Minimal: `connectedCallback`, `set hass()`, `setConfig()` |
| `getConfigElement()` | `ha-form`-based config editor scaffold |
| HA Theme Variables | Palette of all `var(--...)` custom properties |
| `__jsa__.callAction()` | Direct card→script action call |

---

## 7. Toolbar Integration

When the active script declares `@card`, the editor toolbar shows a card button:

```
[ Save ] [ Snippets ▾ ] [ Wrap ] [ 🃏 Card ▾ ]
```

`🃏 Card ▾` dropdown:

| Action | Description |
|---|---|
| Edit Card | Open / focus the virtual card tab |
| Preview | Toggle the live preview panel |
| Deploy | Manually run `ha.frontend.installCard()` |
| Go live | Remove `dev` from `@card dev` and deploy |

---

## 8. Live Preview

Writing CSS and layout without visual feedback is not viable. The preview panel is a core part of the card development workflow.

### Layout

A **floating panel** that the developer positions alongside the editor. Position and size persist in `localStorage` per script.

```
┌─ openligadb.js ──────────┬─ 🃏 Card ─────────────────────────────┐
│  ha.register(...)        │  class OpenLigaDBCard extends Lit...   │
│  ha.frontend.install...  │    render() {                          │
│                          │      return html`                       │
│                          │        <ha-card>...                    │
└──────────────────────────┴────────────────────────────────────────┘

  ╔═ Preview: openligadb-card ════════════════════[─][□][×]═╗
  ║  [1col] [2col] [4col] [──────────┤ 380px ├──] [↔ free]  ║
  ║ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
  ║  ┌─────────────────────────────────────────────────┐    ║
  ║  │  🏆 BVB Next Match                              │    ║
  ║  │  Mo 14.04 · 18:30 · vs. Bayern München         │    ║
  ║  └─────────────────────────────────────────────────┘    ║
  ║ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
  ║  ▼ Entity States (mock hass)                           ║
  ║    sensor.openligadb_bvb  state: "upcoming"  [edit]    ║
  ║    attrs: next_match, date, opponent         [+ add]   ║
  ║                                                        ║
  ║  ▼ Errors  (none)                                      ║
  ╚════════════════════════════════════════════════════════╝
```

### Width Presets

Lovelace cards render very differently across column widths. CSS must be tested at realistic sizes:

| Preset | Width | Represents |
|---|---|---|
| **1col** | ~180 px | Narrow column on a dense dashboard |
| **2col** | ~380 px | Standard single card |
| **4col** | ~760 px | Full-width or sidebar card |
| **↔ Free** | drag | Any custom width |

The preview iframe's viewport width is set to the selected value. The card renders exactly as it would on a real dashboard.

### Auto-Reload on Save

Every Ctrl+S on the card tab re-encodes the block, writes the script file, and reloads the preview iframe. No manual refresh needed.

### Live Data Loop (`@card dev` mode)

When `@card dev` is active and the script is running:

1. The script calls `ha.update('sensor.openligadb_bvb', 'upcoming', { next_match: ... })` with real API data.
2. The addon captures the state update and forwards it to the preview iframe as a mock `hass` state change.
3. The card re-renders with live data — no file install, no browser refresh, no Lovelace roundtrip.

**The dev loop: edit card → save → preview updates instantly with real backend data.**

### Mock `hass` Panel

The **Entity States** section in the preview panel:

- In `@card dev` mode: entities updated by the running script are injected automatically.
- Manually: add any entity ID with arbitrary state and attribute values.
- The mock `hass` object passed to the card matches the real HA `hass` structure exactly (`hass.states[id].state`, `hass.states[id].attributes`, etc.).
- Values persist in `localStorage` per script.

### Error Reporting

Card runtime errors are caught via `window.onerror` / `unhandledrejection` in the preview iframe and forwarded to the addon log stream:

```
[openligadb-card][Preview] TypeError: Cannot read properties of undefined (reading 'state')
    at OpenLigaDBCard.render (openligadb-card:42)
```

---

## 9. Hash-Based Change Detection

Stored in addon state per script:

```json
{
  "openligadb": {
    "cardHash": "a3f8c21b9d...",
    "resourceUrl": "/local/jsa-cards/openligadb-card.js?v=a3f8c21b",
    "resourceId": "12"
  }
}
```

On each `ha.frontend.installCard()` call:

1. Decode `__JSA_CARD__` block → hash the source.
2. Compare against stored hash.
3. **Match:** return existing URL. No I/O.
4. **Mismatch / first run:** write file, update Lovelace resource, store new hash.

---

## 10. `ha.action()` — Universal Script Entry Point ✅ Implemented

Data normally flows one way: script → HA entities → `hass.states` → card renders. `ha.action()` is the reverse channel: any external trigger calls a named handler inside the running script.

```js
// Script — define once, trigger from anywhere
ha.action('refresh', async () => { await update(); });
ha.action('set-team', async ({ teamId }) => { CONFIG.teamId = teamId; await update(); });
```

One handler, multiple possible trigger sources:

### Trigger 1 — Card Tap / Card UI

The card calls `__jsa__.callAction()`. Transport via HA event bus (see Section 10b). No HA entity needed, supports payloads and return values.

```js
// Card — __jsa__ is injected as preamble at card install time
refreshBtn.onclick = () => __jsa__.callAction('refresh');
dropdown.onchange = (e) => __jsa__.callAction('set-team', { teamId: e.target.value });
```

**When to use:** Tap-to-refresh, UI-internal state changes, parameterized calls, anything invisible to HA.

### Trigger 2 — HA Button Entity (linked via `ha.register()`) ✅ Implemented

A button entity visible in the HA UI routes its press to a named action. The handler is shared with all triggers — no `ha.on()` needed.

```js
ha.register('button.openligadb_refresh', {
  name: 'Manual Refresh',
  icon: 'mdi:refresh',
  action: 'refresh'   // ← MQTT button press routes to ha.action('refresh')
});
```

**When to use:** The trigger should be visible in HA — usable from automations, dashboards, or voice assistants.

### Trigger 3 — HA Automation Service Call (Future)

```yaml
service: jsa.call_action
data:
  script: openligadb
  action: refresh
```

### Comparison

| | `ha.on()` | `ha.action()` |
|---|---|---|
| Reacts to HA entity state change | Yes | Via linked `ha.register()` |
| Card UI trigger | No | Yes (`__jsa__.callAction`) |
| Payload support | No | Yes |
| Return values | No | Yes |
| One handler, multiple triggers | No | Yes |
| Visible in HA UI | Yes (entity) | Optional (only if registered) |

### Error Handling

| Scenario | Behavior |
|---|---|
| Action name not registered | Addon logs `warn: Unknown action "x" for script "openligadb"` |
| Script not running | `callAction()` rejects; card shows "Script not running" |
| Handler throws | Caught and logged at `error` level in the script's log stream |

---

## 10b. `__jsa__` Injection — Transport Architecture

`__jsa__` is a small helper object prepended to the card code at install time. It bridges the Lovelace frontend and the addon backend without requiring any imports or knowledge of the addon's Ingress URL.

### The Transport Problem

The Lovelace card runs in the HA browser frontend. The addon runs as a separate Node.js process behind Ingress. The card **cannot** directly reach the addon's Socket.io server — it has no Ingress URL and Socket.io is not loaded in the HA frontend context.

### Solution: HA Event Bus as Bidirectional Transport

The card uses `hass.connection` — the HA WebSocket connection already present in every Lovelace frontend. It fires a custom HA event; the addon's `ha-connection.js` receives it via its own WebSocket subscription, routes to the worker, and fires a response event back. The card receives the response via its own subscription.

```
Card (browser)            HA Event Bus                Addon (ha-connection.js)
──────────────            ────────────                ────────────────────────
callAction('refresh')
  │
  ├─fire_event──────────► jsa_action               ──► workerManager.callAction()
  │                       { script, action,                │
  │                         payload, corr_id }             ▼ worker runs handler
  │                                                   fire_event ◄────────────
  │
  ◄─subscribe──────────── jsa_action_result
      { corr_id, result }
  │
resolve(result)
```

### `__jsa__` Object (injected as preamble at install time)

```js
const __jsa__ = (() => {
  let _conn = null;
  const _pending = new Map();

  function _subscribe(conn) {
    if (_conn === conn) return;
    _conn = conn;
    conn.subscribeEvents((event) => {
      const p = _pending.get(event.data.correlation_id);
      if (!p) return;
      _pending.delete(event.data.correlation_id);
      if (event.data.error) p.reject(new Error(event.data.error));
      else p.resolve(event.data.result ?? null);
    }, 'jsa_action_result');
  }

  return {
    scriptId: '{{SCRIPT_ID}}',  // replaced with script filename (no extension) at install time

    connect(hass) { _subscribe(hass.connection); },

    callAction(name, payload = {}) {
      if (!_conn) return Promise.reject(new Error('__jsa__ not connected — call connect(hass) first'));
      const correlationId = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          _pending.delete(correlationId);
          reject(new Error(`Action "${name}" timed out after 10s`));
        }, 10000);
        _pending.set(correlationId, {
          resolve: (r) => { clearTimeout(timer); resolve(r); },
          reject:  (e) => { clearTimeout(timer); reject(e); },
        });
        _conn.sendMessage({
          type: 'fire_event',
          event_type: 'jsa_action',
          event_data: { script: this.scriptId, action: name, payload, correlation_id: correlationId },
        });
      });
    },
  };
})();
```

`{{SCRIPT_ID}}` is replaced with the script's base filename (e.g. `openligadb`) by `CardManager.installCard()` before writing the card file.

### Card Integration Pattern

```js
set hass(hass) {
  __jsa__.connect(hass);  // idempotent — safe to call on every hass update
  this._hass = hass;
  this._render();
}

// Then anywhere in the card:
refreshBtn.onclick = () => __jsa__.callAction('refresh');
```

### Addon Side — HA Event Listener ✅ Implemented

In `ha-connection.js`, inside the existing `subscribeToEvents` callback:

```js
if (event.event_type === 'jsa_action') {
  const { script, action, payload, correlation_id } = event.data;
  workerManager.callAction(script + '.js', action, payload ?? {})
    .then(result => this._fireHAEvent('jsa_action_result', { correlation_id, result }))
    .catch(err  => this._fireHAEvent('jsa_action_result', { correlation_id, error: err.message }));
}
```

`_fireHAEvent` sends a `fire_event` command over the addon's own WebSocket connection to HA.

### Security

- Only authenticated HA users can fire WebSocket events — existing HA auth handles this.
- The addon validates `script` before routing — unknown or stopped scripts receive `{ error: 'Script not running' }`.
- Response events carry the `correlation_id` so only the originating card instance resolves.

---

## 11. Distributing a Script Pack

### As Author

1. Write the script with `@card dev`.
2. Develop the card in the virtual card tab with live preview.
3. Remove `@card dev` → the card installs and registers on next run.
4. Paste the `.js` file to GitHub Gist (or any raw URL host).
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
| Path traversal | Card file write target is always `config/www/jsa-cards/` — no user-controlled path segment. |
| Overwriting user files | `force: false` default. |
| WebSocket auth | Uses the existing authenticated `haConnection`. |
| `jsa/action` spoofing | Only authenticated HA users can send WebSocket messages. |
| Card code execution | Runs in the browser, sandboxed to the Lovelace frontend. No server-side execution. |
| Import from URL | Warning shown in import dialog. User must confirm. |

---

## 13. Example: Complete Script Pack

A single file. Zero manual setup. Share the URL, others import it in one click.

```js
/**
 * @name OpenLigaDB — BVB
 * @icon mdi:soccer
 * @description Tracks upcoming BVB matches. Installs its own Lovelace card.
 * @npm axios
 * @permission network
 * @card
 * @version 1.2.0
 */

const axios = require('axios');
const ENTITY = 'sensor.openligadb_bvb';

ha.register(ENTITY, { name: 'BVB Next Match', icon: 'mdi:soccer', initial_state: 'unknown' });

await ha.frontend.installCard({ config: { entity_id: ENTITY, title: 'BVB' } });

ha.action('refresh', async () => { await update(); });

async function update() {
  const { data } = await axios.get('https://api.openligadb.de/getmatchdata/bl1/2024/7');
  const next = data.find(m => m.matchIsFinished === false);
  ha.update(ENTITY, next ? 'upcoming' : 'unknown', {
    next_match: next?.team2.teamName,
    date: next?.matchDateTime,
  });
}

update();
ha.schedule('*/30 * * * *', update);

/* __JSA_CARD__
Y2xhc3MgT3BlbkxpZ2FEQkNhcmQgZXh0ZW5kcyBIVE1MRWxlbWVudCB7CiAgc2V0
Q29uZmlnKGMpIHsgdGhpcy5fY29uZmlnID0gYzsgfQogIHNldCBoYXNzKGgpIHsK
...
X19KU0FfQ0FSRF9FTkRfXw==
__JSA_CARD_END__ */
```

One `.js` file. Paste the GitHub raw URL into the Import dialog. Done.

---

## 14. Configurable Cards — Setup Wizard

### The Problem with Static Config Forms

HA's standard `getConfigElement()` works well for fixed options — a text field for an entity ID, a toggle for a boolean. But it cannot present **dynamic data** that only the running script knows about: which leagues exist in the API, which teams are in a given league, which devices were discovered on the network.

Static forms require the card author to hard-code all options. That's not acceptable for a "just works" mini-integration.

### Solution: Wizard Mode via `ha.action()`

The card detects whether it has been configured. If not, it renders a **setup wizard** instead of its normal UI. The wizard calls the script backend step by step via `__jsa__.callAction()` to fetch live data — the same network-capable script that is already running.

```
Card added to dashboard (no config yet)
         │
         ▼
  [ Setup Mode ]  ←─── setConfig({ type: 'custom:openligadb-card' })
         │
         ├─ callAction('wizard/leagues') ──→ script fetches API ──→ returns list
         │
         ▼
  User selects league
         │
         ├─ callAction('wizard/teams', { leagueId }) ──→ returns teams
         │
         ▼
  User selects team
         │
         ├─ dispatch config-changed event
         │
         ▼
  HA saves config to dashboard YAML
         │
         ▼
  [ Display Mode ]  ←─── setConfig({ team_id: 7, team_name: 'BVB', ... })
```

### Script Side — Registering Wizard Actions

The script registers named `ha.action()` handlers for each wizard step. These run in the script's Node.js context, with full network access:

```js
// Script (backend)
ha.action('wizard/leagues', async () => {
  const { data } = await axios.get('https://api.openligadb.de/getavailableleagues');
  return data.map(l => ({ id: l.leagueShortcut, name: l.leagueName }));
});

ha.action('wizard/teams', async ({ leagueId }) => {
  const { data } = await axios.get(`https://api.openligadb.de/getteams/${leagueId}`);
  return data.map(t => ({ id: t.teamId, name: t.teamName }));
});
```

### Card Side — Wizard State Machine

```js
setConfig(config) {
  this._config = config;
  this._mode = config?.team_id ? 'display' : 'setup';
  if (this._mode === 'setup' && !this._leagues) this._loadLeagues();
  this.requestUpdate?.();
}

async _loadLeagues() {
  this._loading = true; this.requestUpdate();
  this._leagues = await __jsa__.callAction('wizard/leagues');
  this._loading = false; this.requestUpdate();
}

async _onLeagueSelected(leagueId) {
  this._selectedLeague = leagueId;
  this._loading = true; this.requestUpdate();
  this._teams = await __jsa__.callAction('wizard/teams', { leagueId });
  this._loading = false; this.requestUpdate();
}

_onTeamSelected(team) {
  this.dispatchEvent(new CustomEvent('config-changed', {
    bubbles: true, composed: true,
    detail: {
      config: {
        ...this._config,
        league_id: this._selectedLeague,
        team_id: team.id,
        team_name: team.name,
      }
    }
  }));
  // HA receives config-changed, saves to dashboard YAML, calls setConfig() again
  // → this._mode becomes 'display'
}
```

### Wizard UX

```
┌──────────────────────────────────────────────┐
│  ⚙ Setup — OpenLigaDB Card                  │
│                                              │
│  Step 1 of 2: Select League                  │
│  ┌──────────────────────────────────────┐    │
│  │ 🔍  Search...                        │    │
│  │ ○  Bundesliga 1                      │    │
│  │ ○  Bundesliga 2                      │    │
│  │ ○  DFB Pokal                         │    │
│  └──────────────────────────────────────┘    │
│                               [ Next → ]     │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  ⚙ Setup — OpenLigaDB Card                  │
│                                              │
│  Step 2 of 2: Select Team                   │
│  ┌──────────────────────────────────────┐    │
│  │ 🔍  Search...                        │    │
│  │ ○  Borussia Dortmund                 │    │
│  │ ○  Bayern München                    │    │
│  │ ○  Bayer 04 Leverkusen               │    │
│  └──────────────────────────────────────┘    │
│                    [ ← Back ]  [ Confirm ]   │
└──────────────────────────────────────────────┘
```

- Loading spinner while `callAction()` is pending
- Search filter for long lists
- Back button to correct a previous step
- On confirm: `config-changed` fires, HA saves, card transitions to display mode

### Reconfiguration via `getConfigElement()`

After initial setup, clicking "Edit card" in the Lovelace editor calls `getConfigElement()`. The config editor reuses the **same `ha.action()` handlers** to populate dropdowns — so the "which team?" dropdown in the edit dialog always shows live data, not a hard-coded list.

```js
static getConfigElement() {
  const el = document.createElement('openligadb-card-editor');
  return el;
}
```

```js
class OpenLigaDBCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }

  async _render() {
    // Re-uses wizard/leagues and wizard/teams actions
    const leagues = await __jsa__.callAction('wizard/leagues');
    const teams = this._config.league_id
      ? await __jsa__.callAction('wizard/teams', { leagueId: this._config.league_id })
      : [];
    // render ha-form or custom selects
  }
}
```

### Prerequisite: Script Must Be Running

`callAction()` requires the script to be active. If the script is stopped, `callAction()` rejects and the wizard shows an error:

```
⚠ Script is not running.
Start "OpenLigaDB" in JS Automations to configure this card.
```

This is intentional — the script's network capabilities are what power the wizard. The card makes this dependency explicit rather than silently failing.

---

## 15. Implementation Phases

Script Packs are a multi-phase feature. Each phase ships independently and delivers usable value on its own.

| Phase | Status | Name | Delivers |
|---|---|---|---|
| **0** | ✅ Done | **`ha.action()`** | Named action handlers, button entity routing via `ha.register({ action: '...' })`, Socket.io `call_action` event for addon UI |
| **1** | ✅ Done | **Foundation** | `__JSA_CARD__` block parsing & encoding, `ha.frontend.installCard()`, hash-based change detection, writing to `config/www/jsa-cards/`, Lovelace resource registration via HA WebSocket |
| **2** | ✅ Done | **Card Editor** | Virtual card tab in Monaco, coupled tab lifecycle (open/close with script tab), `__jsa__` type definitions for cards, card snippet library (boilerplate, callAction, config-changed, HA vars), card-mode banner |
| **3** | ✅ Done | **Live Preview** | Floating preview panel (draggable, position-persistent), width presets (1col/2col/4col/free), auto-reload on Ctrl+S, mock `hass` entity injection, runtime error forwarding from iframe |
| **4** | ✅ Done | **Dev Mode + `__jsa__`** | `__jsa__` preamble injected at install time, `jsa_action` HA event routing in kernel → worker → `jsa_action_result`, `@card dev` parsed as metadata, DEV/CARD badges in script list, live HA state forwarding into preview, `Card ▾` toolbar dropdown |
| **5** | ✅ Done | **Configurable Cards** | `ha.action()` wizard pattern (first-run setup), `getConfigElement()` with live-data dropdowns, wizard card snippet, "script not running" fallback UI |

### Phase Dependencies

```
Phase 0 (ha.action)  ──────────────────────────────────────┐
Phase 1 (installCard)                                       │
    └── Phase 2 (card editor)                               │
            └── Phase 3 (preview)                           │
                    └── Phase 4 (dev mode + __jsa__)  ◄─────┘
                            └── Phase 5 (configurable cards)
```

Phase 4 depends on both Phase 1 (to know the install path for preamble injection) and Phase 0 (`workerManager.callAction()` already implemented — the HA event listener is the remaining piece).

### Value at Each Phase

- **After Phase 0+1:** Script Packs can be authored in any editor and distributed as single files. Cards install automatically with hash-based cache-busting. Button entities route to named action handlers.
- **After Phase 2:** Card code is written inside JS Automations with proper IntelliSense and boilerplate. The virtual tab hides Base64 encoding completely.
- **After Phase 3:** CSS and layout work is practical. Width presets let the developer test at real Lovelace column widths without deploying.
- **After Phase 4:** `__jsa__.callAction()` works from within the card — tap-to-refresh, dropdown-driven config changes, all without HA entities. The full dev loop closes: edit card → live preview with real script data.
- **After Phase 5:** The card guides the user through dynamic first-run configuration using live data from the running script. Exotic API integrations become zero-setup for end users.


### Fehler und Vorschläge nach ersten Tests
- DEV Badge in der Skriptliste: Wir nutzen das mdi:view-dashboard-outline icon genauso wie die Permission. Wir zeigen damit an, dass es ein Karte enthält. Orange, wenn DEV Mode, dunkelgrau, wenn noch nicht installiert hell grau, wenn installier und läuft.
- Wenn ich den Karten-Tab schließe, kann ich ihn nicht wieder öffnen. Sollen wir im Skripttab einen open/close Button (mdi:view-dashboard-edit-outline) für die Karte einbauen. Nur sichtbar wenn @card.
- In der Kartentoolbar stimm was nicht. Cardactions sind rechtsbündig das ist nicht in Ordnung. Für die Snippets benutzen wir auch das Puzzleteil. Das ist ja aus dem Skripttab schon bekannt. 
- Card preview (mdi:monitor-dashboard nutzen?) wirft einen Fehler: "ReferenceError: __jsa__ is not defined line 108" Die Zeilennummer scheint aber nicht zu stimmen.
- Können wir Kartenfehler an den JSA-Logger schicken, damit es wartbarer wird?
- Werden Karten auch irgendwie deinstalliert?
- Kann man die Packs auch mit TS coden? Also nicht die Karten, sondern das Hauptskript?
- durchgängig das mdi


## Karten Ideen:
- Das Awtrix-Display bietet eine Vorschau seines Displays als Bild an. Unsere Karte Zeigt genau dieses Bild an und wird auch aktualisiet. Das Bild wird im Browser auch aktualisiert. Config ist die IP Adresse, USR und PW. Noch was?
- analoguhr gemäß @doc/ideas/uhr.html. Config: 7-Segment-Feld ein- und ausblendbar machen, SWISS_STOP_GO, SMOOTH_SECONDS, DYNAMIC_DATE, PULSE_ON_DONE, GLOW_EFFECT
- OpenligaDB: @doc/ideas/openligadb-card.js Die Karte hat sich im Layout bewährt. Config-flow: Das Skript hat die shorts für die wichtigsten Ligen fest im Code und bietet diese per SELECT an. Plus sonstige: Hier kann man dann ggf. sein eigene short eingeben. Schritt zwei: Es wird nur der aktuelle Wettbewerb genutzt oder in der Saisonpause, der nächst anstehende. Schritt drei: Das Skript füllt einen Mannschaftsselect mit den Mannschaften des Wettbewerbs. Bei Fußball wird direkt Championsleague, DFB Pokal, europa league mit "aboniert". Bei DFB packen wir noch ein Batch trophy-outline, bei championsleage trophy dazu. europa league mdi:soccer?