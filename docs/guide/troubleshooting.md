# Troubleshooting & FAQ

Common questions and problems, with the place to look first. For the MCP server there is a separate table in the [MCP guide](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md#troubleshooting).

## Contents

- [My native entities disappear or stay unavailable (MQTT)](#my-native-entities-disappear-or-stay-unavailable-mqtt)
- [Ports: which ones are used, and what to do about a conflict](#ports-which-ones-are-used-and-what-to-do-about-a-conflict)
- [Nabu Casa and remote access](#nabu-casa-and-remote-access)
- [A script stops, does not start or says "restart protection"](#a-script-stops-does-not-start-or-says-restart-protection)
- [Safe Mode](#safe-mode)
- [Stable and Beta add-on](#stable-and-beta-add-on)
- [Secrets are unreadable after switching add-ons](#secrets-are-unreadable-after-switching-add-ons)
- [Where are my files?](#where-are-my-files)
- [Still stuck?](#still-stuck)

---

## My native entities disappear or stay unavailable (MQTT)

Entities created with `ha.register()` and scripts exposed with `@expose` use **MQTT Discovery**, so they need an MQTT broker in Home Assistant, for example the [Mosquitto add-on](https://github.com/home-assistant/addons/tree/master/mosquitto) and the MQTT integration.

- **No broker:** registered entities are gone after a Home Assistant restart, because nothing keeps them. A script that uses MQTT (it is exposed, or it calls `ha.mqtt`) shows a small **orange dot** on its icon in the list while the add-on is not connected to the broker.
- **Broker present, but JSA is not connected:** open **Settings → MQTT Broker**, switch on **Enable MQTT** and let the add-on import the connection settings from Home Assistant. If you use a separate broker, enter its address and login there.
- **After a restart an entity is `unavailable`:** that is expected while its script is stopped, unless the script was registered with the option to stay available. See [Native Entities](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/native-entities.md). Start the script, or check its log for an error.
- **Two entities with the same name, one with the suffix `_2`:** a leftover entry in the Home Assistant entity registry is in the way. JSA removes the stale entry on the next start of the script; if it stays, remove the old entity under **Settings → Devices & services → Entities** and restart the script.

`ha.mqtt.publish()` and `ha.mqtt.subscribe()` (direct broker access) and `ha.onWebhook()` need no `@permission network`.

## Ports: which ones are used, and what to do about a conflict

| Port | Used for                                                                                          | Reachable from                                |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 3000 | The web interface, through Home Assistant's sidebar (**Ingress**). No host port is opened for it. | Home Assistant only                           |
| 3001 | Webhook receiver (`ha.onWebhook`)                                                                 | Your network, and the internet if you open it |
| 3002 | MCP server for AI clients (off by default)                                                        | Your network                                  |

**Another add-on or service already uses 3001 or 3002:**

1. Open the add-on page in Home Assistant, tab **Configuration**, section **Network**.
2. Change the **host port** for 3001 or 3002 to a free one. The port inside the add-on stays as it is, only the one outside changes.
3. Restart the add-on. Use the new host port in webhook URLs and in the MCP endpoint (the MCP panel shows the endpoint; for a changed port, enter the right address under **External URL** if the shown one is wrong).

**Stable and Beta use the same ports.** Stop one before you start the other, see [Stable and Beta add-on](#stable-and-beta-add-on). The MCP panel retries every 15 seconds while the port is still taken ("not running yet").

## Nabu Casa and remote access

- The **web interface** works through Nabu Casa and the Home Assistant app, because it uses Ingress.
- **Webhooks do not work through the Nabu Casa tunnel.** The webhook receiver has its own port (3001). Use a reverse proxy, a Cloudflare tunnel or a port forward for that port, and prefer an **IP allowlist** per webhook when the sender publishes its addresses.
- **MCP is not meant to be reachable from the internet.** Claude Desktop reaches it over your home network or a VPN. Web connectors that need public HTTPS and OAuth cannot use it. If you do put it behind a proxy, set **External URL** and the proxy settings in **Settings → MCP Server** and read [Network and security](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/mcp.md#network-and-security) first.

## A script stops, does not start or says "restart protection"

1. **Look at the log** (the **Logs** tab, or the log line under a script in the mobile view). A script that ends with an error shows a red icon in the list; the check mark on its row acknowledges the error.
2. **"Restart protection":** when a script crashes again and again within a short time, JSA refuses further starts so that it does not loop. Fix the error first, then wait out the time window and start it again. The numbers are **Max Restarts** and **Time Window** under **Settings → Danger Zone**.
3. **A script runs but nothing happens:** check that the entity IDs exist (`ha.states['…']` offers your real entities as you type) and that the handler is not waiting for a state that never changes. `ha.log()` at the start of a handler is the quickest test.
4. **`PermissionDeniedError`:** the script uses network, files or a shell without declaring it. Add `@permission network` (or `fs:read`, `fs:write`, `exec`) to the header, see [Security model](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/security.md).
5. **`ha.fs` is missing:** the filesystem API is switched off by default. Enable **Enable Filesystem Access (ha.fs)** under **Settings → Danger Zone**.
6. **A script keeps dying while it runs a long time:** there is a per-script memory limit under **Settings → Danger Zone** (**Memory Limit per Script**). Look for an array or cache in the script that only ever grows.

## Safe Mode

If the add-on crashes repeatedly while starting (a "bootloop"), JSA stops **all scripts** and shows a red **SAFE MODE ACTIVE** banner, so that a broken script cannot keep taking the system down.

1. Find the script that causes it (check the log of the last start) and fix or remove it.
2. Click **Exit Safe Mode** in the banner. Scripts do not start by themselves afterwards: start them one by one.

## Stable and Beta add-on

Both add-ons share the same scripts folder, libraries, store data and ports. **Never run both at the same time.** Stop **JS Automations**, then start **JS Automations (Beta)**, and the other way round when you go back. How the two coexist is described in the [beta add-on README](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/js_automations_beta/README.md).

## Secrets are unreadable after switching add-ons

If you switched on **Encrypt ha.store Secrets**, the encryption key lives in each add-on's private data and is not shared. Encrypted secrets written by the beta cannot be read by the stable add-on and the other way round. Switch the option off **before** you change add-on or go back to an older version. The key is also lost when the add-on is uninstalled.

## Where are my files?

- **Scripts, libraries, cards and notes:** in the Home Assistant config folder under `/config/js-automations/` (reachable through the Samba or SSH add-on). Scripts are plain `.js` / `.ts` files; Lovelace cards of script packs are files in `cards/`.
- **Version history:** a local Git repository in the same folder, see [Script Versioning](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/script-versioning.md).
- **Backups:** see [Backup & Restore](https://github.com/rocklobster42195/ha-js_automations_addon/blob/main/docs/guide/backup-restore.md).

## Still stuck?

[Open an issue](https://github.com/rocklobster42195/ha-js_automations_addon/issues) and include the add-on version (top left in the web interface), whether you run Stable or Beta, the relevant log lines, and the script header if a single script is involved. Remove tokens and passwords from anything you paste.
