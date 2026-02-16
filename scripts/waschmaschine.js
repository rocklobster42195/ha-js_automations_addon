/**
 * @name Waschmaschinen Manager
 * @icon mdi:washing-machine
 * @description Überwacht die Waschmaschine und erstellt einen Status-Sensor in HA.
 * @loglevel info
 * @area Keller
 */

const SWITCH = 'switch.waschmaschine'; // Exakte ID deines Schalters prüfen!
const SENSOR = 'sensor.waschmaschine_status';
const NOTIFY_SERVICE = 'notify.mobile_app_pixel_7a';
const MEDIA_PLAYER = 'media_player.sonos_kuche';
const DURATION_MINUTES = 120; // 2 Stunden Waschzeit

ha.log("Waschmaschinen-Manager gestartet.");

// Hilfsfunktion für Benachrichtigungen
function sendFinishNotifications() {
    ha.log("Sende Benachrichtigungen: Maschine ist fertig.");
    
    // Handy
    ha.callService('notify', 'mobile_app_pixel_7a', {
        message: 'Die Waschmaschine ist fertig!'
    });

    // Sonos
    ha.callService('tts', 'cloud_say', {
        entity_id: MEDIA_PLAYER,
        message: 'Die Waschmaschine ist fertig.',
        cache: true
    });
}

// Haupt-Logik zur Berechnung
function updateProgress() {
    // Holen der Daten aus dem Cache/Store
    const finishAt = ha.store.val.wm_finish_timestamp;
    const currentState = ha.states[SWITCH];
    const isPlugOn = currentState?.state === 'on';

    // FALL 1: Steckdose ist AUS
    if (!isPlugOn) {
        ha.updateState(SENSOR, 'aus', { 
            icon: 'mdi:washing-machine-off',
            finish_time: null 
        });
        if (finishAt) ha.store.delete('wm_finish_timestamp');
        return;
    }

    // FALL 2: Waschgang läuft (Timestamp im Store vorhanden)
    if (finishAt) {
        const remainingMs = finishAt - Date.now();

        if (remainingMs > 0) {
            // Zeit berechnen (H:MM)
            const minutesTotal = Math.ceil(remainingMs / 60000);
            const hours = Math.floor(minutesTotal / 60);
            const mins = minutesTotal % 60;
            const timeStr = `${hours}:${mins.toString().padStart(2, '0')}`;

            ha.updateState(SENSOR, timeStr, {
                icon: 'mdi:washing-machine',
                finish_time: new Date(finishAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
            });
        } 
        // FALL 3: Waschgang ist ZEITLICH fertig, Steckdose aber noch AN
        else {
            ha.updateState(SENSOR, 'fertig', { 
                icon: 'mdi:washing-machine-alert',
                finish_time: 'Abgeschlossen'
            });

            // Benachrichtigung nur einmal senden
            if (ha.store.val.wm_notified !== true) {
                sendFinishNotifications();
                ha.store.set('wm_notified', true);
            }
        }
    } else {
        // Falls Steckdose an ist, aber kein Timer läuft (z.B. Standby nach Neustart ohne Store)
        ha.updateState(SENSOR, 'bereit', { icon: 'mdi:washing-machine' });
    }
}

// Event-Listener: Wenn Schalter betätigt wird
ha.on(SWITCH, (e) => {
    if (e.state === 'on' && e.old_state !== 'on') {
        ha.log("Waschmaschine wurde eingeschaltet. Timer startet.");
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set('wm_finish_timestamp', endTimestamp);
        ha.store.set('wm_notified', false);
        updateProgress();
    } 
    else if (e.state === 'off') {
        ha.log("Waschmaschine wurde ausgeschaltet.");
        ha.store.delete('wm_finish_timestamp');
        ha.store.delete('wm_notified');
        updateProgress();
    }
});

// Alle 30 Sekunden den Fortschritt im Sensor aktualisieren
const progressInterval = setInterval(updateProgress, 30000);

// Graceful Shutdown: Timer löschen wenn Skript stoppt
ha.onStop(() => {
    clearInterval(progressInterval);
});

// Sofort-Check beim Start
updateProgress();