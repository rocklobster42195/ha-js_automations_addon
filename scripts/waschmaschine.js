/**
 * @name waschmaschine.js
 * @icon mdi:test-tube
 * @description 
 * @area 
 * @label 
 * @loglevel info
 */


const SWITCH = 'switch.3fachleiste_l1';
const SENSOR = 'sensor.waschmaschine_status';
const DURATION_MINUTES = 120;

ha.log("Waschmaschinen-Manager gestartet.");

// Funktion zur Benachrichtigung
function sendFinishNotifications() {
    ha.log("Waschmaschine fertig! Sende Benachrichtigungen...");
    ha.callService('notify', 'mobile_app_pixel_7a', { message: 'Die Waschmaschine ist fertig!' });
    //ha.callService('tts', 'cloud_say', { entity_id: 'media_player.sonos_kuche', message: 'Die Waschmaschine ist fertig.', cache: true });
}

// Haupt-Logik zur Berechnung
function updateProgress() {
    const finishAt = ha.store.val.wm_finish_timestamp;
    const isPlugOn = ha.states[SWITCH]?.state === 'on';

    if (!isPlugOn) {
        ha.updateState(SENSOR, 'aus', { icon: 'mdi:washing-machine-off' });
        if (finishAt) ha.store.delete('wm_finish_timestamp');
        return;
    }

    if (finishAt) {
        const remainingMs = finishAt - Date.now();
        if (remainingMs > 0) {
            const minutesTotal = Math.ceil(remainingMs / 60000);
            const hours = Math.floor(minutesTotal / 60);
            const mins = minutesTotal % 60;
            ha.updateState(SENSOR, `${hours}:${mins.toString().padStart(2, '0')}`, {
                icon: 'mdi:washing-machine',
                finish_time: new Date(finishAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
            });
        } else {
            ha.updateState(SENSOR, 'fertig', { icon: 'mdi:washing-machine-alert' });
            if (ha.store.val.wm_notified !== true) {
                sendFinishNotifications();
                ha.store.set('wm_notified', true);
            }
        }
    } else {
        ha.updateState(SENSOR, 'bereit', { icon: 'mdi:washing-machine' });
    }
}

/**
 * INITIALISIERUNG (Wichtig für den Start während des Laufs)
 */
function checkInitialState() {
    const isNowOn = ha.states[SWITCH]?.state === 'on';
    const finishAt = ha.store.val.wm_finish_timestamp;

    if (isNowOn && !finishAt) {
        ha.log("⚠️ Maschine läuft bereits, aber kein Timer im Speicher. Initialisiere Timer jetzt...");
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set('wm_finish_timestamp', endTimestamp);
        ha.store.set('wm_notified', false);
    }
    updateProgress();
}

// Trigger für Änderungen (Weg für die Zukunft)
ha.on(SWITCH, (e) => {
    if (e.state === 'on' && e.old_state !== 'on') {
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set('wm_finish_timestamp', endTimestamp);
        ha.store.set('wm_notified', false);
        ha.log(`Waschmaschine eingeschaltet. Timer gesetzt auf ${new Date(endTimestamp).toLocaleTimeString()} Uhr`);
        updateProgress();
    } else if (e.state === 'off') {
        ha.store.delete('wm_finish_timestamp');
        ha.store.delete('wm_notified');
        ha.log("Waschmaschine ausgeschaltet.");
        updateProgress();
    }
});

const progressInterval = setInterval(updateProgress, 30000);

ha.onStop(() => {
    clearInterval(progressInterval);
});

// Warten, bis der HA-Cache geladen ist (ca. 2 Sek), dann Initial-Check
setTimeout(checkInitialState, 2000);