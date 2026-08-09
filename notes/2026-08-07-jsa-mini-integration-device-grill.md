# JSA Mini Integration (as Device): Grill / Discovery Notes

Date: 2026-08-07 · Goal: Figure out what potential a native "JSA as HA Device" mini-integration has (inspired by AWTRIX-NG's rich MQTT/HA-discovery device), what JSA's own integration/addon should cover out of the box, and what's better left to userland scripts via `ha.mqtt`.

## Context gathered before interview

- **AWTRIX-NG** (https://blueforcer.github.io/awtrix-ng/) is ESP32 LED-matrix firmware. Relevant pattern, not the literal target — it exposes itself to HA as a rich device via MQTT + HA auto-discovery:
  - Command topics (`cmd/...`): notify, notify/dismiss, apps/pushed/<name>, apps/switch|next|previous|order, display, display/moodlight, indicators/1-3, sounds/play|stop, radio/*, device/reboot|sleep, settings, settings/reset, screen/get
  - State topics (`state/...`, mostly retained): device (stats/power/indicators/sensors), settings, apps/active, radio, capabilities, prefix, buttons/left|select|right; non-retained `screen`
  - `<prefix>/availability` (LWT), `<prefix>/cmd/<topic>/result` command ack
  - HA discovery via single `<haPrefix>/device/<uid>/config` payload → ~20 entities auto-created: 4 lights (matrix + 3 indicators), 2 selects (brightness mode, transition), 1 switch (auto-transition), 3 buttons (dismiss/next/previous), 7 sensors (current app, version, IP, mqtt prefix, wifi strength, uptime, free RAM), plus conditional sensors (light level, temp/humidity/pressure, battery) if hardware present.
  - Key design point: HTTP API and MQTT payloads are identical JSON shapes, so automation logic is protocol-agnostic.
- **JSA's current capabilities** (already in `js_automations/core/types/ha-api.d.ts`):
  - `ha.register(entityId, config)` — creates/updates a native HA entity via MQTT Discovery (sensor, switch, select, button, etc.), with `{action: 'name'}` callback wiring for button presses.
  - `ha.unregister(entityId)` — teardown.
  - `ha.mqtt.subscribe(topic, cb)` / `ha.mqtt.publish(topic, payload, opts)` — raw broker access, wildcards supported.
  - So JSA already has the _primitives_ AWTRIX uses (discovery + raw MQTT) available to userland scripts. The open question is what JSA itself (the addon/runtime) should expose as its own built-in device, vs leave to scripts.

## Summary / key decisions

- Scope confirmed: "JSA Mini Integration (as Device)" = the JSA **add-on/runtime itself** ships as one self-describing HA device (health/status), analogous to AWTRIX exposing itself. It is a separate concern from `ha.register()`, which stays the tool for user-authored virtual devices.
- It must appear **automatically / out of the box** — no explicit registration step required from the user (unlike `ha.register()` which is opt-in per entity). This is a built-in kernel feature, not a userland pattern.

## Q&A log

### Q1 — Scope: what does "JSA as a Device" mean? [CORRECTED]

- Asked (v1, WRONG framing): Is this about the JSA add-on itself registering a native HA device (runtime health/status)?
- Correction: Misread. The topic is actually about **AWTRIX-NG devices as a target for JSA** — i.e., should JSA build a dedicated "mini integration" for AWTRIX-NG-style MQTT devices, and if so what should it cover vs. leave to plain `ha.mqtt` scripting? Not about JSA's own runtime exposing itself.
- Captured: User's answer to v1 ("Wenn es sich schon automatisch zeigt, brauchen wir das nicht als Gerät anmelden") actually means: AWTRIX-NG already auto-registers itself as a full HA device via its own HA-discovery (lights, sensors, buttons) — so JSA does **not** need to do anything to make an AWTRIX device "appear" in HA. That part is already solved by AWTRIX + HA core MQTT discovery, independent of JSA.
- Flags: none

### Q2 — Which entities should a built-in device bring? [SUPERSEDED — wrong framing, see Q1 correction]

- Asked (v1, wrong framing): proposed sensor/button list for a "JSA Runtime" device.
- Captured: User's answer ("Wenn AwtrixNG das alles von Haus aus mitbringt, brauchen wir das auch nicht") confirms the corrected reading: since AWTRIX already ships version/uptime/wifi/RAM/buttons/etc. as standard entities via its own discovery, JSA duplicating a device/entity layer for it would be redundant. No native JSA "device layer" needed for state/control that AWTRIX's own discovery already exposes.
- Flags: none
