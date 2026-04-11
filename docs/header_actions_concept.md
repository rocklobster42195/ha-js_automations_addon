# Concept: Header Action Buttons

## Motivation

Scripts in JS Automations can register native HA entities (`ha.register()`). A common pattern is a `button` entity that triggers a script action — e.g. "Start Backup Now" or "Sync Config". Currently, triggering such an entity requires leaving the IDE and opening the HA dashboard.

Header Action Buttons close this gap: up to 3 configurable entity buttons appear in the sidebar header, permanently visible, right-aligned. One click calls the HA service directly from the IDE.

---

## Layout

```
┌───────────────────────────────────────────────────────┐
│ 🤖 JS AUTOMATIONS  v2.x   [+][DB][⚙]   [⚡][🔄][🗄] │
└───────────────────────────────────────────────────────┘
                             ↑             ↑
                    Existing group       Header Actions (new)
                    unchanged            right-aligned, up to 3
```

The existing `.header-actions` group (New Script, Store Explorer, Settings) stays together and unchanged. The new `#header-entity-actions` div is a separate flex element pushed to the right via `margin-left: auto`.

---

## Configuration

Three `entity-picker` settings are added to the existing `statusbar` section of `settings-schema.js`:

| Key | Description |
|---|---|
| `header_action_1` | First entity slot (empty = hidden) |
| `header_action_2` | Second entity slot |
| `header_action_3` | Third entity slot |

No label, no additional options per slot. Empty slots are simply not rendered.

---

## Supported Entity Domains

| Domain | Behavior on click | State |
|---|---|---|
| `switch` | Toggles: `switch.turn_on` / `switch.turn_off` | ON / OFF |
| `button` | Presses: `button.press` | stateless |
| `input_button` | Presses: `input_button.press` | stateless |

Other domains can be added later. Unknown domains default to a press-style interaction.

---

## Icon Logic

Icon resolution priority (highest first):

1. `state.attributes.icon` — HA native icon attribute (format: `mdi:backup-restore` → class `mdi-backup-restore`)
2. Domain default:

| Domain | ON / Active | OFF / Inactive |
|---|---|---|
| `switch` | `mdi-toggle-switch` | `mdi-toggle-switch-off` |
| `button` | `mdi-gesture-tap-button` | `mdi-gesture-tap-button` |
| `input_button` | `mdi-gesture-tap-button` | `mdi-gesture-tap-button` |
| (fallback) | `mdi-flash` | `mdi-flash-off` |

---

## State & Color

Color is resolved in priority order:

1. `state.attributes.rgb_color` → `rgb(r, g, b)`
2. `state.attributes.icon_color` → used directly as CSS color string
3. Active fallback: `var(--primary-color, #03a9f4)`
4. Inactive (switch OFF): `var(--secondary-text-color, #777)`

Button entities are always rendered in active color (no ON/OFF state).

Switch entities reflect their current state: ON = colored, OFF = gray.

The tooltip (`title` attribute) shows the entity ID, so the user always knows what they're clicking.

---

## Interaction

### Click Flow

```
User clicks button
  → determine domain from entity_id
  → if switch: check current state → turn_on / turn_off
  → if button / input_button: press
  → POST /api/ha/call-service
  → optimistic UI update (icon color flips immediately)
  → confirmed by next ha_state_changed WebSocket event
```

### Optimistic Update

For switches, the icon color flips immediately on click without waiting for the HA confirmation. The next `ha_state_changed` event corrects it if the actual state differs.

---

## Backend

### New Endpoint

`POST /api/ha/call-service` added to `js_automations/routes/ha-routes.js`:

```js
router.post('/call-service', async (req, res) => {
    const { domain, service, entity_id, service_data = {} } = req.body;
    await haConnector.callService(domain, service, { entity_id, ...service_data });
    res.json({ ok: true });
});
```

`haConnector.callService()` already exists in `core/ha-connection.js:259`.

---

## i18n

Three new keys under `settings.statusbar` in `locales/en/` and `locales/de/`:

| Key | EN | DE |
|---|---|---|
| `header_action_1` | Header Action 1 | Header-Aktion 1 |
| `header_action_2` | Header Action 2 | Header-Aktion 2 |
| `header_action_3` | Header Action 3 | Header-Aktion 3 |
| `header_action_desc` | HA entity to show as a quick-action button in the sidebar header (switch or button). | HA-Entity als Schnellzugriff-Button im Sidebar-Header (switch oder button). |

---

## Implementation Roadmap

| Phase | Files | Change |
|---|---|---|
| 1 — Backend | `routes/ha-routes.js` | `POST /api/ha/call-service` |
| 2 — Settings | `core/settings-schema.js` | 3× entity-picker in `statusbar` section |
| 3 — HTML | `public/index.html` | `<div id="header-entity-actions">` after `.header-actions` |
| 4 — JS | `public/js/statusbar.js` | `initHeaderActions()`, `updateHeaderAction()`, `triggerHeaderAction()`, `getEntityColor()` |
| 5 — CSS | `public/css/style.css` | `#header-entity-actions`, button hover/active states |
| 6 — i18n | `locales/en/` + `locales/de/` | 4 new keys |

---

## Not in Scope

- Labels for action buttons (icon + tooltip is sufficient)
- More than 3 slots
- Drag-and-drop reordering
- Non-switch/button domains (lights, covers, etc.)
- Making existing statusbar custom slots interactive (separate feature)
