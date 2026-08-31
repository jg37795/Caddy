/* prep_tap_probe3.js — bisect the wedge: wrap every CaddyPrep bridge fn
   with before/after logs + count innerHTML writes + classifyLie cost. */
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

// instrument innerHTML setter
let innerWrites = 0, lastWriteLen = 0, lastWriteTs = 0;
const HE = window.Element.prototype;
const desc = Object.getOwnPropertyDescriptor(HE, 'innerHTML') ||
  Object.getOwnPropertyDescriptor(HE, 'textContent');
if (desc && desc.set) {
  Object.defineProperty(HE, 'innerHTML', {
    get() { return desc.get ? desc.get.call(this) : ''; },
    set(v) {
      innerWrites++;
      lastWriteLen = String(v).length;
      const t0 = Date.now();
      desc.set.call(this, v);
      const dt = Date.now() - t0;
      if (dt > 200) console.log(`[slow innerHTML ${dt}ms len=${lastWriteLen}] on`, this.id || this.tagName);
    },
    configurable: true,
  });
} else {
  console.log('[probe] no innerHTML descriptor on Element.prototype — skipping setter instrument');
}

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

setTimeout(() => {
  const api = window.CaddyPrep;
  const wrap = (name, fn) => function (...a) {
    const t0 = Date.now();
    const out = fn.apply(this, a);
    const dt = Date.now() - t0;
    if (dt > 150) console.log(`[slow api ${name} ${dt}ms]`, JSON.stringify(a).slice(0, 80));
    return out;
  };
  for (const k of ['playsLike', 'recommendClub', 'clubSequence', 'holeInfo', 'weather']) {
    if (typeof api[k] === 'function') api[k] = wrap(k, api[k]);
  }
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe] tapping…');
  const t0 = Date.now();
  rows[4].click();
  console.log(`[probe] click returned ${Date.now() - t0}ms, innerWrites ${innerWrites}`);
  // heartbeat to detect wedge
  let b = 0;
  const hb = setInterval(() => {
    b++;
    console.log(`[hb ${b}] writes=${innerWrites} lastLen=${lastWriteLen} lastSlow=${Date.now() - lastWriteTs}`);
    if (b >= 4) { clearInterval(hb); console.log('LOOP ALIVE — wedge is elsewhere or transient'); process.exit(0); }
  }, 700);
  setTimeout(() => {
    console.log('[probe] should never print if wedged');
  }, 3000);
}, 800);

setTimeout(() => {
  console.log('[probe] WATCHDOG: blocked >9s — event loop dead. innerWrites', innerWrites, 'lastLen', lastWriteLen);
  process.exit(2);
}, 9000);
