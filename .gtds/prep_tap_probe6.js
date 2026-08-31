/* prep_tap_probe6.js — bisect INSIDE prep's tap path.
   Tap → bindHole: [paintControls, paintTarget, loadGreenMap, setTimeout(recompute)]
   Deferred recompute → recomputeNow: [solve, renderRecommendation, renderStrategy]
   renderStrategy: [holeMapSvg, seqChipsHtml, solve x3, readGreenBrief,
                    greenFeedLine, flyover?, innerHTML, wire back]
   Use MODE env to stub one piece at a time via api + DOM hacks. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SKIP = process.argv[2] || '';   // '' | 'no-defer' | 'no-renderRec' | 'no-renderStrategy'
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
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

const holes = [];
for (let i = 1; i <= 18; i++) {
  holes.push({
    number: i, source: 'openstreetmap', par: 4, yards: 320 + i * 9,
    teePoint: { lat: 41.5901 + i * 0.0007, lng: -93.8831 + i * 0.0006 },
    greenCenter: { lat: 41.5901 + i * 0.0007 + 0.0052, lng: -93.8831 + i * 0.0006 + 0.0034 },
    front: 320 + i * 9 - 12, back: 320 + i * 9 + 12,
    hazards: [], greenDepthYds: 24,
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:test1', name: 'Freeze Test GC', teeName: 'Blue',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
window.localStorage.setItem('caddy:onboarded', '1');

// Instrument setTimeout to see whether the deferred recompute even runs.
// NOTE: don't route global.setTimeout through window.setTimeout (jsdom's
// internal timers also call it → recursion). Keep them separate.
const origST = window.setTimeout.bind(window);
let deferredFired = false;
window.setTimeout = function (fn, ms, ...rest) {
  if (ms === 0) {
    return origST(function (...a) {
      deferredFired = true;
      console.log('[probe6] deferred task fired');
      return fn.apply(this, a);
    }, ms, ...rest);
  }
  return origST(fn, ms, ...rest);
};

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

setTimeout(() => {
  const api = window.CaddyPrep;
  if (SKIP === 'no-renderRec' || SKIP === 'no-renderStrategy') {
    // neutralise physics anyway to isolate DOM code
    api.playsLike = (o) => ({ playsLikeYd: o.horizontalYd, headwindMph: 0,
      crosswindMph: 0, aimYd: 0, aimDeg: 0, carryYd: o.horizontalYd,
      releaseYd: 0, windAdjYd: 0, tempAdjYd: 0, elevAdjYd: 0,
      altitudeAdjYd: 0, lateralDriftYd: 0, horizontalYd: o.horizontalYd,
      tempF: 70, elevDiffFt: 0 });
    api.recommendClub = () => ({ main: '7 iron stock', sub: '' });
    api.clubSequence = () => ({ seq: ['Driver'], finisherName: 'PW' });
  }
  // Interpose on innerHTML of prepStratBody to log write
  const stratBody = () => window.document.getElementById('prepStratBody');
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe6] mode =', SKIP || 'full', '— tapping…');
  const t0 = Date.now();
  rows[4].click();
  console.log(`[probe6] click returned ${Date.now() - t0}ms`);
  let b = 0;
  const hb = setInterval(() => {
    b++;
    console.log(`[hb ${b}] alive (deferredFired=${deferredFired})`);
    if (b >= 4) { clearInterval(hb); console.log('LOOP ALIVE with', SKIP || 'full'); process.exit(0); }
  }, 700);
}, 800);

setTimeout(() => {
  console.log('[probe6] WATCHDOG wedged with mode =', SKIP || 'full', 'deferredFired =', deferredFired);
  process.exit(2);
}, 9000);
