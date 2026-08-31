/* prep_tap_probe.js — find WHO schedules endless timers after the tap.
   NOTE: no Error().stack capture (it recursed through the jsdom shim).
   We count schedules + sample the scheduled function's name. */
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

const origST = window.setTimeout.bind(window);
let schedCount = 0;
const names = new Map();   // fnName -> count
window.setTimeout = function (fn, ms, ...rest) {
  schedCount++;
  if (typeof fn === 'function') {
    const n = (fn.name || 'anon');
    names.set(n, (names.get(n) || 0) + 1);
  } else {
    names.set('(string)', (names.get('(string)') || 0) + 1);
  }
  return origST(fn, ms, ...rest);
};

let obsFires = 0;
const OrigMO = window.MutationObserver;
window.MutationObserver = class extends OrigMO {
  constructor(fn) {
    super((list, obs) => { obsFires += list.length; fn(list, obs); });
  }
};

const holes = [];
for (let i = 1; i <= 18; i++) {
  holes.push({
    number: i, source: 'openstreetmap', par: 4, yards: 320 + i * 9,
    strokeIndex: ((i * 7) % 18) + 1,
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
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  const base = schedCount;
  console.log('rows', rows.length, 'sched before tap', base);
  rows[4].click();
  console.log('tap done, sched', schedCount, '(delta', schedCount - base, ') obsFires', obsFires);
  setTimeout(() => {
    console.log('1.2s later: sched', schedCount, '(delta since tap', schedCount - base, ') obsFires', obsFires);
    const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('top scheduled fns:', JSON.stringify(top));
    process.exit(0);
  }, 1200);
}, 800);
