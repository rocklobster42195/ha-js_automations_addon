# KI-Unterstützung in JS Automations — MCP-Server

Stand: 2026-10-28. **Gebaut** (Branch `feature/mcp-server`), noch nicht gegen eine echte HA-Instanz und nicht mit Claude Desktop getestet — siehe [Testplan](./mcp-test-plan.md). Ersetzt das frühere Konzept mit Chat-Panel, BYOK und `ha.ai()`.

Release: **"With A Little Help From My Friends"** (`npm run ship:minor`).

Nutzer-Doku: [`docs/guide/mcp.md`](../guide/mcp.md). Technische Beschreibung (Module, Ablauf, "ein Tool hinzufügen"): [`TECH-README §20`](../TECH-README.md#20-mcp-server).

---

## 1. Idee

JSA ist ein **MCP-Server**. Ein externer KI-Client (hauptsächlich Claude Desktop) ruft JSA-Tools auf: Skripte lesen und schreiben, steuern, Logs und Fehler lesen. Die Denkarbeit macht der Client des Users. JSA braucht dafür **keinen eigenen API-Key, kein Chat-Panel und keinen Chat-/Memory-Store**.

Entfallen gegenüber dem alten Konzept: BYOK-Anbieteranbindung, Editor-Chat-Panel, API-Key-Masking, Chat-Verlauf, KI-Memory, Prompt-Caching-Kontext. Zurückgestellt: `ha.ai()` als Laufzeit-API für Skripte (z. B. `smart_watering.ts`) — eigenes Thema.

## 2. Nicht-Ziele (v1)

- `run_repl` (Code in laufendem Skript ausführen) — später, eigene Schaltergruppe, default aus
- Breakpoints / Watch über MCP — nie (zu interaktiv)
- OAuth / Cloud-Connector (öffentliches HTTPS nötig) — nicht v1; deshalb kein ChatGPT, keine Claude-Web-Connectors
- Mehrere Tokens (pro Client)
- Blockly-Skripte — weder lesen noch schreiben

## 3. Entscheidungen (wie gebaut)

**Transport.** Streamable HTTP, **zustandslos mit JSON-Antworten** (pro Request ein frischer `McpServer`), SDK `@modelcontextprotocol/sdk`. Eigener Express-Server auf dem **festen Port 3002** (nicht konfigurierbar, steht in `config.yaml` beider Add-ons; Begründung wie `WEBHOOK_PORT`). Stable und Beta teilen sich Host-Port und `STORAGE_DIR` — damit auch das Token (`.storage/mcp.json`); Sibling-Guard/`EADDRINUSE`-Retry wie beim Webhook. Die Härtung (Rate-Limit 300/min, Backoff 5 Fehlversuche → 10 min, IP-Allowlist, Token-Vergleich) liegt in `core/request-guard.ts` und wird von Webhook- und MCP-Server genutzt.

**Auth.** Ein statisches Bearer-Token (`jsamcp_…`), Reveal/Copy/Rotate im UI, Rotate wirkt sofort. Server nur an, wenn `mcp.enabled` (**default aus**).

**Claude Desktop.** Custom Connectors rufen aus Anthropics Cloud auf (öffentliches HTTPS + OAuth) → für ein Heimnetz-Add-on nicht nutzbar. Stattdessen `.mcpb`-Extension (MCPB-Manifest 0.3), die eine abhängigkeitsfreie **stdio→HTTP-Bridge** (`js_automations/mcpb/bridge.js`) startet. Endpoint und Token sind als `user_config`-Defaults vorbelegt (die Datei enthält also das Token). Fallback: Config-Snippet mit `npx mcp-remote` (`--header Authorization:${AUTH_HEADER}`, `--allow-http` für http).

**UI-Aufteilung** (Entscheidung 2026-10-28):

- _Settings → MCP-Server_: Aktivieren (danach erscheint der Rest per `condition`), externe URL, `trust_proxy`, Allowlist, **alle Tool-Schalter**, und das Panel `<mcp-panel>` mit Status, Endpunkt, Token, "Für Claude Desktop installieren" und Config-Snippet. Kein Dev-Tools-Tab für das Setup, weil der Dev-Tools-Bereich nur im Expert Mode existiert.
- _Dev-Tools-Tab "MCP"_ (`<mcp-activity-panel>`): Aufruf-Log (In-Memory, 200) mit aufklappbaren, kopierbaren Fehlern und die Feedback-Notizen aus dem Maintainer-Modus.
- _Settings → Allgemein (Expert Mode)_: Dev-Tools-Tabs einzeln abschaltbar (`devtab_*`), Maintainer-Modus.

**Tools** (18, alle einzeln schaltbar; `mcp-tool-catalog.ts`):

| Gruppe     | Tool                                                                                                             | Default |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| Lesen      | list_scripts, read_script, get_logs, get_script_errors, get_events, list_entities, get_entity, get_api_reference, get_script_notes | an      |
| Lesen      | get_store (Secrets nie ausgegeben, sensible Schlüssel maskiert)                                                  | **aus** |
| Steuern    | start_script, stop_script, restart_script                                                                        | an      |
| Steuern    | call_service (host-nahe Services gesperrt)                                                                       | **aus** |
| Schreiben  | write_script, write_card, save_script_notes, delete_script                                                                          | **aus** |
| Maintainer | jsa_feedback (nur im Maintainer-Modus, kein eigener Schalter)                                                    | —       |

**Schreiben.** Name validieren → Syntaxfehler blockieren, Typprobleme (nur TS, gegen `ha-api.d.ts` + generierte Typen) sind Warnungen → bestehender Karten-Block bleibt erhalten → **Snapshot-Commit** des Ist-Zustands → atomar schreiben → Commit (`mcp: …`). Kein automatischer Neustart (`restart_script` separat). Das Git-Repo wird beim ersten Schreiben lazy angelegt. Offene Editor-Tabs: sauber → Reload, ungespeichert → Warnung + Rückfrage beim Speichern (`script_content_changed`, `JsaTab.externalChange`).

**Secrets/Datenschutz.** `mcp-secret-filter.ts` maskiert benannte Werte und bekannte Token-Formate in `read_script`/`get_logs`/`get_events`/`get_store` (Sicherheitsnetz, keine Garantie); Hinweis im Panel, dass gelesene Inhalte an den KI-Anbieter gehen.

**Prompts/Resources.** `new_script` (Struktur-Regeln) und `grill_script` (Interview, Schreiben erst nach Bestätigung); Doku als Resources (`jsa://docs/authoring`, `…/api-reference`, `jsa://types/ha-api`); Server-`instructions` verweisen jeden Client auf `get_api_reference authoring`. Neu: `docs/guide/authoring.md` und die Header-Tag-Tabelle in der `API_REFERENCE.md`.

**Maintainer-Modus** (Idee 2026-10-28): `general.maintainer_mode`. Zusätzliche Server-Anweisung (nennt das Repo `github.com/rocklobster42195/ha-js_automations_addon`) + Tool `jsa_feedback`. Notizen (`.storage/mcp-feedback.json`, lokal, Secrets maskiert, max. 200) werden fuzzy zusammengeführt und gezählt. Das Tool-Ergebnis sagt der KI, was zu tun ist: **harter Fehler → sofort dem User melden**, normale Notiz → einmal beim 3. Auftreten, sonst still. Nichts verlässt das Gerät; ein "Issue erstellen"-Knopf wurde nicht gebaut (Issue-Formulare übernehmen über die URL nur den Titel).

## 4. Bekannte Grenzen

- "Nicht nerven"/"sofort melden" sind Bitten an das Modell; hart erzwungen sind nur Schwelle, Einmaligkeit und Tool-Antwort.
- Typcheck: Node-Globals (`process`, `require`, `crypto`, …) werden aus den Meldungen gefiltert, weil keine Node-Typen geladen sind; seltene Fehlalarme möglich.
- Der Endpunkt im Panel nutzt `window.location.hostname`; hinter Tunnel/Proxy muss die externe URL gesetzt sein.
- Clipboard-Knöpfe brauchen HTTPS oder localhost.
- Mit allen Tools aus liefert `tools/list` eine leere Liste (SDK-Sonderfall behandelt).

## 5. Offen

- **Verifikation:** offizieller `mcpb`-Validator; echte `.mcpb`-Installation in Claude Desktop (übernimmt ein "sensitives" Feld den `default`? wie wird ein Boolean in `env` serialisiert — die Bridge akzeptiert `true`/`1`/`yes`); andere MCP-Clients (Header-Unterstützung).
- Generische Kopier-Variante (URL + Header) für Nicht-Claude-Clients im Panel.
- "Issue erstellen"-Knopf an Feedback-Notizen.
- `ha.ai()` Laufzeit-API: eigenes Konzept, falls gewünscht.
- `run_repl` als spätere, eigene Schaltergruppe.
