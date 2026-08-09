# Entity Picker: State Preview Toggle — Grill / Discovery Notes

Date: 2026-08-08 · Goal: Flesh out the feature idea — a checkbox/icon in `<entity-picker-modal>` (the Ctrl+E "Insert Entity" picker) that shows each entity's current state inline, so the user knows what they're picking before inserting it.

## Summary / key decisions

**Feature (v1):** `<entity-picker-modal>` (Ctrl+E "Insert Entity") gets an `mdi-eye-outline`/`mdi-eye` icon-toggle button next to the search input. When on, each visible entity row shows its current state (+ unit for sensors) right-aligned in a muted color, alongside the existing plain entity ID. State-less rows (not found in the cache) just omit the field — no placeholder, no error.

**Data:** Reuses `window.cachedEntities` (`JsaHaState[]`) exactly like `status-bar.ts`/`status-bar-header-actions.ts` already do — check the cache first, only call `fetchAllStatesDeduped()` (`ha-entity-cache.ts`) if empty. No new fetch mechanism. Fetch is **lazy**: only triggered if the toggle is already on (remembered via `localStorage`, same pattern as word-wrap/collapsed-groups) when the picker opens, or the moment the user switches it on mid-session. No live updates while the picker is open — a fresh snapshot per open/toggle is enough.

**Explicitly out of scope for v1:**

