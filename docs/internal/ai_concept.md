# KI-Unterstützung in JS Automations — MCP-Server

Stand: 2026-10-28 (Grill-Session, noch nichts gebaut). Ersetzt das frühere Konzept mit Chat-Panel, BYOK und `ha.ai()`.

Release: **"With A Little Help From My Friends"** (`npm run ship:minor`).

---

## 1. Idee

JSA bekommt einen **MCP-Server**. Ein externer KI-Client (hauptsächlich die Claude-Desktop-App, auch Claude Code, Cursor u. a.) ruft JSA-Tools auf: Skripte lesen und schreiben, steuern, Logs und Fehler lesen. Die Denkarbeit macht der Client des Users. JSA braucht dafür **keinen eigenen API-Key, kein Chat-Panel und keinen Chat-/Memory-Store**.

Entfällt gegenüber dem alten Konzept: BYOK-Anbieteranbindung, Editor-Chat-Panel, API-Key-Masking, Chat-Verlauf, KI-Memory, Prompt-Caching-Kontext.
Zurückgestellt: `ha.ai()` als Laufzeit-API für Skripte (z. B. `smart_watering.ts`) — eigenes Thema, nicht Teil dieses Releases.

## 2. Nicht-Ziele (v1)

- `run_repl` (Code in laufendem Skript ausführen) — später, eigene Schaltergruppe, default aus
- Breakpoints / Watch über MCP — nie (zu interaktiv)
- OAuth / Cloud-Connector (öffentliches HTTPS nötig) — nicht v1
- Mehrere Tokens (pro Client) — nicht v1
- Blockly-Skripte — weder lesen noch schreiben

## 3. Transport und Anbindung

- **Streamable HTTP** auf einem **eigenen Port** (nicht `/mcp` auf dem Webhook-Port 3001). Grund: Die Webhook-Fläche ist bewusst öffentlich, MCP gibt Schreibzugriff auf Skripte und muss getrennt exponierbar sein (LAN/VPN vs. Tunnel).
- Härtung (Rate-Limit, Auth-Backoff, IP-Allowlist, `trust_proxy`-Opt-in) wird aus `core/webhook-manager.ts` in ein **gemeinsames Modul** gezogen, nicht dupliziert.
- **Der Port ist fest, nicht konfigurierbar** (wie `WEBHOOK_PORT = 3001`): der Container veröffentlicht nur Ports aus `config.yaml` (`ports:`). Neu: `3002/tcp: 3002` samt `ports_description` in `config.yaml` **und** `js_automations_beta/config.yaml`. Stable und Beta teilen sich wie beim Webhook-Port den Host-Port (Sibling-Guard, `EADDRINUSE`-Retry); der User kann ihn in der HA-Add-on-Oberfläche umlegen.
- Server startet nur, wenn in den Settings aktiviert (**Default aus**).
- **Auth:** ein statisches Bearer-Token, getrennt von den Webhook-Tokens. Reveal/Copy/Rotate im UI; Rotate invalidiert sofort. Kein OAuth.
- Beta und Stable haben getrennte Tokens (je Add-on-`/data`); der Host-Port wird wie beim Webhook geteilt.

### Claude Desktop

Claude Desktops Custom Connectors rufen Server aus Anthropics Cloud auf und brauchen öffentliches HTTPS plus OAuth — ein Add-on im Heimnetz ist so nicht erreichbar. Remote-`url`-Einträge in `claude_desktop_config.json` werden laut Quellen nicht unterstützt; üblich ist `npx mcp-remote <url>`.

Daher:

- **`.mcpb`-Datei** (Ein-Klick-Install) mit gebündelter stdio→HTTP-Bridge. Beim Installieren fragt sie URL und Token ab. Pro Variante (Beta/Stable) eindeutig benannt.
- **Fallback:** fertiges Config-Snippet (`mcp-remote`) zum Kopieren.
- **Verifiziert gegen die Anthropic-Doku (2026-10-28):** Eine `.mcpb` ist ein zip mit `manifest.json` und laufender _lokaler_ stdio-Server (`server.type`: `node`, `python`, `binary`, `uv`); einen Remote-URL-Servertyp gibt es nicht. `user_config` (Typen `string`/`number`/`boolean`/`directory`/`file`, `sensitive: true` für Token, Substitution `${user_config.KEY}` in `mcp_config` args/env) erlaubt, beim Install URL und Token abzufragen. Claude Desktop (macOS/Windows) bringt Node mit, Installation per Doppelklick/Drag&Drop; eine Signaturpflicht wurde nicht gefunden. -> Bridge als Node-Bundle (`node_modules` mitgeliefert).
- Remote-Connectors verlangen eine HTTPS-URL; für Server im privaten Netz verweist Anthropic auf "MCP tunnels" (Seite nicht gelesen).

## 4. UI

