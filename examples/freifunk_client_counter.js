/**
 * @name Freifunk Client Counter
 * @icon mdi:account-group
 * @description Counts active clients on a specific SSID via UniFi Controller.
 * @label Example
 * @npm node-unifi
 */

// https://github.com/jens-maus/node-unifi
const Unifi = require('node-unifi');

// --- Config (persisted — edit values in the JSA Global Store under 'freifunk_config') ---
const config = ha.persistent('freifunk_config', {
  unifi_ip: '192.168.1.1',
  unifi_port: 443,
  unifi_user: 'admin',
  unifi_password: '',
  target_ssid: 'Freifunk',
});

if (!config.unifi_password) {
  ha.error("No UniFi password set. Enter it in the Global Store under 'freifunk_config' → unifi_password and restart.");
  ha.stop();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let unifi;

ha.register('sensor.freifunk_clients', {
  name: 'Freifunk Clients',
  icon: 'mdi:account-group',
  unit_of_measurement: 'Clients',
  state_class: 'measurement',
});

// ─── Logic ────────────────────────────────────────────────────────────────────

let lastCount = -1;
let debounceTimer;

async function updateClientCount() {
  try {
    const clients = await unifi.getClientDevices();
    const count = clients.filter((c) => c.essid === config.target_ssid).length;
    if (count !== lastCount) {
      ha.debug(`Client count on "${config.target_ssid}": ${count}`);
      ha.update('sensor.freifunk_clients', count);
      lastCount = count;
    }
  } catch (err) {
    ha.error(`Error retrieving clients: ${err.message}`);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

ha.onError((err) => {
  if (err.type === 'background' && err.message.includes('WebSocket')) {
    ha.warn(`Background WebSocket error: ${err.message}`);
  }
});

ha.onStop(async () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  ha.update('sensor.freifunk_clients', null);
  if (unifi) {
    await unifi.removeAllListeners();
    await unifi.logout();
  }
  ha.log('Script stopped.');
});

// ─── Start ────────────────────────────────────────────────────────────────────

// node-unifi auto-reconnects the events WebSocket on close/error, but it does so by
// re-sending the *original* login cookie without ever calling login() again. Once that
// cookie expires on the controller, it retries forever with a cookie that will never
// work again, and the sensor silently stops updating. connect() (re)creates the
// Controller and logs in from scratch, and is re-run periodically below to guarantee
// a fresh session before that can happen.
async function connect() {
  unifi = new Unifi.Controller({
    host: config.unifi_ip,
    port: config.unifi_port,
    sslverify: false,
  });

  try {
    await unifi.login(config.unifi_user, config.unifi_password);
    await updateClientCount();
    await unifi.listen();
    ha.log('UniFi WebSocket listener started.');

    unifi.on('event', (event) => {
      if (event === 'events.evt_wg_connected' || event === 'events.evt_wg_disconnected') {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateClientCount, 1000);
      }
    });
  } catch (err) {
    ha.error(`Initialization failed: ${err.message}`);
    ha.error(`Check UniFi connection settings in 'freifunk_config' (JSA Store) and ensure the password is set.`);
  }
}

// Force a clean re-login + reconnect well within any realistic UniFi session
// timeout, so a stale cookie never gets the WebSocket stuck reconnecting forever.
schedule('every 6 hours', async () => {
  ha.debug('Refreshing UniFi session...');
  try {
    await unifi.removeAllListeners();
    await unifi.logout();
  } catch (err) {
    // Old controller/session may already be unreachable - ignore and reconnect anyway.
  }
  await connect();
});

connect();
