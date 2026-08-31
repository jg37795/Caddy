/* prep_tap_jsdom.js — REAL DOM repro of the Prep hole-tap freeze.
   jsdom: index.html + injected course + app.js + prep.js, then a click
   on a .plan-hole-row. Run: node .gtds/prep_tap_jsdom.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, {
  url: 'https://caddy.local/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.SVGElement = window.SVGElement;
global.Element = window.Element;
global.Node = window.Node;
global.MutationObserver = window.MutationObserver;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {};
global.confirm = () => false;
global.fetch = async () => { throw new Error('offline'); };
global.AbortController = window.AbortController;
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

let solveCalls = 0, recCalls = 0, obsFires = 0;
const OrigMO = window.MutationObserver;
window.MutationObserver = class extends OrigMO {
  constructor(fn) {
    super((list, obs) => { obsFires += list.length; fn(list, obs); });
  }
};

// Inject the course BEFORE app.js boots so planCourseOptions sees it.
const holes = [];
for (let i = 1; i <= 18; i++) {
  holes.push({
    number: i, source: 'openstreetmap', par: 4,
    yards: 320 + i * 9, strokeIndex: ((i * 7) % 18) + 1,
    teePoint: { lat: 41.5901 + i * 0.0007, lng: -93.8831 + i * 0.0006 },
    greenCenter: { lat: 41.5901 + i * 0.0007 + 0.0052, lng: -93.8831 + i * 0.0006 + 0.0034 },
    front: 320 + i * 9 - 12, back: 320 + i * 9 + 12,
    hazards: [{ type: 'water', lat: 41.5911 + i * 0.0007, lng: -93.8829 + i * 0.0006 }],
    greenDepthYds: 24,
  });
}
const course = {
  id: 'local:test1', name: 'Freeze Test GC', teeName: 'Blue',
  source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
  updatedAt: Date.now(), holesCount: 18, holes,
};
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([course]));
window.localStorage.setItem('caddy:onboarded', '1');

try {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));
} catch (e) {
  console.error('app.js load threw:', e.message);
  process.exit(1);
}

setTimeout(() => {
  const api = window.CaddyPrep;
  if (!api) { console.error('no CaddyPrep bridge'); process.exit(1); }
  const origSolve = api.playsLike;
  api.playsLike = (o) => { solveCalls++; return origSolve(o); };
  const origRec = api.recommendClub;
  api.recommendClub = (y) => { recCalls++; return origRec(y); };

  try {
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  } catch (e) {
    console.error('prep.js load threw:', e.message);
    process.exit(1);
  }

  // Select the injected course through the REAL select element.
  const sel = window.document.getElementById('planCourseSelect');
  const opts = [...sel.options].map((o) => o.value);
  console.log('select options:', JSON.stringify(opts));
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));

  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('hole rows:', rows.length);
  if (!rows.length) { console.error('no rows rendered'); process.exit(1); }

  const watchdog = setTimeout(() => {
    console.error('FREEZE REPRODUCED: blocked >6s after tap.');
    console.error('solveCalls', solveCalls, 'recCalls', recCalls);
    process.exit(2);
  }, 6000);

  const t0 = Date.now();
  rows[4].click();
  const dt = Date.now() - t0;
  console.log(`tap handled in ${dt}ms. solveCalls=${solveCalls} recCalls=${recCalls}`);

  setTimeout(() => {
    console.log('after settle: solveCalls', solveCalls, 'recCalls', recCalls);
    clearTimeout(watchdog);
    console.log(dt > 3000
      ? `SLOW TAP CONFIRMED (${dt}ms synchronous)`
      : 'no synchronous freeze in jsdom');
    process.exit(0);
  }, 1200);
}, 800);