**Settings-Sektion `mcp`** (wie `webhook`): an/aus, externe URL, `trust_proxy`, IP-Allowlist (Port fest, nur angezeigt), **Tool-Schalter** (einzeln; Gruppen Lesen/Steuern/Schreiben als Presets).

**Eigener Tab** (Dev-Tools-Stil wie Webhooks):

- Status und URL
- Token (maskiert, Reveal/Copy/Rotate)
- Button "Für Claude Desktop installieren" (`.mcpb`) + Snippet-Fallback
- **Aktivitätslog:** In-Memory-Ringpuffer (letzte 200 Aufrufe: Zeit, Tool, Skript, Client-IP, Erfolg/Fehler), live per Socket-Event, bei Neustart leer. Schreibende Aufrufe sind zusätzlich über die Git-History nachvollziehbar.
- Datenschutz-Hinweis: _Inhalte, die Claude liest, gehen an Anthropic._

i18n: Tab, Settings und Tool-Namen in `de` und `en`.

## 5. Tools

Alle Tools sind **einzeln schaltbar**.

| Gruppe    | Tool                                              | Beschreibung                                                                                             | Default |
| --------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| Lesen     | `list_scripts`                                    | Name, Status, Header-Tags, Fehlerzustand                                                                 | an      |
| Lesen     | `read_script`                                     | Quelltext (Secret-Filter)                                                                                | an      |
| Lesen     | `get_logs`                                        | Skript-Log, Filter nach Level/Zeitraum (Secret-Filter)                                                   | an      |
| Lesen     | `get_script_errors`                               | Letzter Fehler mit Stacktrace                                                                            | an      |
| Lesen     | `get_events`                                      | Letzte N Events aus dem Event Inspector                                                                  | an      |
| Lesen     | `list_entities` / `get_entity`                    | State + Attribute                                                                                        | an      |
| Lesen     | `get_api_reference`                               | `authoring.md` + `ha-api.d.ts` + `API_REFERENCE.md`                                                      | an      |
| Lesen     | `get_store`                                       | `ha.store`-Inhalt, sensible Schlüssel (token/password/key/secret) maskiert                               | **aus** |
| Steuern   | `start_script` / `stop_script` / `restart_script` |                                                                                                          | an      |
| Steuern   | `call_service`                                    | HA-Service ausführen (schaltet reale Geräte)                                                             | **aus** |
| Schreiben | `write_script`                                    | Anlegen/Ändern von Skripten und Libraries; Syntax-/Typecheck, Fehler zurück; **Git-Commit pro Änderung** | **aus** |
| Schreiben | `write_card`                                      | Card-Definition                                                                                          | **aus** |
| Schreiben | `delete_script`                                   |                                                                                                          | **aus** |

Defaults: Lesen + Steuern an; die gesamte Schreiben-Gruppe, `get_store`, `call_service` und `delete_script` aus. Der User aktiviert sie bewusst.

**Fix-Loop** (Hauptnutzen): `write_script` → `restart_script` → `get_script_errors` / `get_logs` → korrigieren — ohne dass der User Logs kopiert. `write_script` startet ein Skript nie selbst.

**Editor-Kollision:** Ändert Claude ein Skript, das im Editor offen ist, wird die Änderung als Git-Commit abgelegt und der Editor lädt neu; bei ungespeichertem Stand erscheint ein Konflikthinweis.

## 6. Secrets und Datenschutz

Skripte enthalten oft Tokens, Passwörter, Webhook-Keys, WebDAV-Zugänge.

- `read_script` und `get_logs` filtern bekannte Secret-Muster vor der Ausgabe (**Sicherheitsnetz, keine Garantie**). Konkrete Muster werden beim Bau definiert.
- `get_store` ist default aus; wenn aktiv, werden Werte mit sensiblen Schlüsselnamen maskiert.
- Tab zeigt den Hinweis, dass gelesene Inhalte an Anthropic gehen.

## 7. Prompts und Resources

- **Prompt `new_script`:** erzwingt die Skriptstruktur Header → Typen → Config-Block → Logik (Config-Name kontextabhängig: `DEFAULT_CONFIG` bei Store-Nutzung, sonst `CONFIG`).
- **Prompt `grill_script`:** geführtes Interview (Trigger, Entities, Edge Cases, Config-Werte, Benachrichtigungen), am Ende Spezifikation, erst dann `write_script`. Entspricht dem alten "Grill-Modus".
- **Resource:** API-Doku (`authoring.md`, `ha-api.d.ts`, `API_REFERENCE.md`).
- Hinweis: Claude Desktop zeigt Prompts als auswählbare Vorlagen; sie starten nichts von selbst.

## 8. Doku als Voraussetzung (Teil des Releases)

Die JSA-"Philosophie" ist heute über README, TECH-README und Guides verstreut; eine KI, die nur `ha-api.d.ts` und `API_REFERENCE.md` bekommt, schreibt technisch lauffähige, aber unidiomatische Skripte. Befund (2026-10-28):

