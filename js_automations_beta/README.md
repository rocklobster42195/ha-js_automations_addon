# JS Automations (Beta)

This is the **beta channel** of the [JS Automations](https://github.com/rocklobster42195/ha-js_automations_addon) add-on. It receives pre-release builds (`x.y.z-beta.n`) for testing before they are promoted to the stable add-on.

> [!WARNING]
> The beta add-on shares its scripts, libraries, data, and the JSA store with the stable add-on (both use `/config/js-automations`). **Never run both add-ons at the same time.** Both map webhook port 3001, so the Supervisor refuses to start one while the other is running ("port 3001 is already in use") — this is expected and by design. Stop the stable add-on first, then start the beta.

**Typical flow:**

1. Stop *JS Automations* (stable).
2. Start *JS Automations (Beta)*.
3. Test.
4. Stop the beta, start the stable add-on again.

> [!NOTE]
> **Secret encryption is opt-in in this beta.** `ha.store` secrets are encrypted at rest only after you set **`store_encryption`** to `true` in the add-on's Configuration and restart. Until then secrets are stored as before.

> [!IMPORTANT]
> **Before you go back to a version without secret encryption** (stable older than the release that introduced it): open the beta add-on's **Configuration**, set **`store_encryption`** back to `false`, and restart the beta once. It decrypts all `ha.store` secrets back to plain values in `store.json`, which the older version can read. Skipping this leaves the secrets unreadable there, because the key lives in the beta add-on's private data and is lost when it is uninstalled.
>
> On the first start with encryption, a plaintext copy of the store is kept as `.storage/store.json.pre-encryption` (excluded from backups and git). It is removed automatically after 14 days, or right after you switch encryption off.

When no beta cycle is active, this add-on points at the latest stable image.
