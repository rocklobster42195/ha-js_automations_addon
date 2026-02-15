# 🗺️ JS Automations Roadmap

Current Version: **v2.12.0 (Stable)**

## 🟦 Short Term (v2.13 - v2.15)
- [ ] **onStop Hook:** Allow scripts to clean up resources (custom timers, db connections) when stopped.
- [ ] **Astro Triggers:** Native support for `astro:sunset`, `astro:sunrise` with offsets.
- [ ] **Log Levels:** Support for `@loglevel` (debug, info, error) to reduce console noise.
- [ ] **Global Folder:** A `/global` directory for shared utility functions automatically available in all scripts.

## 🟨 Mid Term (v2.20 - v3.0)
- [ ] **Multi-Tab Editor:** Switch between multiple open scripts in the Dashboard.
- [ ] **Git Integration:** Built-in UI to pull/push scripts from a GitHub repository.
- [ ] **NPM Prune:** Automatically remove unused NPM packages when scripts are deleted.
- [ ] **Visual Selectors:** `ha.select({area: 'Living Room'})` for bulk actions on entities.

## 🟧 Long Term (v3.0+)
- [ ] **Blockly Integration:** Drag-and-drop visual programming layer that generates JS code.
- [ ] **Dashboard Widgets:** Custom UI components for scripts to show specific data in the sidebar.
- [ ] **Resource Monitoring:** Real-time CPU and RAM usage tracking per script.