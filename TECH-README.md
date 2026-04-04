# Blick unter die Haube: JS Automations

Dieses Dokument beschreibt die technische Architektur des Addons — wie die einzelnen Subsysteme zusammenspielen, warum bestimmte Designentscheidungen getroffen wurden, und was intern passiert wenn ein Skript startet, eine Entity angelegt oder ein HA-Event empfangen wird.

---

## Inhaltsverzeichnis

1. [Überblick: Das Zwei-Transport-Modell](#1-überblick-das-zwei-transport-modell)
2. [Kernel: Orchestrierung und Boot-Sequenz](#2-kernel-orchestrierung-und-boot-sequenz)
3. [Bridge: Event-Mediation nach außen](#3-bridge-event-mediation-nach-außen)
4. [Worker Threads: Isolation und Lifecycle](#4-worker-threads-isolation-und-lifecycle)
5. [Worker Wrapper: Die Sandbox](#5-worker-wrapper-die-sandbox)
6. [Entity Manager: Entity-Lifecycle](#6-entity-manager-entity-lifecycle)
7. [MQTT Discovery: Wie Entities entstehen](#7-mqtt-discovery-wie-entities-entstehen)
8. [Entity Registry: Persistenz und Mark-and-Sweep](#8-entity-registry-persistenz-und-mark-and-sweep)
9. [HA Connection: WebSocket & State Cache](#9-ha-connection-websocket--state-cache)
10. [MQTT Manager: Broker-Verbindung und Command-Routing](#10-mqtt-manager-broker-verbindung-und-command-routing)
11. [TypeScript-Pipeline und IntelliSense](#11-typescript-pipeline-und-intellisense)
12. [Settings: Schema-Driven UI](#12-settings-schema-driven-ui)
13. [Ressourcenverbrauch und bekannte Einschränkungen](#13-ressourcenverbrauch-und-bekannte-einschränkungen)

---

## 1. Überblick: Das Zwei-Transport-Modell

Das Addon kommuniziert mit Home Assistant über **zwei unabhängige Transportkanäle**:

| Kanal | Zweck | Richtung |
|---|---|---|
| **HA WebSocket** | Events empfangen, Services aufrufen, Entity-Registry abfragen/schreiben | Bidirektional |
| **MQTT** | Entities registrieren (Discovery), Zustände publizieren, Commands empfangen | Bidirektional |

**Warum zwei Transporte?**

HA WebSocket ist der "native" Kanal für Daten und Events — er liefert alle State Changes in Echtzeit und erlaubt Service-Calls. Allerdings bietet er keine persistente Möglichkeit, eigene Entities anzumelden. Früher nutzte das Addon dafür eine Custom Integration (`js_automations` Custom Component), die über REST Entities anlegen konnte.

Seit dem Wechsel zu **MQTT Discovery** ist die Custom Integration nicht mehr nötig. MQTT Discovery ist das offizielle HA-Protokoll für dynamisch registrierte Entities. Ein Payload auf `homeassistant/<domain>/<object_id>/config` reicht, und HA legt die Entity automatisch an — inklusive Gerät, Klasse, Attributen und allem. Der Payload bleibt retained im Broker, HA registriert ihn bei jedem Neustart erneut.

---

## 2. Kernel: Orchestrierung und Boot-Sequenz

`core/kernel.js` ist der zentrale Orchestrator. Er ist als Singleton exportiert (`module.exports = new Kernel()`), was bedeutet: es gibt genau eine Kernel-Instanz pro Prozess.

### Instantiierung vs. Start

Der Kernel trennt bewusst zwischen **`boot()`** und **`start()`**:

- **`boot(io)`** — Wird aufgerufen sobald der Express/Socket.io-Server bereit ist. Instantiiert alle Manager, registriert persistente Event-Listener, erzeugt die Bridge. Kein I/O, kein Netzwerk.
- **`start()`** — Startet die eigentliche Applikationslogik: HA-Verbindung aufbauen, MQTT verbinden, TypeScript compilieren, Entities registrieren, Skripte starten.

Diese Trennung macht es möglich, dass `bridge.connect()` (Socket.io Event-Verdrahtung) bereits in `start()` als erster Schritt aufgerufen werden kann — sodass die UI sofort Updates empfangen kann, während das System noch hochfährt.

### Boot-Sequenz (vereinfacht)

```
boot(io)
├── LogManager, SettingsManager, HAConnector instantiieren
├── DependencyManager, StateManager, StoreManager instantiieren
├── CompilerManager, MqttManager instantiieren
├── WorkerManager konfigurieren (storageDir, scriptsDir, store, mqtt)
├── SystemService erzeugen
├── EntityManager erzeugen (bekommt alle obigen als Injection)
├── Bridge erzeugen
└── Statische Event-Listener registrieren (Settings, Logs, MQTT Status)

start()
├── bridge.connect()          ← Socket.io Events verdrahten
├── systemService.start()     ← CPU/RAM-Polling starten
├── TypeScript Initial-Pass   ← Alle .ts Skripte compilieren
├── haConnector.connect()     ← WebSocket zu HA aufbauen
├── mqttManager.connect()     ← MQTT Broker verbinden
├── HA-Language auslesen
├── entityManager.createExposedEntities()  ← @expose Entities anlegen
├── _setupSystemEventListeners()           ← HA Events → Worker Dispatch
├── Autostart-Skripte starten
└── performGlobalCleanup()    ← Verwaiste Entities sofort entfernen
```

### Dependency Injection durch Kernel

Der Kernel konstruiert alle Manager selbst und übergibt Abhängigkeiten explizit als Konstruktorargumente. Beispiel: `EntityManager` bekommt `haConnection`, `workerManager`, `stateManager`, `depManager`, `systemService`, `mqttManager` und `compilerManager` injiziert. Es gibt kein globales Service-Locator-Pattern — jede Klasse deklariert ihre Abhängigkeiten in der Signatur.

### Reconnect-Logik

`handleReconnection()` wird aus einer Route aufgerufen, wenn das Frontend einen Verbindungsabbruch erkennt. Es verbindet den HA WebSocket neu, aktualisiert die Systemsprache, republiziert `@expose`-Entities und ruft `republishNativeEntities()` auf — damit alle per `ha.register()` angelegten Entities nach einem HA-Neustart wieder vorhanden sind.

### Globaler Cleanup-Zyklus

Alle 60 Minuten (und einmal direkt nach Boot) läuft `performGlobalCleanup()`:
1. Vergleicht die aktuell auf Disk vorhandenen Skripte mit den registrierten Entities in HA
2. Entfernt verwaiste Entities (Skript gelöscht, Entity noch in HA)
3. Republiziert alle `ha.register()`-Entities (Integrity-Check)

---

## 3. Bridge: Event-Mediation nach außen

`core/bridge.js` ist die einzige Stelle, die weiß, dass es Socket.io gibt. Alle anderen Manager emittieren Node.js `EventEmitter`-Events — die Bridge übersetzt diese ins Socket.io-Protokoll Richtung Browser.

```
LogManager  ──log_added──►  Bridge  ──socket.emit('log')──►  Frontend
Kernel      ──ha_state_changed──►  Bridge  ──socket.emit('ha_state_changed')──►  Frontend
Kernel      ──integration_status_changed──►  Bridge  ──socket.emit('integration_status')──►  Frontend
SystemService ──system_stats_updated──►  Bridge  ──socket.emit('system_stats')──►  Frontend
```

Wenn ein neuer Browser-Tab geöffnet wird (Socket.io `connection`-Event), sendet die Bridge sofort den aktuellen System-Status — so sieht jeder neue Tab direkt den richtigen Zustand ohne auf das nächste Event warten zu müssen.

Die Bridge selbst enthält **keine Logik**, nur Routing. Das macht sie testbar und austauschbar: würde man Socket.io durch WebSockets ersetzen, ändert sich nur die Bridge.

---

## 4. Worker Threads: Isolation und Lifecycle

Jedes Skript läuft in einem eigenen **Node.js Worker Thread** (nicht einem separaten Prozess). Das hat folgende Konsequenzen:

- **Kein gemeinsamer Heap**: Skripte können sich gegenseitig nicht per Speicherzugriff beeinflussen
- **Separater V8-Isolate**: Ein Crash in einem Skript bringt nicht den Hauptprozess zum Absturz
- **Kommunikation nur per `postMessage`**: Alle Interaktionen zwischen Skript und System gehen über strukturierte Nachrichten

### Worker starten: `startScript(filename)`

`WorkerManager.startScript()` führt folgende Schritte aus:

1. **TypeScript-Auflösung**: Falls `filename.ts`, wird `dist/filename.js` als eigentliche Execution-Datei verwendet. Falls die compilierte Version nicht existiert, Abbruch mit Fehlermeldung.
2. **Restart-Protection-Check**: Wurden in den letzten `restart_protection_time` Millisekunden mehr als `restart_protection_count` Starts versucht? → Abbruch, Fehlermeldung.
3. **Mark-and-Sweep initialisieren**: `activeRunEntities.set(filename, new Set())` — startet einen leeren "aktiv in diesem Run"-Tracking-Set. Nach 10 Sekunden wird ein Sweep gestartet (mehr dazu in Abschnitt 8).
4. **Worker erzeugen**: `new Worker('worker-wrapper.js', { workerData, resourceLimits })` mit:
   - Dem gesamten Script-Metadata-Objekt als `workerData`
   - Dem initialen HA State Cache (`haConnector.states` + Alias-Einträge)
   - Dem initialen Store-Inhalt
   - Dem Memory-Limit (`maxOldGenerationSizeMb`)

### Message-Protokoll (Worker → Manager)

| `msg.type` | Bedeutung |
|---|---|
| `log` | Logzeile von `ha.log()` oder `console.log()` |
| `call_service` | `ha.callService()` — Manager ruft HA WebSocket auf, schickt Response zurück |
| `update_state` | `ha.setState()` — Manager leitet an EntityManager (MQTT) weiter |
| `create_entity` | `ha.register()` — Manager leitet an EntityManager zur Discovery weiter |
| `subscribe` | `ha.on()` — Manager registriert Pattern in `subscriptions`-Map |
| `store_set` | `ha.store.set()` — Manager persistiert über StoreManager, broadcastet an alle anderen Worker |
| `ask` | `ha.ask()` — Manager schickt HA Mobile-App-Notification, wartet auf Action-Response |
| `get_stats` | Heartbeat-Anfrage; Worker antwortet mit RAM-Nutzung |

### State Changes an Worker dispatchen

Wenn HA ein `state_changed`-Event über den WebSocket sendet, ruft der Kernel `workerManager.dispatchStateChange(entity_id, new_state, old_state)` auf. Der WorkerManager prüft für jeden laufenden Worker, ob sein `subscriptions`-Array ein Pattern enthält, das zur `entity_id` passt. Nur wenn ja, wird `worker.postMessage({ type: 'state_changed', ... })` gesendet.

Pattern-Matching unterstützt Wildcards (`sensor.*`) und exakte Entity-IDs. Da jede Dispatch-Operation alle laufenden Worker iteriert, ist die Komplexität O(Workers × Subscriptions) — bei realistischen Skriptzahlen vernachlässigbar.

---

## 5. Worker Wrapper: Die Sandbox

`core/worker-wrapper.js` ist die Datei, die tatsächlich als Worker ausgeführt wird. Sie baut die Sandbox-Umgebung auf, bevor das eigentliche Skript geladen wird.

### Module Path Injection

Damit Skripte `require('axios')` schreiben können ohne `axios` selbst zu installieren, wird das `.storage/node_modules`-Verzeichnis in `Module.globalPaths` und `module.paths` eingetragen. Das ist ein Node.js-internes Mechanismus — ohne diese Injection würde `require()` im Worker-Kontext nur im Standard-Pfad suchen.

### Axios Monkey-Patch

Worker Threads haben ein bekanntes Problem mit HTTP-Keep-Alive-Verbindungen: Offene Sockets verhindern, dass sich der Thread beendet. Der Wrapper patcht `Module.prototype.require` so dass jedes `require('axios')` automatisch `keepAlive: false` erhält.

### Das `ha`-Objekt

Der Wrapper erzeugt ein globales `ha`-Objekt mit folgenden Methoden, die alle intern `parentPort.postMessage()` aufrufen:

| Methode | Nachrichtentyp | Beschreibung |
|---|---|---|
| `ha.on(pattern, cb)` | `subscribe` | Event-Listener registrieren |
| `ha.callService(domain, service, data)` | `call_service` | HA Service aufrufen (Promise) |
| `ha.setState(entityId, state, attrs)` | `update_state` | Entity-State setzen |
| `ha.register(entityId, config)` | `create_entity` | Entity per MQTT Discovery anlegen |
| `ha.getState(entityId)` | — | Synchron aus lokalem State-Cache lesen |
| `ha.log(msg, level)` | `log` | Logzeile ans System senden |
| `ha.store.set(key, value)` | `store_set` | Persistenten Wert setzen |
| `ha.store.get(key)` | — | Synchron aus lokalem Store lesen |
| `ha.ask(target, msg, actions)` | `ask` | Mobile-App-Notification mit Antwort-Optionen |
| `ha.onError(cb)` | — | Error-Handler für unkritische Hintergrundausnahmen registrieren |

### Thread-Lifecycle (ref/unref)

`parentPort.unref()` beim Start bedeutet: Der Worker-Thread beendet sich automatisch, wenn der Event-Loop leer ist und keine weiteren Callbacks mehr ausstehen. Ein Skript das nur `ha.callService(...)` aufruft und danach nichts weiter tut, wird also automatisch beendet.

`ha.on()` ruft intern `parentPort.ref()` auf, um den Thread am Leben zu halten solange ein Listener aktiv ist. `ha.removeListener()` ruft `unref()` wenn kein Listener mehr registriert ist.

### Graceful Shutdown

Wenn der WorkerManager einen Worker stoppen will, sendet er `{ type: 'stop_request' }`. Der Wrapper ruft dann alle `onStop`-Callbacks des Skripts auf (z.B. um Verbindungen zu schließen), und beendet sich danach sauber.

---

## 6. Entity Manager: Entity-Lifecycle

`core/entity-manager.js` ist das zentrale Stück für alles was mit HA-Entities zu tun hat. Er reagiert auf Events vom WorkerManager und orchestriert MQTT Discovery, Typings-Generierung, Script-Watcher und Command-Routing.

### Abhängige Subsysteme (per Konstruktor instantiiert)

- **`TypeDefinitionGenerator`**: Erzeugt `entities.d.ts` und `store.d.ts` für IntelliSense
- **`ScriptCommandRouter`**: Leitet MQTT-Commands auf die richtige Skript-Aktion (start/stop/set state)
- **`ScriptWatcher`**: Überwacht das Skript-Verzeichnis auf Dateiänderungen (chokidar)

### Event-Routing vom WorkerManager

| Event | Handler |
|---|---|
| `create_entity` | `handleDynamicEntity()` — MQTT Discovery für `ha.register()` |
| `update_entity_state` | `handleEntityStateUpdate()` — State via MQTT publishen |
| `script_start` / `script_exit` | `handleScriptLifecycle()` — Control-Entity-State (on/off) aktualisieren |
| `request_device_cleanup` | `checkDeviceCleanup()` — MQTT-Device entfernen wenn keine Entities mehr da |
| `sweep_entity_removed` | HA Entity Registry via WebSocket aufräumen |

### `@expose`-Entities vs. `ha.register()`-Entities

Es gibt zwei Wege, Entities anzulegen:

**`@expose`-Header** (statisch, beim Addon-Start):  
Script-Header `// @expose switch` legt beim Start automatisch eine Switch-Entity an. Diese wird von `createExposedEntities()` verarbeitet und gilt als "protected" — der Mark-and-Sweep-Mechanismus ignoriert sie.

**`ha.register()`** (dynamisch, zur Laufzeit):  
Skript-Code ruft `ha.register('sensor.mein_sensor', { name: '...', ... })` auf. Das geht als `create_entity`-Message an den WorkerManager, der es an `EntityManager.handleDynamicEntity()` weiterleitet.

---

## 7. MQTT Discovery: Wie Entities entstehen

### Das Discovery-Protokoll

HA hört auf Topics der Form `homeassistant/<domain>/<object_id>/config`. Wenn ein JSON-Payload dort (retained) veröffentlicht wird, legt HA die Entity automatisch an. Wenn ein leerer String veröffentlicht wird, entfernt HA die Entity.

### Payload-Aufbau

Für eine `ha.register('sensor.freifunk_clients', { name: 'Freifunk Clients' })`-Anfrage baut `handleDynamicEntity()` folgenden Payload:

```json
{
  "name": "Freifunk Clients",
  "default_entity_id": "sensor.freifunk_clients",
  "object_id": "freifunk_clients",
  "unique_id": "jsa_freifunk_clients",
  "state_topic": "jsa/sensor/freifunk_clients/data",
  "json_attributes_topic": "jsa/sensor/freifunk_clients/data",
  "value_template": "{{ value_json.state }}",
  "availability_topic": "jsa/status",
  "payload_available": "online",
  "payload_not_available": "offline"
}
```

**`default_entity_id`** (HA 2025.10+, Pflichtfeld ab HA 2026.4):  
Das Feld gibt die gewünschte Entity-ID inklusive Domain an (z.B. `"sensor.freifunk_clients"`). Es ist der direkte Nachfolger des veralteten `object_id`-Felds. Ohne dieses Feld würde HA ab Version 2026.4 die Entity-ID aus dem `name`-Feld slugifizieren — statt `sensor.freifunk_clients` entstünde dann `sensor.freifunk_clients` (aus dem friendly name), also `sensor.anzahl_freifunk_clients` bei `name: 'Anzahl Freifunk Clients'`.

**`object_id`** (Legacy, deprecated seit HA 2025.10):  
Wird weiterhin mitgeschickt für Installs mit HA < 2025.10 (nur der Object-Part, ohne Domain-Präfix).

**State Topic**:  
Der Zustand wird als JSON auf `jsa/<domain>/<object_id>/data` publiziert: `{ "state": "42", "attributes": {...}, "icon": "mdi:..." }`. HA extrahiert den State via `value_template: "{{ value_json.state }}"` und Attribute via `json_attributes_topic`.

### Discovery Topic vs. State Topic

| Topic | Inhalt | Retain |
|---|---|---|
| `homeassistant/<domain>/<object_id>/config` | Entity-Konfiguration (JSON) | ✓ |
| `jsa/<domain>/<object_id>/data` | Entity-Zustand + Attribute (JSON) | ✓ |
| `jsa/status` | `online` / `offline` (Birth/Will) | ✓ |
| `jsa/<domain>/<object_id>/set` | Command von HA (z.B. Switch togglen) | ✗ |

### Stale Entity Detection

Beim `ha.register()`-Aufruf wird die HA Entity Registry via WebSocket gecheckt, um Altlasten zu erkennen:

**Case 1 — Falsche Entity-ID, gleiche `unique_id`**:  
Existiert eine Entity mit derselben `unique_id` (`jsa_<object_id>`) aber einer anderen `entity_id`? Das passiert z.B. nach einer Umbenennung. → Entity aus Registry entfernen, Discovery-Topic clearen.

**Case 2 — Name-Slug Entity-ID aus altem Payload**:  
Existiert eine Entity mit der slugifizierten Version des Friendly-Names (z.B. `sensor.anzahl_freifunk_clients` anstatt `sensor.freifunk_clients`)? Das ist ein Relikt aus Zeiten vor `default_entity_id`. → Ebenfalls entfernen.

Nach beiden Checks wird das Discovery-Topic kurz geclearet (leerer String, retained), bevor der korrekte Payload veröffentlicht wird. Das zwingt HA, die Entity komplett neu einzulesen.

### Post-Registration: area_id und labels

MQTT Discovery kennt kein `area_id`- oder `labels`-Feld. Diese Werte können nur über die HA Entity Registry API gesetzt werden — ein WebSocket-`config/entity_registry/update`-Call.

Da HA die Entity erst verarbeiten muss bevor sie in der Registry erscheint, wird dieser Call mit 2 Sekunden Verzögerung ausgeführt:

```
ha.register('sensor.x', { area_id: 'living_room', labels: ['important'] })
  ↓
MQTT Discovery Payload publizieren
  ↓  (2 Sekunden warten)
Entity Registry abfragen → haEntry finden (über unique_id)
  ↓
config/entity_registry/update { area_id: 'living_room', label_ids: [...] }
```

Sowohl `area_id` (direkter ID-String) als auch `area` (Name → wird automatisch in die ID aufgelöst) werden akzeptiert. Labels funktionieren ebenso: Label-Namen werden gegen die HA Label-Registry aufgelöst.

---

## 8. Entity Registry: Persistenz und Mark-and-Sweep

### Lokale Registry

Der WorkerManager pflegt drei In-Memory-Strukturen:

| Map | Inhalt |
|---|---|
| `nativeEntities` | `entityId → Discovery-Payload` (alle registrierten Entities) |
| `scriptEntityMap` | `filename → Set<entityId>` (welche Entities gehören zu welchem Skript) |
| `activeRunEntities` | `filename → Set<entityId>` (welche Entities wurden im aktuellen Run registriert) |

Die ersten beiden werden in `.storage/entity_registry.json` persistiert (debounced, 1 Sekunde). Nach einem Addon-Neustart werden die Payloads wiederhergestellt — so können Entities auch nach dem Neustart korrekt gelöscht werden.

### Mark-and-Sweep

Wenn ein Skript startet, wird `activeRunEntities.get(filename)` geleert. Jeder `ha.register()`-Aufruf fügt die Entity-ID in diesen Set. Nach 10 Sekunden läuft `_sweepOrphanedDynamicEntities()`:

```
knownEntities (Registry) - activeRunEntities (dieser Run) = verwaiste Entities
```

Entities die im vorherigen Run registriert waren, aber in diesem Run nicht mehr aufgetaucht sind, werden via MQTT Discovery geclearet und aus der Registry entfernt.

**Ausnahmen**: Entities die über `@expose`-Header registriert wurden, sind in `protectedEntities` und werden vom Sweep ignoriert.

### Globaler Orphan-Cleanup

`EntityManager.cleanupOrphanedEntities(scripts)` vergleicht die aktuell existierenden Skript-Dateinamen (slugified) mit den registrierten Entities. Entities die zu einem längst gelöschten Skript gehören, werden entfernt. Das greift auch für `@expose`-Entities bei gelöschten Skripten.

---

## 9. HA Connection: WebSocket & State Cache

`core/ha-connection.js` kapselt die gesamte HA WebSocket-Kommunikation.

### Verbindungsaufbau

Nach dem Verbindungsaufbau kommt sofort `auth_required` von HA — der Connector sendet den Token. Bei `auth_ok` passieren drei Dinge gleichzeitig:
1. `subscribeEvents()` — alle HA-Events abonnieren
2. `fetchInitialStates()` — kompletter State-Dump (`get_states`)
3. `resolve()` des Boot-Promises

### Lokaler State-Cache

Alle Entity-States werden in `this.states` als Map `entity_id → state_object` gecacht. Bei jedem `state_changed`-Event wird der Cache aktualisiert. Der Cache wird beim Worker-Start als `initialStates` übergeben, sodass Skripte vom ersten Aufruf an synchron States lesen können (`ha.getState()`).

### Request-Response Pattern

Jeder WebSocket-Call bekommt eine inkrementelle `id`. Die Antwort von HA enthält dieselbe `id`. Eine temporäre `message`-Handler-Funktion wird registriert und nach Empfang wieder entfernt. Timeout nach 5 Sekunden verhindert hängende Promises.

### Entity Registry API

Folgende WebSocket-Commands werden genutzt:

| Command | Zweck |
|---|---|
| `config/entity_registry/list` | Alle registrierten Entities abrufen |
| `config/entity_registry/update` | `area_id`, `labels`, `name` einer Entity setzen |
| `config/entity_registry/remove` | Entity aus der Registry löschen |
| `config/device_registry/list` | Geräte-Registry für Device-Cleanup abrufen |
| `config/area_registry/list` | Area-Namen → IDs auflösen |
| `config/label_registry/list` | Label-Namen → IDs auflösen |
| `config/config_entries/list` | MQTT-Broker-Settings für Autodetect lesen |
| `get_states` | Initialer State-Dump |
| `get_config` | HA-Konfiguration (Sprache, etc.) |
| `get_services` | Service-Definitionen für IntelliSense |
| `call_service` | Service aufrufen (mit optionalem `return_response`) |

---

## 10. MQTT Manager: Broker-Verbindung und Command-Routing

### Verbindungsparameter

Der MqttManager verbindet sich mit dem konfigurierten Broker (Standard: `core-mosquitto:1883`). Die Verbindungsoptionen beinhalten:

- **Will Message**: `jsa/status = offline` (retained, QoS 1) — wird von HA automatisch gesetzt wenn die Verbindung abbricht
- **Birth Message**: `jsa/status = online` beim `connect`-Event — signalisiert HA, dass der Addon verfügbar ist
- **Reconnect Period**: 5 Sekunden automatisches Reconnect bei Verbindungsabbruch

### Unified Payload

Wenn `state_topic` und `json_attributes_topic` auf dasselbe Topic zeigen (Normalfall), publiziert `publishEntityState()` einen einzigen JSON-Payload:

```json
{
  "state": "42",
  "attributes": { "unit_of_measurement": "clients" },
  "icon": "mdi:wifi"
}
```

HA extrahiert State via `value_template: "{{ value_json.state }}"`, Attribute via `json_attributes_topic` + `value_json.attributes.*`.

### Command-Routing

Der MqttManager subscribed auf `jsa/#` und routet eingehende Messages nach Schema `jsa/<domain>/<script_id>/set` als `command`-Event weiter. Der `ScriptCommandRouter` nimmt diese Events und übersetzt sie in `startScript`, `stopScript`, `setState` etc.

### Health Check

Alle 30 Sekunden prüft ein Watchdog ob `client.connected` noch `true` ist. Falls nicht, wird `status_change: { connected: false }` emittiert. Das löst in `EntityManager` eine `createExposedEntities()`-Sequenz aus wenn die Verbindung wiederhergestellt wird.

---

## 11. TypeScript-Pipeline und IntelliSense

### Compiler Manager

TypeScript-Dateien (`.ts`) werden vom `CompilerManager` mit der offiziellen TypeScript API (nicht `tsc` CLI) transpiliert. Die compiled `.js`-Dateien landen in `.storage/dist/` und spiegeln die Ordnerstruktur der Quelldateien.

**Source Maps**: `execArgv: ['--enable-source-maps']` im Worker-Start sorgt dafür, dass Stack Traces auf die ursprünglichen `.ts`-Zeilen zeigen.

Der Compiler überwacht Änderungen via `ScriptWatcher` (chokidar) und transpiliert automatisch bei Save. Compilation-Fehler werden via Socket.io als `compiler_signal` an den Editor geschickt, der daraus Inline-Fehlermarker erzeugt.

### Type Definition Generator

`TypeDefinitionGenerator` erzeugt drei automatisch generierte Dateien in `.storage/`:

| Datei | Inhalt |
|---|---|
| `ha-api.d.ts` | Typen für das `ha`-Objekt (von `core/types/ha-api.d.ts` kopiert) |
| `entities.d.ts` | Alle HA Entity-IDs als Union-Type für `ha.getState()`-Autocomplete |
| `store.d.ts` | Aktuelle Store-Keys als TypedStore-Interface |
| `services.d.ts` | ServiceMap mit allen HA Domains und Services (aus `get_services`) |

Jede Änderung an Store-Daten oder HA-States triggert eine Neugeierung mit Debouncing. Das Frontend empfängt ein `typings_updated`-Socket.io-Event und lädt die Definitionen neu in den Monaco-Editor.

---

## 12. Settings: Schema-Driven UI

`core/settings-schema.js` definiert die Struktur der Einstellungen als Array von Sections mit Items. Dasselbe Schema wird für zwei Zwecke verwendet:

1. **Frontend**: Das Settings-UI wird vollständig aus dem Schema generiert — kein manuelles HTML
2. **Backend**: Validierung der gespeicherten Settings beim Laden

### Item-Typen

| Typ | Beschreibung |
|---|---|
| `text` / `number` / `boolean` | Standard-Eingabefelder |
| `select` | Dropdown mit `options: [{ value, label }]` |
| `entity-picker` | HA-Entity-Autocomplete |
| `mqtt-test` | Spezieller Button: testet MQTT-Verbindung ohne zu speichern |
| `mqtt-autodetect` | Spezieller Button: liest MQTT-Konfiguration aus HA aus |
| `button` | Generischer HTTP-Action-Button mit `actionUrl` |

### Conditions

Items können mit `condition: { key, value }` bedingt angezeigt werden — z.B. MQTT-Felder nur wenn `enabled: true`. Das Frontend wertet diese Bedingungen in Echtzeit aus.

### `active: false`

Items mit `active: false` werden im Schema definiert, aber im UI ausgeblendet (z.B. temporär deaktivierte Features). Sie bleiben im Schema für einfaches Re-Aktivieren.

---

## 13. Ressourcenverbrauch und bekannte Einschränkungen

### RAM-Overhead pro Worker Thread

Jeder Worker Thread instanziiert eine eigene V8-Engine, was einen Basis-Overhead von ~20–30 MB bedeutet. Mit dem konfigurierbaren `maxOldGenerationSizeMb` (Standard: 256 MB) gibt es ein hartes Limit pro Skript.

Das `initialStates`-Objekt mit dem kompletten HA State Cache wird beim Worker-Start kopiert. Bei großen HA-Installationen (3000+ Entities) kann das mehrere MB pro Worker ausmachen.

### MQTT Discovery Delay

Zwischen dem Publizieren des Discovery-Payloads und der Verfügbarkeit der Entity in HA gibt es eine Verarbeitungszeit (~1–3 Sekunden). Das `ha.register()`-Call in einem Skript kehrt sofort zurück, aber `ha.getState()` auf die neue Entity kann in den ersten Sekunden `undefined` liefern.

### HA 2026.4 Kompatibilitätshinweis

`object_id` wurde in HA 2026.4 aus MQTT Discovery entfernt. Das Addon sendet weiterhin `object_id` für Rückwärtskompatibilität mit HA < 2025.10, aber `default_entity_id` ist das maßgebliche Feld ab HA 2025.10.

### WebSocket Nachrichten-ID Counter

Der `msgId`-Counter in `HAConnector` ist ein Integer der monoton steigt und nie zurückgesetzt wird. Bei sehr langen Laufzeiten und vielen Requests könnte er theoretisch JavaScript's `Number.MAX_SAFE_INTEGER` überschreiten — in der Praxis irrelevant (bräuchte Milliarden Requests).
