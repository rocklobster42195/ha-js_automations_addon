# Concept: Embedded Lovelace Cards in JS Automations Scripts

* **Status:** Proposal
* **Date:** 2026-04-08

---

## 1. Background & Motivation

JS Automations enables powerful "single-script integrations" — one `.js` or `.ts` file that contains all the backend logic for a Home Assistant mini-integration: polling an API, registering native HA entities, handling state changes, and sending notifications.

The missing piece has always been the **frontend**. A truly self-contained integration also needs a custom Lovelace card to display its data. Currently, shipping a card alongside a script requires the user to manually create a file in `config/www/`, paste card code into it, navigate to the Lovelace resource settings, and register the URL. This manual process is error-prone, breaks the "single file" promise, and raises the barrier for authors who want to ship polished mini-integrations.

This concept introduces **embedded Lovelace cards**: card code lives directly inside the script file, encoded as a comment block. The addon provides a dedicated card editor, a live preview loop, a config injection system, and automatic installation — making it possible to develop and ship a complete HA mini-integration as a single, shareable `.js` file.

**The goal: lower the barrier for powerful single-script integrations that include their own UI.**

---

## 2. The Embedded Card Block

### Format

Card code is stored as a Base64-encoded comment block at the end of the script file. Multiple cards per script are supported.

```js
// --- backend script logic ---
ha.register('sensor.openligadb_next_match', { ... });
ha.frontend.installCard('openligadb-card');

/* __JSA_CARD_START__: openligadb-card | v1.0.0
Y2xhc3MgT3BlbkxpZ2FEQkNhcmQgZXh0ZW5kcyBIVE1MRWxlbWVudCB7...
__JSA_CARD_END__ */
```

| Field | Description |
|---|---|
| `__JSA_CARD_START__: <name>` | Opens a card block. Name must match `[a-z0-9-_]+`. |
| `\| v<version>` | Optional version tag, used for cache-busting. Derived from `@version` in the script header. |
| Base64 content | `Buffer.from(cardCode).toString('base64')` — no compression, binary-safe. |
| `__JSA_CARD_END__` | Closes the block. |

The comment block has no effect on script execution. The addon strips and decodes all card blocks before the script runs.

### Multi-Card Support

A single script can embed multiple cards:

```js
ha.frontend.installCard('openligadb-card');
ha.frontend.installCard('openligadb-stats-card');

/* __JSA_CARD_START__: openligadb-card | v1.0.0
...
__JSA_CARD_END__ */

/* __JSA_CARD_START__: openligadb-stats-card | v1.0.0
...
__JSA_CARD_END__ */
```

---

## 3. API: `ha.frontend.installCard(name, options?)`

### Signature

```typescript
ha.frontend.installCard(name: string, options?: {
  config?: Record<string, unknown>; // Passed to setConfig() on the card
  force?: boolean;                   // Overwrite existing file (default: false)
}): Promise<string>                  // Returns the installed resource URL
```

### Behavior

1. Looks up the decoded card code from the embedded block matching `name`.
2. Computes a SHA-256 hash of the card code.
3. Compares the hash against the previously installed version (stored in addon state).
4. **If unchanged and not `force`:** skips file write and registration. Returns existing URL.
5. **If changed or first install:** writes `config/www/jsa-cards/<name>.js` and updates the Lovelace resource URL to include a cache-busting hash.
6. Registers (or updates) the Lovelace resource via `lovelace/resources/create` or `lovelace/resources/update` through the existing HA WebSocket connection.
7. Returns the resource URL: `/local/jsa-cards/<name>.js?v=<hash8>`.

### Cache-Busting

The installed file URL includes the first 8 characters of the content hash as a query parameter:

```
/local/jsa-cards/openligadb-card.js?v=a3f8c21b
```

When the card code changes, the hash changes, the resource URL changes, and the browser fetches the new version — no manual cache clearing required. The Lovelace resource URL update triggers a frontend refresh in all connected HA browser sessions.

### Config Injection

The `config` option is passed to the card's `setConfig()` method immediately after the element is first connected, using a thin wrapper injected around the card code:

```js
// Injected wrapper (transparent to card author):
const __jsa_config__ = { entity_id: 'sensor.openligadb', title: 'BVB' };
// ... card class definition ...
const __jsa_original_define__ = customElements.define.bind(customElements);
customElements.define = (name, cls) => {
  class WrappedCard extends cls {
    connectedCallback() {
      super.connectedCallback?.();
      if (__jsa_config__ && this.setConfig) this.setConfig(__jsa_config__);
    }
  }
  __jsa_original_define__(name, WrappedCard);
};
```

The card author writes a normal `setConfig(config)` method and accesses `this._config` as usual. No addon-specific code required in the card.

