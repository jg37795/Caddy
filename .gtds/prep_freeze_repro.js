/* prep_freeze_repro.js — reproduce the hole-tap freeze headlessly.
   Loads prep.js against a stub DOM, simulates the hole-row tap through
   the REAL document click delegation, and watches for unbounded loops.
   Run: node .gtds/prep_freeze_repro.js */
'use strict';
const fs = require('fs');
const path = require('path');

let solveCalls = 0, hapticCalls = 0, observerFires = 0;

const docListeners = [];   // {type, fn, capture}
function makeEl(id, tag) {
  const el = {
    id, tagName: (tag || 'div').toUpperCase(),
    style: { setProperty() {}, },
    dataset: {},
    hidden: false, value: '', textContent: '', innerHTML: '',
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { (f === undefined ? !this._s.has(c) : f) ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute() {}, toggleAttribute() {}, removeAttribute() {},
    addEventListener(type, fn) {
      if (!el._h) el._h = {};
      (el._h[type] ||= []).push(fn);
    },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    removeChild() {}, remove() {},
    querySelector(sel) {
      if (sel === 'b') return makeEl(id + '_b', 'b');
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.prep-point-btn') return ['front', 'middle', 'back'].map(p => {
        const b = makeEl(id + '_' + p, 'button');
        b.dataset.point = p;
        b.querySelector = () => makeEl(id + '_' + p + '_b', 'b');
        return b;
      });
      return [];
    },
    closest(sel) {
      if (sel === '.plan-hole-row') return tapRow;
      return null;
    },
    focus() {}, blur() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 232, height: 232 }),
  };
  return el;
}

const registry = new Map();
function getEl(id) {
  if (registry.has(id)) return registry.get(id);
  const el = makeEl(id);
  registry.set(id, el);
  return el;
}

const tapRow = makeEl('holeRow', 'button');
tapRow.dataset.hole = '5';

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.document = {
  getElementById: (id) => getEl(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => makeEl('dyn_' + Math.random().toString(36).slice(2), t),
  createElementNS: (ns, t) => makeEl('dynns_' + Math.random().toString(36).slice(2), t),
  addEventListener(type, fn) { docListeners.push({ type, fn }); },
  removeEventListener() {},
  body: makeEl('body'), documentElement: makeEl('html'),
  visibilityState: 'visible',
};
global.window = {
  addEventListener() {}, removeEventListener() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (f) => setImmediate(f),
  localStorage: global.localStorage,
  CADDY_VERSION: 'test',
  isSecureContext: false,
  location: { search: '', protocol: 'file:' },
};
global.location = global.window.location;
global.navigator = { vibrate: () => true, onLine: true, language: 'en-US',
  userAgent: 'test', standalone: false,
  geolocation: { watchPosition: () => 1, clearWatch() {} } };
global.requestAnimationFrame = (f) => setImmediate(f);
global.fetch = async () => { throw new Error('offline'); };
global.crypto = require('crypto').webcrypto;
global.matchMedia = () => ({ matches: false, addEventListener() {} });
global.window.matchMedia = global.matchMedia;

const clubs = [['Driver', 260], ['3W', 230], ['5I', 190], ['7I', 160],
  ['9I', 130], ['PW', 105], ['52', 80], ['56', 60]]
  .map(([n, y]) => ({ id: n, name: n, yards: y }));
const sortedDesc = () => clubs.slice().sort((a, b) => b.yards - a.yards);
const sortedAsc = () => clubs.slice().sort((a, b) => a.yards - b.yards);

global.window.CaddyPrep = {
  v: 1,
  playsLike(o) {
    solveCalls++;
    if (solveCalls > 800) throw new Error('SOLVE RUNAWAY: ' + solveCalls);
    return {
      playsLikeYd: o.horizontalYd + (o.windMph || 0) * 0.5,
      headwindMph: 0, crosswindMph: 0, aimYd: 0, aimDeg: 0,
      carryYd: o.horizontalYd, releaseYd: 0,
    };
  },
  recommendClub(playsYd) {
    solveCalls++;
    if (solveCalls > 800) throw new Error('RECOMMEND RUNAWAY: ' + solveCalls);
    for (const c of sortedDesc())
      if (playsYd <= c.yards * 1.08) return { main: c.name + ' stock', sub: '' };
    return { main: 'Lay up', sub: '' };
  },
  clubsDesc: sortedDesc,
  weather: () => ({ rh: 50, pressureHpa: 1015, shearAlpha: 0.143, gustMph: 0, tempF: 70 }),
  elevation: () => ({ targetFt: 0, userFt: 0 }),
  locLat: () => 41.6,
  clubSequence(totalYd) {
    let remain = totalYd; const seq = [];
    for (const c of sortedDesc()) {
      if (remain <= c.yards * 1.08) break;
      if (seq.length >= 4) break;
      seq.push(c.name); remain -= c.yards;
      if (remain <= 30) break;
    }
    if (!seq.length) {
      const s = sortedAsc()[0];
      if (s && s.yards > 0 && totalYd < s.yards * 0.95)
        return { seq: [], finisherName: `${s.name} · ${Math.round(totalYd / s.yards * 100)}% swing` };
    }
    const f = sortedAsc().find(c => c.yards >= Math.max(20, remain));
    return { seq, finisherName: f ? f.name : `${Math.round(remain)} yd partial` };
  },
  holeInfo(number) {
    return {
      number, courseName: 'Test GC', par: 4, yards: 400, strokeIndex: 3,
      hazards: [{ type: 'water', label: 'Water', sub: 'right, ~200 yd off the tee',
        along: 200, cross: 25 }],
      green: { front: 380, center: 400, back: 415, depth: 22 },
      teeLatLng: { lat: 41.59, lng: -93.88 },
      greenLatLng: { lat: 41.5922, lng: -93.8790 },
      bearing: 42,
    };
  },
  haptic() { hapticCalls++; },
};
global.window.CaddyElev = { greenMap: async () => null };

let obsFn = null;
global.MutationObserver = class {
  constructor(fn) { obsFn = fn; }
  observe(el) { this.el = el; }
  fire() { observerFires++; obsFn([{ type: 'attributes', target: this.el }], this); }
};

const watchdog = setTimeout(() => {
  console.error('FREEZE REPRODUCED: blocked >5s. solveCalls=', solveCalls,
    'observerFires=', observerFires);
  process.exit(2);
}, 5000);

try {
  require(path.join(__dirname, '..', 'prep.js'));
} catch (e) {
  clearTimeout(watchdog);
  console.error('BOOT THREW:', e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
console.log('booted. solveCalls after boot:', solveCalls);

// Simulate the tap: capture-phase document click → prep.js bindHole
solveCalls = 0;
const click = { target: tapRow, closest: (s) => (s === '.plan-hole-row' ? tapRow : null) };
try {
  const cap = docListeners.find(l => l.type === 'click');
  if (!cap) { console.error('no document click listener registered'); process.exit(4); }
  cap.fn(click);          // prep.js capture handler → bindHole(5)
  console.log('tap handled. solveCalls:', solveCalls,
    'observerFires:', observerFires, 'haptics:', hapticCalls);
  // second tap (double-tap scenario)
  solveCalls = 0;
  cap.fn(click);
  console.log('second tap handled. solveCalls:', solveCalls);
  clearTimeout(watchdog);
  console.log('NO FREEZE in harness — need device-side profiling');
  process.exit(0);
} catch (e) {
  clearTimeout(watchdog);
  console.error('TAP THREW:', e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
