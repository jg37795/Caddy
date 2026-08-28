/* TEMP harness (not for commit): headless render3D frame capture.
   Runs the REAL greenmap boot + real render3D + real pointer orbit handlers
   against a stubbed DOM, synthetic 3DEP grid and synthetic OSM polygon.
   Captures PNGs from multiple orbit angles at iPhone 16 Pro Max geometry.
   Run: node tmp_rim_harness.js [poly|ellipse] [outdir]
*/
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');

const MODE = process.argv[2] || 'poly';         // poly | ellipse
const OUTDIR = process.argv[3] || '.rimframes';
fs.mkdirSync(OUTDIR, { recursive: true });

/* ---------- canvas factory ---------- */
function makeCtx2D(w, h) {
  const cv = createCanvas(w || 300, h || 150);
  return cv;
}
const REAL_CANVAS = makeCtx2D(1170, 2532);      // 390pt x 844pt @3x

/* ---------- DOM stubs ---------- */
const elRegistry = new Map();
function makeEl(key) {
  const listeners = {};
  const el = {
    _key: key, _listeners: listeners,
    style: {}, dataset: {}, title: '', textContent: '', value: '',
    classList: { _set: new Set(), add(c) { this._set.add(c); },
                 remove(c) { this._set.delete(c); },
                 contains(c) { return this._set.has(c); },
                 toggle(c, force) {
                   const has = this._set.has(c);
                   const want = force === undefined ? !has : !!force;
                   if (want) this._set.add(c); else this._set.delete(c);
                   return want;
                 } },
    width: 300, height: 150,
    appendChild() {}, remove() {}, focus() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    getContext() { return ctxStub; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    _fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); },
  };
  return el;
}
// canvas gets the REAL node-canvas 2d context
const ctxStub = null; // placeholder (real one attached to REAL_CANVAS below)
const realCtx = REAL_CANVAS.getContext('2d');

function getEl(key) {
  if (!elRegistry.has(key)) {
    const el = makeEl(key);
    if (key === 'gm-canvas') {
      el.width = REAL_CANVAS.width; el.height = REAL_CANVAS.height;
      el.getContext = () => realCtx;
    }
    elRegistry.set(key, el);
  }
  return elRegistry.get(key);
}

global.document = {
  getElementById: (id) => getEl(id),
  querySelector: (sel) => getEl('sel:' + sel),
  querySelectorAll: (sel) => {
    if (sel === '.gm-view-btn')
      return [getEl('view:2d'), getEl('view:3d'), getEl('view:hole')]
        .map((el, i) => (el.dataset.view = ['2d', '3d', 'hole'][i], el));
    if (sel === '.gm-layer-btn')
      return ['shading', 'arrows', 'both'].map(l => {
        const el = getEl('layer:' + l); el.dataset.layer = l; return el;
      });
    if (sel === '#gm-ramplabels span') return [makeEl('sp1'), makeEl('sp2'), makeEl('sp3')];
    return [];
  },
  createElement: (tag) => {
    if (tag === 'canvas') { const c = makeCtx2D(); c.style = {}; return c; }
    return makeEl('created:' + tag + ':' + Math.random());
  },
  addEventListener() {},
};
global.window = {
  devicePixelRatio: 3,
  addEventListener: () => {},
  GreenMapCore: null,     // filled by greenmap.js
  CaddyElev: null,        // stubbed below after require
};
global.innerWidth = 390; global.innerHeight = 844;
global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '' };
global.requestAnimationFrame = (fn) => { fn(); return 0; };
global.alert = () => {}; global.consoleWarnQuiet = false;
const realWarn = console.warn; console.warn = (...a) => {
  if (String(a[0]).includes('no OSM green polygon') ||
      String(a[0]).includes('[CaddyElev]')) return;
  realWarn(...a);
};

