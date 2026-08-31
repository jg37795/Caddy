/* prep_tap_probe5.js — control: app.js ONLY (no prep.js). Does the tap
   still wedge the loop? */
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
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

const holes = [];
for (let i = 1; i <= 18; i++) {
  holes.push({
    number: i, source: 'openstreetmap', par: 4, yards: 320 + i * 9,
    teePoint: { lat: 41.5901 + i * 0.0007, lng: -93.8831 + i * 0.0006 },
    greenCenter: { lat: 41.5901 + i * 0.0007 + 0.0052, lng: -93.8831 + i * 0.0006 + 0.0034 },
    front: 320 + i * 9 - 12, back: 320 + i * 9 + 12,
    hazards: [{ type: 'water', lat: 41.5911 + i * 0.0007, lng: -93.8829 + i * 0.0006 }],
    greenDepthYds: 24,
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:test1', name: 'Freeze Test GC', teeName: 'Blue',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
window.localStorage.setItem('caddy:onboarded', '1');

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

setTimeout(() => {
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe5] rows', rows.length, '(NO prep.js loaded) — tapping…');
  const t0 = Date.now();
  rows[4].click();
  console.log(`[probe5] click returned ${Date.now() - t0}ms`);
  let b = 0;
  const hb = setInterval(() => {
    b++;
    console.log(`[hb ${b}] alive`);
    if (b >= 4) { clearInterval(hb); console.log('LOOP ALIVE without prep.js → wedge is in prep chain'); process.exit(0); }
  }, 700);
}, 800);

setTimeout(() => {
  console.log('[probe5] WATCHDOG: wedged WITHOUT prep.js → wedge is in app.js openHolePlan path');
  process.exit(2);
}, 9000);
