# Script Packs (JSA Card Packs)

A **Script Pack** is a single `.js`/`.ts` file that bundles two things that normally live in separate worlds:

1. **Backend logic** — a regular JSA script (`ha.on()`, `ha.register()`, `ha.action()`, NPM packages, TypeScript types, persistent state — everything covered in [Native Entities](./native-entities.md)).
2. **A Lovelace card** — a plain Web Component (no framework required), embedded directly in the same file.

The add-on extracts the card on install, writes it to `config/www/jsa-cards/`, and registers it as a Lovelace resource automatically — no HACS, no manual resource management, no separate repo for the card half of a mini-integration.

Traditionally, automation logic and its dashboard card are maintained, versioned, and deployed independently, and they talk to each other awkwardly — via entities, MQTT helpers, or REST hooks. A Script Pack collapses that boundary into one file.

## How it works: two one-way channels

This is the part that isn't obvious from looking at the code, so it's worth stating plainly: **your script and your card never call each other's functions directly.** They communicate through two separate, one-way channels — get this mental model right and everything else falls into place.

**Script → Card (showing data): plain Home Assistant, nothing JSA-specific.** Every Lovelace card — custom or built-in — receives a `hass` object pushed into it by Home Assistant's own frontend, via a `set hass(hass)` setter, every time _any_ entity's state changes anywhere in your HA instance. Your script doesn't push data "into the card" directly. It just calls `ha.register()`/`ha.update()` on a normal HA entity, same as any other script; HA's own state machine changes; Lovelace re-pushes `hass` into every card on the dashboard, including yours; your card reads `hass.states['sensor.your_entity']` and re-renders. From the card's point of view, an entity your script maintains is indistinguishable from any other HA entity.

