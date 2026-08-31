/* prep_tap_probe2.js — control: does the loop hang WITHOUT the tap?
   Heartbeats every 200ms reveal when the loop stops servicing timers. */
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
    hazards: [], greenDepthYds: 24,
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:test1', name: 'Freeze Test GC', teeName: 'Blue',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
window.localStorage.setItem('caddy:onboarded', '1');

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let beats = 0;
const hb = setInterval(() => { beats++; process.stdout.write(beats % 10 === 0 ? 'B' : '.'); }, 200);

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('\n[probe] rows', rows.length, '— tapping hole 5 NOW');
  const t0 = Date.now();
  rows[4].click();
  console.log(`\n[probe] click() returned after ${Date.now() - t0}ms`);

  setTimeout(() => {
    console.log('\n[probe] T+1200ms — loop alive, beats =', beats);
    // Try a SECOND tap (the real killer?)
    const t1 = Date.now();
    rows[4].click();
    console.log(`[probe] second click returned after ${Date.now() - t1}ms`);
    setTimeout(() => {
      console.log('[probe] T+2400ms — loop alive, beats =', beats);
      clearInterval(hb);
      console.log('\nVERDICT: no hang reproduced in jsdom');
      process.exit(0);
    }, 1200);
  }, 1200);
}, 800);

setTimeout(() => {
  console.log('\n[probe] watchdog: loop blocked >8s. beats =', beats);
  process.exit(2);
}, 9000);
