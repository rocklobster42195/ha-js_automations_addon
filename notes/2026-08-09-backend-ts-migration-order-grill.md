# Backend TS Migration Order: Grill / Discovery Notes

Date: 2026-08-09 · Goal: Concretize RFC_FRONTEND_MODERNIZATION.md Abschnitt 8 ("Modul für Modul auf .ts, Reihenfolge nach Kritikalität") into an actual file-by-file order for `js_automations/core` (+ `routes`/`services`), decide how much backend test coverage must exist before each rename, and find edge-case handling from the original JS authoring that may have overcomplicated things and could be simplified once real types land.

## Summary / key decisions

**Scope:** Nicht die exakte Datei-Reihenfolge, sondern die **Methodik** für den in RFC Abschnitt 8 offen gelassenen Schritt "Modul für Modul auf .ts, Reihenfolge nach Kritikalität" (Q1).

**Die Methodik, Schritt für Schritt:**

1. **Rename-Prinzip:** Leaf-first nach Abhängigkeitsgraph — Module ohne interne `require('./...')`-Abhängigkeiten zuerst, dann ihre Konsumenten, `kernel.js` (Fan-in auf fast alles) zuletzt (Q4).
2. **Test-Tiefe:** Nicht jedes Modul bekommt vorab Tests — nur die als riskant eingestuften (Q2).
3. **Risiko-Kriterien (alle drei zusammen, kein Einzelkriterium reicht):** hoher Fan-in/Blast-Radius, hohe Verzweigungs-/Edge-Case-Dichte, vergangene Bugs/Incidents (Q3). Daraus ergeben sich `kernel.js`, `worker-wrapper.js`, `entity-manager.js` als klare Kandidaten.
4. **Überkomplizierungs-Audit:** Für diese riskanten Module erst ein dedizierter Lesedurchgang, der verdächtige Edge-Case-Handler markiert (redundante Checks, nie erreichbare Zweige, doppelte Absicherung die HA-Lib/Node schon übernimmt) — Ergebnisse werden vorgelegt und bestätigt, BEVOR dafür Tests geschrieben werden (Q5, konsistent mit `[[feedback_flag_bugs_found_incidentally]]`).
5. **Validierungsgate pro Rename-Schritt:** `npm run typecheck` sauber + `npm run test:backend` grün + `test/boot.test.js` grün + zusätzlich manueller Check im laufenden Addon (via `[[reference_run_jsa_web_driver]]`) für Module mit UI-sichtbarem/funktionalem Effekt (Q6).
6. **PR-Granularität:** Ein Commit/PR pro umbenanntem Modul — kleinstmöglicher Blast-Radius, trivialer Revert (Q7).
7. **Branch/Timing:** Erst den laufenden Mobile-View-Meilenstein auf `feature/lint-prettier-ci-foundation` fertigstellen/mergen, danach eigener neuer Branch nur für die Backend-TS-Migration (Q8). `routes/`/`services/` folgen später demselben Prinzip, kein separater Zeitplan nötig.

**Nebenbefund (Q9, kein Teil der Migrations-Methodik selbst):** Der Nutzer möchte während mehrstufiger Umsetzungen gelegentliche Zwischenstände — nicht nach jedem Schritt, aber auch nicht nur am Ende. Generelles Arbeitsverhalten, nicht migrationsspezifisch.

**Bereits vorhandener Unterbau (aus Repo-Analyse, nicht neu entschieden):** `checkJs`/`allowJs` bereits aktiv (M1 erledigt), Lint/Format/Test-Gate bereits scharf in `tools/release.js` + `ci.yml` (M0/M3 erledigt). Es fehlt nur die per-Modul-Testabdeckung in `core/` (M2 unvollständig) — genau die Lücke, die Q2/Q3 jetzt gezielt schließen, statt pauschal überall Tests nachzuziehen.

## Context established by reading the repo (not asked, already known)

