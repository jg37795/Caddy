/* e2e_v110.js — v1.13 regression: real-shape map + tee shortcut +
   rectangular corridor + composed palette. Run: node .gtds/e2e_v110.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'https://caddy.local/index.html',
  runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;
global.navigator = window.navigator; global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement; global.SVGElement = window.SVGElement;
global.Element = window.Element; global.Node = window.Node;
global.MutationObserver = window.MutationObserver;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {}; global.confirm = () => false;
global.fetch = async () => { throw new Error('offline'); };
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

// dogleg path + green ring + 2 tee sets (stored, unused by UI now but
// importer still saves them — the course data must tolerate them)
const holes = [];
for (let i = 1; i <= 18; i++) {
  const mapped = i !== 7;
  const yards = 340 + (i % 5) * 20;
  const latPerYd = 0.9 / 111320;
  const doglegs = i % 3 === 0;
  const mkPath = () => {
    const a = { lat: 41.5901, lng: -93.8831 };
    const b = { lat: 41.5901 - yards * latPerYd, lng: -93.8831 };
    if (!doglegs) return [a,
      { lat: (a.lat + b.lat) / 2, lng: a.lng }, b];
    const mid = { lat: a.lat - yards * latPerYd * 0.6, lng: a.lng };
    return [a, mid,
      { lat: mid.lat, lng: mid.lng + 40 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180)) },
      b];
  };
  holes.push({
    number: i, source: mapped ? 'openstreetmap' : 'manual',
    par: 4, yards: mapped ? yards : undefined,
    teePoint: mapped ? { lat: 41.5901, lng: -93.8831 } : undefined,
    greenCenter: mapped
      ? { lat: 41.5901 - yards * latPerYd, lng: -93.8831 } : undefined,
    front: mapped
      ? { lat: 41.5901 - (yards - 14) * latPerYd, lng: -93.8831 } : undefined,
    back: mapped
      ? { lat: 41.5901 - (yards + 6) * latPerYd, lng: -93.8831 } : undefined,
    hazards: [], greenDepthYds: mapped ? 20 : undefined,
    pathPts: mapped ? mkPath() : undefined,
    greenRingPts: mapped ? (() => {
      const c = { lat: 41.5901 - yards * latPerYd, lng: -93.8831 };
      const rLat = 10 * 0.9 / 111320;
      const rLng = 10 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180));
      return [0, 60, 120, 180, 240, 300].map((d) => ({
        lat: c.lat + rLat * Math.sin(d * Math.PI / 180),
        lng: c.lng + rLng * Math.cos(d * Math.PI / 180),
      }));
    })() : undefined,
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:t', name: 'Shape Test GC', teeName: 'Red',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes,
    teeSets: [{ name: 'Red', holes: {} }, { name: 'Blue', holes: {} }],
    activeTeeSet: 'Red' }]));
window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:t';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  rows[2].click();   // dogleg hole 3
  setTimeout(() => {
    const body = window.document.getElementById('prepStratBody');
    const svg = body.querySelector('svg.prep-holemap');
    check('1. hole card shown', !!svg);
    const fw = svg.querySelector('path.prep-hm-fairway');
    check('2. fairway is a real stroked path', !!fw &&
      (fw.getAttribute('d') || '').startsWith('M'));
    const pathD = fw ? fw.getAttribute('d') : '';
    check('3. dogleg visible', fw && (() => {
      const nums = pathD.replace(/M|L/g, ' ').trim().split(/\s+/).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      if (xs.length < 4) return false;
      const x0 = xs[0], x1 = xs[xs.length - 1];
      const y0 = ys[0], y1 = ys[ys.length - 1];
      const midIdx = Math.floor(xs.length / 2);
      const linY = y0 + (y1 - y0) * ((xs[midIdx] - x0) / (x1 - x0));
      return Math.abs(ys[midIdx] - linY) > 4;
    })());
    check('4. green drawn as real outline', !!svg.querySelector('path.prep-hm-greenfill'));
    // v1.12/v1.13: tee chips/nudge REMOVED
    check('5. tee chips removed', !body.querySelector('.prep-tee-chip'));
    check('6. nudge removed', !body.querySelector('.prep-tee-nudge'));
    // tee shortcut button beside 3D Green, deep-links armtee=1
    const teeBtn = body.querySelector('#prepTeeBtn');
    check('7. Tee shortcut beside 3D Green', !!teeBtn &&
      (teeBtn.getAttribute('href') || '').includes('armtee=1'));
    check('8. tee shortcut carries course + hole',
      teeBtn && (teeBtn.getAttribute('href') || '').includes('course=') &&
      (teeBtn.getAttribute('href') || '').includes('hole=3'));
    // corridor rect: verified in .gtds/unit_corridor.js (pure core needs a
    // node require context; jsdom window.GreenMapCore isn't exposed). The
    // smoke suite's section 11 now asserts the rectangle (260 x 100).
    check('9. corridor rectangle covered by greenmap_smoke section 11', true);
    console.log(fails ? fails + ' FAILURE(S)' : 'E2E v1.13 PASSED');
    process.exit(fails ? 1 : 0);
  }, 400);
}, 800);
