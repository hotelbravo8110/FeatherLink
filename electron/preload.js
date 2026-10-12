'use strict';
// The only door between the page and the app: a fixed list of channels, plain data both ways.
const { contextBridge, ipcRenderer } = require('electron');

const CALLS = new Set([
  'db:get', 'db:set', 'db:del', 'db:list',
  'ai:info', 'ai:json', 'ai:cancel',
  'dl:save', 'link:call',
  'settings:open', 'settings:get', 'settings:set', 'settings:test', 'app:info'
]);
const EVENTS = new Set(['ai:text']);

contextBridge.exposeInMainWorld('featherHost', {
  invoke(channel, arg) {
    if (!CALLS.has(channel)) return Promise.resolve({ ok: false, error: { code: 'not_allowed', message: channel } });
    return ipcRenderer.invoke(channel, arg);
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) return () => {};
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  }
});