- `tsconfig.json` already has `checkJs`+`allowJs` on for `js_automations/{server.js,core,routes,services}` + `tools` — M1 from the old RFC is live. Backend is CommonJS, staying CommonJS.
- Gate is already wired (M3 done): `tools/release.js` runs `lint && test` before tag/push; `.github/workflows/ci.yml` runs lint+format:check+test on push/PR to main.
- Backend test coverage today is exactly one file: `test/boot.test.js` (spawns the real server, hits `/api/status`). No unit tests exist yet for any individual `core/` module. `npm run test:backend` = `node --test test/**/*.test.js`.
- `core/` has 28 files. Internal `require('./...')` dependency graph:
  - Zero internal deps (leaves): `script-header-parser`, `config`, `settings-schema`, `ha-history-helpers`, `fs-service`, `capability-analyzer`, `sibling-guard`, `log-manager`, `store-manager`, `state-manager`, `ha-connection`, `compiler-manager`, `blockly-compiler`, `bridge`, `dev-setup`, `type-definition-generator`, `script-command-router`, `mqtt-manager`, `webhook-manager`, `card-manager`* , `dependency-manager`_, `store-type-generator`_ (*these three depend only on the leaves above)
  - `script-watcher` -> `script-header-parser`
  - `settings-manager` -> `settings-schema`, `config`
  - `worker-manager` -> `script-header-parser`
  - `worker-wrapper` -> `ha-history-helpers`, `fs-service` (dynamic require)
  - `entity-manager` -> `script-header-parser`, `script-watcher`, `script-command-router`, `type-definition-generator`
  - `kernel.js` -> requires almost everything (the orchestrator/singleton wired at boot) — highest fan-in, highest blast radius.
- `routes/` (6 files) and `services/` (1 file: `system-service.js`) are also in the `checkJs` scope already but not mentioned as separately ordered in the RFC.
- Existing note `notes/2026-08-01-lit-ts-lint-test-expansion-grill.md` already settled M0-M3 sequencing and confirmed "Test Infra" (M2) should prioritize the boot smoke test — which exists — but per-module `core/` test coverage was never actually built out despite being in scope.

## Q&A log

### Q1 — Session scope: konkrete Reihenfolge oder Vorgehensweise?

- Asked: Ist das Ziel eine konkrete Datei-Reihenfolge für core/ (+ ggf. routes/, services/), oder etwas anderes?
- Captured: "Es muss nicht konkret sein, aber mich interessiert, dass wie wir es angehen" — Fokus liegt auf der **Vorgehensweise/Methodik** (Prozess, Reihenfolge-Prinzip, Test-Strategie, wie man Überkomplizierung findet), nicht auf einer fest ausgearbeiteten Datei-für-Datei-Rangliste. Eine grobe Priorisierung (Prinzip, nicht exakte Liste) ist trotzdem hilfreich als Beispiel/Anwendung der Methodik.
- Flags: keine

### Q2 — Test-Tiefe pro Modul vor dem Rename

- Asked: Welche Art Test soll pro Modul vor dem .ts-Umbau entstehen — Charakterisierungstests überall zuerst, volle Unit-Tests überall direkt, oder Tests nur für die riskantesten Module?
- Captured: "Nur für die riskantesten Module" — einfache Leaf-Module (config, settings-schema, script-header-parser, ...) werden ohne Vorab-Test umbenannt (geringes Risiko), Tests konzentrieren sich auf die kritischen/stark verzweigten Module (Kandidaten aus dem Dependency-Graph: kernel.js, worker-wrapper, entity-manager — evtl. weitere, noch zu klären welche genau "riskant" heißt).
- Flags: genaue Kriterien für "riskant" (Verzweigungsgrad? Fan-in? Häufigkeit von Bugs in der Vergangenheit?) -> nächste Frage

### Q3 — Kriterien für "riskant genug für Tests vorab"