**Card → Script (triggering actions): this is what JSA actually built.** There's no standard way for a Lovelace card to call back into an arbitrary running script — so a button click needs `__jsa__.callAction(name, payload)` on the card side, matched by `ha.action(name, handler)` on the script side. It's a full round trip over the HA event bus and returns a Promise, so the card can `await` a result (see [The `__jsa__` Bridge](#the-__jsa__-bridge) below for exactly how).

## Writing one, step by step

1. **Write the backend half like any other script.** Register whatever entity/entities the card should display (`ha.register()`), and keep them updated (`ha.on()`, `schedule()`, an API poll, ...).
2. **Decide what the card's buttons should be able to trigger**, and expose each as its own named action:
   ```javascript
   ha.action('refresh', async () => {
     const data = await fetchLatestScore();
     ha.update('sensor.bundesliga_score', data.score, { home: data.home, away: data.away });
   });
   ```
3. **Write the card as a plain Web Component.** In `set hass(h)`, read the entities you registered and render them; call `__jsa__.connect(h)` once; wire button clicks to `await __jsa__.callAction('refresh')`.
4. **Iterate with `@card dev`** and the card editor tab's live preview — no install needed yet (see [Card states](#card-states-in-the-script-list) below).
5. **Switch to plain `@card` when ready.** The card installs for real: it's written to `config/www/jsa-cards/`, registered as a Lovelace resource, _and_ added to Lovelace's own "Add Card" picker (see [Adding it to a dashboard](#adding-it-to-a-dashboard) below) — no manual YAML required.

## Authoring a Script Pack

Add `@card` (or `@card dev` for development mode) to the script header, then append a `__JSA_CARD__` block containing your Web Component source, Base64-encoded:

```javascript
/**
 * @name Bundesliga Live
 * @npm axios
 * @card dev
 */

ha.register('sensor.bundesliga_score', { name: 'BL Score' });

ha.action('refresh', async () => {
  // fetch and update the entity
});

/* __JSA_CARD__
<base64-encoded Web Component source>
__JSA_CARD_END__ */
```

You never hand-encode that Base64 block yourself — the IDE has a dedicated **card editor tab** where you write plain JavaScript/HTML; the tab handles the encoding when it saves. The same tab also gives you a **live preview panel** with real HA entity data and width presets that simulate actual Lovelace column sizes, so you can iterate on the card's appearance without installing anything.

## The `__jsa__` Bridge

Every installed card gets a `const __jsa__` object injected server-side, ahead of your card's own source (it is not part of the Base64 you write):

```javascript
class MyCard extends HTMLElement {
  set hass(h) {
    __jsa__.connect(h); // one-time setup
    this.render(h.states['sensor.bundesliga_score']);
  }

  async onRefreshClick() {
    await __jsa__.callAction('refresh');
    // hass is pushed again automatically once the action completes
  }
}
customElements.define('my-card', MyCard);
```

- **`__jsa__.connect(hass)`** subscribes to the HA WebSocket connection once and listens for the script's action results.
- **`__jsa__.callAction(name, payload)`** fires a `jsa_action` event on the HA event bus. Your script receives it through `ha.action(name, handler)` (see the [API Reference](../API_REFERENCE.md)); the handler's return value flows back as the resolved value of the `callAction()` promise. Requests time out after **20 seconds** if the script never responds.

Use `ha.action()` for this targeted card → script round trip. For a fire-and-forget broadcast to any number of listeners with no return value, use `ha.fireEvent()`/`ha.onEvent()` instead.

## Adding it to a dashboard

Once installed (plain `@card`, not `@card dev`), the card is registered in Lovelace's own **"Add Card" picker** — `installCard()` pushes an entry onto `window.customCards` using the script's `@name`/`@description`, so it shows up there like any built-in card, not just as raw YAML. Either pick it visually, or add it by hand with `type: custom:<tag-name>` (the tag it registers via `customElements.define()`).

Either way, Home Assistant itself calls your card's standard `setConfig(config)` with whatever you entered on the dashboard — this is plain Lovelace card behavior, not something JSA wraps or intercepts for a normal install.

**Multi-instance cards** (the same card added to a dashboard more than once, each representing a different dynamic thing) can additionally call `__jsa__.updateConfig(config)` from `setConfig()`. Passing an `instanceId` (plus optional `entityId`/`autoDelete: false`) starts an hourly `__jsa__`-side heartbeat that calls `ha.action('heartbeat', ...)` on your script. Nothing happens automatically beyond that call arriving, though — your own `'heartbeat'` handler is what has to track which `instanceId`s are still checking in and `ha.unregister()` the entity for any that stop. This is an advanced pattern; most cards don't need it.

### Suggesting a default config for the picker

`ha.frontend.installCard({ config: {...} })` doesn't change how the card behaves once it's on a dashboard — a dashboard's own config, entered through `setConfig()`, always wins there. What it _does_ do is pre-fill the "Add Card" picker's config editor the first time someone adds your card, via an injected `getStubConfig()` (only if the card doesn't already define its own):

```javascript
await ha.frontend.installCard({
  config: { entity_id: 'sensor.bundesliga_score', title: 'BMG' },
});
```

Pick sensible defaults here (an entity_id the card actually reads, a reasonable title) so a first-time user doesn't land on a blank/broken card before configuring anything.

## Card states in the script list

The script list shows a dashboard icon (`mdi:view-dashboard-outline`) next to any script with a card block, colored by install state:

- **Orange** — `@card dev`: the card block exists, but this is dev-mode — preview only, nothing is written to Lovelace.
- **Dark gray** — the card block exists but hasn't been installed yet.
- **Light gray** — the card is installed and active in Lovelace.

Switch from `@card dev` to plain `@card` (and restart the script, or click the install action) once you're happy with the preview and want it live on your dashboard.

## Caching external assets

Cards that show external images — team logos, album art, weather icons — shouldn't hotlink the source URL directly: a hotlinked image depends on that source staying up and fast, which matters a lot more on a flaky kiosk dashboard tablet than in a normal browser. `ha.frontend.cacheAsset(url)` downloads and caches it once under `config/www/`, returning a stable local URL to store on the entity instead:

```javascript
const localUrl = await ha.frontend.cacheAsset(team.teamIconUrl);
ha.update('sensor.bundesliga_score', 'scheduled', { team_icon: localUrl });
```

See the [API Reference](../API_REFERENCE.md#frontend--card-assets-hafrontend) for `installCard()`/`cacheAsset()` options (force refresh, TTL, max size).

## Under the hood

If you're debugging a Script Pack or curious how installation actually works — hashing, the Lovelace resource lifecycle, the preview endpoint's mock `hass` — see [TECH-README §18, Card Manager](../TECH-README.md#18-card-manager-script-pack-system).
