/**
 * @name CRON-Test
 * @icon mdi:clock
 */

ha.log("Cronjob gestartet.");

// Dank global.schedule läuft der Worker ewig weiter!
schedule('0 18 * * *', () => {
    ha.log("Prüfe Müllkalender...");
   
});
// Skript endet NICHT -> Worker bleibt an -> Icon bleibt im Dashboard grün/blau