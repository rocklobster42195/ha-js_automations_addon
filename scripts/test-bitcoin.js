/**
 * @name Internet Check
 * @icon mdi:wifi-check
 * @npm axios
 * @description Prüft Verbindung zu Google und JSONPlaceholder.
 */

const axios = require('axios');

ha.log("Starte Verbindungs-Test...");

async function testConnection() {
    try {
        // 1. Einfacher Test gegen eine Dummy-API
        ha.log("Pinge jsonplaceholder.typicode.com...");
        const res = await axios.get('https://jsonplaceholder.typicode.com/todos/1', { timeout: 5000 });
        
        ha.log(`✅ Erfolg! Status: ${res.status}`);
        ha.log(`   Daten: ${JSON.stringify(res.data)}`);

    } catch (err) {
        ha.error(`❌ Verbindung gescheitert: ${err.message}`);
        
        if (err.code === 'ENOTFOUND') {
            ha.error("   -> DNS Fehler. Dein PC kann den Servernamen nicht auflösen.");
        } else if (err.code === 'ETIMEDOUT') {
            ha.error("   -> Timeout. Firewall oder schlechte Verbindung?");
        }
    }
}

testConnection();