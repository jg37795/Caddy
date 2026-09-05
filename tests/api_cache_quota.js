'use strict';
/* C3: run the real cache helper against controlled browser-storage failures. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const loadStart = source.indexOf('  function load(k, f)');
const loadEnd = source.indexOf('  // QA-004:', loadStart);
const cacheStart = source.indexOf('  async function cachedJSON(');
const cacheEnd = source.indexOf('  function sortedClubsDesc()', cacheStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart && cacheStart >= 0 && cacheEnd > cacheStart);
const cacheKey = 'caddy:api:weather:test';
const entry = (ts, data = { stale: true }) => JSON.stringify({ ts, data });
const quota = () => Object.assign(new Error('Storage is full'), { name: 'QuotaExceededError', code: 22 });
function boot({ entries = [], failWrite = () => null, fetchError = null } = {}) {
  const values = new Map(entries), removed = [], writes = [];
  let fetches = 0;
  const localStorage = {
    get length() { return values.size; },
    key(i) { return [...values.keys()][i] || null; },
    getItem(k) { return values.get(k) ?? null; },
    setItem(k, v) {
      writes.push(k);
      const error = failWrite(writes.length);
      if (error) throw error;
      values.set(k, String(v));
    },
    removeItem(k) { removed.push(k); values.delete(k); },
  };
  const context = {
    localStorage, AbortController,
    console: { warn() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async () => {
      fetches++;
      if (fetchError) throw fetchError;
      return { ok: true, json: async () => ({ temperature: 68 }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(loadStart, loadEnd) + source.slice(cacheStart, cacheEnd) +
    '\nthis.cachedJSON = cachedJSON;', context);
  return { values, removed, writes, fetches: () => fetches,
    run: () => context.cachedJSON('weather:test', 'https://weather.test/', 1000) };
}
const userEntries = [
  ['caddy:round', '{"hole":7}'], ['caddy:history', '[{"score":81}]'],
  ['caddy:courseProfiles:v1', '[{"id":"saved-course"}]'],
  ['caddy:shotLog:v1', '[{"club":"7i"}]'], ['other-app:key', 'keep'],
];

test('quota failure evicts oldest API caches and retries the real write', async () => {
  const caches = Array.from({ length: 6 }, (_, i) => ['caddy:api:old:' + i, entry(i + 1)]);
  const h = boot({ entries: [...userEntries, ...caches], failWrite: n => n === 1 ? quota() : null });
  const result = await h.run();
  assert.equal(h.writes.length, 2, 'quota error must trigger a second localStorage write');
  assert.deepEqual(h.removed, ['caddy:api:old:0', 'caddy:api:old:1']);
  assert.equal(JSON.parse(h.values.get(cacheKey)).data.temperature, 68);
  assert.equal(result.offline, false);
  for (const [key, value] of userEntries) assert.equal(h.values.get(key), value, key + ' must survive');
});
test('corrupt cache entries can be evicted without losing valid user data', async () => {
  const h = boot({ entries: [...userEntries, ['caddy:api:bad', '{'],
    ['caddy:api:newer', entry(2)], ['caddy:api:newest', entry(3)]],
    failWrite: n => n === 1 ? quota() : null });
  await h.run();
  assert.deepEqual(h.removed, ['caddy:api:bad']);
  assert.equal(h.writes.length, 2);
  for (const [key, value] of userEntries) assert.equal(h.values.get(key), value);
});
test('continued quota exhaustion returns fresh online data, not stale fallback', async () => {
  const h = boot({ entries: [...userEntries, [cacheKey, entry(1)]], failWrite: quota });
  const result = await h.run();
  assert.equal(result.data.temperature, 68);
  assert.equal(result.offline, false);
  assert.equal(h.writes.length, 2, 'retry must be bounded to one attempt');
  for (const [key, value] of userEntries) assert.equal(h.values.get(key), value);
});
test('storage disabled does not evict anything or discard fresh weather', async () => {
  const security = Object.assign(new Error('Storage denied'), { name: 'SecurityError' });
  const h = boot({ entries: [...userEntries, [cacheKey, entry(1)]], failWrite: () => security });
  const result = await h.run();
  assert.equal(result.data.temperature, 68);
  assert.equal(result.offline, false);
  assert.deepEqual(h.removed, []);
  assert.equal(h.writes.length, 1);
});
test('normal writes are still cached and fresh hits skip the network', async () => {
  const h = boot();
  const first = await h.run();
  const second = await h.run();
  assert.equal(first.offline, false);
  assert.equal(second.data.temperature, 68);
  assert.equal(second.ts, first.ts);
  assert.equal(h.fetches(), 1);
  assert.equal(h.writes.length, 1);
});
test('network failure still returns stale data labeled offline', async () => {
  const h = boot({ entries: [[cacheKey, entry(1)]], fetchError: new Error('network down') });
  const result = await h.run();
  assert.equal(result.offline, true);
  assert.equal(result.data.stale, true);
  assert.equal(result.ts, 1);
  assert.equal(h.writes.length, 0);
});
test('network failure without cached data still rejects', async () => {
  await assert.rejects(boot({ fetchError: new Error('network down') }).run(), /network down/);
});
