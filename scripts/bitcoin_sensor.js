/**
 * @name Bitcoin Live Sensor
 * @icon mdi:currency-btc
 * @description Holt den BTC Kurs und erstellt einen Sensor in HA.
 * @loglevel info
 */

ha.log("Bitcoin-Sensor gestartet...");

async function updateBitcoinSensor() {
    try {
        // 1. Preis von CoinGecko holen
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
        const response = await axios.get(url, { timeout: 10000 });
        const price = response.data.bitcoin.usd;

        ha.log(`Aktueller Kurs: $${price}`);

        // 2. In Home Assistant als Entität speichern
        // Wenn die Entität nicht existiert, wird sie automatisch angelegt!
        ha.updateState('sensor.bitcoin_price', price, {
            unit_of_measurement: 'USD',
            friendly_name: 'Bitcoin Preis',
            icon: 'mdi:currency-btc',
            device_class: 'monetary',
            last_updated_by: 'JS-Automation'
        });

    } catch (err) {
        ha.error("Fehler beim Abrufen des Kurses: " + err.message);
    }
}

// Alle 5 Minuten aktualisieren (um API-Limits zu schonen)
updateBitcoinSensor();
setInterval(updateBitcoinSensor, 300000);