- README verspricht eine vollständige Header-Tag-Referenz in `API_REFERENCE.md`; dort gibt es keinen eigenen Abschnitt (nur `@permission`).
- Karten sind in `docs/guide/card-packs.md` gut erklärt, in `ha-api.d.ts`/`API_REFERENCE` kaum; das einzige Beispiel `examples/counter_card.ts` enthält die Karte als Base64-Block.
- Das Musterskript aus dem alten Konzept wurde nie geschrieben.

Maßnahmen:

1. Neues **`docs/guide/authoring.md`**: Header-Tag-Tabelle, Skriptstruktur, Konventionen (native Entities, Store, i18n/`ha.localize`, Notifications), Karten-Format in Klartext, ~80-Zeilen-Musterskript. Hauptressource von `get_api_reference`, zugleich für menschliche Autoren.
2. **Header-Tag-Tabelle** auch in `API_REFERENCE.md`.
3. Lesbares **Karten-Beispiel** (statt nur Base64).

## 9. Bauplan

Reihenfolge (jeder Schritt einzeln testbar):

1. **Härtungsmodul extrahieren** — `core/request-guard.ts` aus `webhook-manager.ts`: `ipMatchesAllowlistEntry`, `_tokensMatch` (timing-safe), Rate-Limit (`${ip}:${key}`, 60/min), Auth-Backoff (5 Fehlversuche/10 min → 10 min Sperre), Sweep-Timer. Parametrisierbar (Key statt Webhook-ID, Logger-Callback, Konstanten per Option), ohne Express-Abhängigkeit. `WebhookManager` nutzt es danach; Verhalten unverändert (Regression: Postman-Matrix aus `examples/webhook_api_test.js`, Unit-Tests für CIDR/Backoff).
2. **`mcp-manager.ts` Gerüst** — eigener Express-Server auf `3002`, Bearer-Auth über das Modul, `trust_proxy`, Sibling-Guard/EADDRINUSE-Retry nach Webhook-Vorbild, Token-Persistenz (`.storage/mcp.json`, Reveal/Rotate), Start/Stopp per Setting. Dazu `config.yaml` (beide Add-ons) + Settings-Sektion `mcp`.
3. **MCP-Protokoll** — offizielles SDK (`@modelcontextprotocol/sdk`, Streamable HTTP) auf Route `/mcp`; Tool-Registry mit Einzel-Schaltern (Settings), Aktivitätslog-Ringpuffer + Socket-Event.
4. **Lese-Tools** (`list_scripts`, `read_script`, `get_logs`, `get_script_errors`, `get_events`, `list_entities`/`get_entity`, `get_api_reference`) inkl. Secret-Filter. Danach Steuern-Tools, `get_store`.
5. **Schreiben-Tools** (`write_script`, `write_card`, `delete_script`): Syntax-/Typecheck, Git-Commit pro Änderung, Editor-Reload und Konflikthinweis; Blockly ausgeschlossen.
6. **Prompts + Resources** (`new_script`, `grill_script`, API-Doku).
7. **UI** — `mcp-panel.ts` (Tab), Settings-Sektion, i18n `de`/`en`.
8. **`.mcpb`** — Node-Bridge (stdio→HTTP, Abhängigkeiten gebündelt), `manifest.json` mit `user_config` (URL, Token `sensitive`), Build-Skript, Download-Route; Snippet-Fallback.
9. **Doku** — README, API_REFERENCE (falls API-Änderungen), `docs/guide/mcp.md`, CHANGELOG; Release via `npm run ship:minor` ("With A Little Help From My Friends").

## 9a. Backend-Skizze

- `core/request-guard.ts` (gemeinsames Härtungsmodul, siehe Schritt 1)
- `core/mcp-manager.ts` (Server, Token, Tool-Registry, Aktivitätslog)
- `routes/mcp-route.ts` (Token reveal/rotate, Status, `.mcpb`-Download)
- Sektion `mcp` in `core/settings-schema.ts`, Verdrahtung in `core/kernel.ts`
- Frontend: `public/js/components/mcp-panel.ts` + Tab-Registrierung
- `.mcpb`-Build (Bridge + `manifest.json`)
- i18n `de`/`en`, `README.md`, `API_REFERENCE.md`, `ha-api.d.ts` (falls betroffen) nachziehen

## 10. Offene Punkte

- Bridge: eigener minimaler stdio→HTTP-Proxy (Node, mit abhängigen Paketen gebündelt) vs. `mcp-remote` bündeln; Self-signed-HTTPS-Verhalten testen
- Optional: Anthropic-Seite zu "MCP tunnels" lesen (relevant für Tunnel-User)
- Konkrete Secret-Filter-Muster
- Aufbewahrung des Aktivitätslogs ist bewusst nur In-Memory; bei Bedarf später persistieren
- `ha.ai()` Laufzeit-API: eigenes Konzept, falls gewünscht
