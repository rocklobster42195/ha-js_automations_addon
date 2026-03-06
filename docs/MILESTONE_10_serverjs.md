# 🏗️ Konzept: Server Refactoring & Modularisierung (Meilenstein 10)

Dieses Dokument beschreibt die Dekonstruktion der `server.js` in eine modulare, wartbare Architektur. Ziel ist es, die `server.js` auf unter 50 Zeilen Code zu reduzieren und die Logik in spezialisierte Services und Manager zu verschieben.

---

## 1. Die neue Kern-Architektur

Wir führen drei neue Ebenen ein, um die Verantwortlichkeiten zu trennen:

### A. Der Kernel (`core/kernel.js`)
Der Kernel wird zum "Orchestrator" des Systems.
*   **Aufgabe:** Instanziierung aller Manager (`HAConnector`, `WorkerManager`, `StoreManager`, etc.) in der richtigen Reihenfolge.
*   **Lifecycle:** Bietet `boot()`, `start()` und `shutdown()` Methoden an.
*   **Dependency Injection:** Er hält die Instanzen der Manager und reicht sie bei Bedarf an andere Komponenten weiter.

### B. Der Bridge-Service (`core/bridge.js`)
Aktuell ist die `server.js` voll von `manager.on('event', () => io.emit(...))`.
*   **Aufgabe:** Fungiert als Mediator zwischen den internen Managern und der Außenwelt (Socket.io).
*   **Entkopplung:** Die Manager wissen nichts von Sockets. Sie emittieren Standard-Node-Events. Die Bridge abonniert diese und sendet sie an das Frontend.

### C. Der System-Service (`services/system-service.js`)
Infrastruktur-Logik gehört nicht in den Server-Kern.
*   **Aufgabe:** Überwachung von CPU/RAM, Verwaltung der Bootloop-Detection (`CRASH_FILE`) und Handling des Safe-Mode Status.
*   **Vorteil:** Die `server.js` wird von `setInterval`-Logik und `os`-Abfragen befreit.

---

## 2. Strategische Änderungen

### Weg vom Store-Proxy
Der aktuelle Proxy in der `server.js`, der Änderungen im Store an die Worker broadcastet, ist ein "Hack".
*   **Neu:** Der `StoreManager` emittiert ein `change` Event. Der `WorkerManager` abonniert dieses Event direkt oder über den Kernel und führt den Broadcast aus.

### Konsolidierung der Routen
Alle API-Endpunkte, die noch direkt in `server.js` hängen, wandern in ihre logischen Gegenstücke:
*   `/api/ha/*` -> `routes/ha-routes.js` (Neu: Für States, Services und Metadata).
*   `/api/system/safe-mode/*` -> `routes/system-route.js`.

### Zentrale Konfiguration (`core/config.js`)
Die Berechnung von `IS_ADDON`, `SCRIPTS_DIR` und `STORAGE_DIR` erfolgt einmalig in einer Config-Datei, auf die alle Manager zugreifen. Das eliminiert redundante Pfad-Logik.

---

## 3. Der neue Boot-Flow

1.  **`server.js`**: Startet Express, Socket.io und ruft `kernel.boot(io)` auf.
2.  **`kernel.js`**:
    *   Lädt die Konfiguration.
    *   Initialisiert alle Manager.
    *   Startet den `SystemService` (Health-Check).
    *   Initialisiert die `Bridge` (Event-Mapping).
    *   Verbindet sich mit Home Assistant.
3.  **`kernel.js`**: Startet nach erfolgreicher Verbindung den `WorkerManager` (Autostart).

---

## 4. Was wird obsolet?

*   **Inline-Middleware:** Fehler-Handling und JSON-Parsing werden in separate Middleware-Dateien ausgelagert.
*   **Manuelle Ordner-Erstellung:** Jeder Manager ist selbst dafür verantwortlich, seine benötigten Unterordner in `.storage` beim Start zu prüfen/erstellen.
*   **Globaler `hasIntegration` Status:** Dieser wird Teil des `HAConnector` oder eines `IntegrationState` Objekts im Kernel.

---

## 5. Vorteile für Meilenstein 9 (TypeScript)

Durch diese Struktur können wir den `CompilerManager` (aus Meilenstein 9) einfach als weiteren Baustein in den Kernel einhängen. Der Kernel sagt dann:
1.  `EntityManager` meldet Dateiänderung.
2.  Kernel ruft `CompilerManager.compile(file)`.
3.  Bei Erfolg: Kernel ruft `WorkerManager.restart(file)`.
4.  Bei Fehler: Kernel ruft `Bridge.sendError(err)`.

---

## 6. Implementierungs-Plan

1.  **Schritt 1:** Erstellen der `core/config.js` und Migration der Pfad-Konstanten.
2.  **Schritt 2:** Implementierung des `Kernel` und Verschiebung der Manager-Instanziierung.
3.  **Schritt 3:** Einführung des `BridgeService` zur Bereinigung der Socket-Events.
4.  **Schritt 4:** Auslagerung der System-Stats in den `SystemService`.
5.  **Schritt 5:** Finales "Ausmisten" der `server.js`.
```

### Zusammenfassung der Vorteile:
1.  **Testbarkeit:** Du kannst den Kernel oder einzelne Manager testen, ohne einen kompletten Express-Server starten zu müssen.
2.  **Übersicht:** Wenn ein Fehler im Safe-Mode auftritt, weißt du sofort: `services/system-service.js`. Wenn ein Log nicht im Frontend ankommt: `core/bridge.js`.
3.  **Vorbereitung:** Wir schaffen Platz für die komplexen Logiken von TypeScript und Blockly.