/* ---------- synthetic data ---------- */
const LAT = 41.91314, LNG = -93.60971;
const N = 64, SPAN = 40, CS = SPAN / N;
// rolling green with a drain dip — few-metre relief like real LiDAR
function elevAt(mx, my) {           // local metres, +x E +y N
  const r = Math.hypot(mx, my);
  let z = 12 + 0.045 * mx + 0.03 * my + 0.9 * Math.sin(mx / 9) *
          Math.cos(my / 7) + 1.1 * Math.exp(-Math.pow((r - 6) / 3.2, 2));
  return z;
}
function gridFor(w, s, e, n2, nCells) {
  const spanX = (e - w) * 111320 * Math.cos(LAT * Math.PI / 180);
  const spanY = (n2 - s) * 110540;
  const cs = Math.max(spanX, spanY) / nCells;
  const W = nCells, H = nCells;
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const mx = (x + 0.5 - W / 2) * cs;      // corridor-local m (centre 0)
      const my = (H / 2 - y - 0.5) * cs;
      grid[y * W + x] = elevAt(mx, my);
    }
  return { W, H, cellSizeM: cs, grid, validMask: null };
}
global.fetch = async (url) => {
  if (String(url).includes('overpass')) {
    if (MODE === 'poly') {
      // wavy green polygon ~±7m around (LNG, LAT)
      const geo = [];
      for (let k = 0; k < 48; k++) {
        const th = k / 48 * Math.PI * 2;
        const r = 7 + 1.3 * Math.sin(3 * th) + 0.8 * Math.cos(5 * th);
        const dLng = Math.cos(th) * r / (111320 * Math.cos(LAT * Math.PI / 180));
        const dLat = Math.sin(th) * r / 110540;
        geo.push({ lon: LNG + dLng, lat: LAT + dLat });
      }
      return { ok: true, json: async () => ({ elements: [{ geometry: geo }] }) };
    }
    return { ok: true, json: async () => ({ elements: [] }) };  // ellipse path
  }
  throw new Error('unexpected fetch ' + url);
};
require(path.join(__dirname, 'caddy-elev.js'));   // not used — we stub below
global.window.CaddyElev = {
  fetchElevGrid: async (bb, nCells) => gridFor(bb[1], bb[1], bb[2], bb[3], nCells),
};
// fix: fetchElevGrid(bbox, GRID_N) with bbox=[w,s,e,n]
global.window.CaddyElev.fetchElevGrid = async (bb, nCells) =>
  gridFor(bb[0], bb[1], bb[2], bb[3], nCells);

/* ---------- boot the real app ---------- */
require(path.join(__dirname, 'greenmap.js'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // let the async loadGreen boot complete
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (getEl('gm-status').textContent &&
        !getEl('gm-status').textContent.includes('Loading')) break;
  }
  const canvas = getEl('gm-canvas');
  console.log('[harness] status:', getEl('gm-status').textContent, '| mode:', MODE);

  // switch to 3D view (real click handler)
  getEl('view:3d')._fire('click');
  await sleep(100);
  // optional exaggeration override via env (default app value 8)
  if (process.env.EXAG) {
    const ex = getEl('gm-exag');
    ex.value = process.env.EXAG;
    ex._fire('input');
    await sleep(100);
    console.log('[harness] exag ->', process.env.EXAG + 'x');
  }

  const shot = async (name) => {
    const buf = REAL_CANVAS.toBuffer('image/png');
    const p = path.join(OUTDIR, MODE + '_' + name + '.png');
    fs.writeFileSync(p, buf);
    console.log('[frame]', p);
  };
  // orbit via REAL pointer handlers (dx in CSS px; yaw+=dx*0.35, pitch+=dy*0.25)
  let cur = { x: 195, y: 400, yaw: 0, pitch: 45 };   // defaults match state.v3
  async function orbitTo(yaw, pitch) {
    const dyaw = ((yaw - cur.yaw) + 540) % 360 - 180;
    const dpit = pitch - cur.pitch;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dyaw), Math.abs(dpit)) / 2));
    const sx = 195, sy = 400;
    const ex = sx + dyaw / 0.35, ey = sy + dpit / 0.25;
    canvas._fire('pointerdown', { pointerId: 1, clientX: sx, clientY: sy });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      canvas._fire('pointermove', {
        pointerId: 1,
        clientX: sx + (ex - sx) * t,
        clientY: sy + (ey - sy) * t,
      });
      await sleep(5);
    }
    canvas._fire('pointerup', { pointerId: 1, clientX: ex, clientY: ey });
    await sleep(30);
    cur.yaw = yaw; cur.pitch = pitch;
  }
  await orbitTo(0, 45);   await shot('yaw000_pit045');
  await orbitTo(0, 22);   await shot('yaw000_pit022');
  await orbitTo(90, 22);  await shot('yaw090_pit022');
  await orbitTo(180, 22); await shot('yaw180_pit022');
  await orbitTo(270, 22); await shot('yaw270_pit022');
  await orbitTo(180, 70); await shot('yaw180_pit070');
  console.log('[harness] done');
  process.exit(0);
})().catch(e => { console.error('[harness] FAILED:', e); process.exit(1); });
