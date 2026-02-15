# ⚙️ Technical Architecture: JS Automations

## Architecture Overview
The system follows a **Master-Worker** architecture designed for stability and Home Assistant Ingress compatibility.

### 1. The Master Process (`server.js`)
- **HTTP/WebSocket Server:** Serves the Dashboard and streams live logs via `Socket.io`.
- **HA Bridge:** Maintains a single, high-speed native WebSocket connection to the Home Assistant API.
- **State Orchestrator:** Manages the `StoreManager` (Global JSON Store) and `WorkerManager`.
- **Ingress Proxy:** Handles dynamic path resolution to work behind Home Assistant's reverse proxy.

### 2. The Worker Manager (`core/worker-manager.js`)
- Orchestrates the lifecycle of Node.js `Worker Threads`.
- **Subscription Engine:** Maintains a registry of which script listens to which HA entity. It uses a "Dispatch" pattern to only send relevant events to specific workers, minimizing CPU overhead.
- **Crash Detection:** Monitors exit codes. Any non-zero exit (e.g. exit code 1) triggers an "Error" state in the UI.

### 3. The Worker Wrapper (`core/worker-wrapper.js`)
- The entry point for every user script.
- **Sandboxing:** Isolates user code from the main process.
- **Smart Lifecycle:** Uses Node.js `ref()` and `unref()` logic. Scripts with active listeners (`ha.on`, `schedule`) stay alive; one-shot scripts exit automatically after execution to save RAM.
- **Module Resolution:** Injects `/config/js-automation/node_modules` into the search path to support persistent NPM packages.

## 📡 Data Flow: Real-time Updates
1. **HA** sends a `state_changed` event via WebSocket.
2. **HAConnector** updates the master state cache.
3. **WorkerManager** evaluates active subscriptions (Regex/Wildcard).
4. **Target Worker** receives a message and updates its local `ha.states` object before triggering the user's callback.

## 📂 Internal File Roles
- `parser.js`: Static analysis of script headers using Regex.
- `ha-connection.js`: Raw WebSocket protocol implementation for maximum stability.
- `state-manager.js`: Tracks which scripts should autostart on reboot.
- `app.js`: Ingress-aware frontend logic; manages Monaco Editor initialization and library injection.
