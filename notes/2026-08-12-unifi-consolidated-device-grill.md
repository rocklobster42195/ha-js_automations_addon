# Unified UniFi Device ("UniFi Control"): Grill / Discovery Notes

Date: 2026-08-12 · Goal: Figure out how far `freifunk_client_counter.js` can grow into a single consolidated "UniFi Control" HA device — auto-disabling Freifunk on WAN failover to 5G, toggling known WLANs, keeping the client counter — using only the `node-unifi` npm package (no official HA UniFi integration, since that imports hundreds of unwanted Freifunk clients). The incoming UniFi UPS was scoped _out_ of this device during the interview (see Q6) — handled via HA's native NUT integration instead.

## Context gathered before interview

Pulled `node-unifi`'s source (`jens-maus/node-unifi`, the package already used by `freifunk_client_counter.js`) directly from GitHub to check real method coverage before asking anything guessable:

- **WLAN toggle — confirmed supported.** `getWLanSettings(wlan_id)` (`GET /api/s/<SITE>/rest/wlanconf/<id>`) and `disableWLan(wlan_id, disable)` (`PUT` with `{enabled: !disable}` via `setWLanSettingsBase`) exist and map 1:1 to "turn this SSID off/on".
- **WAN / ISP visibility — likely supported, needs a live check.** `getHealth()` hits `/api/s/<SITE>/stat/health`, which per current UniFi controller behavior returns a `wan` subsystem entry containing `isp_name`, `wan_ip`, `status`, gateway system stats, and uptime stats. This is an undocumented-but-stable private API, not officially documented by Ubiquiti, and field availability has varied across controller versions historically.
- **WAN failover events exist as a named event key**: `EVT_GW_WANTransition`, retrievable via `getEvents()` (REST log) — and potentially also over the same events WebSocket the script already listens on (unconfirmed whether it surfaces there the same way `evt_wg_connected` does).
- **UPS — genuinely uncertain, two possible paths found:**
  1. UniFi's own UPS product "integrates into the UniFi Network application for simple adoption and monitoring" per Ubiquiti's marketing — meaning it likely gets adopted as a generic device and _might_ be reachable through node-unifi's general device-list endpoint (`getAccessDevices()`/device stat, not yet inspected in depth), alongside APs/switches.
  2. Separately, Ubiquiti's own materials mention the UPS has **NUT (Network UPS Tools) compatibility**. NUT is a standard, widely supported protocol with its **own native, well-documented Home Assistant integration** — completely independent of the UniFi Network API/controller and of `node-unifi`. This would sidestep the whole "does node-unifi support it" question entirely.
