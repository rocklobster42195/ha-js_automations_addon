# 🔥 Konzept: Frontend-/Backend-Modernisierung (LIT, TypeScript, Lint, Test, CSS-Tokens)

Dieses Dokument beschreibt den Plan, das bestehende Vanilla-JS Frontend (`js_automations/public`) auf [LIT](https://lit.dev) (Web Components) umzustellen, das Backend schrittweise auf TypeScript zu heben, Lint/Test-Infrastruktur einzuführen und die CSS-Grundlage auf ein definiertes Token-System zu bringen. Ersetzt das frühere `RFC_LIT_MIGRATION.md`.

Ziel-Version: nächste **Major-Version**.

## 0. Ziele

- **"Aus einem Guss"**: konsistentes Look & Feel über alle Bereiche (Editor, Store Explorer, Logs, Settings, Watch, MQTT-Monitor, ...) durch ein definiertes, systematisches CSS-Token-Set statt gewachsenem Wildwuchs.
- **Mobil nutzbar**: Skriptstatus prüfen, Skript starten/stoppen/neustarten, Logs lesen — ohne dass dafür der Editor/volle Desktop-Oberfläche nötig ist.
- **Weniger manuelles DOM-Handling**: reaktive Properties statt manueller `innerHTML`/`querySelector`-Updates.
- **Typsicherheit** im Backend, ohne Modulsystem-Umstieg (CommonJS bleibt).
- **Automatisierte Qualitätssicherung** (Lint, Tests) — ohne die bestehende Release-Pipeline anzufassen.
- **Kein Big-Bang**: Migration bei laufendem Betrieb, Komponente für Komponente, Meilenstein für Meilenstein.
- **Das Addon muss jederzeit startbar/funktionsfähig bleiben** — jeder neue Build-/Gate-Mechanismus ist so konstruiert, dass ein Fehler das _Entstehen_ eines neuen Release/Images verhindert, niemals den _Betrieb_ eines bereits laufenden Addons gefährdet.

## 1. Warum LIT? (unverändert aus altem RFC)

1. **Standardbasiert:** Web Components (`CustomElementRegistry`, Shadow DOM) — kein proprietäres Laufzeit-Framework, kein Vendor-Lock-in.
2. **Inkrementell einsetzbar:** Jede LIT-Komponente ist ein normales `<my-component>`-Element, einzeln einhängbar in `index.html`, während der Rest Vanilla-JS bleibt.
3. **Klein:** ~5 kB Kern-Runtime, kein zwingender Build-Step für den Betrieb selbst.
4. **Style-Isolation ohne Verlust an Konsistenz:** Shadow DOM kapselt Komponenten-Styles, CSS Custom Properties (Design-Tokens) durchdringen die Kapselung.
5. **TypeScript first-class:** Reaktive Properties per Decorator, passt zu `ha-api.d.ts`.
6. **Geringe Lernkurve:** Kein RxJS, keine DI-Container, keine Modul-Bürokratie.

## 2. CSS-Design-Tokens ("aus einem Guss mit HA")

**Kontext:** Das Addon läuft im HA-Ingress-iFrame (`config.yaml: ingress: true`). Ein iFrame ist ein eigenes Dokument — HAs CSS-Variablen (`--primary-color`, `--card-background-color`, ...) werden **nicht automatisch vererbt**. Eine Live-Synchronisation mit dem tatsächlichen HA-Theme des Nutzers würde eine Laufzeitabhängigkeit einführen, die dem Ziel "jederzeit startbar" widerspricht.

**Entscheidung:** Dark-only bleibt (keine Light-Mode-Unterstützung, keine Live-Theme-Synchronisation). Stattdessen wird der bestehende Grauton-Wildwuchs in `style.css` (`--bg`, `--side`, `--main`, `--border`, `--modal-bg`, `--input-bg`, `--text-main`, `--text-sec`, `--text-dim` — 9 Ad-hoc-Variablen) auf ein systematisches Set reduziert:

- **Flächen (3 Stufen):**
  - `--surface-0` — Seiten-Hintergrund (ersetzt `--main`)
  - `--surface-1` — Sidebar/Panels (ersetzt `--side`)
  - `--surface-2` — erhöht: Modals, Inputs, Cards, Hover (ersetzt `--modal-bg` **und** `--input-bg`, die aktuell zwei fast identische Werte sind)
- **Rand (1 Stufe):** `--border`
- **Text (3 Stufen):** `--text-primary`, `--text-secondary`, `--text-muted`
- **Akzent/Status bleiben semantisch, zählen nicht als Grauton:** `--accent`, `--success`, `--danger`, `--warning`

Jede Verwendungsstelle im Code muss auf eine der drei Flächen-Stufen abgebildet werden — keine Ad-hoc-Einzelfarbe mehr pro Komponente. Tokens werden zentral in `tokens.css` gesammelt, referenziert von jeder LIT-Komponente über `:host`.

## 3. Release-Pipeline-Schutz

Die bestehende Release-Pipeline (`npm run ship:patch/minor/major/beta`, `tools/release.js`, `.github/workflows/release.yml`) bleibt **strukturell unangetastet** — insbesondere `release.yml`, das erst auf `release: published` triggert und daher für ein echtes Gate zu spät ist (Tag+Release existieren zu dem Zeitpunkt schon).

Schutz läuft stattdessen zweistufig:

1. **Sichtbarkeit:** neuer, separater CI-Workflow (`.github/workflows/ci.yml`) auf `push`/`pull_request` gegen `main` — führt Lint + Tests aus, zunächst rein informativ (kein Merge-Zwang).
2. **Echtes Gate:** `tools/release.js` führt vor dem Taggen/Pushen `npm run build && npm run lint && npm test` aus und bricht bei Fehler ab. Das ist die einzige Stelle vor der Veröffentlichung — verhindert zugleich, dass ein Tag/GitHub-Release entsteht, für den der nachgelagerte Docker-Build in `release.yml` dann fehlschlagen würde.

## 4. Docker-Build-Sicherheit

Build-Step im `Dockerfile` (`RUN npm run build`) existiert bereits für das esbuild-Bundling des LIT-Frontends (produziert nach `public/js/dist/`). **Entschieden 2026-08-09 beim Start der Backend-TS-Migration:** Backend-`.ts`-Dateien werden über denselben Build-Step per `tsc` **zu Plain-JS kompiliert** (nicht nativ über Node's Type-Stripping ausgeführt) — `tsc` emittiert `.js` unter demselben Dateinamen/derselben Ordnerstruktur wie die `.ts`-Quelle, sodass bestehende `require('./modul')`-Aufrufe **unverändert** bleiben. Erwogene Alternative (Node-Version im Dockerfile pinnen + native `.ts`-Ausführung + explizite `.ts`-Endung an jeder `require()`-Stelle) wurde verworfen: sie hätte eine Node-Versionsgarantie über das ungepinnte `ghcr.io/home-assistant/*-base:latest`-Image hinweg gebraucht (Multi-Arch-Risiko, nicht lokal verifizierbar) und jede `require()`-Stelle dauerhaft angefasst — der Compile-Weg braucht keins von beidem und ist unabhängig von der im Base-Image installierten Node-Version. Volle Abwägung in `notes/2026-08-09-backend-ts-migration-order-grill.md` (Addendum).

**Warum das sicher ist:** Schlägt der Build (esbuild ODER `tsc`) fehl, schlägt der gesamte Docker-Image-Build fehl — es entsteht schlicht kein neues Image, und Nutzer, die bereits ein älteres Image laufen haben, sind davon nicht betroffen. Kein Szenario eines halb-kaputten Deploys zur Laufzeit.

## 5. Meilenstein-Plan

Reihenfolge, jeder Meilenstein für sich lauffähig. **M0–M3 sind reiner Unterbau ohne User-sichtbaren Effekt und werden als ein gebündelter Release ausgeliefert** (kein eigener Release pro Schritt). Ab M4 wieder Einzel-Releases/Beta-Kanal pro sichtbarem Schritt.

1. **M0 — Foundation:** ESLint + Prettier-Config, `npm run lint`/`format`, sichtbarer CI-Workflow (informativ).
2. **M1 — TS Groundwork:** `checkJs` + `allowJs` in `tsconfig.json`, bestehende Typfehler schrittweise fixen, keine Umbenennungen. Läuft weiter als reines JS in Prod — kein Laufzeitrisiko.
3. **M2 — Test Infra:** Vitest/Node-Test-Runner für `core/`, `services/`, `routes/`. Priorität: ein **Boot-Smoke-Test** ("Server startet und beantwortet Health-Check") — direkt motiviert durch den früheren PROD-Startup-Bug (siehe `[[project_startup_502_fix]]`-Memory).
4. **M3 — Gate wired:** Pre-Tag-Gate aus Abschnitt 3 in `tools/release.js` scharf schalten, CI-Workflow zum required check machen. **Zusätzlich:** Build-Prozess in `TECH-README.md` dokumentieren (Dockerfile-Build-Step, Pre-Tag-Gate, TS/Lint/Test-Setup).
5. **M4 — CSS Tokens:** `tokens.css` extrahieren nach Abschnitt 2.
6. **M5+ — LIT Phase A:** Komponenten nacheinander, siehe Abschnitt 6.
7. **Laufend, ohne feste Deadline:** TS-Datei-für-Datei-Umstellung (Backend); LIT Phase B nach Blockly-Merge (siehe Abschnitt 6).

## 6. LIT-Komponenten: Reihenfolge des inkrementellen Austauschs

Unverändert aus dem alten RFC übernommen — die Begründung (Vermeidung von Merge-Konflikten mit `feature/blockly-integration`) gilt weiterhin uneingeschränkt.

> **Abhängigkeit Blockly:** `feature/blockly-integration` (eigener Worktree `C:\dev\ha-js_automations_addon-blockly`) überschneidet sich per Drei-Punkt-Diff zum gemeinsamen Vorfahren (`631d75d`) signifikant nur mit `tab-manager.js` und `creation-wizard.js` (trivial: `script-list.js`, `app.js`). Alle anderen Bereiche sind unbetroffen.

**Phase A — jetzt sicher:**

1. `<integration-banner>`, `<safe-mode-banner>`
2. `<log-viewer>`
3. `<status-bar>`, `<mqtt-monitor>`, `<watch-panel>`, `<webhook-panel>`
4. `<store-explorer>`, `<event-inspector>`, `<settings-view>`
5. `<app-sidebar>` + `<script-row>`/`<script-group>`
6. `<card-preview>`, Dialoge (`<store-item-modal>`, `<confirm-dialog>`, `<alert-toast>`, `<entity-picker-modal>`)

**Phase B — erst nach dem Blockly-Merge:** 7. `<script-modal>` (`creation-wizard.js`) 8. `<editor-view>` + `<monaco-editor>` (`tab-manager.js`, komplexeste Komponente, zuletzt)

Solange eine Komponente noch nicht migriert ist, bleibt ihr Vanilla-JS-Pendant unverändert in Betrieb.

**Neuer Meilenstein, angehängt an Phase A (nicht blockiert durch Item 6, da nur von bereits fertigen Komponenten abhängig):** siehe Abschnitt 7 — Mobile View.

## 7. Mobile View

**Ziel (siehe Abschnitt 0):** Skriptstatus prüfen, Skript starten/stoppen/neustarten, Logs lesen — ohne Editor/volle Desktop-Oberfläche. Ergänzt `<app-sidebar>` (Phase A Item 5, bereits fertig) um einen eigenständigen Mobile-Modus statt eines vollständig responsiven Ports der gesamten App. Läuft als neuer Meilenstein auf demselben Branch (`feature/lint-prettier-ci-foundation`) weiter, kein separates späteres Vorhaben.

**Detection:** `matchMedia('(max-width: 768px)')`, live-reagierend auf Resize/Rotation (kein einmaliges User-Agent-Sniffing).

**Umschalter:** Neuer Header-Actions-Button (mobile ⇄ desktop), Icons `mdi-cellphone`/`mdi-monitor` je nach aktuellem Modus. Sichtbarkeit im Desktop-Modus über neues Setting "Im Desktopmode verbergen" (`<settings-view>`, Default **aus**) steuerbar; im Mobile-Modus immer sichtbar. Manuelle Wahl persistiert in `localStorage`, übersteuert Auto-Detection bis erneut umgeschaltet.

**Zwei Mobile-"Screens"** (Wechsel über eigenen Header-Actions-Button, keine Bottom-Tab-Bar — würde mit der bottom-verankerten `<status-bar>` kollidieren):

1. **Dashboard** — Skriptliste (Start/Stop/Health-Fokus), `<status-bar>` bleibt sichtbar. Tap auf eine Zeile klappt die (heute nur per Hover erreichbaren) Detail-Infos (RAM/Last-Started/Capabilities/Conflicts) inline auf.
2. **Log** — `<log-viewer>` weitgehend unverändert wiederverwendet (globaler Stream, kein Pro-Skript-Filter in v1). `<status-bar>` hier ausgeblendet, Platz für den Log-Stream.

**Out of scope für v1:** Editor/Tabs, Store Explorer, Event Inspector, MQTT-Monitor, Watch-Panel. Entsprechend sind "New Script" und "Store Explorer" im mobilen Header ausgeblendet; "Settings" bleibt (dort lebt das neue Setting).

**Collapse-all-Button** (neben dem Suchfeld, gilt für Desktop **und** Mobile): klappt alle Skript-Gruppen auf einmal ein (nutzt den bestehenden `js_collapsed_sections`-Mechanismus für alle Gruppen statt einzeln), Zustand persistiert. Icons `mdi-unfold-less-horizontal`/`mdi-unfold-more-horizontal` — bewusst anders als der Pro-Gruppen-Chevron.

**Code-Suche:** Suchfeld matcht zusätzlich zu `name`/`filename`/`description`/`area`/`label` jetzt auch den Skript-Code, über einen neuen Backend-Suchendpoint (kein Client-seitiges Prefetch-all). Kein separater Modus/Toggle — fließt still ins bestehende Suchfeld ein, debounced (~300ms).

**Icon-Rename (Kollateral):** Da es noch keine Nutzer gibt, wird `mdi-view-dashboard-outline` dem neuen Dashboard-Screen zugeordnet; Card-Editor/Card-Capability-Badges (`card-preview.ts`, `script-row.ts`, `tab-manager.js`) wechseln auf `mdi-card-text-outline` (passender: HA-Lovelace-"Cards", kein generisches Dashboard). **Dabei beachten:** `tab-manager.js:362` hat einen toten Ternary (beide Zweige identisch `mdi-view-dashboard-edit-outline`) — beim Rename mit anfassen/entscheiden.

**Details/Herleitung:** volle Diskussion in `notes/2026-08-07-mobile-view-grill.md`.

## 8. Backend auf TypeScript

1. `checkJs` + `allowJs` in `tsconfig.json` aktivieren (M1, erledigt), bestehendes JS ohne Umbenennung typprüfen lassen, Fehler schrittweise beheben.
2. `ha-api.d.ts` als Referenz für Nutzerskript-Typen bleibt unverändert bestehen; interner Backend-Code bekommt eigene Typen.
3. CommonJS-Modulsystem bleibt — kein Umstieg auf ESM als Teil dieses Workstreams.
4. **Methodik für den eigentlichen Datei-für-Datei-Umbau (`core/`, später `routes/`/`services/` nach demselben Prinzip), entschieden 2026-08-09 (`notes/2026-08-09-backend-ts-migration-order-grill.md`):**
   - **Rename-Reihenfolge:** leaf-first nach dem internen `require()`-Abhängigkeitsgraph — Module ohne interne `core/`-Abhängigkeiten zuerst, dann ihre Konsumenten, `kernel.js` (höchster Fan-in, zur Boot-Zeit fast überall verdrahtet) zuletzt.
   - **Tests vor dem Rename sind selektiv, nicht flächendeckend:** die meisten Module werden ohne vorherigen Test direkt umbenannt. Nur Module, die den Risiko-Maßstab unten erfüllen, bekommen vorab Charakterisierungs-/Unit-Tests — entkoppelt vom tatsächlichen Zeitpunkt ihres Renames in der leaf-first-Reihenfolge.
   - **Risiko-Maßstab (alle drei Signale zusammen, kein einzelnes reicht):** hoher Fan-in/Blast-Radius, hohe Verzweigungs-/Edge-Case-Dichte, vergangene Bugs/Incidents. Aktuell erfüllen `kernel.js` (siehe `[[project_startup_502_fix]]`), `worker-wrapper.js` (führt Nutzerskripte in einer Sandbox aus, historisch am meisten Edge-Case-Handling) und `entity-manager.js` (höchster Fan-in unter den Nicht-Kernel-Modulen) diesen Maßstab.
   - **Überkomplizierungs-Suche:** für diese Risiko-Module erst ein dedizierter Lesedurchgang, der verdächtige Edge-Case-Handler markiert (redundante Checks, nie erreichbare Zweige, doppelte Absicherung die Node/die HA-Lib schon übernimmt) — Ergebnisse werden vorgelegt und bestätigt, bevor dafür Tests geschrieben werden. Kein organisches "nebenbei beim Testen finden".
   - **Validierungsgate pro Rename-Schritt:** `npm run typecheck` sauber + `npm run test:backend` grün (inkl. evtl. neuer Modul-Tests) + `test/boot.test.js` grün, zusätzlich ein manueller Check im laufenden Addon für Module mit UI-sichtbarem/funktionalem Effekt.
   - **Ein Commit/PR pro umbenanntem Modul** — kleinstmöglicher Blast-Radius, trivialer Revert.
   - **Start:** erst nach Abschluss/Merge des laufenden Mobile-View-Meilensteins (Abschnitt 7) auf `feature/lint-prettier-ci-foundation`, dann auf einem eigenen neuen Branch — keine Vermischung mit dem Frontend-Branch.

## 9. Lint & Test

1. **Lint:** ESLint + Prettier-Baseline für `js_automations/` (Backend + Frontend), Konfiguration committen (M0).
2. **Test — Backend zuerst:** Vitest oder Node-Test-Runner für `core/`, `services/`, `routes/`; Boot-Smoke-Test hat Priorität (M2).
3. **Test — Frontend danach:** `@open-wc/testing` für neue LIT-Komponenten, sobald vorhanden. Kein nachträgliches Testen des auslaufenden Vanilla-Codes.

## 10. i18n

Keine Änderung nötig — `i18next` bleibt, Übersetzungsdateien (`locales/de|en/translation.json`) weiter pflegen wie bisher, auch wenn Komponenten auf LIT umgestellt werden.

## 11. State-Management (unverändert aus altem RFC)

Kein zentraler Store nötig für den Start — bestehende Muster bleiben, nur reaktiv gekapselt. Gemeinsam benötigter State über ein leichtgewichtiges Pub/Sub-Modul (`script-state.js`, kein RxJS). Bei wachsendem Bedarf später evaluierbar: [`@lit/context`](https://lit.dev/docs/data/context/).

## 12. Vorarbeiten (unabhängig vom Zeitpunkt der Komponenten-Migration)

- **CSS aufteilen:** `style.css` (2300+ Zeilen) in komponentenausgerichtete Dateien trennen — eigenes Vorhaben, siehe `[[project_css_split]]`-Memory, nicht mit dieser Migration vermischen.
- **`window.*`-Globals inventarisieren:** aktuell ca. 80 globale Funktionen/Variablen — für jede neue Komponente klären, welche abgelöst werden.
- **Socket-Events katalogisieren** (Server→Client/Client→Server, Payload-Form).
- **REST-API katalogisieren** — größtenteils bereits in `api.js` gekapselt.
- **Monaco-Facade extrahieren** vor der `<monaco-editor>`-Migration (`init`, `getValue`, `setValue`, `setLanguage`, `onDidChangeContent`, `layout`).
- **Inline-Styles aus JS entfernen** (außer dynamisch berechnete Werte) — LIT-Templates arbeiten mit `classMap`/`styleMap`.
