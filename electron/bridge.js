'use strict';
/*
 * FEATHER LINK, built into the FEATHER NET app: the bridge between X-Plane 12
 * and the page. It listens to X-Plane over UDP (the RREF interface on port
 * 49000), works out what the aeroplane is doing (APU, engines, taxi, takeoff,
 * top of climb, top of descent, touchdown rate, parked) and hands the page a
 * snapshot plus a log of those moments. It also fetches road routes, place
 * positions and map tiles for the map.
 *
 * This started life as the feather-link.mcpb MCP server; the detection logic
 * is unchanged, only the stdio transport is gone and the settings are live.
 */
const dgram = require('dgram');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.0.0';
let XP_HOST = '127.0.0.1';
let XP_PORT = 49000;
const FAST = process.env.FEATHER_LINK_FAST === '1';   // shorter detection windows, for tests only
const OFFLINE = process.env.FEATHER_LINK_OFFLINE === '1';
const UA = 'FEATHER-NET/' + VERSION + ' (X-Plane flight sim companion; personal use)';
const SESSION = crypto.randomBytes(6).toString('hex');
let CACHE = path.join(os.tmpdir(), 'feather-link-cache');
const log = (...a) => { try { process.stderr.write('[feather-link] ' + a.join(' ') + '\n'); } catch (e) { /* ignore */ } };

// ════════════════════════════════════════════════════════════════
// X-Plane over UDP
// ════════════════════════════════════════════════════════════════
const REFS = [
  ['lat', 'sim/flightmodel/position/latitude'],
  ['lon', 'sim/flightmodel/position/longitude'],
  ['elevM', 'sim/flightmodel/position/elevation'],
  ['aglM', 'sim/flightmodel/position/y_agl'],
  ['gsMs', 'sim/flightmodel/position/groundspeed'],
  ['ias', 'sim/flightmodel/position/indicated_airspeed'],
  ['vsFpm', 'sim/flightmodel/position/vh_ind_fpm'],
  ['psi', 'sim/flightmodel/position/psi'],
  ['pitch', 'sim/flightmodel/position/theta'],
  ['roll', 'sim/flightmodel/position/phi'],
  ['onGround', 'sim/flightmodel/failures/onground_any'],
  ['parkBrake', 'sim/cockpit2/controls/parking_brake_ratio'],
  ['eng0', 'sim/flightmodel/engine/ENGN_running[0]'],
  ['eng1', 'sim/flightmodel/engine/ENGN_running[1]'],
  ['n2a', 'sim/flightmodel/engine/ENGN_N2_[0]'],
  ['n2b', 'sim/flightmodel/engine/ENGN_N2_[1]'],
  ['n1a', 'sim/flightmodel/engine/ENGN_N1_[0]'],
  ['n1b', 'sim/flightmodel/engine/ENGN_N1_[1]'],
  ['apu', 'sim/cockpit2/electrical/APU_running'],
  ['apuN1', 'sim/cockpit2/electrical/APU_N1_percent'],
  ['beacon', 'sim/cockpit/electrical/beacon_lights_on'],
  ['belt', 'sim/cockpit/switches/fasten_seat_belts'],
  ['gear', 'sim/cockpit/switches/gear_handle_status'],
  ['flaps', 'sim/cockpit2/controls/flap_handle_deploy_ratio'],
  ['fuelKg', 'sim/flightmodel/weight/m_fuel_total'],
  ['gNrml', 'sim/flightmodel/forces/g_nrml'],
  ['zulu', 'sim/time/zulu_time_sec'],
  ['paused', 'sim/time/paused'],
  ['altFt', 'sim/cockpit2/gauges/indicators/altitude_ft_pilot'],
  ['selAlt', 'sim/cockpit2/autopilot/altitude_dial_ft']
];
const V = {};                 // latest values by key
let lastPacket = 0;           // Date.now() of the last X-Plane packet
let lastSubscribe = 0;
let sock = null;

