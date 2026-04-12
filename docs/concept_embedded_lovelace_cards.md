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

## 10. `ha.action()` — Universal Script Entry Point

Data normally flows one way: script → HA entities → `hass.states` → card renders. `ha.action()` is the reverse channel: any external trigger calls a named handler inside the running script.

```js
// Script — define once, trigger from anywhere
ha.action('refresh', async () => { await update(); });
ha.action('set-team', async ({ teamId }) => { CONFIG.teamId = teamId; await update(); });
```

One handler, multiple possible trigger sources:

### Trigger 1 — Card Tap / Card UI

The card calls `__jsa__.callAction()` directly. No HA entity needed, supports payloads and return values.

```js
// Card — __jsa__ is injected at card install time
refreshBtn.onclick = () => __jsa__.callAction('refresh');
dropdown.onchange = (e) => __jsa__.callAction('set-team', { teamId: e.target.value });
```

Transport: custom WebSocket message `jsa/action` → addon → worker thread.

**When to use:** Tap-to-refresh, UI-internal state changes, parameterized calls, anything invisible to HA.

### Trigger 2 — HA Button Entity (linked via `ha.register()`)

A button entity visible in the HA UI routes its press to a named action. The handler is shared with all other triggers — no duplication.

```js
ha.register('button.openligadb_refresh', {
  name: 'Manual Refresh',
  icon: 'mdi:refresh',
  action: 'refresh'   // ← press is routed to ha.action('refresh')
});
```

Instead of writing a separate `ha.on('button.openligadb_refresh', handler)`, the `action` field on `ha.register()` wires the entity to the existing named handler.

**When to use:** The trigger should be visible in HA — usable from automations, dashboards, or voice assistants.

### Trigger 3 — HA Automation Service Call (Future)

```yaml
service: jsa.call_action
data:
  script: openligadb
  action: refresh
```

Allows HA automations to call into Script Pack logic without needing a dedicated button entity.

### Comparison

| | `ha.on()` (today) | `ha.action()` |
|---|---|---|
| Reacts to HA entity state change | Yes | Via linked `ha.register()` |
| Card UI trigger | No | Yes (`__jsa__.callAction`) |
| Payload support | No | Yes |
| Return values | No | Yes (future) |
| One handler, multiple triggers | No | Yes |
| Visible in HA UI | Yes (entity) | Optional (only if registered) |

### Error Handling

| Scenario | Behavior |
|---|---|
| Action name not registered | Addon logs `warn: Unknown action "x" for script "openligadb"` |
| Script not running | `callAction()` rejects; card shows error or fallback |
| Handler throws | Caught and logged at `error` level in the script's log stream |

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

| Phase | Name | Delivers |
|---|---|---|
| **1** | **Foundation** | `__JSA_CARD__` block parsing & encoding, `ha.frontend.installCard()`, hash-based change detection, writing to `config/www/jsa-cards/`, Lovelace resource registration via WebSocket |
| **2** | **Card Editor** | Virtual card tab in Monaco, coupled tab lifecycle (open/close with script tab), card-specific TypeScript type definitions (`HomeAssistant`, `LovelaceCard`, `LitElement`), card snippet library, first-time template prompt |
| **3** | **Live Preview** | Floating preview panel, width presets (1col / 2col / 4col / free), auto-reload on save, mock `hass` entity panel, runtime error forwarding from iframe |
| **4** | **Dev Mode** | `@card dev` state-forwarding from running script to preview, DEV badge in script list, `🃏 Card ▾` toolbar dropdown, "Go live" action |
| **5** | **Configurable Cards** | `ha.action()` wizard pattern (first-run setup), `getConfigElement()` with live-data dropdowns, wizard card snippet, "script not running" fallback UI |

### Phase Dependencies

```
Phase 1 (installCard)
    └── Phase 2 (card editor)
            └── Phase 3 (preview)
                    └── Phase 4 (dev mode)
                            └── Phase 5 (configurable cards)
```

Phase 5 requires `ha.action()` to be implemented (already in scope from the card→script communication section). All other infrastructure — embedded blocks, virtual tab, preview, dev mode — must exist before the wizard pattern makes sense to develop.

### Value at Each Phase

- **After Phase 1:** Script Packs can be built in any external editor and distributed as single files. Cards install automatically. Hash-based cache-busting works.
- **After Phase 2:** Card code can be written inside JS Automations with IntelliSense and boilerplate snippets. The virtual tab hides the Base64 encoding entirely.
- **After Phase 3:** CSS and layout work becomes practical. Developers can test cards at realistic column widths without deploying to a real dashboard.
- **After Phase 4:** The full dev loop is closed. Script-driven state updates appear live in the preview without any file installation or browser refresh.
- **After Phase 5:** Script Packs can guide users through dynamic first-run configuration. Exotic API integrations become zero-effort to set up — the card itself walks the user through it.