- No entity icon (would need WatchTab's `_lookupHAIcon`/HA-icon-catalog system extracted into a shared module first — real work, not a quick add; tracked as a follow-up below).
- No state-value filtering (ID-only search stays as-is).
- No rollout to `event-inspector.ts`/`settings-view.ts` — both use native `<datalist>` autocomplete, which can't render formatted rows at all; `<entity-picker-modal>`'s custom list is the only place this is even possible.

**Net effect:** a genuinely small, self-contained change — new toggle button + one extra render field + a cache-aware fetch call, no new backend endpoint, no architecture change.

## Baseline (read from code, not asked)

- `entity-picker-modal.ts` currently renders `window.allEntities` — a **plain array of entity-ID strings only** (`['light.kitchen', 'sensor.temp', ...]`), extracted via regex from `entities.d.ts` in `monaco-editor.ts`. **No state/attribute data exists in this list today.**
- Entity _state_ data (`state`, `attributes`) lives in a **separate** global, `window.cachedEntities: JsaHaState[]`, populated by `fetchAllStatesDeduped()` (`ha-entity-cache.ts`) — currently only pulled in by `<status-bar-header-actions>` and `<status-bar>` (a handful of configured entities), not guaranteed populated/fresh for the _entire_ entity list when the picker opens.
- Render cap is 200 rows (`RENDER_LIMIT`), filtered/live as the user types in `.search-input`.
- List item is currently a single-line `<div class="entity-row">` showing just the raw entity ID, monospace.

## Q&A log

### Q1 — Datenquelle: brauchen wir überhaupt einen neuen Fetch?

- Gefragt: Live-Updates nötig? Haben wir die Entitäten nicht schon in einem Cache?
- Erfasst: Live-Updates explizit **nicht nötig** (User-Antwort). Nachrecherchiert: `fetchAllStatesDeduped()` selbst prüft `window.cachedEntities` **nicht** vorab — das machen die Aufrufer (`status-bar.ts`, `status-bar-header-actions.ts`) jeweils selbst (`if (!all || all.length === 0) all = await fetchAllStatesDeduped();`). D.h. `window.cachedEntities` ist ein **geteilter, aber nicht garantiert warmer** Cache: wenn der User Status-Bar-Slots oder Header-Actions konfiguriert hat, ist er beim Öffnen des Pickers wahrscheinlich schon befüllt (kostenlos, kein Extra-Fetch nötig) — wenn nicht (frische Session, nichts konfiguriert), ist er leer/undefined bis irgendwer ihn füllt.
- Entscheidung: Picker übernimmt exakt dasselbe Muster wie die beiden bestehenden Aufrufer — `cachedEntities` zuerst prüfen, nur bei leer/fehlend `fetchAllStatesDeduped()` aufrufen. Kein neuer Sondermechanismus.
- Flags: keine

### Q2 — UI-Mechanik: Checkbox vs. Icon-Toggle

- Gefragt: Checkbox oder Icon-Toggle-Button für den Umschalter? Persistiert der Zustand?
- Erfasst: **Icon-Toggle-Button** (mdi-Icon, aktiv/inaktiv), passend zum durchgängigen App-Muster (Word-Wrap-Toggle, Mobile-View-Toggle, Collapse-All — nirgends rohe HTML-Checkboxen). Platzierung: neben dem Suchfeld. Zustand wird per `localStorage` gemerkt (wie Word-Wrap/eingeklappte Gruppen). User: "Ist gut so."
- Flags: keine

### Q3 — Darstellung pro Zeile (Text) + Icon-Frage

- Gefragt: Wie wird der State pro Zeile dargestellt? Auch das Entity-Icon anzeigen (vergleichbar mit WatchTab)?
- Erfasst: State (+ Einheit bei Sensoren, z.B. "21.5 °C") **rechtsbündig auf derselben Zeile**, gedämpfte Farbe, ID bleibt gut lesbar/durchsuchbar. Kein Farb-Icon wie bei Header-Actions (`rgb_color`/`icon_color`) — für reine Text-Vorschau Overkill.
- Icon-Nachfrage (User: "vergleichbar mit WatchTab?"): recherchiert — WatchTab's Icon-Auflösung (`watch-panel.ts`) ist überraschend aufwendig: lädt HA's eigenen Icon-Übersetzungs-Katalog vom Backend (`api/ha/icons`), State-/Range-/Domain-Lookup (`_lookupHAIcon`/`_getEntityIcon`/`_iconColor`), alles als private Instanzmethoden ohne geteiltes Modul (anders als `ha-entity-cache.ts` für States). **Kein Quick-Win** — entweder ~60-80 Zeilen duplizieren (schnell, aber Schulden) oder sauber extrahieren (richtig, aber kein "sehr schnell").
- Entscheidung: **Icon fällt aus v1 raus**, bleibt reiner Text. Separat als Folge-Idee festgehalten (siehe unten). User: "sehr gut".
- Flags: Folge-Idee "WatchTab-Icon-Resolver in geteiltes Modul extrahieren, dann auch im Picker (und ggf. weiteren Stellen) nutzen" -> spätere Session/Entscheidung

### Q4 — Filterverhalten

- Gefragt: Filter nur auf Entity-ID (wie heute) oder auch auf State-Wert matchen?
- Erfasst: **Nur ID**, wie bisher. State-Filterung explizit nicht Teil des Features (User: "nur id").
- Flags: keine

### Q5 — Fehlender State

- Gefragt: Was passiert, wenn eine Entity-ID nicht in `cachedEntities` gefunden wird?
- Erfasst: Zeile zeigt **kein State-Feld** (kein Platzhalter wie "—", einfach weggelassen). ID bleibt trotzdem klickbar/einfügbar — State-Preview ist Bonus, kein Blocker. User: "ja".
- Flags: keine

### Q6 — Reichweite (nur Ctrl+E-Picker, oder auch anderswo?)

- Gefragt: Sollte das Feature auch für andere Entity-Listen gelten (z.B. `event-inspector.ts`, `settings-view.ts`)?
- Erfasst: Recherchiert — beide nutzen `window.allEntities`, aber für **native `<input list>`/`<datalist>`-Autocomplete** (browser-natives Rendering, keine formatierten/reichen Zeilen möglich). `<entity-picker-modal>` ist technisch die einzige Stelle mit eigener Custom-Liste. Feature bleibt **exklusiv im Ctrl+E-Picker**. User: "ja".
- Flags: keine

### Q7 — Wann wird gefetcht?

- Gefragt: Fetch nur wenn Toggle beim Öffnen schon aktiv ist, oder immer prophylaktisch beim Öffnen?
- Erfasst: **Nur wenn Toggle aktiv ist** (spart Requests für Nicht-Nutzer). Mid-Session-Einschalten löst Nachladen aus (kurzer Ladezustand ok, Cache greift meist eh schon). User: "ok".
- Flags: keine

### Q8 — Icon für den Toggle-Button

- Gefragt: Welches mdi-Icon für den Umschalter?
- Erfasst: `mdi-eye-outline` (aus) / `mdi-eye` (an). User: "ist in Ordnung".
- Flags: keine

## Open flags (pending input)

- Folge-Idee: WatchTab's Icon-Resolver-Logik (`_lookupHAIcon` & Co., inkl. `api/ha/icons`-Fetch) in ein geteiltes Modul extrahieren (z.B. `ha-icon-resolver.ts` neben `ha-entity-cache.ts`), dann optional auch im Entity Picker (und ggf. anderen Stellen) für farbige/State-abhängige Icons nutzen -> eigene spätere Entscheidung, nicht Teil von v1