- **Device grouping — already solved.** `ha.register(entityId, { device: {...} })` already groups multiple entities under one HA device (see `trash_reminder.ts`'s `DEVICE` constant) — no new capability needed to present client counter + WLAN switches + WAN sensor as one device.
- Not yet checked: whether the existing `unifi.on((event) => ...)` wildcard-style listener in the current script actually receives WAN-transition events the same way it receives client connect/disconnect events (the current code's single-argument `.on(cb)` usage against `eventemitter2` needs a closer read/live test regardless — flagged, not core to this decision).

## Summary / key decisions

**Scope**: a new `scripts/unifi_control.ts` (TypeScript, replaces `freifunk_client_counter.js`) drives one HA device — display name **"UniFi Control"**, icon **`mdi:server-network`** — built entirely on the existing `node-unifi` npm package. Hardware: **UCG Max** gateway + incoming **U5G-EU** 5G backup modem, fully UniFi-adopted (not an external/standalone device), so `getHealth()` and `EVT_GW_WANTransition` are expected to be fully usable.

**Entities on the device**:

- `sensor.freifunk_clients` — existing client counter, **entity ID kept unchanged** to preserve history, just re-homed under the new device.
- `sensor.unifi_wan_link` (new) — visible state `primary` / `5g_failover`, `isp_name` as attribute — for at-a-glance dashboard awareness (explicitly wanted: "Ich bin Datenjunkie").
- One switch per WLAN in a static **allow-list** (config in the script, not dynamic auto-discovery) — initially covering **all** currently configured networks (main household WLAN, Gastnetz, Freifunk, ...). Newly created WLANs on the controller do **not** auto-appear as switches until added to the list explicitly.

**Deploy-before-hardware-arrives requirement**: the U5G-EU isn't installed yet. The script must be deployable and fully functional (client counter + WLAN switches) _today_, on WAN1-only, without erroring. WAN-health polling must treat "no second WAN entry in `getHealth()`" as a normal no-op state, not a failure — so the failover automation activates itself automatically the moment the U5G-EU gets adopted, with no redeploy or config flag needed.

**WAN-failover automation** (the actual point of the exercise):

- Detection: **30-second polling** of `getHealth()` via `schedule('*/30 * * * * *', ...)` (node-cron supports 6-field/seconds cron natively — confirmed in `_parseCronExpression`, unknown strings pass through unchanged). Chosen over the WebSocket `EVT_GW_WANTransition` event path because that path's `unifi.on((event) => ...)` semantics are unverified in this codebase (same catch-all-callback pattern already used un-verified for `evt_wg_connected`/`evt_wg_disconnected`).
- **Only Freifunk** is coupled to this automation (auto-off on failover, auto-on when primary WAN returns, with a debounce ~2-5 min against flapping — exact value TBD at implementation). All other allow-listed WLANs (Gastnetz, main WLAN) are pure manual switches, no automation.
- Why speed matters: the 5G plan will be a small/limited **"Mini" data contract** — the concern is Freifunk users burning data allowance during a failover window, so reaction time (30s cap on exposure) is a real requirement, not a nice-to-have.
- Failure handling: no extra retry logic — the 30s poll cycle _is_ the retry. Only add a warning notification/log entry after several consecutive failures in a row (exact threshold TBD, ~3×), so a stuck automation doesn't go unnoticed until the bill arrives.
- Forward-looking, not blocking: passively log raw `EVT_GW_WANTransition`-ish events to `internal://` via `ha.fs.append()` (+ `ha.fs.rotate()` to cap size) from inside the existing WS handler, purely to gather evidence for a _future_ switch to event-based (near-instant) detection. Requires the `filesystem_enabled` addon setting and `@permission fs:write` in the script header — **both unverified, need checking before this part can work.**

**UPS**: deliberately **out of scope** for this script. Ubiquiti's UPS advertises NUT (Network UPS Tools) compatibility, and HA has a native, independent NUT integration — start there instead of reverse-engineering UPS visibility through the UniFi Network API.

**Escape hatch for gaps**: if `node-unifi`'s wrapper methods don't cover something needed (WAN health detail, UPS, etc.), `Controller.customApiRequest(path, method, payload)` already exposes raw authenticated REST access to any controller endpoint — no upstream PR required to unblock. A PR to `jens-maus/node-unifi` (MIT, active) stays a nice-to-have for contributing a clean wrapper back later, not a dependency.

## Q&A log

### Q1a — "Notfalls ein PR beim npm-Paket, damit wir das an anderer Stelle aktualisieren?"

- Asked (in response to Q1, before it was answered): whether we'd need to open a PR against `node-unifi` upstream if it's missing something we need (UPS, WAN detail, etc.), so a fix could land "elsewhere" (i.e., upstream, benefiting from future updates) rather than us hacking around it locally.
- Captured: Checked the library source directly — it already exposes `customApiRequest(path, method, payload)`, a thin public wrapper around its internal authenticated `_request()`. This means **any** UniFi controller REST endpoint (documented or not, including whatever the UPS or WAN health detail turns out to need) is callable today through the installed package, with no code changes to the package itself and no PR required to unblock functionality. A PR upstream is still worth doing later purely to contribute a clean, named, reusable method back to the community (matches this project's general habit of playing well with upstream deps) — but it is not on the critical path and not something to wait on.
- Flags: none — resolved.

### Q1 — Hardware-Topologie: was macht den WAN-Failover auf 5G?

- Asked: Gateway-Modell und ob das 5G-Backup ein UniFi-adoptiertes Gerät ist oder extern/nicht-adoptiert.
- Captured: Gateway ist ein **UCG Max**. 5G-Backup wird ein **U5G-EU** (UniFi 5G Max, EU-Variante). Recherche bestätigt: das U5G-MAX/-EU wird wie ein normaler UniFi-Access-Point per PoE an einen Switch-Port gehängt und läuft **voll adoptiert** über denselben Controller (nicht als externes Standalone-WAN2-Gerät). Das Gateway überwacht die primäre WAN-Verbindung und schaltet innerhalb von Sekunden auf 5G um, revertiert automatisch wenn die Primärleitung zurückkommt. Damit sind `getHealth()`'s WAN/WAN2-Subsystem und `EVT_GW_WANTransition` mit hoher Wahrscheinlichkeit voll nutzbar — kein Sonderfall für nicht-adoptierte Hardware nötig.
- Wichtiger Nebenfund: Ubiquitis eigene Doku zum U5G-MAX erwähnt, dass man im UniFi Network App **granular pro Netzwerk/VLAN konfigurieren kann, welche Netze während Failover priorisiert bzw. gedrosselt/geblockt werden** ("Failover network priority"). Das ist potenziell eine **native, codefreie Alternative** zu "WLAN per Skript abschalten" — muss als eigener Zweig geklärt werden (siehe nächste Frage).
- Flags: keine — Hardware-Frage vollständig beantwortet.

### Q2 — Radio wirklich aus, oder nur Traffic auf dem 5G-Link blocken?

- Asked: Ob native "Failover Network Priority" (Traffic drosseln/blocken pro VLAN, ohne Code) reicht, oder ob das WLAN-Radio tatsächlich abgeschaltet werden soll.
- Captured: **Radio wirklich aus** ("Soll ausgeschaltet werden"), bestätigt — via `disableWLan(wlan_id, true)`, nicht nur Traffic-Policy.
- Zusatz (unaufgefordert erweitert): User will nicht nur Freifunk, sondern **generische Schalter-Entitäten pro bekanntem Netz** — explizit genannt: auch das **Gastnetz**. D.h. Scope wächst von "ein Automatismus für Freifunk" zu "ein WLAN-Toggle-Baukasten für mehrere SSIDs, von denen einer (Freifunk) zusätzlich automatisiert an den WAN-Failover gekoppelt ist".
- Flags: keine — aber wirft neue Fragen auf (nächste Punkte): welche Netze bekommen Schalter, und ist die Automatik nur an Freifunk gekoppelt oder auch an andere (z.B. Gastnetz)?

### Q3 — Welche Netze bekommen einen Schalter: Allow-List oder alle automatisch?

- Asked: Explizite Allow-Liste (Empfehlung) vs. dynamisch alle vorhandenen WLANs; und welche Netze initial (nur Freifunk+Gast, oder auch Haupt-WLAN)?
- Captured: **"alle. Und mit allowlist"** — Mechanismus ist die empfohlene **Allow-Liste** (statische Config im Skript, kein dynamisches Auto-Discovery aller WLANs), aber der Inhalt dieser Liste soll initial **alle** aktuell vorhandenen Netze umfassen (inkl. Haupt-Haushaltsnetz, nicht nur Freifunk+Gast). Zukünftig neu angelegte WLANs tauchen NICHT automatisch als Schalter auf, bis sie explizit in die Allow-Liste eingetragen werden.
- Flags: Genaue Liste der aktuell existierenden WLAN-Namen/SSIDs noch nicht erfasst (User müsste die im Controller nachsehen oder wir lesen sie einmalig per `getWLanSettings()` aus und schlagen die Liste vor) → Owner: User bzw. Skript-Bootstrap.

### Q4 — Koppelt der Failover-Automatismus nur Freifunk ab, oder auch andere Netze?

- Asked: Nur Freifunk automatisch aus-/einschalten (Empfehlung), Gastnetz/Haupt-WLAN bleiben rein manuell ohne Automatik-Kopplung.
- Captured: Bestätigt ("ist ok so") — **nur Freifunk** ist an den WAN-Failover-Automatismus gekoppelt. Alle anderen Netze in der Allow-Liste (Gastnetz, Haupt-WLAN, ...) sind reine manuelle Schalter ohne jede Automatik.
- Flags: keine.

### Q5 — Freifunk automatisch wieder einschalten bei Primärleitung zurück, oder manuell?

- Asked: Automatisch wieder an (Empfehlung, analog zum U5G-MAX-Verhalten selbst), plus Debounce (2-5 Min stabile Primärleitung) gegen Flackern bei instabiler Leitung.
- Captured: **"automatisch"** bestätigt. Debounce-Fenster selbst noch nicht exakt beziffert (Empfehlung 2-5 Min steht im Raum, nicht explizit gegengeprüft) — als Implementierungsdetail einstufen, nicht blockierend.
- Flags: keine, exakte Debounce-Dauer bei Umsetzung final festlegen (kein Show-Stopper).

### Q6 — UPS: native NUT-Integration statt Custom-Code im UniFi-Device?

- Asked: Native HA-NUT-Integration (unabhängig von UniFi/node-unifi) nutzen, statt UPS-Status mühsam über `customApiRequest()` aus dem Controller zu holen.
- Captured: **"Wir starten dann erstmal mit nut"** — bestätigt. UPS-Anbindung läuft über die HA-Bordmittel-NUT-Integration, **nicht** Teil des JSA-"UniFi Control"-Skripts/Device. Kann bei Bedarf später nachgezogen werden, ist aber aus dem aktuellen Skript-Scope raus.
- Flags: keine für dieses Thema. (Spätere Prüfung falls NUT nicht erreichbar/nicht ausreicht, ist ein neues Thema, kein offener Punkt hier.)

### Q7 — WAN-Failover-Erkennung: Polling statt WebSocket-Event?

- Asked: Polling `getHealth()` alle 1-2 Min via `schedule()` (Empfehlung, robust, nutzt bereits etablierten Mechanismus) vs. Event-basiert über den unverifizierten `unifi.on((event)=>...)`-Pfad (potenziell instant, aber technisch unklar).
- Captured: **Wichtiger Kontext, der die Antwort ändert**: Es wird nur ein **kleiner ("Mini") 5G-Datentarif** abgeschlossen. Die Kernsorge ist explizit, dass Freifunk-Nutzer während der Failover-Zeit Daten "wegstreamen" — d.h. **Reaktionsgeschwindigkeit ist doch relevant** (Datenvolumen-Schutz auf begrenztem Tarif), nicht nur "irgendwann abschalten reicht".
- Empfehlung (aktualisiert, noch nicht vom User bestätigt): Polling-Intervall deutlich verkürzen — node-cron (unterliegt `schedule()`) unterstützt 6-Feld-Cron **mit Sekunden**, d.h. `schedule('*/30 * * * * *', ...)` für alle 30 Sekunden ist technisch möglich, ohne den `_parseCronExpression`-Helfer erweitern zu müssen (unbekannte Strings werden unverändert durchgereicht). Vorschlag: mit 30s-Polling starten (robust, sofort umsetzbar), und den schnelleren WS-Event-Pfad (`EVT_GW_WANTransition`) als späteres Upgrade verifizieren/nachrüsten, statt jetzt darauf zu warten.
- Flags: User-Bestätigung zum 30s-Intervall (oder anderer Wert) noch ausstehend -> nächste Frage.

### Q7a — 30s-Polling reicht, oder Event-Pfad sofort verifizieren?

- Asked: Mit 30s-Polling starten (schnell umsetzbar) vs. Event-Pfad-Verifizierung zuerst.
- Captured: **"Mit 30s starten"** bestätigt. Zusätzlich möchte der User den `EVT_GW_WANTransition`-Pfad parallel **passiv mitloggen** (nicht als aktive Erkennung, sondern als Datensammlung für eine spätere Umstellung auf Event-basierte Erkennung), via `ha.fs` in eine Datei geschrieben.
- Verifiziert im Code (`ha-api.d.ts:1362-1368, 1431-1501`): `ha.fs` ist genau dafür geeignet.
  - `ha.fs.append('internal://<name>.log', data)` — hängt an, erstellt bei Bedarf; passend für ein Log statt `write()` (das würde überschreiben).
  - `ha.fs.rotate('internal://<name>.log', { maxSize, keep })` — verhindert unbegrenztes Wachstum über Wochen.
  - **Voraussetzungen**: (1) Addon-Setting `filesystem_enabled` muss aktiv sein, (2) Skript-Header braucht `@permission fs:write` (und `fs:read`, falls das Log später im Skript selbst wieder gelesen werden soll, statt nur manuell/extern).
  - Geplanter Ort im Skript: im bestehenden `unifi.on((event) => {...})`-Handler (derselbe Listener, der schon `evt_wg_connected`/`evt_wg_disconnected` für den Client-Counter prüft) einen zusätzlichen Zweig ergänzen, der bei einem Treffer auf `wantransition` (Groß/Kleinschreibung noch zu prüfen) Zeitstempel + Rohevent in die Log-Datei schreibt — unabhängig vom 30s-Polling, rein zur späteren Auswertung.
- Flags: keine inhaltlichen — reine Umsetzungsdetails (exakter Log-Dateiname, Rotationsgröße) für später.

### Q8 — Neue Datei oder bestehende erweitern? TypeScript oder JS?

- Asked: Neue Datei `scripts/unifi_control.ts` (Empfehlung, TS analog zu `trash_reminder.ts`, löst `freifunk_client_counter.js` ab) vs. bestehenden JS-Dateinamen behalten und nur erweitern.
- Captured: **"TS und neues script"** bestätigt. `scripts/freifunk_client_counter.js` wird durch ein neues `scripts/unifi_control.ts` (Name vorläufig, siehe unten) abgelöst.
- Flags: exakter Dateiname noch nicht final festgelegt (Vorschlag `unifi_control.ts`, nicht explizit bestätigt) — kein Blocker, bei Umsetzung final wählen.

### Q9 — Sichtbarer WAN-Link-Sensor + bestehende Client-Counter-Entity-ID beibehalten?

- Asked: (1) Zusätzlicher sichtbarer `sensor.unifi_wan_link` (primary/5g_failover, isp_name als Attribut) für Dashboard-Überblick. (2) Bestehende Entity-ID `sensor.freifunk_clients` unverändert lassen (nur Geräte-Zuordnung ändert sich), um History/Dashboards nicht zu brechen.
- Captured: **"Beide Fragen: ja. Ich bin Datenjunkie ;-)"** — beide Empfehlungen bestätigt. Der "Datenjunkie"-Kommentar passt inhaltlich zu beidem: sichtbarer Status-Sensor gewünscht (mehr Daten im Dashboard), UND bestehende Historie/Entity-ID bleibt erhalten (Datenjunkies werfen keine History weg).
- Flags: keine.

### Q10 — Fehlerbehandlung, falls der "Freifunk aus"-API-Call fehlschlägt?

- Asked: 30s-Poll als eingebauter Retry (nächster Tick versucht es automatisch erneut) + HA-Notification/Log-Warnung nach mehrfachem Fehlschlag in Folge (z.B. 3×) — reicht das, oder sofortiger Extra-Retry statt auf nächsten Tick zu warten?
- Captured: **"ist ok"** — bestätigt. Kein Extra-Retry-Mechanismus nötig, 30s-Poll-Zyklus übernimmt das automatisch; Warnung erst nach mehrfachem Fehlschlag in Folge.
- Flags: exakte Schwelle ("mehrfach" = 3×) als Implementierungsdetail, nicht explizit gegengeprüft, aber kein Blocker.

### Q11 — Vollständigkeits-Check / Icon fürs Device

- Asked: Sonst noch was offen (Device-Name/Icon, Notification bei jedem Toggle, weitere Anforderungen)?
- Captured: **Icon: `mdi:server-network`** ("es gibt ja kein unifi icon") — Device-Icon damit festgelegt. Device-Name selbst noch offen (Vorschlag: "UniFi Control"). Notification-bei-jedem-Toggle nicht explizit gefordert — nicht Teil des Scopes, nur die Fehler-Warnung aus Q10.
- Flags: Device-Anzeigename noch nicht explizit bestätigt (Vorschlag "UniFi Control" im Raum) — kein Blocker.

### Q12 — Device-Anzeigename "UniFi Control"?

- Asked: Passt "UniFi Control" als Anzeigename, oder anderer Name gewünscht?
- Captured: **"ja"** — bestätigt. Device heißt "UniFi Control", Icon `mdi:server-network`.
- Flags: keine. Interview abgeschlossen.

### Q13 — U5G-EU ist noch nicht da: Skript muss auch ganz ohne WAN2 robust laufen

- Asked: (implizit durch User-Anmerkung) Skript soll schon jetzt deploybar sein, bevor die Hardware da ist, ohne zu crashen oder falsch zu reagieren.
- Captured: **"MAche das Skript so robust, dass es auch ohne auskommt."** — neue, wichtige Anforderung: das Skript muss ab Tag 1 laufen können (nur WAN1 vorhanden, kein WAN2/5G-Backup adoptiert), und soll automatisch "scharf" werden, sobald das U5G-EU später adoptiert wird — ohne Redeploy/manuelle Umschaltung.
- Auswirkung auf Design: `getHealth()`'s `wan`-Subsystem-Array muss defensiv ausgewertet werden (kein zweiter WAN-Eintrag vorhanden = "kein Failover-Fall möglich", nicht "Fehler"). Client-Counter und WLAN-Allow-List-Schalter sind ohnehin unabhängig von WAN2 und laufen schon immer normal.
- Antwort (User meldete sich direkt, bevor die Rückfrage gestellt wurde): **"Natürlich ohne die Umschaltfunktion"** — bestätigt die dynamische Variante: Solange kein WAN2 da ist, läuft das 30s-Polling einfach weiter, findet aber logischerweise keinen zweiten WAN-Eintrag und tut nichts (kein Fehler, kein Redeploy nötig). Sobald das U5G-EU adoptiert ist, sieht `getHealth()` automatisch den zweiten Eintrag und die Automatik greift ab dann von selbst — kein Config-Flag, kein manueller Schritt.
- Flags: keine — vollständig geklärt.

### Post-Grill-Korrektur — Q3's "allowlist" war zweideutig

Während der Implementierung stellte sich heraus, dass Q3's Antwort ("alle. Und mit allowlist") vom User anders gemeint war, als ich es gebaut hatte: er dachte an eine **Survive-Liste** (welche Netze bei Failover AN bleiben), ich hatte es als **Switch-Erzeugungs-Liste** umgesetzt. Aufgelöst in zwei getrennte, klar benannte Konfig-Listen im fertigen `scripts/unifi_control.ts`:

- `WLAN_ALLOWLIST` = Survive-Liste (Opt-out-Modell: alles NICHT gelistete wird bei Failover abgeschaltet, auch nicht-verwaltete Netze) — aktuell `['RocklobsterWLAN']`.
- `MANAGED_WLANS` = welche Netze einen HA-Schalter bekommen — aktuell `['Freifunk', 'RocklobsterWLAN']`.
  Details siehe `project_unifi_control_device.md` im Memory-System (aktuellerer Stand als diese Datei für den Implementierungsteil).

## Open flags (pending input)

- Exakter SSID-Name des Gastnetzes fehlt weiterhin — und ob es in WLAN_ALLOWLIST (überlebt Failover) oder nicht (wird mit abgeschaltet) soll
- `filesystem_enabled`-Addon-Setting: bestätigt AN (User-Antwort im Chat)
