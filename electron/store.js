'use strict';
/*
 * The campaign database: one JSON file per document under the app's data
 * folder, e.g. campaign/state -> <data>/campaign/state.json. Stands in for
 * the claude.ai artifact database the page was written against.
 */
const fs = require('fs');
const path = require('path');

let ROOT = null;
function init(dir) { ROOT = dir; fs.mkdirSync(ROOT, { recursive: true }); }

function segs(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (!parts.length || parts.some(s => s === '.' || s === '..')) throw Object.assign(new Error('bad path ' + p), { code: 'invalid_argument' });
  return parts.map(s => encodeURIComponent(s));
}
function fileFor(p) { return path.join(ROOT, ...segs(p)) + '.json'; }

function get(p) {
  try { return JSON.parse(fs.readFileSync(fileFor(p), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Write to a side file and rename, so a crash mid-write never leaves half a ledger.
function set(p, data) {
  const f = fileFor(p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, f);
}
function del(p) {
  try { fs.unlinkSync(fileFor(p)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function list(col) {
  const dir = path.join(ROOT, ...segs(col));
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try { out.push({ id: decodeURIComponent(n.slice(0, -5)), data: JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) }); }
    catch (e) { /* skip a damaged file rather than lose the whole list */ }
  }
  return out;
}

module.exports = { init, get, set, del, list };
