# Lit/TS/Lint/Test Expansion: Grill / Discovery Notes

Date: 2026-08-01 · Goal: Turn the existing LIT-migration RFC (docs/RFC_LIT_MIGRATION.md, sections 7+8) into a concrete milestone plan that adds TypeScript, lint, and testing — without ever breaking the release pipeline or addon startability. Also nail down the "aus einem Guss mit HA" CSS token strategy.

## Summary / key decisions

- **Ersetzt, nicht ergänzt:** Dieses Ergebnis ersetzt `docs/RFC_LIT_MIGRATION.md` komplett als neuer Plan `docs/RFC_FRONTEND_MODERNIZATION.md` (4 Workstreams: LIT, TypeScript, Lint/Test, CSS-Tokens). Altes RFC wird danach gelöscht.
- **Meilensteine, in Reihenfolge, M0-M3 als ein gebündelter Release:**
  1. M0 Foundation — ESLint+Prettier, `npm run lint`, sichtbarer CI-Workflow (informativ)
  2. M1 TS Groundwork — `checkJs`/`allowJs` in `tsconfig.json`, keine Umbenennungen, kein Laufzeitrisiko
  3. M2 Test Infra — Vitest/Node-Test-Runner für `core/`/`services/`, Priorität: Boot-Smoke-Test (Server startet + Health-Check)
  4. M3 Gate wired — Pre-Tag-Gate in `tools/release.js` scharf schalten + `TECH-README.md` Build-Prozess-Doku nachtragen
  5. M4 CSS Tokens — `tokens.css` extrahieren nach unten stehendem Schema
  6. M5+ LIT Phase A — Komponenten nacheinander (Banner, Log-Viewer, Status-Bar, MQTT/Watch/Webhook, Store-Explorer, Event-Inspector, Settings, Sidebar, Card-Preview, Dialoge)
  7. Laufend, ohne Deadline: `.ts`-Umstellung Datei für Datei; LIT Phase B (Script-Modal, Editor/Monaco) erst nach Merge von `feature/blockly-integration`
- **Release-Pipeline-Schutz (zwei Ebenen, `release.yml`/Docker-Pipeline bleibt unangetastet):**
  - Separater, informativer CI-Workflow auf push/PR gegen main (Lint + Test, kein Merge-Zwang)
  - Echtes Gate in `tools/release.js` vor Tag/Push: `npm run build && npm run lint && npm test` muss grün sein, sonst Abbruch — verhindert auch, dass ein Tag/Release ohne passendes Docker-Image entstehen kann
- **Docker-Build-Sicherheit:** Build-Step (`RUN npm run build`, tsc + esbuild-Bundling) kommt ins `Dockerfile` selbst (aktuell keiner vorhanden). Schlägt der Build fehl, entsteht kein neues Image — altes Image läuft für Nutzer unverändert weiter. Kein Risiko eines halb-kaputten Deploys.
- **CSS-Tokens ("aus einem Guss mit HA"):** Addon läuft im HA-Ingress-iFrame — HAs CSS-Variablen werden nicht automatisch vererbt. Entscheidung: **Dark-only bleibt** (keine Light-Mode-Unterstützung, keine Live-Theme-Synchronisation mit HA), aber der Grauton-Wildwuchs (9 Ad-hoc-Variablen) wird auf ein systematisches 3-Stufen-Flächenmodell reduziert:
  - `--surface-0` (Seiten-Hintergrund), `--surface-1` (Sidebar/Panels), `--surface-2` (erhöht: Modals/Inputs/Cards/Hover)
  - `--border` (1 Stufe)
  - `--text-primary` / `--text-secondary` / `--text-muted` (3 Stufen)
  - `--accent`, `--success`, `--danger`, `--warning` bleiben semantisch, zählen nicht als Grauton
- **LIT Phase A/B + Blockly-Abhängigkeit unverändert übernommen** aus dem alten RFC (Grund: `feature/blockly-integration` überschneidet sich signifikant nur mit `tab-manager.js`/`creation-wizard.js`).
- **TypeScript-Scope unverändert aus altem RFC übernommen** (nicht explizit neu gestellt, da bereits entschieden): CommonJS bleibt, kein ESM-Umstieg als Teil dieses Workstreams; `ha-api.d.ts` bleibt eigenständig für Nutzerskript-Typen.

## Q&A log

### Q1 — Neuer Plan vs. Erweiterung des RFC

- Asked: Ist das eine Erweiterung von RFC-Abschnitt 7/8 oder ein komplett neuer, ersetzender Plan?
- Captured: "Als neuen Plan, der diesen ersetzt. Kann anschließend gelöscht werden." → Der bestehende `docs/RFC_LIT_MIGRATION.md` wird durch das Ergebnis dieser Session ersetzt und danach gelöscht. Die LIT-Phase-A/B-Reihenfolge selbst steht damit implizit auch zur Neubewertung offen (nicht nur TS/Lint/Test).
- Flags: keine

### Q2 — Wo lebt das Lint/Test-Gate?