### Error Handling

```
throws: 'No embedded card "<name>" found in script.'   // Block not found
throws: 'Card name "<name>" is invalid.'               // Sanitization failure
throws: 'File write failed: <reason>'                  // Permissions error
throws: 'Lovelace resource registration failed: ...'   // WebSocket error
```

---

## 4. `@card` Script Header Tag

A new `@card` header tag controls installation behavior:

```js
/**
 * @name OpenLigaDB
 * @icon mdi:soccer
 * @card dev
 */
```

| Value | Behavior |
|---|---|
| *(absent)* | Normal: `ha.frontend.installCard()` installs and registers the card. |
| `@card dev` | **Development mode.** `installCard()` does not write any files or register resources. Instead, the decoded card code and current script entity states are routed to the live preview. The script list shows a yellow **DEV** badge. When `@card dev` is removed, the card is installed on the next script start. |

---

## 5. Card Editor

### Opening the Editor

Scripts that contain at least one embedded card block show an additional **"Edit Card"** button in their action button group in the script list. Clicking it opens the card editor tab. If the script contains multiple cards, a dropdown lets the user select which card to edit.

### Editor Tab

The card editor opens as a separate Monaco editor tab alongside the script tab.

- **Header:** `🃏 Card: openligadb-card`
- **Language:** JavaScript with full IntelliSense
- **While open:** the script tab shows a **dirty indicator** — the script file will be updated on save.
- **Save:** re-encodes the card code to Base64, updates the `__JSA_CARD_START__` block in the script file, and updates the version tag if `@version` is set.

### Toolbar & Snippets

The card editor toolbar provides:

| Snippet | Inserts |
|---|---|
| `LitElement` | Full LitElement card boilerplate with `static get properties()`, `render()`, `static get styles()` |
| `HTMLElement` | Minimal HTMLElement card with `connectedCallback()`, `set hass()`, `setConfig()` |
| `setConfig()` | Config method + `getConfigElement()` scaffold stub |
| `getCardSize()` | Standard size method |
| HA Theme vars | Auto-complete list of all HA CSS custom properties (`--primary-color`, `--card-background-color`, etc.) |
| MDI Icon picker | Browse and insert MDI icon names |

### TypeScript Types

The card editor loads type definitions for:
- `HomeAssistant` — `hass.states`, `hass.callService`, `hass.user`, `hass.themes`, etc.
- `LovelaceCard` — `setConfig()`, `getCardSize()`, `getConfigElement()`
- `LovelaceCardConfig` — base config type for extension

IntelliSense inside the card editor is aware of the HA API surface.

---

## 6. `getConfigElement()` Scaffold (High Priority)

When a card defines a config schema, the addon can generate a full `getConfigElement()` implementation automatically.

### Config Schema Definition

Inside the card block, a JSDoc-style schema comment defines the card's configurable fields:

```js
/**
 * @config entity_id {string} required - The entity to display
 * @config title {string} - Card title
 * @config show_graph {boolean} default:true - Show sparkline graph
 * @config max_items {number} default:5 min:1 max:20 - Max rows
 */
class OpenligaCard extends HTMLElement { ... }
```

### Generated Editor Element

The "Generate Config Editor" button in the card editor toolbar reads the schema and inserts a fully functional `getConfigElement()`:

```js
static getConfigElement() {
  // Auto-generated by JS Automations
  class OpenligaCardEditor extends HTMLElement {
    setConfig(config) { this._config = config; this._render(); }
    _render() {
      this.innerHTML = `
        <ha-form
          .schema=${[
            { name: 'entity_id', required: true, selector: { entity: {} } },
            { name: 'title', selector: { text: {} } },
            { name: 'show_graph', selector: { boolean: {} } },
            { name: 'max_items', selector: { number: { min: 1, max: 20 } } },
          ]}
          .data=${this._config}
          @value-changed=${e => this.dispatchEvent(
            new CustomEvent('config-changed', { detail: { config: e.detail.value } })
          )}
        ></ha-form>`;
    }
  }
  customElements.define('openligadb-card-editor', OpenligaCardEditor);
  return document.createElement('openligadb-card-editor');
}
```

Uses HA's built-in `ha-form` component — no external dependencies, consistent look and feel with native HA cards.

---

## 7. Live Preview

### Layout

The card editor has a toggle button to open a **floating preview window**. The window is freely positionable and resizable — the developer drags it to any position on screen and resizes it to test the card at different widths.