function rrefPacket(freq, index, ref) {
  const b = Buffer.alloc(413);
  b.write('RREF\0', 0, 'ascii');
  b.writeInt32LE(freq, 5);
  b.writeInt32LE(index, 9);
  b.write(ref, 13, 'ascii');
  return b;
}
function subscribe(freq) {
  if (!sock) return;
  lastSubscribe = Date.now();
  REFS.forEach(([, ref], i) => {
    try { sock.send(rrefPacket(freq, i, ref), XP_PORT, XP_HOST); } catch (e) { /* the next resend tries again */ }
  });
}
function startUdp() {
  sock = dgram.createSocket('udp4');
  sock.on('error', e => { log('udp error', e.message); });
  sock.on('message', msg => {
    if (msg.length < 13 || msg.toString('ascii', 0, 4) !== 'RREF') return;
    for (let o = 5; o + 8 <= msg.length; o += 8) {
      const i = msg.readInt32LE(o), v = msg.readFloatLE(o + 4);
      if (i >= 0 && i < REFS.length && Number.isFinite(v)) V[REFS[i][0]] = v;
    }
    lastPacket = Date.now();
  });
  sock.bind(0, () => { subscribe(10); log('listening for X-Plane at', XP_HOST + ':' + XP_PORT); });
  // keep the subscription alive: X-Plane may start after us, or restart
  setInterval(() => { if (Date.now() - lastPacket > 3000 && Date.now() - lastSubscribe > 5000) subscribe(10); }, 1000).unref();
}
const live = () => Date.now() - lastPacket < 3000;

// ════════════════════════════════════════════════════════════════
// Flight event detection, ten times a second
// ════════════════════════════════════════════════════════════════
const EVENTS = [];
let seq = 0;
const W = FAST ? { toc: 3000, tod: 2000, belt: 600, eng: 800, taxi: 800, park: 1200, tdg: 600, rough: 4000 } : { toc: 60000, tod: 25000, belt: 2500, eng: 4000, taxi: 3000, park: 5000, tdg: 1500, rough: 20000 };
function emit(type, data) {
  seq += 1;
  const e = { seq, type, real: Date.now(), simSec: V.zulu != null ? Math.round(V.zulu * 10) / 10 : null, data: data || {} };
  EVENTS.push(e);
  if (EVENTS.length > 400) EVENTS.splice(0, EVENTS.length - 400);
  log('event', type, JSON.stringify(data || {}));
}
function freshFlight() {
  return { taxied: false, airborne: false, takeoffAt: 0, maxAlt: 0, levelSince: 0, toc: false, todSince: 0, tod: false, below10k: false, climb10k: false, landed: false, tdPending: null, slowSince: 0, belt: null, beltSince: 0, beltSeen: null, roughHits: [], roughAt: 0, bankSince: 0, bankAt: 0, movingSince: 0 };
}
const S = { connected: false, paused: null, apuOn: false, apuSince: 0, engRun: 0, engSince: 0, allRun: false, offSince: 0, parkSet: null, F: freshFlight(), vsHist: [] };

