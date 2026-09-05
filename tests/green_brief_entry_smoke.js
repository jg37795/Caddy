'use strict';
/* C1 regression: use index.html's actual script list, not test-only math imports.
   Synthetic elevation is confined to this test; no external requests are made. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

(async () => {
  const dom = new JSDOM(html, {
    url: 'https://caddy.test/Caddy/', runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  let networkCalls = 0;
  const errors = [];
  w.addEventListener('error', e => errors.push(e.error || e.message));
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.alert = () => {};
  w.confirm = () => false;
  w.scrollTo = () => {};
  w.fetch = async () => { networkCalls++; throw new Error('offline test fixture'); };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.localStorage.setItem('caddy:onboarded', '1');
  w.localStorage.setItem('caddy:prefs', JSON.stringify({ activeTab: 'shot', gpsEnabled: false }));
  try {
    // Evaluate exactly the scripts shipped by the page, in document order.
    for (const script of w.document.querySelectorAll('script')) {
      const src = script.getAttribute('src');
      w.eval(src ? fs.readFileSync(path.join(root, src), 'utf8') : script.textContent);
    }
    await new Promise(resolve => w.setTimeout(resolve, 50));
    assert.deepEqual(errors, [], 'main app must boot without a 3D-tool DOM');
    assert.equal(networkCalls, 0, 'loading the math must not start the 3D tool or its API requests');
    assert.ok(w.CaddyPrep, 'main app bootstrap exports the Prep bridge');

    const centerLL = { lat: 41.91314, lng: -93.60971 };
    const teeLL = { lat: 41.912, lng: -93.60971 };
    let elevCalls = 0;
    w.CaddyElev.fetchElevGrid = async (bbox, N) => {
      elevCalls++;
      const grid = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
        grid[y * N + x] = 100 + 0.02 * (x - N / 2);
      return { grid, W: N, H: N, cellSizeM: 1, validMask: null, bbox };
    };
    const brief = await w.GreenBriefCore.build({ centerLL, teeLL, stimp: 10 });
    assert.ok(brief, 'Prep must build a non-null green brief using the shipped script order');
    assert.equal(elevCalls, 1);
    assert.ok(Math.abs(brief.slopePct - 2) < 0.05, 'known 2% test plane retains its slope');
    assert.equal(brief.zones.length, 3);
    assert.ok(brief.zones.every(z => Number.isFinite(z.breakIn) && Number.isFinite(z.dirDeg)));
    const stored = JSON.parse(w.localStorage.getItem('caddy:greenBrief:v1'));
    const key = w.GreenBriefCore.keyFor(centerLL.lat, centerLL.lng);
    assert.equal(stored[key].source, 'prep-auto');
    assert.equal(w.GreenBriefCore.briefFor(centerLL).savedAt, brief.savedAt);
    const snapshot = w.localStorage.getItem('caddy:greenBrief:v1');
    w.CaddyElev.fetchElevGrid = async () => null;
    assert.equal(await w.GreenBriefCore.build({ centerLL }), null, 'missing elevation stays unavailable');
    assert.equal(w.localStorage.getItem('caddy:greenBrief:v1'), snapshot, 'failed rebuild preserves saved brief');
    w.CaddyElev.fetchElevGrid = async () => { throw new Error('USGS unavailable'); };
    assert.equal(await w.GreenBriefCore.build({ centerLL }), null, 'USGS failure stays non-fatal');
    assert.deepEqual(errors, []);
    console.log('GREEN BRIEF ENTRY SMOKE PASSED (real page scripts; fixture elevation; persistence; outage)');
  } finally {
    w.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
