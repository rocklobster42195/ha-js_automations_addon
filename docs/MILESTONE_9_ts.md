# 📘 Konzept: TypeScript Integration (Meilenstein 9)

Dieses Dokument beschreibt die Architektur und Implementierung von TypeScript (TS) Support im Add-on. Ziel ist es, dem User Typsicherheit und erstklassiges IntelliSense zu bieten, während die Ausführung performant bleibt.

---

## 1. Architektur-Übersicht

Wir verfolgen einen **Transpiler-Ansatz**. Der User schreibt TypeScript, das System kompiliert dieses im Hintergrund zu JavaScript (CommonJS), welches dann in den Worker-Threads ausgeführt wird.

### Dateistruktur
*   **Source:** `/scripts/*.ts` und `/scripts/libraries/*.ts`.
*   **Distribution:** `/scripts/.storage/dist/`. Hier liegen die kompilierten `.js` Dateien. Die Ordnerstruktur der Sources wird hier gespiegelt.
*   **Typings:** 
    *   `.storage/entities.d.ts` (Dynamisch generiert aus HA-States).
    *   `.storage/ha-api.d.ts` (Statische Definition der `ha` API). Aktuelle Version liegt in public/types/ und wird bereits vom Monaco-Editor verwendet. Wenn die Datei verschben wird, muss ein Api-Endpunkt erzeugt werden.
*   **Config:** `.storage/tsconfig.json` (Vom System verwaltet).

---

## 2. Der CompilerManager (Backend)

Eine neue Kernkomponente im Master-Prozess, die den Lebenszyklus des Codes verwaltet.

*   **Watcher-Integration:** Der `EntityManager` (oder ein dedizierter Watcher) erkennt Änderungen an `.ts` Dateien.
*   **Inkrementelle Kompilation:** Wir nutzen den TypeScript Compiler (`tsc`) im Speicher oder via API. Es wird nur kompiliert, was sich geändert hat.
*   **Fehler-Reporting:** Kompilierfehler werden abgefangen und über den `LogManager` direkt an das Frontend gestreamt, damit der User sofort sieht, warum ein Script nicht startet (inkl. Zeilennummer).
*   **Cleanup:** Beim Löschen einer `.ts` Datei wird die entsprechende `.js` Datei im `dist`-Ordner ebenfalls entfernt.

---

## 3. Worker-Manager Anpassungen

Der `WorkerManager` muss intelligent entscheiden, welche Datei geladen wird:

1.  **Pfad-Auflösung:** Wenn ein Script `my_logic.ts` gestartet werden soll, prüft der Manager, ob in `.storage/dist/my_logic.js` eine kompilierte Version vorliegt.
2.  **Transparenz:** Für den User bleibt es "sein" Script. Logs und Statusmeldungen beziehen sich immer auf den ursprünglichen Dateinamen (`.ts`).
3.  **Libraries:** Wenn ein Script eine Library via `require('./libraries/my_lib')` einbindet, sorgt die `tsconfig.json` und die Pfad-Struktur im `dist`-Ordner dafür, dass Node.js die richtigen (kompilierten) Dateien findet.

---

## 4. IntelliSense & Typings

Damit Monaco (der Editor) rote Kringel und Autovervollständigung anzeigen kann, müssen wir Typ-Definitionen bereitstellen:

*   **`ha-api.d.ts`:** Definiert das globale `ha` Objekt (z.B. `ha.on`, `ha.callService`, `ha.register`).
*   **`entities.d.ts`:** Wird weiterhin dynamisch generiert, damit der User `ha.states['light.kitchen']` mit Autovervollständigung nutzen kann.
*   **NPM Types:** Der `DependencyManager` wird so erweitert, dass er bei der Installation von Paketen (z.B. `axios`) prüft, ob `@types/axios` verfügbar ist und diese ebenfalls in den `.storage` Ordner lädt.

---

## 5. UI & Monaco Integration

*   **Language Toggle:** Im "Neues Script" Wizard kann der User zwischen JavaScript und TypeScript wählen.
*   **Monaco Mode:** Der Editor schaltet auf `typescript` um.
*   **Type-Loading:** Beim Laden des Editors werden die `.d.ts` Dateien aus dem Backend geladen und in die Monaco-Instanz injiziert (`monaco.languages.typescript.typescriptDefaults.addExtraLib`).


## 7. Implementierungs-Schritte

1.  **Phase 1: Infrastruktur**
    *   Erstellen der `tsconfig.json` Vorlage.
    *   Anlegen des `dist` Ordners in `.storage`.
    *   Verschieben der `ha-api.d.ts`. Aktuelle Version liegt in public/types/.

2.  **Phase 2: CompilerManager**
    *   Integration von `typescript` als NPM Dependency im Add-on.
    *   Logik zum Transpilieren bei Dateiänderung.

3.  **Phase 3: Worker-Update**
    *   Anpassung der Start-Logik im `WorkerManager`.

4.  **Phase 4: Frontend**
    *   Monaco für TS konfigurieren.
    *   API-Endpunkte für Typ-Definitionen bereitstellen.

---

## 8. Vorteile

*   ✅ **Fehlervermeidung:** Tippfehler in Entitätsnamen oder API-Methoden werden vor der Ausführung erkannt.
*   ✅ **Dokumentation:** Die API ist durch Typen "selbsterklärend".
*   ✅ **Zukunftssicher:** Die Trennung von Source und Dist erlaubt beliebige Sprachen (TS, Blockly, etc.).
*   ✅ **Performance:** Da im Worker nur reines JS läuft, gibt es keinen Runtime-Overhead für die Typisierung.
```