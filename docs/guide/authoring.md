# Authoring Scripts

How a well-formed JS Automations (JSA) script looks and why. This page is the one place that ties the conventions together — header tags, script structure, native entities, config, cards — so a human or an AI assistant writes scripts that feel like the rest of the project. Details for each topic live in the linked guides and the [API Reference](../API_REFERENCE.md).

## The philosophy in five rules

1. **A script is one file.** Metadata (header), logic, and optionally a Lovelace card all live together. No YAML, no separate repos.
2. **Make things real HA entities.** Use `ha.register()` / `@expose` so state shows up natively in Home Assistant (dashboards, history, automations) instead of hiding in script variables. See [Native Entities](./native-entities.md).
3. **Config is data, not code to edit.** Anything a user might tune goes into one typed config object, persisted with `ha.persistent()`/`ha.store`, editable from the UI — not scattered magic numbers.
4. **Declare what you use.** Sensitive capabilities are declared with `@permission`; credentials live in the store (see [Credentials](#credentials)), never in source.
5. **Fail loudly and clean up.** Log with `ha.log/warn/error`, handle errors, and let Mark-and-Sweep remove entities you no longer register.

## Script structure

Always in this order:

1. **Header** — the JSDoc block (first thing in the file)
2. **Types** — `interface`/`type` declarations (TypeScript files)
3. **Config block** — one typed constant with defaults
4. **Logic** — registration, triggers, actions, helpers

```typescript
/**
 * @name Garage Watch
 * @icon mdi:garage
 * @description Warns when the garage door stays open too long
 * @label Security
 */

interface GarageConfig {
  doorEntity: string;
  maxOpenMinutes: number;
  notifyTarget: string;
}

// Seed values on first run. After that the store entry is the source of truth —
// edit it in the Store Explorer, not here.
const DEFAULT_CONFIG: GarageConfig = {
  doorEntity: 'cover.garage_door',
  maxOpenMinutes: 15,
  notifyTarget: 'notify.mobile_app_my_phone',
};

const config = ha.persistent<GarageConfig>('garage_watch_config', DEFAULT_CONFIG);

ha.register('binary_sensor.garage_open_too_long', {
  name: 'Garage open too long',
  icon: 'mdi:garage-alert',
  device_class: 'problem',
});

let timer: ReturnType<typeof setTimeout> | null = null;

ha.on(config.doorEntity, (e) => {
  if (timer) clearTimeout(timer);
  if (e.state === 'open') {
    timer = setTimeout(() => {
      ha.update('binary_sensor.garage_open_too_long', 'on');
      ha.notify('Garage door has been open too long', { target: config.notifyTarget });
    }, config.maxOpenMinutes * 60_000);
  } else {
    ha.update('binary_sensor.garage_open_too_long', 'off');
  }
});

ha.log('Garage Watch started.');
```

**Config naming:** use `DEFAULT_CONFIG` when the config is persisted via `ha.persistent()`/`ha.store` (the constant only seeds the first run). Use plain `CONFIG` when it is a fixed constant that is never persisted. Pass the type explicitly (`ha.persistent<MyConfig>(...)`) so the stored shape wins over inference.

## Header tags

The header is the first `/** ... */` block in the file. One tag per line. `.blocks` (Blockly) files keep the same fields in their `jsa` JSON key instead.

| Tag            | Value                                                                              | Purpose                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@name`        | text                                                                               | Display name in the sidebar. Falls back to the file name.                                                                     |
| `@icon`        | `mdi:...`                                                                          | Sidebar icon. Default `mdi:script-text`.                                                                                      |
| `@description` | text (may span lines)                                                              | Short description; also used as the card's name in Lovelace's "Add Card" picker.                                              |
| `@label`       | text                                                                               | Groups scripts in the sidebar. If an HA Label with that name exists it lends its icon and color.                              |
| `@area`        | HA area id                                                                         | Area assigned to the entities this script registers/exposes. About where the _entity_ lives in HA, not IDE organization.      |
| `@loglevel`    | `debug` \| `info` \| `warn` \| `error`                                             | Minimum log level for this script. Default `info`.                                                                            |
| `@npm`         | package names, comma/space separated                                               | npm packages installed automatically.                                                                                         |
| `@include`     | library file names, comma/space separated                                          | Shared global libraries (`.js`/`.ts`) made available to this script.                                                          |
| `@expose`      | `switch` (default) \| `button`                                                     | Exposes the script itself as an entity: `switch` = on while running; `button` = press (re)starts it.                          |
| `@permission`  | `network`, `fs:read`, `fs:write`, `fs` (= read + write), `exec`, `webhook`, `mqtt` | Declares capabilities. Undeclared use is flagged in the script list; `network`, `fs:*` and `exec` can be enforced at runtime. |
| `@card`        | _(none)_ \| `dev`                                                                  | Marks the file as a Script Pack with a Lovelace card. `dev` = preview only, nothing installed.                                |

Rules:

- The header must be the **first** block in the file (TypeScript triple-slash directives may precede it).
- Only write tags you need. Omit defaults (`@loglevel info`, `@expose` if not wanted).
- Read your own header at runtime with `ha.getHeader('filename')` — useful for deriving entity IDs from the file name.
- Use **plain `@card`** only once the card is ready; develop with `@card dev`.

## Conventions

### Entities

- Create your own entities with `ha.register()` (domains: `sensor`, `binary_sensor`, `switch`, `select`, `number`, `text`, `button`); update with `ha.update()`.
- Group related entities into one device with the `device` option. Remember: with `device` set, HA derives the entity ID from device + entity name slugs.
- Entities a script stops registering are removed on its next run (Mark-and-Sweep). For dynamic sets, call `ha.unregister()` immediately.
- Use `stale_ok: true` for values that stay meaningful while the script is stopped.
- Control other devices through `ha.call()` / `ha.entity()`; read with `ha.getState()`, `ha.getStateValue()`, `ha.states`.

### State and config

- `ha.persistent(key, default)` for config and runtime state that must survive restarts (auto-saves on mutation).
- `ha.store` for values shared across scripts. Pass `true` / `{ secret: true }` to store a value as a secret — encrypted on disk (when store encryption is on) and masked in the UI. **Never hard-code tokens or passwords in source** — see [Credentials](#credentials).
- Keep user-tunable values in the config object; keep hard-wired internals as `const`s next to it.

### Credentials

Credentials (API keys, passwords, tokens) are never written into the script. Instead the script **creates the place for them on its first start**, leaves it empty and asks the user to fill it in:

```typescript
interface WeatherConfig {
  apiKey: string; // credential — stays empty until the user enters it
  city: string;
}

const DEFAULT_CONFIG: WeatherConfig = { apiKey: '', city: 'Berlin' };
const config = ha.persistent<WeatherConfig>('weather_config', DEFAULT_CONFIG); // key exists after the first start

function start() {
  ha.log(`Weather for ${config.city}`);
  // ... the feature that needs config.apiKey
}

if (config.apiKey) {
  start();
} else {
  ha.warn(
    'API key missing — fill in "apiKey" of the store entry "weather_config" (Store Explorer), then restart the script.'
  );
  ha.notify(
    'The weather script needs an API key. Open the Store Explorer, edit "weather_config", enter "apiKey" and restart the script.',
    {
      title: 'Weather script',
      persistent: true,
    }
  );
}
```

- For a **single value** use a key with an empty value: `const apiKey = ha.persistent<string>('weather_api_key', '');` (read and write `apiKey.value`; keep the type argument, otherwise TypeScript infers the literal type `''`).
- Use **empty** defaults, not placeholders like `'YOUR_KEY_HERE'` — an empty value is easy to test for and cannot be mistaken for a real credential.
- While a required credential is empty: warn in the log, raise a **persistent notification** that names the store key, and do not start the feature that needs it. Do not crash or retry in a loop.
- `ha.persistent` values are ordinary store values: visible in the Store Explorer and written unencrypted to `store.json`. For especially sensitive values use a **secret** instead — `ha.store.set('weather_api_key', '', true)` on first start (only if `ha.store.get(...)` is still `undefined`) — which is masked in the UI and encrypted at rest when store encryption is switched on.

### Triggers and timing

- Reactive: `ha.on(entityId, callback)`, `ha.waitFor` / `ha.waitUntil`.
- Time-based: `schedule('cron expression', callback)`, `sleep(ms)`.
- Dashboard buttons / external triggers: `ha.action(name, handler)`, `ha.onEvent` / `ha.fireEvent`, `ha.onWebhook` (needs `@permission webhook`).

### Language (i18n)

- User-facing strings that depend on language: `ha.localize({ en: '...', de: '...' }, 'fallback')`; current language in `ha.language`.
- Code comments are always English.

### Notifications

- Fire-and-forget: `ha.notify(message, { title, target, persistent })`.
- Actionable: `await ha.ask(message, { actions, timeout, defaultAction })`.
- Details: [Notifications](./notifications.md).

### Errors and logging

- `ha.debug` / `ha.log` / `ha.warn` / `ha.error` (error marks the script as crashed). Use `ha.onError` for a global handler and `ha.isConnected()` / `ha.onConnectionChange` for connection state.
- Put network calls behind timeouts (`AbortController`) and `try/finally`.

## Cards (Script Packs)

A card is a plain Web Component shipped inside the script file. The pieces:

1. **Header:** `@card` (or `@card dev` while developing).
2. **Script side:** register the entities the card shows, keep them updated, and expose each button as `ha.action(name, handler)`. Call `ha.frontend.installCard()` (optionally with a `config` that pre-fills the "Add Card" picker).
3. **Card side:** a Web Component. Home Assistant pushes `hass` into it; read entities from `hass.states[...]`. Call `__jsa__.connect(hass)` once and trigger actions with `await __jsa__.callAction(name, payload)`. The `__jsa__` object is injected by JSA — don't define it.

The two directions are separate one-way channels: **script → card** happens through normal HA entities, **card → script** through `callAction` ↔ `ha.action`. They never call each other directly. Full explanation: [Script Packs](./card-packs.md).

### Card source in plain form

This is what you write (in the IDE's card editor tab, or via the `write_card` tool). It is plain JavaScript:

```javascript
class CounterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._last = null;
  }

  setConfig(config) {
    this._config = config;
    this._entityId = 'number.' + __jsa__.scriptId;
  }

  set hass(hass) {
    __jsa__.connect(hass);
    const stateObj = hass.states[this._entityId];
    const value = stateObj ? parseInt(stateObj.state, 10) || 0 : 0;
    if (value === this._last) return; // avoid needless re-render
    this._last = value;
    this._render(value);
  }

  _render(value) {
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 24px 16px; text-align: center; }
        .row { display: flex; align-items: center; justify-content: center; gap: 24px; }
        button { background: var(--primary-color); color: #fff; border: none; border-radius: 50%;
                 width: 52px; height: 52px; font-size: 1.6em; cursor: pointer; }
        .val { font-size: 3em; font-weight: 700; color: var(--primary-text-color); }
      </style>
      <ha-card>
        <div class="row">
          <button id="dec">−</button>
          <div class="val">${value}</div>
          <button id="inc">+</button>
        </div>
      </ha-card>`;
    root.getElementById('dec').onclick = () => __jsa__.callAction('decrease', {}).catch(() => {});
    root.getElementById('inc').onclick = () => __jsa__.callAction('increase', {}).catch(() => {});
  }

  getCardSize() {
    return 2;
  }
  static getStubConfig() {
    return {};
  }
}

try {
  customElements.define('counter-card', CounterCard);
} catch (_) {}
```

**The `__JSA_CARD__` block:** in the saved file the card source sits in a trailing `/* __JSA_CARD__ ... __JSA_CARD_END__ */` comment as Base64. Never write or edit that block by hand — the card editor tab (and the `write_card` MCP tool) encode and decode it for you. See `examples/counter_card.ts` for the complete script that goes with the card above.

Style guidance for cards: use Home Assistant CSS variables (`--primary-color`, `--primary-text-color`, ...) so the card follows the user's theme, use a Shadow DOM, avoid framework dependencies, and keep first-time defaults sensible via `getStubConfig()` / `installCard({ config })`.

## Checklist before saving a script

- [ ] Header first; only needed tags; `@permission` for network / fs / exec / webhook / mqtt
- [ ] Order: header → types → config → logic
- [ ] Config object typed, persisted if user-tunable; credentials are **empty** fields of the persisted config (or `ha.store` secrets), never in source; a warning + persistent notification while they are empty
- [ ] Entities created with `ha.register()`; IDs predictable (no `device` option if the exact ID matters)
- [ ] Timeouts and error handling around external calls
- [ ] Language-dependent strings via `ha.localize`; comments in English
- [ ] If a card: `@card dev` while iterating, plain `@card` when done; actions named and matched on both sides

## See also

- [API Reference](../API_REFERENCE.md) — every `ha.*` function
- [Native Entities](./native-entities.md), [Script Packs](./card-packs.md), [Notifications](./notifications.md), [Creation Wizard](./creation-wizard.md), [Script Versioning](./script-versioning.md)
- `examples/` — runnable reference scripts (`hello_world.js` is the smallest)
