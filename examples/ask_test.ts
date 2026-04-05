/**
 * @name ask-test
 * @icon mdi:garage-alert
 * @label Spielwiese
 */

let snoozeTimeout: ReturnType<typeof setTimeout> | null = null;

const SNOOZE_DURATION_SECONDS = 20;

ha.onError((error) => {
    ha.error(`Ein unbehandelter Fehler ist aufgetreten: ${error.message}`);
    ha.error(error.stack);
    setTimeout(() => ha.restart(), 10000);
});

ha.onStop(() => {
    if (snoozeTimeout) {
        clearTimeout(snoozeTimeout);
        ha.log('Gestoppt und ausstehende Erinnerung gelöscht.');
    } else {
        ha.log('Gestoppt.');
    }
});

ha.log(ha.localize({ en: 'ask-test started...', de: 'ask-test gestartet...' }));

async function askUser() {
    const answer = await ha.ask(
        ha.localize({ en: "What should I do?", de: "Was soll ich tun?" }),
        {
            title: ha.localize({ en: "Garage Alert", de: "Garagen-Alarm" }),
            timeout: SNOOZE_DURATION_SECONDS * 1000,
            defaultAction: "SNOOZE",
            actions: [
                { action: "CLOSE",  title: ha.localize({ en: "Close now",    de: "Jetzt schließen" }) },
                { action: "SNOOZE", title: ha.localize({ en: "Remind me",    de: "Erinnere mich"   }) },
                { action: "IGNORE", title: ha.localize({ en: "Ignore",       de: "Ignorieren"      }) },
            ]
        }
    );

    if (answer === "CLOSE") {
        ha.log(ha.localize({ en: "Garage door closed by user.", de: "Garagentor vom Benutzer geschlossen." }));
    } else if (answer === "SNOOZE" || answer === null) {
        ha.log(ha.localize({ en: `Snoozed — reminding again in ${SNOOZE_DURATION_SECONDS}s.`, de: `Erinnerung verschoben — erneut in ${SNOOZE_DURATION_SECONDS} Sekunden.` }));
        snoozeTimeout = setTimeout(askUser, SNOOZE_DURATION_SECONDS * 1000);
    } else {
        ha.log(ha.localize({ en: "User chose to ignore.", de: "Benutzer hat Ignorieren gewählt." }));
    }
}

askUser();
