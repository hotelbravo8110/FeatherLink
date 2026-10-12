'use strict';
// Runs FEATHER LINK against a fake X-Plane on UDP and checks it sees a flight.
process.env.FEATHER_LINK_FAST = '1';
process.env.FEATHER_LINK_OFFLINE = '1';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const os = require('os');
const path = require('path');

const REFS = ['lat', 'lon', 'elevM', 'aglM', 'gsMs', 'ias', 'vsFpm', 'psi', 'pitch', 'roll', 'onGround', 'parkBrake', 'eng0', 'eng1', 'n2a', 'n2b', 'n1a', 'n1b', 'apu', 'apuN1', 'beacon', 'belt', 'gear', 'flaps', 'fuelKg', 'gNrml', 'zulu', 'paused', 'altFt', 'selAlt'];
const wait = ms => new Promise(r => setTimeout(r, ms));

test('bridge subscribes to X-Plane and reports state and events', async () => {
  const xp = dgram.createSocket('udp4');
  const subs = new Map(); let client = null;
  xp.on('message', (m, r) => {
    if (m.toString('ascii', 0, 4) !== 'RREF') return;
    client = r;
    const freq = m.readInt32LE(5), idx = m.readInt32LE(9);
    const ref = m.toString('ascii', 13).replace(/\0.*$/s, '');
    if (freq > 0) subs.set(idx, ref); else subs.delete(idx);
  });
  await new Promise(r => xp.bind(0, '127.0.0.1', r));
  const port = xp.address().port;

  const v = { lat: 34.21, lon: -118.49, onGround: 1, parkBrake: 1, gNrml: 1, zulu: 50000, altFt: 800, fuelKg: 5000 };
  const timer = setInterval(() => {
    if (!client) return;
    const keys = [...subs.keys()];
    const b = Buffer.alloc(5 + keys.length * 8);
    b.write('RREF,', 0, 'ascii');
    keys.forEach((i, n) => { b.writeInt32LE(i, 5 + n * 8); b.writeFloatLE(v[REFS[i]] || 0, 9 + n * 8); });
    xp.send(b, client.port, client.address);
  }, 50);

  const bridge = require('../electron/bridge');
  bridge.start({ host: '127.0.0.1', port, cacheDir: path.join(os.tmpdir(), 'fl-test-cache') });
  await wait(600);
  assert.strictEqual(subs.size, REFS.length, 'subscribed to every dataref');
  assert.strictEqual(subs.get(0), 'sim/flightmodel/position/latitude');

  let s = await bridge.call('sim_state', { since: 0 });
  assert.strictEqual(s.xplane.connected, true);
  assert.strictEqual(s.phase, 'parked');
  assert.ok(Math.abs(s.ac.lat - 34.21) < 1e-4);
  assert.ok(s.events.some(e => e.type === 'xplane_connected'));

  // APU, then both engines
  v.apu = 1; await wait(1100);
  v.eng0 = 1; v.eng1 = 1; await wait(1100);
  // taxi
  v.parkBrake = 0; v.gsMs = 6; await wait(1100);
  // take off
  v.onGround = 0; v.ias = 140; v.aglM = 30; v.vsFpm = 2000; await wait(400);
  s = await bridge.call('sim_state', { since: 0 });
  const types = s.events.map(e => e.type);
  for (const t of ['apu_on', 'engine_start', 'engines_running', 'taxi', 'takeoff']) assert.ok(types.includes(t), 'saw ' + t + ' in ' + types);
  assert.strictEqual(s.phase, 'climb');

  // "since" only returns newer events
  const later = await bridge.call('sim_state', { since: s.lastSeq });
  assert.strictEqual(later.events.length, 0);

  // land at 180 fpm
  v.altFt = 900; v.vsFpm = -180; await wait(3200);
  v.onGround = 1; v.aglM = 0; v.vsFpm = 0; v.gNrml = 1.2; v.ias = 100; await wait(900);
  s = await bridge.call('sim_state', { since: 0 });
  const td = s.events.find(e => e.type === 'touchdown');
  assert.ok(td, 'touchdown logged');
  assert.strictEqual(td.data.fpm, 180);

  await assert.rejects(bridge.call('nope', {}), /Unknown tool/);
  await assert.rejects(bridge.call('route', { from: { lat: 1, lon: 2 }, to: { lat: 1, lon: 2.1 } }), /offline/);

  bridge.stop(); clearInterval(timer); xp.close();
});
