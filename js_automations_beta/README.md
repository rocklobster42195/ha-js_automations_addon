# JS Automations (Beta)

This is the **beta channel** of the [JS Automations](https://github.com/rocklobster42195/ha-js_automations_addon) add-on. It receives pre-release builds (`x.y.z-beta.n`) for testing before they are promoted to the stable add-on.

> [!WARNING]
> The beta add-on shares its scripts, libraries, data, and the JSA store with the stable add-on (both use `/config/js-automations`). **Never run both add-ons at the same time** — the add-on detects a running sibling on startup and waits until it is stopped, but you should stop the stable add-on yourself before starting the beta.

**Typical flow:**

1. Stop *JS Automations* (stable).
2. Start *JS Automations (Beta)*.
3. Test.
4. Stop the beta, start the stable add-on again.

When no beta cycle is active, this add-on points at the latest stable image.