```
┌─ Card: openligadb-card ──────────────────────────────────────────────────┐
│  class OpenligaCard extends HTMLElement {                                 │
│    connectedCallback() { ...                                              │
│  }                                                                        │
└───────────────────────────────────────────────────────────────────────────┘

          ╔═ Preview: openligadb-card ══════════════[─][□][×]═╗
          ║                                                    ║
          ║  ┌──────────────────────────────────────────────┐  ║
          ║  │  🏆 BVB Next Match                           │  ║
          ║  │  Mo 14.04 · 18:30 · vs. Bayern München      │  ║
          ║  └──────────────────────────────────────────────┘  ║
          ║                                                    ║
          ║  Entity states:  sensor.openligadb ▼              ║
          ║  state: "upcoming"   [+ add entity]               ║
          ║                                                    ║
          ║  Width: ████████████░░░  320px    [1col][2col][4col]  ║
          ╚════════════════════════════════════════════════════╝
```

**Why floating:** Lovelace cards render differently at 1, 2, or 4 dashboard columns. A floating, resizable window lets the developer test any width without leaving the editor. Position and size persist in `localStorage`.

**Width presets:** Quick buttons snap the preview to standard Lovelace column widths (approx. 180px / 360px / 720px), matching real dashboard layouts.

### Closed Dev Loop (`@card dev` mode)

When `@card dev` is active and the script is running:

1. Script calls `ha.update('sensor.openligadb', ...)` with real API data.
2. The addon captures these state updates and forwards them to the preview iframe as mock `hass` state changes.
3. The card re-renders with live data — without any file installation or browser refresh.

This creates a tight feedback loop: **edit card → see live HA data → adjust → repeat.**

### Mock `hass` Panel

The preview panel shows a collapsible "Entity states" section:

- Entities registered or updated by the running script are added automatically in `@card dev` mode.
- In non-dev mode, the user can add entity IDs manually with arbitrary state/attributes.
- State values persist in `localStorage` per script+card combination.

### Error Reporting

Runtime errors in the preview iframe (thrown by `connectedCallback`, `set hass`, etc.) are caught via `window.onerror` and `unhandledrejection` and forwarded to the addon's log stream as `warn`-level entries:

```
[18:30:27][openligadb-card][Preview] TypeError: Cannot read properties of undefined (reading 'state')
    at OpenligaCard.render (openligadb-card.js:42)
```

---

## 8. Hash-Based Change Detection

Every card installation stores a record:

```json
{
  "openligadb-card": {
    "hash": "a3f8c21b9d...",
    "url": "/local/jsa-cards/openligadb-card.js?v=a3f8c21b",
    "resourceId": "12"
  }
}
```

On each `ha.frontend.installCard()` call:

1. Hash the current decoded card code (SHA-256, first 8 hex chars used for URL).
2. Compare against stored hash.
3. **Match:** return stored URL immediately. No file write, no Lovelace API call.
4. **Mismatch or first run:** write file, update Lovelace resource URL, store new hash.

---

## 9. Card → Script Communication

By default, data flows one way: script → HA entities → `hass.states` → card renders. Two mechanisms provide the reverse channel.

### Option A — HA-Native: Button Entity (Available Today)

The script registers a `button` entity. The card presses it via `hass.callService`. The script handles it with `ha.on()`.

```js
// Script (backend)
ha.register('button.openligadb_refresh', { name: 'Manual Refresh', icon: 'mdi:refresh' });
ha.on('button.openligadb_refresh', async () => {
  ha.log('Manual refresh triggered by card');
  await update();
});
```

```js
// Card (frontend)
set hass(hass) {
  this._hass = hass;
}
connectedCallback() {
  this.querySelector('#refresh-btn').onclick = () => {
    this._hass.callService('button', 'press', { entity_id: 'button.openligadb_refresh' });
  };
}
```

**When to use:** The action is meaningful to HA (can be used in automations, scripts, dashboards). The button entity is visible in the HA UI — which is a feature, not a bug, if the user might want to trigger it from an automation.

**Trade-off:** Every action needs its own HA entity. For purely UI-internal triggers (e.g., "scroll to next page"), this creates unnecessary clutter.

---

### Option B — Direct Channel: `ha.action()` + `__jsa__.callAction()` (Proposed)

A lightweight card→script channel that bypasses HA entirely. No entity is created. The action is invisible to the HA UI and automation engine.

```js
// Script (backend)
ha.action('refresh', async () => {
  ha.log('Manual refresh triggered by card');
  await update();
});

ha.action('select-team', async ({ teamId }) => {
  CONFIG.teamId = teamId;
  await update();
});
```

```js
// Card (frontend) — __jsa__ helper is automatically available in the card context
this.querySelector('#refresh-btn').onclick = () => {
  __jsa__.callAction('refresh');
};

this.querySelector('#team-select').onchange = (e) => {
  __jsa__.callAction('select-team', { teamId: e.target.value });
};
```

#### Transport

`__jsa__.callAction(name, payload?)` sends a custom HA WebSocket message:

