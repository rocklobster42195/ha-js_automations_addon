const { test } = require('node:test');
const assert = require('node:assert/strict');

const HAConnector = require('../js_automations/core/ha-connection.js');

function connector(result) {
  const ha = new HAConnector('http://localhost:8123', 'token', '/tmp');
  ha.isReady = true;
  ha.sent = [];
  ha.sendCommand = async (type, payload) => { ha.sent.push({ type, payload }); return result; };
  return ha;
}

test('getHistory maps the compressed format: attributes (a) and the record time (lu)', async () => {
  const ha = connector({
    'climate.k': [
      { s: 'heat', a: { temperature: 16, current_temperature: 16.3 }, lu: 1764093600 },
      // only the setpoint changed: lc is the older state change, lu the time of this record
      { s: 'heat', a: { temperature: 22, current_temperature: 16.3 }, lc: 1764093600, lu: 1764094855.45 },
    ],
  });
  const rows = await ha.getHistory('climate.k', { minimalResponse: false });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].attributes, { temperature: 22, current_temperature: 16.3 });
  assert.equal(rows[1].last_changed, new Date(1764094855450).toISOString());
  assert.equal(ha.sent[0].payload.minimal_response, false);
});

test('getHistory keeps the full format and minimal rows without attributes', async () => {
  const ha = connector({
    's.x': [
      { state: '1', attributes: { unit: 'K' }, last_changed: '2026-11-25T10:00:00Z', last_updated: '2026-11-25T10:05:00Z' },
      { s: '2', lu: 1764065100 },
    ],
  });
  const rows = await ha.getHistory('s.x');
  assert.equal(rows[0].last_changed, '2026-11-25T10:05:00Z');
  assert.deepEqual(rows[0].attributes, { unit: 'K' });
  assert.equal(rows[1].state, '2');
  assert.equal('attributes' in rows[1], false);
});
