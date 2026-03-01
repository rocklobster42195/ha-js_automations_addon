# Changelog

## [2.38.0] - 2026-03-01
### Added
- **Settings management and UI integration**

## [2.37.x] - 2026-02-28
### Added
- **Gemini Weather Demo:** Added a new example script demonstrating AI-driven weather integration.
- **Native Update Logging:** Enhanced logging specifically for native entity updates.
### Changed
- Refined entity management and worker synchronization.

## [2.36.0] - 2026-02-27
### Added
- **v2 Hybrid Architecture:** Introduction of the new hybrid system for better performance and flexibility.
- **Native Entity Support:** Direct support for creating and managing native Home Assistant entities.

## [2.35.0] - 2026-02-26
### Changed
- Major refactoring of script management and native entity logic.
- Comprehensive documentation updates.

## [2.34.x] - 2026-02-26
### Added
- **Graceful Shutdown:** Implemented SIGTERM signal handling for clean worker exits.
### Fixed
- Script filename reference logic in exit handlers.

## [2.33.0] - 2026-02-26
### Added
- **Script Creation Wizard:** New guided UI to simplify the creation of new automation scripts.

## [2.32.x] - 2026-02-25
### Added
- **Library Support:** Script management now supports the inclusion of shared libraries.
- **Connection Management:** Enhanced socket-client logic for better connection state awareness.

## [2.31.0] - 2026-02-24
### Added
- **JSA-Bridge Integration:** Initial implementation of the Home Assistant Integration (JSA-Bridge) to support seamless communication between the Add-on and HA.

## [2.30.x] - 2026-02-24
### Added
- **Expert Mode:** Introduced system statistics and a dedicated UI for managing Store Secrets.
- **HA Auto-Reconnect:** Automated reconnection logic for the Home Assistant API with UI status indicators.
- **npm Sync:** Automated version synchronization via npm.

## [2.2x] - 2026-02-22
### Added
- **NPM Package Support:** Users can now use third-party npm packages within their automation scripts.
- **Global Store Explorer:** New UI tool to inspect and debug the persistent global store.
- **Modular Frontend:** Refactored the UI (`app.js`) into modules for better performance and maintainability.
### Fixed
- Resolved race conditions affecting `ha.states` within event callbacks.

## [2.1x] - 2026-02-21
### Added
- **IntelliSense Overhaul:** Improved code editor with better snippets and IntelliSense for `ha.on()` arrays.
- **Multi-language Support (i18n):** Added UI localization (language selection moved to Add-on config).
- **Persistent Logs:** System logs now persist across sessions.
- **Sidebar Grouping:** Collapsible labels and groups for better script organization.

## [2.0.0] - 2026-02-15
### Added
- **V2.0 Engine:** Major infrastructure overhaul including a smart worker lifecycle.
- **Flat UI Redesign:** Completely modernized user interface with enhanced filtering.
- **Synchronous Store:** Implemented a persistent, synchronous storage engine for script data.
- **Crash Detection:** Automated monitoring and detection of script worker failures.

## [1.0.0] - 2026-02-13
### Added
- **Initial Release:** Foundation of the JS-Automation Engine for Home Assistant.