```json
{ "type": "jsa/action", "script": "openligadb", "action": "refresh", "payload": {} }
```

The addon's WebSocket handler receives it, looks up the running worker for the script, and posts a `card_action` message into the worker thread. `ha.action()` registers a named handler that fires on receipt.

#### `__jsa__` Helper Injection

The `__jsa__` object is injected into the card's JavaScript at install time (prepended before the card code):

```js
// Injected by JS Automations at card install time
const __jsa__ = {
  scriptId: 'openligadb',
  callAction(name, payload = {}) {
    // Uses the HA WebSocket connection already present in the Lovelace frontend
    if (window.__JSA_WS__) {
      window.__JSA_WS__.sendMessage({ type: 'jsa/action', script: this.scriptId, action: name, payload });
    }
  }
};
```

`window.__JSA_WS__` is set once by the addon's Lovelace resource bootstrap script (installed alongside the first card).

#### Error Handling

| Scenario | Behavior |
|---|---|
| Action name not registered | Addon logs `warn: Unknown action "x" for script "openligadb"` |
| Script not running | Addon responds with error; `callAction` rejects its Promise |
| Handler throws | Error is caught and logged at `error` level in the script's log stream |

#### Return Values (Future)

`callAction` can return a value from the handler for request/response patterns:

```js
// Script
ha.action('get-standings', async () => {
  return await fetchStandings(CONFIG.teamId);
});

// Card
const standings = await __jsa__.callAction('get-standings');
renderStandings(standings);
```

---

### Choosing Between A and B

| | Option A (Button Entity) | Option B (`ha.action`) |
|---|---|---|
| HA visibility | Yes — entity appears in UI | No — invisible to HA |
| Usable in HA automations | Yes | No |
| Payload support | No | Yes |
| Return values | No | Yes (future) |
| Infrastructure cost | None (works today) | New WebSocket handler + worker routing |
| Best for | Refresh, sync, reboot triggers | Multi-action cards, parameterized calls, internal UI state |

Both options can coexist in the same script. Use A for actions that belong in HA's world; use B for actions that are purely between the card and its backend.

---

## 10. Security

| Concern | Mitigation |
|---|---|
| Path traversal in `name` | Sanitize to `[a-z0-9-_]+` only. Write target is always `config/www/jsa-cards/` — a dedicated subdirectory. |
| Overwriting user files | `force: false` default. Script authors must explicitly opt in to overwrite. |
| WebSocket auth | Handled by the existing `haConnection` — no separate credentials. |
| `jsa/action` spoofing | Action handler only fires if the calling user is authenticated to HA. Script can optionally check `ha.action('x', (payload, context) => ...)` where `context.userId` is the HA user who triggered it. |
| Card code execution | Runs in the browser, scoped to the Lovelace frontend. No server-side execution. |

---

## 11. Roadmap: File Linking (External Developers)

When file access is introduced in JS Automations, an alternative to the Base64 block will be supported:

```js
/* __JSA_CARD_START__: openligadb-card
__JSA_CARD_FILE__: /config/www/src/openligadb-card.js
__JSA_CARD_END__ */
```

- The addon reads the linked file at runtime instead of decoding a Base64 block.
- External developers can use VSCode, esbuild, or any other toolchain.
- The card editor tab opens and saves the linked file directly.
- The Base64 block and file reference are mutually exclusive.

---

## 12. Example: Complete Single-Script Integration

```js
/**
 * @name OpenLigaDB — BVB
 * @icon mdi:soccer
 * @description Tracks upcoming BVB matches and displays them as a custom card.
 * @card dev
 * @version 1.0.0
 */

const CONFIG = {
  entity_id: 'sensor.openligadb_bvb',
  teamId: 7,
};

// Register the backend entity
ha.register(CONFIG.entity_id, {
  name: 'BVB Next Match',
  icon: 'mdi:soccer',
  initial_state: 'unknown',
});

// Install the embedded card (skipped in @card dev mode)
await ha.frontend.installCard('openligadb-card', {
  config: { entity_id: CONFIG.entity_id, title: 'BVB' },
});

// Poll the API every 30 minutes
async function update() {
  const data = await fetchMatchData(CONFIG.teamId);
  ha.update(CONFIG.entity_id, data.status, { next_match: data.nextMatch });
}

update();
schedule('*/30 * * * *', update);

/* __JSA_CARD_START__: openligadb-card | v1.0.0
Y2xhc3MgT3BlbkxpZ2FEQkNhcmQgZXh0ZW5kcyBIVE1MRWxlbWVudCB7...
__JSA_CARD_END__ */
```

One file. Zero manual setup. The user installs the script, removes `@card dev`, and the card appears in their Lovelace resource list ready to add to any dashboard.
