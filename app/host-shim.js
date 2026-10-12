/*
 * window.claude for the desktop app. FEATHER NET was written for claude.ai,
 * where the page asks the host for capabilities with window.claude.use(name).
 * Here each one is answered by the app through window.featherHost:
 *   db          the campaign, saved as files on this PC
 *   sample      Claude, through the Claude API with your key
 *   downloads   a Save As dialog
 *   mcp         FEATHER LINK, built into the app
 *   permissions everything is already allowed; "manage" opens Settings
 */
(function () {
  'use strict';
  const host = window.featherHost;
  if (!host) return;

  async function call(channel, arg) {
    const r = await host.invoke(channel, arg);
    if (r && r.ok) return r.value;
    throw (r && r.error) || { code: 'error', message: 'No answer from the app.' };
  }
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const snap = (data, id) => ({ exists: data != null, id, data: () => clone(data) });

  // ── db: the slice of the artifact database the page uses ──
  const watchers = new Map();
  function notify(path, data) {
    const set = watchers.get(path);
    if (set) set.forEach(w => { try { w.cb(snap(data, path.split('/').pop())); } catch (e) { console.error(e); } });
  }
  const db = {
    doc(path) {
      return {
        async get() { return snap(await call('db:get', { path }), path.split('/').pop()); },
        async set(data) { const d = clone(data); await call('db:set', { path, data: d }); notify(path, d); },
        async delete() { await call('db:del', { path }); notify(path, null); },
        onSnapshot(cb, onErr) {
          const w = { cb };
          const set = watchers.get(path) || new Set();
          set.add(w); watchers.set(path, set);
          call('db:get', { path }).then(d => { if (set.has(w)) cb(snap(d, path.split('/').pop())); }, e => { if (onErr) onErr(e); });
          return () => set.delete(w);
        }
      };
    },
    collection(col) {
      return {
        async get() {
          const rows = await call('db:list', { col });
          return { docs: rows.map(r => snap(r.data, r.id)) };
        }
      };
    }
  };

  // ── sample: Claude ──
  let seq = 0;
  const texts = new Map();
  host.on('ai:text', m => { const f = texts.get(m.id); if (f) f({ text: m.text }); });
  const sample = {
    async json(prompt, opts) {
      opts = opts || {};
      const id = 'ai' + (++seq) + '-' + Date.now();
      if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'Stopped.' };
      const onAbort = () => call('ai:cancel', { id }).catch(() => {});
      if (opts.signal) opts.signal.addEventListener('abort', onAbort);
      if (typeof opts.onText === 'function') texts.set(id, opts.onText);
      try { return await call('ai:json', { id, prompt: String(prompt), tier: opts.modelTier || 'default', stream: typeof opts.onText === 'function' }); }
      finally { texts.delete(id); if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
    }
  };

  // ── downloads ──
  const downloads = {
    async save(o) {
      let data = o.data;
      if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
      else if (typeof data !== 'string') data = JSON.stringify(data);
      return call('dl:save', { filename: o.filename, data });
    }
  };

  // ── mcp: FEATHER LINK ──
  const mcp = {
    callTool(server, tool, input, opts) {
      const p = call('link:call', { tool, input: clone(input || {}) });
      const signal = opts && opts.signal;
      if (!signal) return p;
      return new Promise((resolve, reject) => {
        const stop = () => reject({ code: 'timeout', message: 'No answer from FEATHER LINK.' });
        if (signal.aborted) { stop(); return; }
        signal.addEventListener('abort', stop, { once: true });
        p.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
    }
  };

  const permissions = {
    async state() { return 'granted'; },
    async manage() { await call('settings:open'); }
  };

  window.claude = {
    async use(name) {
      switch (name) {
        case 'db': return db;
        case 'sample': { const i = await call('ai:info'); return i && i.ready ? sample : null; }
        case 'downloads': return downloads;
        case 'mcp': return mcp;
        case 'permissions': return permissions;
        default: return null;
      }
    }
  };
})();
