/**
 * @name Waschmaschinen Skript
 * @icon mdi:washing-machine
 * @description Überwacht die Waschmaschine, setzt sensor.waschmaschine_status mit Dauer und Endezeit
 * @area Keller
 * @label Alarme
 * @loglevel info
 */

const scriptName=ha.getHeader('name');
ha.log(`'${scriptName}' gestartet...`);

const SWITCH = 'switch.waschmaschine'; 
const SENSOR = 'sensor.waschmaschine_status';
const DURATION_MINUTES = 120;
const WM_DATA = 'wm_data';

// Funktion zur Benachrichtigung mit lokalen Variationen
function sendFinishNotifications() {
    ha.log("Waschmaschine fertig! Wähle Zufallstext...");

    const variations =[
        // Klassisch & Freundlich
        "[sigh][bored]Die Waschmaschine ist fertig.",
        "[bored]Der Waschgang ist beendet. Die Wäsche kann jetzt aufgehängt werden.",
        "Deine Wäsche ist frisch gewaschen und wartet im Keller auf dich.",
        "Das Waschprogramm ist abgeschlossen. Bitte die Wäsche zeitnah ausräumen.",
        
        // Humorvoll & Motivierend
        "Ding Dong! Deine frisch gewaschene Wäsche verlangt nach dir.",
        "Mission 'Saubere Kleidung' war erfolgreich. Zeit fürs Ausräumen!",
        "Die Waschmaschine hat fertig geschleudert. Bitte befreie die nasse Wäsche aus der Trommel!",
        "Achtung, Wäsche-Alarm! Die Maschine ist durch.",
        "<s>Es ist Zeit für ein kleines Workout.</s> [laughing] <s>Wäsche aufhängen steht auf dem Plan!</s>",
        "Operation Sauberschlüpfer erfolgreich beendet.",
               
        // Etwas drängender (damit man es nicht vergisst)
        "[sarcasm] Die Wäsche fängt leider nicht an, von selbst zu trocknen. Die Waschmaschine ist fertig!",
        "[sigh] Der nasse Wäsche-Berg wartet einsam im Keller auf dich.",
        "Wasch-Ende erreicht. Bitte zügig ausräumen, bevor alles knittert!"
    ];
    
    // Zufälligen Satz aus dem Array auswählen
    const randomMessage = variations[Math.floor(Math.random() * variations.length)];

    ha.debug(`Gewählter Text für Benachrichtigung: "${randomMessage}"`);

    // Push-Benachrichtigung aufs Handy
    ha.call('notify.mobile_app_pixel_7a', { 
        message: 'Die Waschmaschine ist fertig.' 
    });
    
    // Ausgabe auf Sonos
    // WICHTIG: 'cache: false' bleibt drin, damit der Speicher nicht mit dutzenden Audio-Dateien vollläuft.
    ha.call('tts.cloud_say', { 
        entity_id: 'media_player.sonos_kuche', 
        message: randomMessage, 
        cache: false 
    });
}

// Haupt-Logik zur Berechnung
function updateProgress() {
    const wmData = ha.store.get(WM_DATA);
    const finishAt = wmData?.wm_finish_timestamp;
    const isPlugOn = ha.getStateValue(SWITCH) === true;

    if (!isPlugOn) {
        ha.update(SENSOR, 'aus', { icon: 'mdi:washing-machine-off' });
        if (finishAt) ha.store.delete(WM_DATA);
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
            if (wmData?.wm_notified !== true) {
                sendFinishNotifications();
                ha.store.set(WM_DATA, { ...wmData, wm_notified: true });
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
    const wmData = ha.store.get(WM_DATA);
    const finishAt = wmData?.wm_finish_timestamp;

    if (isNowOn && !finishAt) {
        ha.log("⚠️ Maschine läuft bereits, aber kein Timer im Speicher. Initialisiere Timer jetzt...");
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set(WM_DATA, { wm_finish_timestamp: endTimestamp, wm_notified: false });
    }
    updateProgress();
}

// Trigger für Änderungen
ha.on(SWITCH, (e) => {
    if (e.state === 'on' && e.old_state !== 'on') {
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set(WM_DATA, { wm_finish_timestamp: endTimestamp, wm_notified: false });
        ha.log(`Waschmaschine eingeschaltet. Timer gesetzt auf ${new Date(endTimestamp).toLocaleTimeString()}`);
        updateProgress();
    } else if (e.state === 'off') {
        ha.store.delete(WM_DATA);
        updateProgress();
    }
});

const progressInterval = setInterval(updateProgress, 30000);
ha.onStop(() => clearInterval(progressInterval));

// Warten, bis der HA-Cache geladen ist (ca. 2 Sek), dann Initial-Check
setTimeout(checkInitialState, 2000);