const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CardActionBridge,
  ChunkAssembler,
  pushAnswer,
  limitAnswer,
  CARD_ACTION_COMMAND_TOPIC,
} = require('../js_automations/core/card-action-bridge.js');

function makeBridge(overrides = {}) {
  const published = [];
  const calls = [];
  const errors = [];
  let enabled = true;
  const bridge = new CardActionBridge({
    mqtt: { publish: (topic, payload, options) => published.push({ topic, payload, options }) },
    enabled: () => enabled,
    callAction: async (script, action, payload) => {
      calls.push({ script, action, payload });
      if (action === 'fail') throw new Error('boom');
      if (action === 'big') return 'x'.repeat(20000);
      return { ok: action };
    },
    logCardError: (script, message, line) => errors.push({ script, message, line }),
    log: () => {},
    ...overrides,
  });
  const lastAnswers = () => {
    const attr = published.filter((p) => p.topic === 'jsa/system/card_action_result/attributes').pop();
    return attr ? attr.payload.answers : [];
  };
  return { bridge, published, calls, errors, lastAnswers, setEnabled: (v) => (enabled = v) };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('command topic is a jsa/<domain>/<id>/set topic', () => {
  assert.equal(CARD_ACTION_COMMAND_TOPIC, 'jsa/system/card_action/set');
});

test('whole message runs the action and answers with the result', async () => {
  const { bridge, calls, lastAnswers } = makeBridge();
  await bridge.handleCommand(JSON.stringify({ v: 1, c: 'abc', s: 'garmin.ts', a: 'refresh', p: { user: 'boris' } }));
  assert.deepEqual(calls, [{ script: 'garmin', action: 'refresh', payload: { user: 'boris' } }]);
  const a = lastAnswers();
  assert.equal(a.length, 1);
  assert.equal(a[0].c, 'abc');
  assert.equal(a[0].ok, true);
  assert.deepEqual(a[0].r, { ok: 'refresh' });
});

test('errors of the action come back as error answers', async () => {
  const { bridge, lastAnswers } = makeBridge();
  await bridge.handleCommand(JSON.stringify({ v: 1, c: 'e1', s: 'x', a: 'fail' }));
  assert.equal(lastAnswers()[0].ok, false);
  assert.equal(lastAnswers()[0].e, 'boom');
});

test('duplicate correlation ids run only once', async () => {
  const { bridge, calls } = makeBridge();
  const msg = JSON.stringify({ v: 1, c: 'dup', s: 'x', a: 'go' });
  await bridge.handleCommand(msg);
  await bridge.handleCommand(msg);
  assert.equal(calls.length, 1);
});

test('chunked base64 message is assembled in any order (with umlauts)', async () => {
  const { bridge, calls } = makeBridge();
  const full = JSON.stringify({ v: 1, c: 'ch', s: 'x', a: 'save', p: { text: 'Grüße '.repeat(60) } });
  const data = b64(full);
  const size = 180;
  const n = Math.ceil(data.length / size);
  const pieces = [];
  for (let i = 0; i < n; i++) pieces.push(JSON.stringify({ v: 1, c: 'ch', i, n, d: data.slice(i * size, (i + 1) * size) }));
  for (const p of pieces) assert.ok(p.length <= 255, 'piece fits into a text value');
  for (const p of pieces.reverse()) await bridge.handleCommand(p);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.text, 'Grüße '.repeat(60));
});

test('incomplete chunks expire', () => {
  let t = 0;
  const asm = new ChunkAssembler(() => t);
  assert.equal(asm.add(JSON.stringify({ c: 'a', i: 0, n: 2, d: 'eyJ' })), null);
  assert.equal(asm.size, 1);
  t = 31000;
  asm.add(JSON.stringify({ c: 'b', i: 0, n: 2, d: 'eyJ' }));
  assert.equal(asm.size, 1, 'old entry swept, new one kept');
});

test('card errors go to the script log', async () => {
  const { bridge, errors, calls } = makeBridge();
  await bridge.handleCommand(JSON.stringify({ v: 1, k: 'err', c: 'z', s: 'garmin', m: 'x is undefined', l: 12 }));
  assert.deepEqual(errors, [{ script: 'garmin', message: 'x is undefined', line: 12 }]);
  assert.equal(calls.length, 0);
});

test('switched off: no action, error answer, discovery removed', async () => {
  const { bridge, calls, lastAnswers, published, setEnabled } = makeBridge();
  setEnabled(false);
  await bridge.handleCommand(JSON.stringify({ v: 1, c: 'off', s: 'x', a: 'go' }));
  assert.equal(calls.length, 0);
  assert.equal(lastAnswers()[0].ok, false);
  bridge.publishDiscovery();
  const removed = published.filter((p) => p.topic.startsWith('homeassistant/') && p.payload === null);
  assert.equal(removed.length, 2);
});

test('discovery publishes the text entity (max 255) and the result sensor, hides them once', () => {
  const hidden = [];
  const { bridge, published } = makeBridge({ hideEntities: (ids) => hidden.push(ids) });
  bridge.publishDiscovery();
  bridge.publishDiscovery();
  const text = published.find((p) => p.topic === 'homeassistant/text/jsa_system_card_action/config');
  const sensor = published.find((p) => p.topic === 'homeassistant/sensor/jsa_system_card_action_result/config');
  assert.equal(text.payload.max, 255);
  assert.equal(text.payload.command_topic, 'jsa/system/card_action/set');
  assert.ok(sensor.payload.json_attributes_topic);
  assert.equal(hidden.length, 1);
});

test('answers: ring buffer keeps the newest 20, too large results become errors', async () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = pushAnswer(list, { c: 'c' + i, ok: true, r: i, t: i });
  assert.equal(list.length, 20);
  assert.equal(list[0].c, 'c5');
  assert.equal(list[19].c, 'c24');
  const big = limitAnswer({ c: 'b', ok: true, r: 'x'.repeat(20000), t: 0 });
  assert.equal(big.ok, false);
  assert.match(big.e, /too large/);
  const { bridge, lastAnswers } = makeBridge();
  await bridge.handleCommand(JSON.stringify({ v: 1, c: 'big', s: 'x', a: 'big' }));
  assert.equal(lastAnswers()[0].ok, false);
});
