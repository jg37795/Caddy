/* Deterministic service-worker navigation regressions; run with node. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const SCOPE = 'https://jg37795.github.io/Caddy/';
const MAIN = 'CADDY_MAIN_DOCUMENT';
const GREENMAP = 'GREENMAP_DOCUMENT';
const html = (body, status = 200) => new Response(body, {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

// Adapted from the investigator's swNavigation VM probe. No real network,
// browser storage, timers, app bootstrap, or version-specific cache names.
function createWorker() {
  const base = new URL('sw.js', SCOPE).href;
  const key = input => {
    const url = new URL(typeof input === 'string' ? input : input.url, base);
    url.hash = '';
    return url.href;
  };
  class RelativeRequest extends Request {
    constructor(input, options) {
      super(typeof input === 'string' ? key(input) : input, options);
    }
  }
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async put(request, response) { entries.set(key(request), response.clone()); },
          async match(request, options = {}) {
            const wanted = new URL(key(request));
            for (const [url, response] of entries) {
              const stored = new URL(url);
              if (options.ignoreSearch) { stored.search = ''; wanted.search = ''; }
              if (stored.href === wanted.href) return response.clone();
            }
          },
          async keys() { return [...entries.keys()].map(url => new RelativeRequest(url)); },
          async delete(request) { return entries.delete(key(request)); },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request, options) {
      for (const cache of stores.values()) {
        const hit = await cache.match(request, options);
        if (hit) return hit;
      }
    },
  };
  const handlers = {};
  const calls = { fetch: [], skipWaiting: 0, claim: 0 };
  let fetchImpl = async request => {
    const url = new URL(key(request));
    const body = url.pathname === '/Caddy/greenmap.html' ? GREENMAP :
      ['/Caddy/', '/Caddy/index.html'].includes(url.pathname) ? MAIN : 'ASSET';
    return html(body);
  };
  const context = vm.createContext({
    URL, Request: RelativeRequest, Response, caches,
    self: {
      location: new URL(base),
      registration: { scope: SCOPE },
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { calls.skipWaiting++; },
      clients: { async claim() { calls.claim++; } },
    },
    async fetch(request, options) {
      calls.fetch.push({ url: key(request), cache: options?.cache || request.cache });
      return fetchImpl(request, options);
    },
  });
  vm.runInContext(source, context, { filename: 'sw.js' });
  return {
    calls, caches,
    asset(url) { return vm.runInContext('networkFirstAsset', context)(new RelativeRequest(url), vm.runInContext('SHELL_CACHE', context)); },
    async shell() { return caches.open(vm.runInContext('SHELL_CACHE', context)); },
    setFetch(fn) { fetchImpl = fn; },
    offline() { fetchImpl = async () => { throw new Error('offline fixture'); }; },
    async install() {
      const pending = [];
      handlers.install({ waitUntil(promise) { pending.push(promise); } });
      assert.ok(pending.length, 'install must wait for precaching');
      await Promise.all(pending);
    },
    async navigate(relativeURL) {
      // Browser navigation Requests expose a read-only URL and mode=navigate.
      const request = Object.freeze({
        url: new URL(relativeURL, SCOPE).href, method: 'GET', mode: 'navigate',
      });
      const pending = [];
      let result;
      handlers.fetch({
        request,
        respondWith(promise) { assert.equal(result, undefined); result = promise; },
        waitUntil(promise) { pending.push(promise); },
      });
      assert.ok(result, 'navigation must be intercepted');
      const response = await result;
      await Promise.all(pending);
      return { request, response };
    },
  };
}

test('offline greenmap query navigation uses its precached document at /Caddy/', async () => {
  const worker = createWorker();
  await worker.install();
  const shell = await worker.shell();
  assert.equal(await (await shell.match('./greenmap.html')).text(), GREENMAP);
  worker.offline();

  const deepLink = './greenmap.html?lat=41.73&lng=-93.6&r=15';
  const { request, response } = await worker.navigate(deepLink);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), GREENMAP);
  assert.equal(request.url, new URL(deepLink, SCOPE).href, 'keep runtime query parameters');
  assert.equal(worker.calls.fetch.at(-1).url, request.url, 'fetch the original URL');
});

test('failed HTTP navigation status falls back to the matching precached document', async () => {
  const worker = createWorker();
  await worker.install();
  for (const status of [503, 500, 404]) {
    worker.setFetch(async () => html('HTTP_FAILURE', status));
    for (const [url, expected] of [
      ['./greenmap.html?lat=41.73&lng=-93.6', GREENMAP],
      ['./index.html?launch=1', MAIN],
      ['./?launch=2', MAIN],
    ]) {
      const { response } = await worker.navigate(url);
      assert.equal(response.status, 200, `${url} should use its cache after HTTP ${status}`);
      assert.equal(await response.text(), expected);
    }
  }
  const shell = await worker.shell();
  assert.equal(await (await shell.match('./index.html')).text(), MAIN);
  assert.equal(await (await shell.match('./greenmap.html')).text(), GREENMAP);
});

test('successful install precaches scope-relative entries before skipWaiting', async () => {
  const worker = createWorker();
  await worker.install();
  assert.equal(worker.calls.skipWaiting, 1);
  assert.equal(worker.calls.claim, 0, 'install must not claim clients before activation');
  assert.ok(worker.calls.fetch.length > 0);
  assert.ok(worker.calls.fetch.every(call => call.url.startsWith(SCOPE)));
  assert.ok(worker.calls.fetch.every(call => call.cache === 'reload'));
  const keys = (await (await worker.shell()).keys()).map(request => request.url);
  for (const entry of ['./', './index.html', './greenmap.html']) {
    assert.ok(keys.includes(new URL(entry, SCOPE).href), `${entry} must be precached`);
  }
});

for (const failure of ['network rejection', 'HTTP 404', 'HTTP 503']) {
  test(`install ${failure} rejects without replacing the incumbent worker`, async () => {
    const worker = createWorker();
    const oldName = 'caddy-shell-incumbent';
    const oldCache = await worker.caches.open(oldName);
    await oldCache.put('./index.html', html('INCUMBENT_MAIN'));
    await oldCache.put('./greenmap.html', html('INCUMBENT_GREENMAP'));
    worker.setFetch(async request => {
      if (new URL(request.url).pathname === '/Caddy/greenmap.html') {
        if (failure === 'network rejection') throw new Error('offline fixture');
        return html('INSTALL_FAILURE', Number(failure.slice(5)));
      }
      return html('NEW_ASSET');
    });

    // The browser leaves its active worker alone when install.waitUntil
    // rejects. Test those actual SW lifecycle signals, not a fake active flag.
    await assert.rejects(worker.install(), /offline fixture|Unable to precache/);
    assert.equal(worker.calls.skipWaiting, 0);
    assert.equal(worker.calls.claim, 0);
    assert.ok((await worker.caches.keys()).includes(oldName));
    assert.equal(await (await oldCache.match('./index.html')).text(), 'INCUMBENT_MAIN');
    assert.equal(await (await oldCache.match('./greenmap.html')).text(), 'INCUMBENT_GREENMAP');
  });
}

test('offline main entry aliases retain their document with varied queries', async () => {
  const worker = createWorker();
  await worker.install();
  worker.offline();
  for (const url of ['./', './?launch=homescreen', './index.html', './index.html?reload=2&tab=prep']) {
    const { request, response } = await worker.navigate(url);
    assert.equal(response.status, 200, url);
    assert.equal(await response.text(), MAIN, url);
    assert.equal(request.url, new URL(url, SCOPE).href);
  }
});

test('offline greenmap entry retains its document across coordinate and option queries', async () => {
  const worker = createWorker();
  await worker.install();
  worker.offline();
  for (const url of [
    './greenmap.html',
    './greenmap.html?lat=41.73&lng=-93.6&r=15',
    './greenmap.html?lng=-93.61&lat=41.74&src=osm&pinlat=41.7401&pinlng=-93.6101',
    './greenmap.html?lat=0&lng=0&src=auto&armdetect&label=A%20B',
    './greenmap.html?lat=-33.86&lng=151.2&r=30#slope',
  ]) {
    const { request, response } = await worker.navigate(url);
    assert.equal(response.status, 200, url);
    assert.equal(await response.text(), GREENMAP, url);
    assert.equal(request.url, new URL(url, SCOPE).href);
  }
});

test('online greenmap queries refresh only the canonical greenmap cache entry', async () => {
  const worker = createWorker();
  await worker.install();
  const shell = await worker.shell();
  const before = (await shell.keys()).map(request => request.url).sort();
  const url = './greenmap.html?lat=41.74&lng=-93.61&src=auto';
  worker.setFetch(async () => html('FRESH_GREENMAP'));
  const { response, request } = await worker.navigate(url);
  assert.equal(await response.text(), 'FRESH_GREENMAP');
  assert.equal(worker.calls.fetch.at(-1).url, request.url);
  assert.equal(worker.calls.fetch.at(-1).cache, 'reload');
  assert.equal(await (await shell.match('./greenmap.html')).text(), 'FRESH_GREENMAP');
  assert.equal(await (await shell.match('./index.html')).text(), MAIN);
  assert.equal(await (await shell.match('./')).text(), MAIN);
  assert.deepEqual((await shell.keys()).map(entry => entry.url).sort(), before);

  worker.offline();
  assert.equal(await (await worker.navigate('./greenmap.html?lat=40&lng=-90')).response.text(), 'FRESH_GREENMAP');
  assert.equal(await (await worker.navigate('./?from=green')).response.text(), MAIN);
});

test('online main aliases refresh only index and never the greenmap document', async () => {
  const worker = createWorker();
  await worker.install();
  const shell = await worker.shell();
  const before = (await shell.keys()).map(request => request.url).sort();
  for (const url of ['./?launch=1', './index.html?launch=2']) {
    worker.setFetch(async () => html('FRESH_MAIN'));
    assert.equal(await (await worker.navigate(url)).response.text(), 'FRESH_MAIN');
    assert.equal(await (await shell.match('./index.html')).text(), 'FRESH_MAIN');
    assert.equal(await (await shell.match('./greenmap.html')).text(), GREENMAP);
    assert.deepEqual((await shell.keys()).map(entry => entry.url).sort(), before);
    worker.offline();
    assert.equal(await (await worker.navigate('./index.html?offline=1')).response.text(), 'FRESH_MAIN');
    assert.equal(await (await worker.navigate('./?offline=2')).response.text(), 'FRESH_MAIN');
  }
});

test('root precache is a fallback for main aliases only', async () => {
  const worker = createWorker();
  await worker.install();
  const shell = await worker.shell();
  await shell.delete('./index.html');
  worker.offline();
  assert.equal(await (await worker.navigate('./index.html?offline=1')).response.text(), MAIN);
  assert.equal(await (await worker.navigate('./?offline=2')).response.text(), MAIN);
  assert.equal(await (await worker.navigate('./greenmap.html?lat=1&lng=2')).response.text(), GREENMAP);
});

test('missing greenmap precache never falls back to the main app', async () => {
  const worker = createWorker();
  await worker.install();
  await (await worker.shell()).delete('./greenmap.html');
  for (const failure of ['offline', 404, 503]) {
    if (failure === 'offline') worker.offline();
    else worker.setFetch(async () => html('HTTP_FAILURE', failure));
    for (const url of ['./greenmap.html', './greenmap.html?lat=1&lng=2']) {
      const { response } = await worker.navigate(url);
      assert.equal(response.status, 503, `${url} with ${failure}`);
      assert.match(response.headers.get('Content-Type'), /text\/html/);
      const body = await response.text();
      assert.match(body, /You are offline/);
      assert.ok(!body.includes(MAIN), 'do not substitute the main entry document');
    }
  }
});

test('an empty cache returns the offline page for each known entry', async () => {
  const worker = createWorker();
  worker.offline();
  for (const url of ['./?launch=1', './index.html?launch=2', './greenmap.html?lat=1&lng=2']) {
    const { response } = await worker.navigate(url);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /You are offline/);
  }
});

test('nested routes do not alias the /Caddy/ entry documents', async () => {
  const worker = createWorker();
  await worker.install();
  const shell = await worker.shell();
  for (const url of ['./other/', './other/index.html', './other/greenmap.html']) {
    worker.offline();
    assert.equal((await worker.navigate(url)).response.status, 503, url);
    worker.setFetch(async () => html('OTHER_DOCUMENT'));
    assert.equal(await (await worker.navigate(url)).response.text(), 'OTHER_DOCUMENT');
    assert.equal(await (await shell.match('./index.html')).text(), MAIN);
    assert.equal(await (await shell.match('./greenmap.html')).text(), GREENMAP);
    worker.offline();
    assert.equal(await (await worker.navigate(url)).response.text(), 'OTHER_DOCUMENT');
    assert.equal(await (await worker.navigate('./')).response.text(), MAIN);
  }
});

test('successful network document survives cache quota errors', async () => {
  const worker = createWorker(); await worker.install();
  const shell = await worker.shell();
  shell.put = async () => { throw new Error('quota'); };
  worker.setFetch(async () => html('FRESH_DOCUMENT'));
  const { response } = await worker.navigate('./greenmap.html?lat=40&lng=-100');
  assert.equal(await response.text(), 'FRESH_DOCUMENT');
});
test('HTTP-failed assets use cache and cache-write failures preserve fresh assets', async () => {
  const worker = createWorker(); await worker.install();
  worker.setFetch(async () => html('BAD_GATEWAY', 502));
  assert.equal(await (await worker.asset('./app.js')).text(), 'ASSET');
  const shell = await worker.shell(); shell.put = async () => { throw new Error('quota'); };
  worker.setFetch(async () => html('FRESH_SCRIPT'));
  assert.equal(await (await worker.asset('./app.js')).text(), 'FRESH_SCRIPT');
});

test('other navigation queries retain exact URL cache keys', async () => {
  const worker = createWorker();
  await worker.install();
  worker.setFetch(async () => html('REPORT_ONE'));
  assert.equal(await (await worker.navigate('./report.html?id=1')).response.text(), 'REPORT_ONE');
  worker.offline();
  assert.equal(await (await worker.navigate('./report.html?id=1')).response.text(), 'REPORT_ONE');
  assert.equal((await worker.navigate('./report.html?id=2')).response.status, 503);
  assert.equal((await worker.navigate('./report.html')).response.status, 503);
});
