'use strict';
/*
 * FEATHER NET desktop app. Serves the page from app:// and gives it, through
 * a small shim, the host services it used to get from claude.ai: a campaign
 * database, Claude, file saving and the FEATHER LINK bridge to X-Plane.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const bridge = require('./bridge');
const store = require('./store');
const settings = require('./settings');
const claude = require('./claude');

const APP_DIR = path.join(__dirname, '..', 'app');
const ORIGIN = 'app://feathernet';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let settingsWin = null;

function serveApp() {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Links out of the app open in the normal browser.
function guard(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'FEATHER NET', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  guard(win);
  win.once('ready-to-show', () => win.show());
  win.loadURL(ORIGIN + '/index.html');
  win.on('closed', () => { win = null; });
}

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 680, resizable: false, minimizable: false, title: 'FEATHER NET Settings',
    parent: win || undefined, backgroundColor: '#10120f', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  guard(settingsWin);
  settingsWin.loadURL(ORIGIN + '/settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Get a Claude API key', click: () => shell.openExternal('https://console.anthropic.com/settings/keys') },
        { label: 'About FEATHER NET', click: () => dialog.showMessageBox(win, { type: 'info', title: 'FEATHER NET', message: 'FEATHER NET ' + app.getVersion(), detail: 'Crew, dispatch and story desk for X-Plane 12, with FEATHER LINK built in.\nMap data © OpenStreetMap contributors © CARTO.' }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC: every handler answers { ok, value } or { ok: false, error: { code, message } } ──
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, arg) => {
    try { return { ok: true, value: await fn(arg || {}, e) }; }
    catch (err) { return { ok: false, error: { code: (err && err.code) || 'error', message: (err && err.message) || String(err) } }; }
  });
}

function wireIpc() {
  handle('db:get', a => store.get(a.path));
  handle('db:set', a => store.set(a.path, a.data));
  handle('db:del', a => store.del(a.path));
  handle('db:list', a => store.list(a.col));

  handle('ai:info', () => ({ ready: !!settings.apiKey(), model: settings.get('model') }));
  handle('ai:json', (a, e) => claude.json({
    id: a.id, prompt: a.prompt, tier: a.tier, apiKey: settings.apiKey(), model: settings.get('model'),
    onText: a.stream ? text => { if (!e.sender.isDestroyed()) e.sender.send('ai:text', { id: a.id, text }); } : null
  }));
  handle('ai:cancel', a => claude.cancel(a.id));

  handle('dl:save', async (a, e) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const name = String(a.filename || 'FEATHER NET file').replace(/[\\/:*?"<>|]+/g, '-');
    const ext = path.extname(name).slice(1);
    const r = await dialog.showSaveDialog(parent, {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: ext ? [{ name: ext.toUpperCase() + ' file', extensions: [ext] }] : []
    });
    if (r.canceled || !r.filePath) throw Object.assign(new Error('declined'), { code: 'declined' });
    fs.writeFileSync(r.filePath, typeof a.data === 'string' ? a.data : Buffer.from(a.data));
    if (/\.html?$/i.test(r.filePath)) shell.showItemInFolder(r.filePath);
    return { path: r.filePath };
  });

  handle('link:call', async a => {
    try { return await bridge.call(a.tool, a.input); }
    catch (err) { throw Object.assign(new Error(err.message), { code: 'tool_error' }); }
  });

  handle('settings:open', () => openSettings());
  handle('settings:get', () => settings.publicView());
  handle('settings:set', a => {
    const hadKey = !!settings.apiKey();
    settings.update(a);
    bridge.configure({ host: settings.get('xplaneHost'), port: settings.get('xplanePort') });
    // The page checks for Claude once at start, so reload it when that changes.
    if (hadKey !== !!settings.apiKey() && win) win.webContents.reload();
    return settings.publicView();
  });
  handle('settings:test', async a => claude.test(String(a.apiKey || '').trim() || settings.apiKey(), a.model || settings.get('model')));
  handle('app:info', () => ({ version: app.getVersion(), dataDir: app.getPath('userData') }));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const data = app.getPath('userData');
  settings.init(data);
  store.init(path.join(data, 'campaign'));
  bridge.start({ host: settings.get('xplaneHost'), port: settings.get('xplanePort'), cacheDir: path.join(data, 'cache') });
  serveApp();
  wireIpc();
  buildMenu();
  createWindow();
  if (!settings.get('firstRunDone')) {
    settings.set('firstRunDone', true);
    if (!settings.apiKey()) win.webContents.once('did-finish-load', () => setTimeout(openSettings, 600));
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { bridge.stop(); app.quit(); });
