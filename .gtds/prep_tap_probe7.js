/* prep_tap_probe7.js — count MO fires during the wedge: patch the
   MutationObserver constructor to count delivered records + sample
   jsdom timer starvation. Decisive: is the MO handler looping? */
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
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {};
global.confirm = () => false;
global.fetch = async () => { throw new Error('offline'); };
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

let moRecords = 0, moBatches = 0;
const OrigMO = window.MutationObserver;
class CountingMO extends OrigMO {
  constructor(fn) {
    super((list, obs) => {
      moBatches++;
      moRecords += list.length;
      if (moRecords % 5000 < list.length)
        console.log(`[mo] records=${moRecords} batches=${moBatches}`);
      fn(list, obs);
    });
  }
  observe(el, opts) { super.observe(el, opts); }
}
window.MutationObserver = CountingMO;
global.MutationObserver = CountingMO;

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
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe7] tapping…');
  rows[4].click();
  console.log('[probe7] click returned — waiting 3s to observe MO churn…');
  setTimeout(() => {
    console.log(`[probe7] T+3000: moRecords=${moRecords} moBatches=${moBatches}`);
    process.exit(0);
  }, 3000);
}, 800);

setTimeout(() => {
  console.log(`[probe7] WATCHDOG wedged: moRecords=${moRecords} moBatches=${moBatches}`);
  process.exit(2);
}, 9000);