- Asked: Drei vorgeschlagene Signale (Fan-in/Blast-Radius, Verzweigung/Edge-Case-Dichte, vergangene Bugs/Incidents) — welche sollen zählen?
- Captured: Alle drei bestätigt — Fan-in/Blast-Radius, Verzweigungs-/Edge-Case-Dichte, und Bug-/Incident-Historie zählen gemeinsam als Risiko-Signal. Kein einzelnes Kriterium reicht allein.
- Flags: keine — führt zu konkreter Modul-Einordnung: `kernel.js` (max. Fan-in, war Ursache des PROD-Startup-502-Bugs, siehe `[[project_startup_502_fix]]`), `worker-wrapper.js` (führt Nutzerskripte in Sandbox aus, historisch viel Edge-Case-Handling — genau der Verdachtsbereich für Überkomplizierung), `entity-manager.js` (hoher Fan-in unter den Nicht-Kernel-Modulen, koordiniert mehrere Submodule) sind die klaren Kandidaten für Vorab-Tests.

### Q4 — Rename-Reihenfolge-Prinzip

- Asked: Leaf-first nach Abhängigkeitsgraph, Risiko zuerst, oder Änderungshäufigkeit (Git-Historie)?
- Captured: "Leaf-first nach Abhängigkeitsgraph" bestätigt — erst Module ohne interne Abhängigkeiten, dann Konsumenten, `kernel.js` zuletzt. Tests für die riskanten Module (Q2/Q3) werden davon entkoppelt vorgezogen geschrieben, unabhängig vom tatsächlichen Rename-Zeitpunkt dieser Module.
- Flags: keine

### Q5 — Wie wird Überkomplizierung konkret gefunden?

- Asked: Dedizierter Lesedurchgang vor den Tests, organisch beim Testschreiben, oder beides?
- Captured: "Dedizierter Lesedurchgang vor den Tests" bestätigt — pro riskantem Modul (kernel.js, worker-wrapper, entity-manager) erst ein gezielter Review-Durchgang, der verdächtige Edge-Case-Handler markiert (redundante Checks, nie erreichbare Zweige, doppelte Absicherung die schon HA-Lib/Node übernimmt). Ergebnisse werden vorgelegt und bestätigt, BEVOR dafür Tests geschrieben werden — konsistent mit `[[feedback_flag_bugs_found_incidentally]]`.
- Flags: keine

### Q6 — Validierungsgate pro Rename-Schritt

- Asked: Reicht automatisiert (tsc + Backend-Tests + Boot-Smoke-Test), oder zusätzlich manueller Check im echten Addon?
- Captured: "Zusätzlich manueller Check im echten Addon" bestätigt — pro Modul-Rename gilt als sicher gelandet: `npm run typecheck` sauber + `npm run test:backend` grün (inkl. evtl. Modul-Tests aus Q2/Q3) + `test/boot.test.js` grün, UND zusätzlich ein manueller Durchlauf im laufenden Addon (z.B. via `[[reference_run_jsa_web_driver]]`) für Module mit UI-sichtbarem/funktionalem Effekt.
- Flags: keine — offen bleibt, für welche Module der manuelle Check "UI-sichtbar genug" ist um ihn zu rechtfertigen (z.B. bei reinen internen Utilities wie `config.js` vermutlich verzichtbar) -> Praxisentscheidung im Einzelfall, kein separates Kriterium nötig

### Q7 — Commit-/PR-Granularität

- Asked: Ein Commit/PR pro Modul, oder gruppiert nach Abhängigkeitsstufe?
- Captured: "Ein Commit/PR pro Modul" bestätigt — kleinstmögliche Einheit, Blast-Radius bei Problemen auf ein Modul begrenzt, Revert trivial.
- Flags: keine

### Q8 — Branch/Timing

- Asked: Auf welchem Branch/wann startet die Test-Vorarbeit + der erste Rename, relativ zum laufenden Mobile-View-Meilenstein auf `feature/lint-prettier-ci-foundation`?
- Captured: "Neuer eigener Branch, nach Mobile View" bestätigt — Mobile View auf `feature/lint-prettier-ci-foundation` wird erst fertiggestellt/gemerged, danach eigener neuer Branch nur für die Backend-TS-Migration. Keine Vermischung mit dem laufenden Frontend-Meilenstein.
- Flags: keine

### Q9 — Ergänzung: Zwischenstände während der Umsetzung

