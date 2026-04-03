/**
 * @name Waschmaschinen Skript
 * @name Washing Machine Script
 * @icon mdi:washing-machine
 * @description Überwacht die Waschmaschine, setzt sensor.waschmaschine_status mit Dauer und Endezeit
 * @area Keller
 * @label Alarme
 * @description Monitors the washing machine, sets sensor.waschmaschine_status with duration and end time.
 * @area Cellar
 * @label Alarms
 * @loglevel info
 */

const scriptName=ha.getHeader('name');
ha.log(`'${scriptName}' gestartet...`);
ha.log(`'${scriptName}' started...`);

const SWITCH = 'switch.waschmaschine'; 
const SENSOR = 'sensor.waschmaschine_status';
const DURATION_MINUTES = 120;
const WM_DATA = 'wm_data';

// Funktion zur Benachrichtigung mit lokalen Variationen
// Function for notifications with random variations
function sendFinishNotifications() {
    ha.log("Waschmaschine fertig! Wähle Zufallstext...");
    ha.log("Washing machine finished! Selecting random message...");

    const variations =[
        // Klassisch & Freundlich
        // Classic & Friendly
        "[sigh][bored]Die Waschmaschine ist fertig.",
        "[bored]Der Waschgang ist beendet. Die Wäsche kann jetzt aufgehängt werden.",
        "Deine Wäsche ist frisch gewaschen und wartet im Keller auf dich.",
        "Das Waschprogramm ist abgeschlossen. Bitte die Wäsche zeitnah ausräumen.",
        
        // Humorvoll & Motivierend
        // Humorous & Motivating
        "Ding Dong! Deine frisch gewaschene Wäsche verlangt nach dir.",
        "Mission 'Saubere Kleidung' war erfolgreich. Zeit fürs Ausräumen!",
        "Die Waschmaschine hat fertig geschleudert. Bitte befreie die nasse Wäsche aus der Trommel!",
        "Achtung, Wäsche-Alarm! Die Maschine ist durch.",
        "<s>Es ist Zeit für ein kleines Workout.</s> [laughing] <s>Wäsche aufhängen steht auf dem Plan!</s>",
        "Operation Sauberschlüpfer erfolgreich beendet.",
               
        // Etwas drängender (damit man es nicht vergisst)
        // Slightly more urgent
        "[sarcasm] Die Wäsche fängt leider nicht an, von selbst zu trocknen. Die Waschmaschine ist fertig!",
        "[sigh] Der nasse Wäsche-Berg wartet einsam im Keller auf dich.",
        "Wasch-Ende erreicht. Bitte zügig ausräumen, bevor alles knittert!"
    ];
    
    // Zufälligen Satz aus dem Array auswählen
    // Select random message from array
    const randomMessage = variations[Math.floor(Math.random() * variations.length)];

    ha.debug(`Gewählter Text für Benachrichtigung: "${randomMessage}"`);
    ha.debug(`Selected notification text: "${randomMessage}"`);

    // Push-Benachrichtigung aufs Handy
    // Push notification to mobile phone
    ha.call('notify.mobile_app_pixel_7a', { 
        message: 'Die Waschmaschine ist fertig.' 
    });
    
    // Ausgabe auf Sonos
    // WICHTIG: 'cache: false' bleibt drin, damit der Speicher nicht mit dutzenden Audio-Dateien vollläuft.
    // TTS output on Sonos
    ha.call('tts.cloud_say', { 
        entity_id: 'media_player.sonos_kuche', 
        message: randomMessage, 
        cache: false 
    });
}

// Haupt-Logik zur Berechnung
// Main logic for calculation
function updateProgress() {
    const wmData = ha.store.get(WM_DATA);
    const finishAt = wmData?.wm_finish_timestamp;
    const isPlugOn = ha.getStateValue(SWITCH) === true;

    if (!isPlugOn) {
        ha.update(SENSOR, 'aus', { icon: 'mdi:washing-machine-off' });
        ha.update(SENSOR, 'off', { icon: 'mdi:washing-machine-off' });
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
            ha.updateState(SENSOR, 'finished', { icon: 'mdi:washing-machine-alert' });
            if (wmData?.wm_notified !== true) {
                sendFinishNotifications();
                ha.store.set(WM_DATA, { ...wmData, wm_notified: true });
            }
        }
    } else {
        ha.updateState(SENSOR, 'bereit', { icon: 'mdi:washing-machine' });
        ha.updateState(SENSOR, 'ready', { icon: 'mdi:washing-machine' });
    }
}

/**
 * INITIALISIERUNG (Wichtig für den Start während des Laufs)
 * INITIALIZATION (Important for starting mid-run)
 */
function checkInitialState() {
    const isNowOn = ha.states[SWITCH]?.state === 'on';
    const wmData = ha.store.get(WM_DATA);
    const finishAt = wmData?.wm_finish_timestamp;

    if (isNowOn && !finishAt) {
        ha.log("⚠️ Maschine läuft bereits, aber kein Timer im Speicher. Initialisiere Timer jetzt...");
        ha.debug("Machine is already running, but no timer in memory. Initializing now...");
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set(WM_DATA, { wm_finish_timestamp: endTimestamp, wm_notified: false });
    }
    updateProgress();
}

// Trigger für Änderungen
// Triggers for changes
ha.on(SWITCH, (e) => {
    if (e.state === 'on' && e.old_state !== 'on') {
        const endTimestamp = Date.now() + (DURATION_MINUTES * 60000);
        ha.store.set(WM_DATA, { wm_finish_timestamp: endTimestamp, wm_notified: false });
        ha.log(`Waschmaschine eingeschaltet. Timer gesetzt auf ${new Date(endTimestamp).toLocaleTimeString()}`);
        ha.log(`Washing machine switched on. Timer set to ${new Date(endTimestamp).toLocaleTimeString()}`);
        updateProgress();
    } else if (e.state === 'off') {
        ha.store.delete(WM_DATA);
        updateProgress();
    }
});

const progressInterval = setInterval(updateProgress, 30000);
ha.onStop(() => clearInterval(progressInterval));

// Warten, bis der HA-Cache geladen ist (ca. 2 Sek), dann Initial-Check
// Wait until HA cache is loaded (approx. 2 sec), then perform initial check
setTimeout(checkInitialState, 2000);