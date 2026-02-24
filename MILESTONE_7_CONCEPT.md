# 🔌 Konzept: Native Integration & Hybrid Architecture (Meilenstein 7)

## 1. Das Problem: "Ephemeral Entities"
Aktuell erzeugt das Add-on Entitäten über die Home Assistant HTTP API (`POST /api/states/...`).
*   **Nachteil 1:** Diese Entitäten sind "flüchtig". Nach einem HA-Neustart sind sie weg, bis das Skript sie neu setzt.
*   **Nachteil 2:** Sie haben keine `unique_id` und keinen Eintrag in der **Entity Registry**.
*   **Nachteil 3:** Tools wie **Spook** melden diese als "Orphaned" oder "Unknown".
*   **Nachteil 4:** Man kann im UI weder Icon noch Bereich (Area) ändern.

Die bisherige Lösung wäre MQTT Discovery, was jedoch einen externen Broker (Mosquitto) und Konfiguration durch den User erfordert.

## 2. Die Lösung: Hybrid Add-on
Wir wandeln das Projekt in ein **Hybrid Add-on** um. Das bedeutet, das Add-on bringt seine eigene **Custom Component** (Integration) mit und installiert diese bei Bedarf automatisch in Home Assistant.

### Architektur
1.  **Node.js Add-on (Der "Brain"):**
    *   Beinhaltet die Logik, Skripte und NPM-Pakete.
    *   Enthält im Docker-Image einen Ordner `/integration` mit den Python-Dateien.
    *   Prüft beim Start, ob die Integration in `/config/custom_components/js_automations` existiert und aktuell ist.

2.  **Python Integration (Der "Body"):**
    *   Eine schlanke `custom_component`, die in Home Assistant Core läuft.
    *   Stellt Services bereit, um Entitäten zu registrieren und zu aktualisieren.
    *   Verwaltet die Einträge in der **Entity Registry** (Persistenz, Unique IDs).

---

## 3. User Experience (Der "Installer Flow")
Da wir Dateien in `/config` ändern, sollte dies transparent geschehen.

1.  **Erkennung:** Das Add-on startet und bemerkt:
    *   Integration fehlt ODER
    *   Version in `manifest.json` ist älter als die interne Version.
2.  **Benachrichtigung:** Im Web-Dashboard des Add-ons erscheint oben ein Banner:
    > ⚠️ **Setup erforderlich:** Um native Entitäten zu nutzen, muss die JS-Automations Integration installiert/aktualisiert werden.
    > [Button: Jetzt installieren]
3.  **Aktion:**
    *   User klickt.
    *   Node.js kopiert rekursiv Dateien von `/app/integration` nach `/config/custom_components/js_automations`.
4.  **Abschluss:** Banner ändert sich:
    > ✅ **Installation erfolgreich.** Bitte starte Home Assistant neu, damit die Änderungen wirksam werden.

---

## 4. Technische Umsetzung

### A. Die Python-Komponente (`custom_components/js_automations`)
Sie definiert eine virtuelle Plattform (ähnlich wie MQTT, aber über Service-Calls gesteuert).

*   **Domain:** `js_automations`
*   **Services:**
    *   `register_entity(unique_id, type, name, icon, ...)`: Erstellt/Update den Registry-Eintrag.
    *   `update_entity(unique_id, state, attributes)`: Setzt den Status.
    *   `remove_entity(unique_id)`: Löscht die Entität.

### B. Die Node.js Erweiterung (`ha.register`)
Wir erweitern die API für Skripte, um die neuen Fähigkeiten zu nutzen.

```javascript
// Alt (Ephemeral):
ha.updateState('sensor.mein_wert', 123);

// Neu (Persistent):
ha.register('sensor.mein_wert', {
    name: 'Mein Wichtiger Sensor',
    type: 'sensor', // oder binary_sensor, switch, number...
    icon: 'mdi:flash',
    unit_of_measurement: 'W',
    persistent: true // Flag für Backend
});

ha.updateState('sensor.mein_wert', 456);
```

### C. Fallback-Strategie
Das Add-on muss wissen, ob die Integration geladen ist (z.B. durch Check eines HA-Status `component.js_automations`).
*   **Integration aktiv:** `ha.register` ruft den Python-Service auf -> Echte Entität.
*   **Integration inaktiv:** `ha.register` macht nichts (oder Log-Warnung), `ha.updateState` nutzt die alte HTTP-API -> Ephemeral Entität.

---

## 5. Roadmap für Meilenstein 7

### Phase 1: Python Boilerplate
*   [ ] Erstellen der Ordnerstruktur `integration/custom_components/js_automations`.
*   [ ] `manifest.json`, `__init__.py`, `sensor.py`, `binary_sensor.py`.
*   [ ] Implementierung der Service-Handler in Python.

### Phase 2: Der Installer (Node.js)
*   [ ] `IntegrationManager` Klasse erstellen.
*   [ ] Versionsvergleich (SemVer) zwischen interner und externer `manifest.json`.
*   [ ] Datei-Kopier-Logik (`fs-extra` oder nativ).
*   [ ] API-Endpunkt für das Frontend (`POST /api/system/install-integration`).

### Phase 3: Frontend & API
*   [ ] Banner-Komponente im Dashboard.
*   [ ] Erweiterung von `worker-wrapper.js` um `ha.register`.
*   [ ] Routing im `EntityManager` (Entscheidung: HTTP API vs. Service Call).

---

## 6. Vorteile
*   ✅ **Zero Config:** Kein MQTT Broker nötig.
*   ✅ **Spook Approved:** Keine "Unknown Entities" mehr.
*   ✅ **Full Control:** Icons, Namen und Areas im HA UI editierbar.
*   ✅ **History:** Statusverlauf bleibt auch bei Add-on Neustarts erhalten (da Registry-basiert).