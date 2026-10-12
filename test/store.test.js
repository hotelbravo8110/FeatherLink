'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../electron/store');
const { parseJson } = require('../electron/claude');

test('store saves, lists and deletes documents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-store-'));
  store.init(dir);
  assert.strictEqual(store.get('campaign/state'), null);
  store.set('campaign/state', { a: 1 });
  store.set('sectors/F12', { ref: 'F12' });
  store.set('sectors/F13 x?', { ref: 'odd' });
  assert.deepStrictEqual(store.get('campaign/state'), { a: 1 });
  const ids = store.list('sectors').map(r => r.id).sort();
  assert.deepStrictEqual(ids, ['F12', 'F13 x?']);
  assert.deepStrictEqual(store.list('nothing'), []);
  store.del('sectors/F12');
  assert.strictEqual(store.get('sectors/F12'), null);
  assert.throws(() => store.get('../etc/passwd'), /bad path/);
});

test('parseJson takes JSON out of fences and chatter', () => {
  assert.deepStrictEqual(parseJson('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(parseJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.deepStrictEqual(parseJson('Here it is: {"text":"hi"} done'), { text: 'hi' });
  assert.throws(() => parseJson('{"a":'), e => e.code === 'invalid_json');
  assert.throws(() => parseJson('nothing'), e => e.code === 'invalid_json');
});
