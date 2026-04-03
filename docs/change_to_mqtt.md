# Architecture Concept: Transition to MQTT Discovery

## 1. Objective
Replace the custom Home Assistant integration (`js_automations` custom_component) with the standardized **MQTT Discovery** protocol. This removes the dependency on local file manipulation in Home Assistant and makes the addon compatible with any MQTT-capable automation platform.

## 2. Core Components

### 2.1 MqttManager (New)
A new core manager responsible for:
- Maintaining a persistent connection to the MQTT broker.
- Handling "Birth" and "Last Will and Testament" (LWT) messages to manage the "Availability" of all JS Automations entities.
- Subscribing to command topics (e.g., for switches/buttons) and routing these events back to the `WorkerManager`.

### 2.2 EntityManager Refactoring
The `EntityManager` will be decoupled from `ha-connection.js`. Instead of calling HA services like `create_entity` or `update_entity`, it will generate MQTT payloads:
- **Config Topic:** `homeassistant/<domain>/jsa_<script_id>/config`
- **State Topic:** `jsa/<domain>/<script_id>/state`
- **Command Topic:** `jsa/<domain>/<script_id>/set`
- **Availability Topic:** `jsa/status` (Global LWT)

## 3. Configuration (Settings)
The `settings-schema.js` will be expanded to include a "MQTT Broker" section:
- **Broker Host/IP:** Address of the MQTT server (e.g., `core-mosquitto` for HA addon).
- **Port:** Default 1883.
- **Username/Password:** Authentication credentials.
- **Discovery Prefix:** Default `homeassistant` (standard for HA).
- **Client ID:** Unique identifier for the addon.

## 4. Advantages & Opportunities

### 4.1 Universality
The addon is no longer exclusive to Home Assistant. Any system that speaks MQTT (Node-RED, OpenHAB, custom dashboards) can now monitor and control the scripts.

### 4.2 Reduced Maintenance
No more Python code to maintain in `custom_components`. Changes to Home Assistant's internal API will no longer break the entity management of this addon, as the MQTT Discovery protocol is highly stable.

### 4.3 Instant Availability Management
By using the MQTT Last Will, all entities created by the addon will automatically be marked as `unavailable` in Home Assistant if the addon crashes or is stopped. This provides much better feedback to the user than the current WebSocket-based approach.

### 4.4 Simplified Installation
The "Integration Manager" in the UI becomes obsolete. Users only need to provide broker credentials; no file copying or HA restarts are required to "install" the integration logic.

## 5. Challenges & Difficulties

### 5.1 Broker Dependency
The addon now requires an external service (MQTT Broker). If the broker is down, the link between scripts and the UI is severed, even if both the addon and HA are healthy.

### 5.2 State Synchronization & Retention
When the addon starts, it must republish all configurations and states. Using the `retain` flag in MQTT is essential to ensure that HA sees the correct state immediately upon its own restart, without waiting for a script update.

### 5.3 Orphaned Entities Cleanup
In the current system, we manually remove entities via service calls. In MQTT, an entity is removed by sending an empty (null) message to its **Config Topic**. The `cleanupOrphanedEntities` logic must be adapted to perform these "MQTT Purges" when a script is deleted.

### 5.4 Complexity of Command Handling
For interactive entities (Switches, Numbers, Selects), the addon must now manage an active subscription router. It needs to map incoming messages on `.../set` topics back to the correct `ha.on('command', ...)` or internal script start/stop logic.

## 6. Migration Path

1.  **Phase 1 (Dual Support):** Implement the `MqttManager`. If MQTT credentials are provided, `EntityManager` publishes to both the old integration and MQTT.
2.  **Phase 2 (Deprecation):** Mark the custom integration as "Legacy".
3.  **Phase 3 (Hard Cut):** Remove the `ha-connection` service calls for entity management and rely solely on MQTT.

## 7. Topic Hierarchy Structure (Example)

| Purpose | Topic |
| :--- | :--- |
| **Discovery** | `homeassistant/switch/jsa_living_room/config` |
| **State** | `jsa/switch/living_room/state` |
| **Command** | `jsa/switch/living_room/set` |
| **Addon Status** | `jsa/status` (online/offline) |