function engRunning() {
  const a = (V.eng0 || 0) >= 0.5 || (V.n2a || 0) > 50, b = (V.eng1 || 0) >= 0.5 || (V.n2b || 0) > 50;
  return (a ? 1 : 0) + (b ? 1 : 0);
}
// On (re)connection, start from what the aeroplane is already doing, so nothing fires twice.
function join() {
  const ground = (V.onGround || 0) >= 0.5;
  const alt = V.altFt != null ? V.altFt : (V.elevM || 0) * 3.28084;
  const vs = V.vsFpm || 0;
  S.apuOn = (V.apu || 0) >= 0.5 || (V.apuN1 || 0) > 90; S.apuSince = 0;
  S.engRun = engRunning(); S.engSince = 0; S.allRun = S.engRun === 2;
  S.parkSet = (V.parkBrake || 0) >= 0.5;
  S.paused = (V.paused || 0) >= 0.5;
  S.F = freshFlight();
  const F = S.F;
  if (!ground) {
    F.airborne = true; F.taxied = true; F.takeoffAt = Date.now() - 120000; F.maxAlt = alt; F.climb10k = alt > 10000;
    if (alt > 10000 && Math.abs(vs) < 400) F.toc = true;
    if (F.toc && vs < -700) F.tod = true;
    F.beltSeen = (V.belt || 0) >= 0.5;
  } else if ((V.gsMs || 0) * 1.94384 > 3 && !S.parkSet) { F.taxied = true; }
  emit('joined', { onGround: ground, apu: S.apuOn, engines: S.engRun, altFt: Math.round(alt), gsKt: Math.round((V.gsMs || 0) * 1.94384) });
}
function tick() {
  const now = Date.now();
  const on = live();
  if (on && !S.connected) { S.connected = true; emit('xplane_connected'); join(); return; }
  if (!on && S.connected) { S.connected = false; emit('xplane_lost'); return; }
  if (!on) return;
  const paused = (V.paused || 0) >= 0.5;
  if (S.paused !== null && paused !== S.paused) emit(paused ? 'paused' : 'resumed');
  S.paused = paused;
  if (paused) return;
  const F = S.F;
  const ground = (V.onGround || 0) >= 0.5;
  const gsKt = (V.gsMs || 0) * 1.94384;
  const alt = V.altFt != null ? V.altFt : (V.elevM || 0) * 3.28084;
  const vs = V.vsFpm || 0;
  S.vsHist.push([now, vs]);
  while (S.vsHist.length && now - S.vsHist[0][0] > 1500) S.vsHist.shift();

  // APU
  const apu = (V.apu || 0) >= 0.5 || (V.apuN1 || 0) > 90;
  if (apu !== S.apuOn) {
    if (!S.apuSince) S.apuSince = now;
    if (now - S.apuSince > W.eng) { S.apuOn = apu; S.apuSince = 0; emit(apu ? 'apu_on' : 'apu_off'); }
  } else S.apuSince = 0;

  // engines
  const n = engRunning();
  if (n !== S.engRun) {
    if (!S.engSince) S.engSince = now;
    if (now - S.engSince > W.eng) {
      const before = S.engRun; S.engRun = n; S.engSince = 0;
      if (before === 0 && n > 0) emit('engine_start', { running: n });
      if (n === 2 && !S.allRun) { S.allRun = true; emit('engines_running'); }
      if (n === 0 && before > 0) { S.allRun = false; emit('engines_off'); }
    }
  } else S.engSince = 0;

  // parking brake
  const park = (V.parkBrake || 0) >= 0.5;
  if (S.parkSet === null) S.parkSet = park;
  if (park !== S.parkSet) { S.parkSet = park; if (ground) emit(park ? 'brake_set' : 'brakes_off'); }

  if (ground && !F.airborne && !F.landed) {
    // taxi out: rolling under its own power
    if (gsKt > 3 && !park) { if (!F.movingSince) F.movingSince = now; if (!F.taxied && now - F.movingSince > W.taxi) { F.taxied = true; emit('taxi'); } }
    else F.movingSince = 0;
  }
  if (!ground && !F.airborne && (V.ias || 0) > 60 && (V.aglM || 0) > 3) {
    F.airborne = true; F.takeoffAt = now;
    if (!F.taxied) { F.taxied = true; emit('taxi'); }
    emit('takeoff', { ias: Math.round(V.ias || 0) });
  }
  if (F.airborne && !F.landed) {
    F.maxAlt = Math.max(F.maxAlt, alt);
    if (!F.climb10k && alt > 10000) { F.climb10k = true; emit('climb_10k'); }
    // top of climb: level for a while near the highest altitude so far
    if (!F.toc && alt > 8000 && Math.abs(vs) < 300 && alt > F.maxAlt - 600) {
      if (!F.levelSince) F.levelSince = now;
      if (now - F.levelSince > W.toc) { F.toc = true; emit('toc', { altFt: Math.round(alt / 100) * 100 }); }
    } else F.levelSince = 0;
    // top of descent: a steady descent from the cruise
    if (F.toc && !F.tod) {
      if (vs < -700 && alt < F.maxAlt - 800) { if (!F.todSince) F.todSince = now; if (now - F.todSince > W.tod) { F.tod = true; emit('tod', { altFt: Math.round(alt) }); } }
      else F.todSince = 0;
    }
    if (!F.toc && F.climb10k && vs < -1000 && alt < F.maxAlt - 3000) { F.toc = true; F.tod = true; emit('toc', { altFt: Math.round(F.maxAlt / 100) * 100, late: true }); emit('tod', { altFt: Math.round(alt) }); }
    if ((F.tod || F.toc) && !F.below10k && alt < 10000 && F.maxAlt > 10500) { F.below10k = true; emit('below_10k'); }
    // seatbelt sign
    const belt = (V.belt || 0) >= 0.5;
    if (F.beltSeen === null) F.beltSeen = belt;
    if (belt !== F.beltSeen) { if (!F.beltSince) F.beltSince = now; if (now - F.beltSince > W.belt) { F.beltSeen = belt; F.beltSince = 0; emit(belt ? 'belt_on' : 'belt_off'); } }
    else F.beltSince = 0;
    // a bumpy ride, or a steep turn, the cabin will feel
    const dg = Math.abs((V.gNrml || 1) - 1);
    if (dg > 0.3) { F.roughHits.push(now); F.roughHits = F.roughHits.filter(t => now - t < W.rough); if (F.roughHits.length >= 8 && now - F.roughAt > 600000) { F.roughAt = now; F.roughHits = []; emit('turbulence', { g: Math.round((V.gNrml || 1) * 100) / 100 }); } }
    if (Math.abs(V.roll || 0) > 35) { if (!F.bankSince) F.bankSince = now; if (now - F.bankSince > 2000 && now - F.bankAt > 600000) { F.bankAt = now; emit('steep_bank', { roll: Math.round(V.roll || 0) }); } }
    else F.bankSince = 0;
    // touchdown: the sink rate just before the wheels touched, and the g at the bump
    if (ground && now - F.takeoffAt > (FAST ? 3000 : 20000) && !F.tdPending) {
      const sink = S.vsHist.filter(([t]) => now - t < 700).reduce((m, [, v]) => Math.min(m, v), 0);
      F.tdPending = { at: now, fpm: Math.round(Math.abs(sink)), g: V.gNrml || 1, simSec: V.zulu };
    }
  }
  if (F.tdPending && !F.landed) {
    F.tdPending.g = Math.max(F.tdPending.g, V.gNrml || 1);
    if (now - F.tdPending.at > W.tdg) {
      F.landed = true;
      const td = F.tdPending;
      seq += 1;
      const e = { seq, type: 'touchdown', real: td.at, simSec: td.simSec != null ? Math.round(td.simSec * 10) / 10 : null, data: { fpm: td.fpm, g: Math.round(td.g * 100) / 100 } };
      EVENTS.push(e); log('event touchdown', JSON.stringify(e.data));
    }
  }
  // parked after landing: stopped with the brake set
  if (F.landed && ground) {
    if (gsKt < 0.6 && park) { if (!F.slowSince) F.slowSince = now; if (now - F.slowSince > W.park) { emit('parked', { fuelLb: Math.round((V.fuelKg || 0) * 2.20462) }); S.F = freshFlight(); } }
    else F.slowSince = 0;
  }
}