- Asked: `release.yml` feuert erst nach `release: published` (also nach Tag+Push durch `tools/release.js`) — zu spät für ein echtes Gate. Vorschlag: (1) separater, rein informativer CI-Workflow auf push/PR gegen main, (2) echtes Gate direkt in `tools/release.js` vor dem Tag/Push (`npm run lint && npm test` muss grün sein, sonst Abbruch). `release.yml`/Docker-Pipeline bleibt unangetastet.
- Captured: "ok" — Vorschlag bestätigt, beide Ebenen wie vorgeschlagen umsetzen.
- Flags: keine

### Q3 — Meilenstein-Schnitt (M0-M5+) und Bündelung

- Asked: Vorschlag M0 Foundation (Lint/CI sichtbar) → M1 TS Groundwork (checkJs/allowJs) → M2 Test Infra (inkl. Boot-Smoke-Test) → M3 Gate wired (Q2-Gate scharf schalten) → M4 CSS Tokens → M5+ LIT Phase A Komponenten, danach laufend TS-Datei-Umstellung + LIT Phase B nach Blockly-Merge. M0-M3 als ein gebündelter Release (kein User-sichtbarer Effekt), ab M4 wieder Einzel-Releases/Beta-Kanal.
- Captured: "ist ok" — Reihenfolge und Bündelung bestätigt.
- Flags: keine

### Q4 — CSS-Token-Strategie (aus einem Guss mit HA)

- Asked: Addon läuft in HA-Ingress-iFrame (`config.yaml: ingress: true`) — HAs CSS-Variablen werden NICHT automatisch ins iFrame vererbt. Aktuell: fester Dark-Only-Palette-Wildwuchs in `style.css` (`--bg`, `--side`, `--main`, `--border`, `--modal-bg`, `--input-bg`, `--text-sec`, `--text-dim` — 8 eigenständige Grautöne ohne System). Optionen: (A) Live-Sync mit echtem HA-Theme via `home-assistant-js-websocket` — höchste Treue, aber Laufzeitrisiko; (B) fester Light+Dark-Tokensatz nach HA-Standard-Material-Palette; (C) Dark-only bleiben, aber Wildwuchs auf systematisches Set reduzieren.
- Captured: "c" — Dark-only bleibt, aber die Grautöne werden auf ein sauberes, definiertes Set reduziert. Keine Light-Mode-Unterstützung, keine Live-Theme-Synchronisation mit HA geplant.
- Flags: konkrete Token-Anzahl/-Namen noch offen -> nächste Frage

### Q5 — Konkretes Token-Set

- Asked: Vorschlag 3-Stufen-Flächenmodell (`--surface-0/1/2` ersetzt `--main`/`--side`/`--modal-bg`+`--input-bg`), 1 Border-Token, 3 Text-Stufen (`--text-primary/secondary/muted`), Akzent/Status bleiben semantisch (7 Neutral-Tokens statt 9 Wildwuchs-Variablen).
- Captured: "ok" — Schema bestätigt wie vorgeschlagen.
- Flags: keine

### Q6 — Build-Step im Docker-Image + Release-Gate

- Asked: Dockerfile hat aktuell keinen Build-Step (kopiert Code 1:1, startet node direkt). Vorschlag: (1) Build direkt im Dockerfile (`RUN npm run build` vor Start) statt separat committeter Artefakte — schlägt Build fehl, entsteht kein neues Image, altes läuft unverändert weiter; (2) `npm run build` zusätzlich Teil des Pre-Tag-Gates aus Q2, damit nie ein Tag/Release ohne dazugehöriges Image entstehen kann.
- Captured: "ok" — beide Punkte bestätigt.
- Flags: keine

### Q7 — LIT Phase A/B Reihenfolge & Blockly-Abhängigkeit

- Asked: Alte Begründung (Blockly-Worktree überschneidet sich signifikant nur mit `tab-manager.js`/`creation-wizard.js` → Editor/Script-Modal erst nach Blockly-Merge in Phase B) unverändert übernehmen?
- Captured: "ok" — Phase-A/B-Reihenfolge und Blockly-Gate bleiben wie im alten RFC.
- Flags: keine

### Q8 — Name/Ort des neuen Plandokuments

- Asked: Vorschlag `docs/RFC_FRONTEND_MODERNIZATION.md` als Ersatz für `docs/RFC_LIT_MIGRATION.md` (deckt jetzt 4 Workstreams ab: LIT, TS, Lint/Test, CSS-Tokens).
- Captured: "ok" — Name bestätigt.
- Flags: keine

### Q9 — Vollständigkeits-Check

- Asked: Fehlt noch etwas (z. B. ESLint-Regeln im Detail, Test-Coverage-Ziele, ha-api.d.ts/README-Pflege)?
- Captured: "build prozess dann auch in der tech-readme beschrieben." — `TECH-README.md` existiert bereits im Repo-Root; der neue Build-Prozess (Dockerfile-Build-Step aus Q6, Pre-Tag-Gate aus Q2, TS/Lint/Test-Setup aus M0-M3) muss dort dokumentiert werden, sobald diese Meilensteine umgesetzt sind.
- Flags: `TECH-README.md` Update -> Teil von M3 "Gate wired" (bzw. spätestens Abschluss M0-M3-Release), Umsetzung selbst noch offen

## Open flags (pending input)

- `TECH-README.md`: Build-Prozess-Doku (Dockerfile-Build-Step, Pre-Tag-Gate, TS/Lint/Test-Setup) nachtragen, sobald M0-M3 umgesetzt sind -> Owner: bei Umsetzung von M3
