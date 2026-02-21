/**
 * @name Log-Level Tester
 * @icon mdi:traffic-light
 * @description Testet die Filterung von Nachrichten.
 * @loglevel info
 */

// Globaler Error-Handler: Fängt Abstürze ab und sendet sie an das HA-Log
ha.debug("Variable x is: " + x);

// 1. DEBUG (Grau/Weiß)
// Sollte bei Einstellung 'info' NICHT sichtbar sein.
ha.debug("🐛 DEBUG: Das hier sind Details für Entwickler.");

// 2. INFO (Weiß/Standard)
// Sichtbar ab 'info'.
ha.log("ℹ️ INFO: Das ist eine normale Statusmeldung.");

// 3. WARN (Gelb)
// Sichtbar ab 'warn'.
ha.warn("⚠️ WARNUNG: Hier ist etwas nicht ganz okay, aber kein Absturz.");

// 4. ERROR (Rot)
// IMMER sichtbar, egal was eingestellt ist.
ha.error("❌ ERROR: Kritischer Fehler!");

// 5. TEST: Bewusster Absturz
// Da 'x' nicht definiert ist, würde das Skript hier crashen.
console.log(x);