function phaseNow() {
  if (!live()) return 'offline';
  const F = S.F;
  const ground = (V.onGround || 0) >= 0.5;
  const gsKt = (V.gsMs || 0) * 1.94384;
  if (ground) {
    if (F.landed) return gsKt > 40 ? 'rollout' : 'taxi-in';
    if (gsKt > 40) return 'takeoff-roll';
    return F.taxied && gsKt > 1 ? 'taxi' : (S.engRun ? 'engines' : 'parked');
  }
  if (!F.toc) return 'climb';
  if (!F.tod) return 'cruise';
  return F.below10k ? 'approach' : 'descent';
}
function snapshot(since) {
  const r = n => Math.round(n);
  const on = live();
  return {
    session: SESSION, version: VERSION,
    xplane: { connected: on, host: XP_HOST, port: XP_PORT, lastDataMs: lastPacket ? Date.now() - lastPacket : null },
    sim: on ? { zuluSec: V.zulu != null ? Math.round(V.zulu * 10) / 10 : null, paused: (V.paused || 0) >= 0.5 } : null,
    ac: on ? {
      lat: V.lat, lon: V.lon, altFt: r(V.altFt != null ? V.altFt : (V.elevM || 0) * 3.28084), aglFt: r((V.aglM || 0) * 3.28084),
      gsKt: r((V.gsMs || 0) * 1.94384), iasKt: r(V.ias || 0), vsFpm: r(V.vsFpm || 0), hdg: r(((V.psi || 0) % 360 + 360) % 360),
      pitch: Math.round((V.pitch || 0) * 10) / 10, roll: Math.round((V.roll || 0) * 10) / 10, onGround: (V.onGround || 0) >= 0.5,
      parkBrake: (V.parkBrake || 0) >= 0.5, engines: engRunning(), apu: S.apuOn, beacon: (V.beacon || 0) >= 0.5, belt: (V.belt || 0) >= 0.5,
      gearDown: (V.gear || 0) >= 0.5, flaps: Math.round((V.flaps || 0) * 100) / 100, fuelLb: r((V.fuelKg || 0) * 2.20462), g: Math.round((V.gNrml || 1) * 100) / 100,
      selAltFt: V.selAlt != null ? r(V.selAlt) : null
    } : null,
    phase: phaseNow(),
    events: EVENTS.filter(e => e.seq > (Number(since) || 0)).slice(-120),
    lastSeq: seq
  };
}

