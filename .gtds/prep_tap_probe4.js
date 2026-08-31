/* prep_tap_probe4.js — stub-experiment: replace api fns with no-ops to
   isolate which call wedges the loop after the tap. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const MODE = process.argv[2] || 'all-stub';   // all-stub | real-physics
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

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

setTimeout(() => {
  const api = window.CaddyPrep;
  const fastCalc = (yd) => ({ playsLikeYd: yd, headwindMph: 0,
    crosswindMph: 0, aimYd: 0, aimDeg: 0, carryYd: yd, releaseYd: 0 });
  if (MODE === 'all-stub') {
    api.playsLike = (o) => fastCalc(o.horizontalYd);
    api.recommendClub = () => ({ main: '7 iron stock', sub: 'stub' });
    api.clubSequence = (yd) => ({ seq: ['Driver', '7 iron'], finisherName: 'PW' });
    console.log('[probe] MODE=all-stub');
  } else {
    console.log('[probe] MODE=real-physics');
  }
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe] tapping…');
  const t0 = Date.now();
  rows[4].click();
  console.log(`[probe] click returned ${Date.now() - t0}ms`);
  let b = 0;
  const hb = setInterval(() => {
    b++;
    console.log(`[hb ${b}] alive`);
    if (b >= 4) { clearInterval(hb); console.log('LOOP ALIVE with', MODE); process.exit(0); }
  }, 700);
}, 800);

setTimeout(() => {
  console.log('[probe] WATCHDOG: blocked >9s with', MODE);
  process.exit(2);
}, 9000);
