# 🏗️ Meilenstein 11: Integration Refactoring & Basis-Architektur

## 1. Status Quo & Problemanalyse
Aktuell verfügt die Home Assistant Integration über 28 Plattform-Dateien (`sensor.py`, `switch.py`, etc.). Jede dieser Dateien wiederholt zu ca. 80% den identischen Code für:
*   Das Registrieren von Entitäten via Dispatcher-Signal.
*   Das Formatieren der `device_info` und `identifiers`.
*   Das Filtern von Attributen im `update_data` Prozess.
*   Das Abfeuern von Events auf dem Home Assistant Bus.
*   Die Wiederherstellung des Zustands nach einem Neustart (`RestoreEntity`).

Diese Redundanz ist fehleranfällig (siehe den "No entity id specified" Bug) und macht globale Änderungen (z.B. am ID-Schema) extrem zeitaufwendig.

## 2. Zielsetzung
Das Ziel dieses Meilensteins ist die Einführung einer zentralen Architektur in der `__init__.py`, die den Code-Footprint der einzelnen Plattformen drastisch reduziert und die Stabilität maximiert.

## 3. Das technische Konzept

### A. Die Basisklasse: `JSAutomationsBaseEntity`
Wir führen eine abstrakte Basisklasse ein, von der alle Plattform-Entitäten erben.

**Verantwortlichkeiten der Basisklasse:**
1.  **Metadaten-Management:** Zentrale Verarbeitung von `name`, `icon`, `available` und `area_id`.
2.  **Device-Linking:** Einheitliche Erstellung der `device_info` unter Nutzung des `async_format_device_info` Helpers.
3.  **Attribute-Filtering:** Bereitstellung einer Methode zum automatischen Filtern von Attributen, die bereits als native Properties existieren.
4.  **Bus-Events:** Eine standardisierte Methode `_fire_js_event(action, data)`, die automatisch `entity_id` und `unique_id` in den Payload einbettet.
5.  **State Restore:** Standard-Implementierung von `async_added_to_hass`, die den Zustand aus der HA-Datenbank lädt.

### B. Der Setup-Helper: `async_setup_js_platform`
Anstatt in jeder `sensor.py` oder `light.py` den `async_setup_entry` Boilerplate zu wiederholen, führen wir in der `__init__.py` eine universelle Registrierungs-Logik ein.

**Vorteile:**
*   Einheitliches Error-Handling beim Anlegen von Entitäten.
*   Zentrale Prüfung auf Duplikate in `hass.data[DOMAIN][DATA_ENTITIES]`.
*   Plattform-Dateien schrumpfen auf die rein funktionale Logik zusammen.

### C. Datentyp-Sicherheit
*   **Numerischer Restore:** Sensoren mit `state_class` oder `unit_of_measurement` werden beim Restore explizit in `float` oder `int` gecastet, um Graphen-Unterbrechungen zu vermeiden.
*   **Partielle Updates:** Die `update_data` Methode wird so optimiert, dass sie nur Felder aktualisiert, die im Payload enthalten sind (Idempotenz).

## 4. Beispiel-Architektur (Konzeptuell)

**Vorher (`switch.py`):** ca. 80 Zeilen Code.
**Nachher (`switch.py`):** ca. 25 Zeilen Code.

```python
# Beispielhafter Zielzustand einer Plattform-Datei
from . import async_setup_js_platform, JSAutomationsBaseEntity
from homeassistant.components.switch import SwitchEntity

async def async_setup_entry(hass, entry, async_add_entities):
    await async_setup_js_platform(hass, "switch", JSAutomationsSwitch, async_add_entities)

class JSAutomationsSwitch(JSAutomationsBaseEntity, SwitchEntity):
    def update_data(self, data):
        super().update_data(data) # Verarbeitet Name, Icon, Device, etc.
        if "state" in data:
            self._attr_is_on = data["state"] in ["on", True]

    async def async_turn_on(self, **kwargs):
        self._fire_js_event("turn_on")
```

## 5. Implementierungs-Fahrplan

1.  **Phase 1: Infrastruktur (__init__.py)**
    *   Implementierung der `JSAutomationsBaseEntity`.
    *   Implementierung des `async_setup_js_platform` Helpers.
    *   Migration des `async_format_device_info` in die Basisklasse.

2.  **Phase 2: Refactoring der Standard-Plattformen**
    *   Umstellung von `sensor`, `binary_sensor`, `switch` und `button`.
    *   Validierung der Langzeitstatistiken.

3.  **Phase 3: Migration komplexer Plattformen**
    *   Anpassung von `climate`, `light` und `cover` (hier ist oft spezifisches Attribut-Handling nötig).

4.  **Phase 4: Cleanup & Quality Gate**
    *   Migration aller restlichen 20+ Dateien.
    *   Entfernung von redundantem Import-Code.
    *   Finaler Test des `RestoreEntity` Verhaltens bei System-Neustart.

## 6. Erwartete Ergebnisse
*   **Wartbarkeit:** Das Hinzufügen einer neuen Plattform (z.B. `humidifier`) erfordert nur noch minimalen Aufwand.
*   **Performance:** Reduzierter Memory-Footprint der Integration in Home Assistant.
*   **Fehlertoleranz:** Partielle Updates des Add-ons zerstören keine bestehenden Zustände in HA mehr.
*   **Standardisierung:** Alle Entitäten folgen exakt dem gleichen Lifecycle-Muster.