// ════════════════════════════════════════════════════════════════
// The internet side: road routes, places, map tiles
// ════════════════════════════════════════════════════════════════
function get(url, binary, redirects = 3) {
  return new Promise((resolve, reject) => {
    if (OFFLINE) { reject(new Error('offline')); return; }
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: binary ? 'image/png,*/*' : 'application/json' }, timeout: 12000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); resolve(get(new URL(res.headers.location, url).toString(), binary, redirects - 1)); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' from ' + new URL(url).host)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve(binary ? buf : buf.toString('utf8')); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out reaching ' + new URL(url).host)));
    req.on('error', reject);
  });
}
function cachePath(kind, key) { return path.join(CACHE, kind, key.replace(/[^A-Za-z0-9_.-]/g, '_')); }
function readCache(kind, key) { try { return fs.readFileSync(cachePath(kind, key)); } catch (e) { return null; } }
function writeCache(kind, key, data) { try { fs.mkdirSync(path.join(CACHE, kind), { recursive: true }); fs.writeFileSync(cachePath(kind, key), data); } catch (e) { /* cache is optional */ } }

// Douglas-Peucker on lat/lon, tolerance in degrees
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][1] - dx * pts[i][0] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
function point(p, name) {
  const lat = num(p && p.lat), lon = num(p && p.lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error(name + ' needs numeric lat and lon');
  return { lat, lon };
}
async function route(args) {
  const a = point(args.from, 'from'), b = point(args.to, 'to');
  const key = [a.lat, a.lon, b.lat, b.lon].map(v => v.toFixed(4)).join(',') + '.json';
  const hit = readCache('routes', key);
  if (hit) return Object.assign(JSON.parse(hit.toString('utf8')), { cached: true });
  const coords = a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat;
  const hosts = ['https://router.project-osrm.org/route/v1/driving/', 'https://routing.openstreetmap.de/routed-car/route/v1/driving/'];
  let lastErr = null;
  for (const h of hosts) {
    try {
      const j = JSON.parse(await get(h + coords + '?overview=full&geometries=geojson&steps=false'));
      if (!j.routes || !j.routes.length) throw new Error('no road route found');
      const r = j.routes[0];
      const pts = simplify(r.geometry.coordinates.map(c => [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5]), 0.00007);
      const out = { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), coords: pts, source: new URL(h).host };
      writeCache('routes', key, JSON.stringify(out));
      return out;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Could not get a road route: ' + (lastErr ? lastErr.message : 'unknown error'));
}
let lastNominatim = 0;
async function geocode(args) {
  const q = String(args.q || '').trim();
  if (!q) throw new Error('q is required');
  const key = q.toLowerCase() + (args.near ? '@' + Number(args.near.lat).toFixed(1) + ',' + Number(args.near.lon).toFixed(1) : '') + '.json';
  const hit = readCache('places', key);
  if (hit) return JSON.parse(hit.toString('utf8'));
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=' + encodeURIComponent(q);
  if (args.near && Number.isFinite(Number(args.near.lat)) && Number.isFinite(Number(args.near.lon))) {
    const la = Number(args.near.lat), lo = Number(args.near.lon);
    url += '&viewbox=' + [lo - 0.6, la + 0.6, lo + 0.6, la - 0.6].join(',');
  }
  const j = JSON.parse(await get(url));
  const out = { results: (Array.isArray(j) ? j : []).map(x => ({ name: x.display_name, lat: Number(x.lat), lon: Number(x.lon), kind: x.type || x.category || '' })) };
  writeCache('places', key, JSON.stringify(out));
  return out;
}
const STYLES = { dark: 'dark_all', light: 'light_all' };
async function tiles(args) {
  const style = STYLES[args.style] || 'dark_all';
  const list = (Array.isArray(args.tiles) ? args.tiles : []).slice(0, 8);
  const out = [];
  for (const t of list) {
    const z = Math.round(Number(t[0])), x = Math.round(Number(t[1])), y = Math.round(Number(t[2]));
    if (!(z >= 0 && z <= 18) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) continue;
    const key = style + '_' + z + '_' + x + '_' + y + '.png';
    let buf = readCache('tiles', key);
    if (!buf) {
      try { buf = await get('https://' + 'abcd'[(x + y) % 4] + '.basemaps.cartocdn.com/' + style + '/' + z + '/' + x + '/' + y + '.png', true); writeCache('tiles', key, buf); }
      catch (e) { out.push({ z, x, y, error: e.message }); continue; }
    }
    out.push({ z, x, y, data: 'data:image/png;base64,' + buf.toString('base64') });
  }
  return { tiles: out, attribution: '© OpenStreetMap contributors © CARTO' };
}

// ════════════════════════════════════════════════════════════════
// The app side
// ════════════════════════════════════════════════════════════════
const TOOLS = {
  sim_state: async a => snapshot(a.since),
  route, geocode,
  map_tiles: tiles
};
async function call(tool, args) {
  const fn = TOOLS[tool];
  if (!fn) throw new Error('Unknown tool: ' + tool);
  return fn(args || {});
}
let tickTimer = null;
function start(opts) {
  configure(opts);
  if (!sock) startUdp();
  if (!tickTimer) tickTimer = setInterval(tick, 100);
  log('FEATHER LINK', VERSION, 'session', SESSION);
}
// New X-Plane address: drop the old subscription and ask the new one.
function configure(opts) {
  opts = opts || {};
  if (opts.cacheDir) CACHE = opts.cacheDir;
  const host = String(opts.host || '').trim() || '127.0.0.1';
  const port = Number(opts.port) >= 1 && Number(opts.port) <= 65535 ? Math.round(Number(opts.port)) : 49000;
  if (host === XP_HOST && port === XP_PORT) return;
  if (sock) { try { subscribe(0); } catch (e) { /* ignore */ } }
  XP_HOST = host; XP_PORT = port;
  lastPacket = 0;
  if (sock) subscribe(10);
  log('listening for X-Plane at', XP_HOST + ':' + XP_PORT);
}
function stop() {
  try { subscribe(0); } catch (e) { /* ignore */ }
  clearInterval(tickTimer); tickTimer = null;
  // let the unsubscribe go out before the socket closes
  const s = sock; sock = null;
  if (s) setTimeout(() => { try { s.close(); } catch (e) { /* ignore */ } }, 100);
}

module.exports = { start, configure, stop, call };
