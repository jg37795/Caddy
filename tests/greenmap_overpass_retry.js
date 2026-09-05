'use strict';
/* C5: exercise the production lookup function with deterministic HTTP fixtures.
   Network responses here are test fixtures, never production course data. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
const start = source.indexOf('  async function fetchGreenPolygon(');
const end = source.indexOf('  // v1.2.2: loading card', start);
assert.ok(start >= 0 && end > start, 'production lookup seam exists');
const latitude = 41.91314, longitude = -93.60971;
const ring = [
  { lat: latitude - 0.0001, lon: longitude - 0.0001 },
  { lat: latitude + 0.0001, lon: longitude - 0.0001 },
  { lat: latitude + 0.0001, lon: longitude + 0.0001 },
  { lat: latitude - 0.0001, lon: longitude + 0.0001 },
];
const polygon = { elements: [{ type: 'way', id: 1, geometry: ring }] };
const ok = data => ({ ok: true, status: 200, json: async () => data });
function boot(steps) {
  const calls = [], timers = new Map();
  let timerId = 0;
  const context = {
    window: {}, state: { lat: latitude, lng: longitude },
    console: { warn() {} }, AbortController,
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, fn);
      if (ms < 2000) queueMicrotask(() => { if (timers.delete(id)) fn(); });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step === 'timeout') {
        const abort = [...timers.values()].at(-1);
        assert.ok(abort, 'each mirror request must have a timeout');
        abort();
        assert.equal(options.signal.aborted, true);
        throw Object.assign(new Error('timed out'), { name: 'AbortError' });
      }
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(options);
      return step;
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nthis.lookup = fetchGreenPolygon;', context);
  return { context, calls, timers, lookup: context.lookup };
}
async function expectPolygon(steps) {
  const h = boot(steps);
  const result = await h.lookup(latitude, longitude);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ring.map(p => [p.lon, p.lat]),
    'mapped green must survive a failed primary');
  assert.equal(h.context.window.__osmGreenNearby, true);
  assert.equal(h.context.window.__osmGreenDistM, 0);
  assert.equal(h.timers.size, 0, 'no timeout left after a completed lookup');
  return h;
}

test('502 response retries a different mirror', async () => {
  const h = await expectPolygon([{ ok: false, status: 502 }, ok(polygon)]);
  assert.equal(h.calls.length, 2);
  assert.notEqual(new URL(h.calls[0].url).host, new URL(h.calls[1].url).host);
});
test('rate limit and network failure can reach the third mirror', async () => {
  const h = await expectPolygon([{ ok: false, status: 429 }, new Error('offline'), ok(polygon)]);
  assert.equal(h.calls.length, 3);
});
test('transient empty result retries rather than declaring no green', async () => {
  const h = await expectPolygon([ok({ elements: [] }), ok(polygon)]);
  assert.equal(h.calls.length, 2);
});
test('Overpass error remark is not accepted as a valid empty result', async () => {
  const h = await expectPolygon([ok({ elements: [], remark: 'runtime error: Query timed out' }), ok(polygon)]);
  assert.equal(h.calls.length, 2);
});
test('malformed JSON envelope retries another mirror', async () => {
  const h = await expectPolygon([ok({ error: 'unavailable' }), ok(polygon)]);
  assert.equal(h.calls.length, 2);
});
test('request timeout is bounded and retries another mirror', async () => {
  const h = await expectPolygon(['timeout', ok(polygon)]);
  assert.equal(h.calls.length, 2);
});
test('primary gets one final retry after all mirrors return empty', async () => {
  const h = await expectPolygon([ok({ elements: [] }), ok({ elements: [] }), ok({ elements: [] }), ok(polygon)]);
  assert.equal(h.calls.length, 4);
  assert.equal(new URL(h.calls[0].url).host, new URL(h.calls[3].url).host);
});
test('genuinely unmapped green stays unmapped after bounded retries', async () => {
  const h = boot([ok({ elements: [] })]);
  assert.equal(await h.lookup(latitude, longitude), null);
  assert.equal(h.calls.length, 4);
  assert.equal(h.context.window.__osmGreenLookupFailed, false);
  assert.equal(h.context.window.__osmGreenDistM, null);
  assert.equal(h.timers.size, 0);
});
test('all mirrors failing is unavailable, not confirmed unmapped', async () => {
  const h = boot([{ ok: false, status: 503 }]);
  h.context.window.__osmGreenDistM = 12;
  assert.equal(await h.lookup(latitude, longitude), null);
  assert.equal(h.calls.length, 4);
  assert.equal(h.context.window.__osmGreenLookupFailed, true);
  assert.equal(h.context.window.__osmGreenDistM, null, 'old-green distance must be cleared');
  assert.equal(h.timers.size, 0);
});
test('caller cancellation stops requests instead of trying every mirror', async () => {
  const controller = new AbortController();
  const h = boot([() => {
    controller.abort();
    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  }, ok(polygon)]);
  assert.equal(await h.lookup(latitude, longitude, controller.signal), null);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});
test('already cancelled lookup starts no requests', async () => {
  const controller = new AbortController(); controller.abort();
  const h = boot([ok(polygon)]);
  assert.equal(await h.lookup(latitude, longitude, controller.signal), null);
  assert.equal(h.calls.length, 0);
});
test('nearest-green selection is preserved across mirror fallback', async () => {
  const far = ring.map(p => ({ lat: p.lat + 0.0005, lon: p.lon }));
  await expectPolygon([{ ok: false, status: 502 }, ok({ elements: [
    { geometry: far }, { geometry: ring },
  ] })]);
});

test('3D error card distinguishes lookup outage from an unmapped green', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf8');
  for (const unavailable of [true, false]) {
    const dom = new JSDOM(html, {
      url: 'https://caddy.test/greenmap.html?lat=' + latitude + '&lng=' + longitude,
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    try {
      w.AbortController = AbortController;
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.fetch = async () => unavailable ? { ok: false, status: 503 } : ok({ elements: [] });
      w.console.warn = () => {};
      w.GreenDetect = { detect: () => null };
      w.CaddyElev = { fetchElevGrid: async (bbox) => ({
        grid: new Float32Array(64 * 64).fill(100), W: 64, H: 64,
        cellSizeM: 1, validMask: null, bbox,
      }) };
      w.eval(source);
      // Wait for the bounded mirror round and backoff, not a rendering frame.
      const deadline = Date.now() + 2000;
      while (!w.document.getElementById('gm-load-detect').dataset.wired && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(w.document.getElementById('gm-load-detect').dataset.wired, 'lookup completed');
      const title = w.document.querySelector('#gm-loading .gm-load-title').textContent;
      if (unavailable) {
        assert.match(title, /unavailable/i, 'an API outage must not tell the golfer the green is unmapped');
        assert.doesNotMatch(w.document.getElementById('gm-status').textContent, /isn't mapped/i);
      } else {
        assert.match(title, /isn't mapped/i, 'a successful empty lookup keeps the unmapped card');
      }
      assert.equal(w.document.getElementById('gm-load-detect').hidden, false, 'existing recovery action stays usable');
    } finally { w.close(); }
  }
});
