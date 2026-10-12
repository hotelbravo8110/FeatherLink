'use strict';
/*
 * App settings in <data>/settings.json. The Claude API key is encrypted with
 * the operating system's own store (DPAPI on Windows, Keychain on macOS)
 * when it is available.
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' }
];
const DEFAULTS = { xplaneHost: '127.0.0.1', xplanePort: 49000, model: MODELS[0].id, firstRunDone: false };

let FILE = null;
let data = Object.assign({}, DEFAULTS);

function init(dir) {
  FILE = path.join(dir, 'settings.json');
  try { data = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (data.apiKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(data.apiKeyEnc, 'base64')); } catch (e) { return ''; }
  }
  return data.apiKeyPlain || '';
}
function setApiKey(key) {
  delete data.apiKeyEnc; delete data.apiKeyPlain;
  key = String(key || '').trim();
  if (key) {
    if (safeStorage.isEncryptionAvailable()) data.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    else data.apiKeyPlain = key;
  }
}

// What the settings window may see: never the key itself.
function publicView() {
  const k = apiKey();
  return {
    hasKey: !!k, keyHint: k ? '…' + k.slice(-4) : '', keyFromEnv: !!process.env.ANTHROPIC_API_KEY,
    model: data.model, models: MODELS, xplaneHost: data.xplaneHost, xplanePort: data.xplanePort
  };
}
function update(patch) {
  patch = patch || {};
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) setApiKey(patch.apiKey);
  if (patch.clearKey) setApiKey('');
  if (MODELS.some(m => m.id === patch.model)) data.model = patch.model;
  if (typeof patch.xplaneHost === 'string') data.xplaneHost = patch.xplaneHost.trim() || DEFAULTS.xplaneHost;
  const port = Number(patch.xplanePort);
  if (port >= 1024 && port <= 65535) data.xplanePort = Math.round(port);
  save();
}

module.exports = {
  init, save, apiKey, publicView, update, MODELS,
  get: k => data[k],
  set: (k, v) => { data[k] = v; save(); }
};