- Asked: Was fehlt noch?
- Captured: "Gib mir unterwegs immer mal wieder einen Zwischenstand, wie weit wir sind. Nicht jedes Mal, aber ab und zu." — Prozess-/Kommunikationswunsch für die spätere Umsetzung dieser Migration (und generell): gelegentliche Fortschritts-Zwischenstände, nicht nach jedem einzelnen Schritt, aber auch nicht nur am Ende. Kein festes Intervall genannt — Ermessensfrage, wann "ab und zu" greift (z.B. nach Abschluss einer Abhängigkeitsstufe, nicht nach jedem einzelnen Modul).
- Flags: Kandidat für eine dauerhafte Feedback-Memory (allgemeines Arbeitsverhalten, nicht nur für diese Migration) -> bei Graduation berücksichtigen

## Open flags (pending input)

- Ob ein Modul "UI-sichtbar genug" für den manuellen Addon-Check (Q6) ist, wird pro Fall entschieden, kein festes Kriterium -> Praxisentscheidung bei Umsetzung

## Addendum — Umsetzungsbeginn 2026-08-09 (gleicher Tag, direkt im Anschluss)

- **Branch-Entscheidung revidiert:** Q8 sah vor, erst `feature/lint-prettier-ci-foundation` nach `main` zu mergen und dann von `main` abzuzweigen. Bei der tatsächlichen Umsetzung entschieden: stattdessen direkt von `feature/lint-prettier-ci-foundation`s aktuellem HEAD abzweigen (neuer Branch `feature/backend-ts-migration`), ohne auf den `main`-Merge zu warten. Der `main`-Merge des Frontend-Branches bleibt ein separates, späteres Vorhaben.
- **Neuer technischer Befund, nicht Teil der ursprünglichen Methodik-Fragen:** Das Backend hat aktuell keinen Laufzeit-Build-Schritt. Ein echtes `.ts`-Rename hätte `require('./modul')` beim Boot brechen lassen. Node 24 (lokale Dev-Version) führt `.ts`-Dateien zwar nativ aus (verifiziert: Type-Stripping funktioniert ohne Flag), aber `require()` löst die `.ts`-Endung nur explizit auf (`require('./modul.ts')`), nicht implizit wie bei `.js`. Zusätzliches Risiko: das Docker-Base-Image (`ghcr.io/home-assistant/{amd64,aarch64}-base:latest`) installiert Node per `apk add nodejs` ungepinnt — keine Garantie, dass die Produktionsumgebung dauerhaft eine Node-Version mit nativer `.ts`-Unterstützung hat.
- **Erwogen und verworfen: Node-Version im Dockerfile pinnen** (Multi-Stage-Copy von `node:24-alpine`, Dependabot-Docker-Ecosystem für automatische Versions-Updates) + überall explizite `.ts`-Endung bei `require()`. Verworfen, weil: (1) dauerhafte Änderung an jeder `require()`-Stelle jedes umbenannten Moduls, (2) Multi-Arch-Docker-Binärkompatibilität (amd64/aarch64) nicht lokal verifizierbar, (3) widerspricht dem bereits in RFC Abschnitt 4 angelegten Plan ("Sobald TS-Kompilierung [...] dazukommen, muss ein Build-Step ins Dockerfile").
- **Entschieden: echter `tsc`-Compile-Schritt für das Backend**, analog zum bestehenden esbuild-Bundling fürs Frontend. `tsc` emittiert `.js` unter demselben Dateinamen/derselben Struktur wie die `.ts`-Quelle — bestehende `require()`-Aufrufe bleiben unverändert, keine Abhängigkeit von der im Docker-Base-Image installierten Node-Version. Mechanik: separate Backend-Build-Config, Integration in `npm run build` + `Dockerfile` (bestehender `RUN npm run build`-Schritt deckt jetzt beides ab), `npm run dev`/nodemon kompiliert vor jedem Neustart, kompiliertes Backend-Output kommt in `.gitignore` (analog `public/js/dist/`).
- **RFC Abschnitt 4 entsprechend aktualisiert** (siehe `docs/RFC_FRONTEND_MODERNIZATION.md`), da dort "TS-Kompilierung" als Build-Step-Trigger bereits vorgesehen war — dieser Umsetzungsschritt konkretisiert das nur, ändert keine frühere Entscheidung.
