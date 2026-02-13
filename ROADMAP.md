# 🗺️ JS-Automation Roadmap

This document outlines the journey of **JS-Automation**, from a simple script runner to a full-blown Home Assistant IDE.

## ✅ Phase 1: The Core Engine (Completed)
- [x] **File Metadata Parser:** Ability to read `@name`, `@icon`, and `@npm` from script headers.
- [x] **Native WebSocket Connector:** High-performance, library-free connection to Home Assistant.
- [x] **Worker Thread Isolation:** Every script runs in its own thread to prevent system crashes.
- [x] **Reactive API:** Implementation of `ha.onStateChange` for real-time automation.
- [x] **NPM Dependency Manager:** Automatic installation of packages into `/config/js-automation/node_modules`.
- [x] **State API:** Implementation of `ha.updateState` to create virtual sensors in HA.

## ✅ Phase 2: User Interface & Integration (Completed)
- [x] **Responsive Dashboard:** Sleek card-based UI with Material Design Icons.
- [x] **Ingress Integration:** Secure access via Home Assistant Sidebar without opening ports.
- [x] **Live Logging:** Real-time log streaming from worker threads to the browser via Socket.io.
- [x] **Zero-Config Add-on:** Automatic authentication via HA Supervisor Token.
- [x] **Persistent Storage:** Scripts and states are saved in the official HA `/config` directory.

## 🏗️ Phase 3: The Web IDE (In Progress)
- [x] **Monaco Editor Integration:** In-browser code editing (VS Code core).
- [x] **Script Management:** Create, delete, toggle, and restart scripts via UI.
- [x] **Entity Type Generation:** Dynamic `entities.d.ts` generation for 1000+ entities.
- [ ] **Rock-solid IntelliSense:** Finalizing the CSS/Theme fixes for the suggestion widget behind HA Ingress.
- [ ] **Multi-Tab Editing:** Ability to keep multiple scripts open.

## 🚀 Phase 4: Advanced Features (Planned)
- [ ] **Visual Automation (Blockly):** A drag-and-drop layer that generates JavaScript code.
- [ ] **Git Integration:** Sync scripts with GitHub/GitLab directly from the UI.
- [ ] **Cron / Scheduler:** A built-in UI to trigger scripts at specific times (cron-style).
- [ ] **Template Gallery:** One-click blueprints for common tasks (Bitcoin trackers, Light sync, etc.).
- [ ] **Global Store:** A shared memory space for scripts to exchange data without using HA entities.

## 🛡️ Phase 5: Production & Polish
- [ ] **Resource Monitoring:** Show CPU/RAM usage per script in the dashboard.
- [ ] **Error Notifications:** Send HA persistent notifications if a script crashes repeatedly.
- [ ] **Backup Integration:** Full compatibility with Home Assistant's native backup system.
- [ ] **Community Release:** Publishing as a repository for easy installation via HACS or as an official Add-on.