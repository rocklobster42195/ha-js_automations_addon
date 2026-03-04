/**
 * @name Freifunk Client Counter
 * @icon mdi:account-group
 * @description Counts clients in Freifunk via UniFi WebSocket
 * @area REG77
 * @label System
 * @npm node-unifi
 */

//https://github.com/jens-maus/node-unifi
const Unifi = require('node-unifi');

// --- CONFIGURATION ---
const UNIFI_IP = '192.168.7.23';
const UNIFI_PORT = 443;
const UNIFI_USER = 'localadmin';
const UNIFI_PASS = ha.store.get('unifi_localadmin_pw');
const TARGET_SSID = 'Freifunk';
// ---------------------

const unifi = new Unifi.Controller({
  host: UNIFI_IP,
  port: UNIFI_PORT,
  sslverify: false
});

let lastCount = -1;
let debounceTimer;
ha.register('sensor.freifunk_clients', {
    name: 'Number of Freifunk Clients',
    icon: 'mdi:account-group',
    unit_of_measurement: 'Clients',
    area_id: 'REG77',
    labels: ['System']
});

// Function to query and log/save
async function updateClientCount() {
  try {
    const clients = await unifi.getClientDevices();
    const freifunkClients = clients.filter(client => client.essid === TARGET_SSID);
    const count = freifunkClients.length;
    // Only log if the count has changed to avoid flooding the log
    if (count !== lastCount) {
      ha.debug(`Client count in "${TARGET_SSID}": ${count}`);
      ha.update('sensor.freifunk_clients', count);
      lastCount = count;
    }
  } catch (err) {
    ha.error('Error retrieving clients:', err.message);
  }
}

(async () => {
  try {
    await unifi.login(UNIFI_USER, UNIFI_PASS);
    await updateClientCount();

    await unifi.listen();
    ha.log('UniFi WebSocket Listener started.');

    unifi.on('event', (event, data) => {
      if (event === 'events.evt_wg_connected' || event === 'events.evt_wg_disconnected') {
          ha.debug(`Event '${event}' detected. Updating client count...`);
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => updateClientCount(), 1000);
      }
    });

    // Cleanup on script stop
    ha.onStop(async () => {
      ha.log('Script is stopping, performing logout...');
      if (debounceTimer) clearTimeout(debounceTimer);
      await unifi.removeAllListeners();
      ha.updateState('sensor.freifunk_clients', null);
      await unifi.logout();
    });

  } catch (err) {
    ha.error(`[Freifunk Counter] Critical error during initialization: ${err.message}`);
    ha.error('[Freifunk Counter] The script will stop. Please check your UniFi connection details (IP, User) and ensure the password is correctly set in the global store via `ha.store.set(\'unifi_localadmin_pw\', \'YOUR_PASSWORD\')`.');
    ha.error('Full error details:', err);
  }
})();