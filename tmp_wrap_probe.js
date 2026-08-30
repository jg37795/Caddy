/* TEMP: wrap buildMesh3D during the real boot to see what it receives. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.rimdebug';
fs.mkdirSync(OUTDIR, { recursive: true });
const REAL_CANVAS = createCanvas(1170, 2532);
const realCtx = REAL_CANVAS.getContext('2d');

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
                   return want; } },
    width: 300, height: 150,
    appendChild() {}, remove() {}, focus() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    getContext() { return realCtx; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    _fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); },
  };
  return el;
}
function getEl(key) {
  if (!elRegistry.has(key)) elRegistry.set(key, makeEl(key));
  return elRegistry.get(key);
}
global.document = {
  getElementById: (id) => getEl(id),
  querySelector: (sel) => getEl('sel:' + sel),
  querySelectorAll: (sel) => {
    if (sel === '.gm-view-btn')
      return ['2d', '3d', 'hole'].map(v => { const el = getEl('view:' + v);
        el.dataset.view = v; return el; });
    if (sel === '.gm-layer-btn')
      return ['shading', 'arrows', 'both'].map(l => { const el = getEl('layer:' + l);
        el.dataset.layer = l; return el; });
    if (sel === '#gm-ramplabels span')
      return [makeEl('s1'), makeEl('s2'), makeEl('s3')];
    return [];
  },
  createElement: (tag) => {
    if (tag === 'canvas') { const c = createCanvas(300, 150); c.style = {}; return c; }
    return makeEl('c:' + tag);
  },
  addEventListener() {},
};
global.window = { devicePixelRatio: 3, addEventListener: () => {},
  GreenMapCore: null, CaddyElev: null };
global.innerWidth = 390; global.innerHeight = 844;
global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '' };
global.requestAnimationFrame = (fn) => { fn(); return 0; };
console.warn = () => {};

const LAT = 41.91314, LNG = -93.60971;
function elevAt(mx, my) {
  const r = Math.hypot(mx, my);
  return 12 + 0.045 * mx + 0.03 * my +
    0.9 * Math.sin(mx / 9) * Math.cos(my / 7) +
    1.1 * Math.exp(-Math.pow((r - 6) / 3.2, 2));
}
function gridFor(w, s, e, n2, nCells) {
  const spanX = (e - w) * 111320 * Math.cos(LAT * Math.PI / 180);
  const spanY = (n2 - s) * 110540;
  const cs = Math.max(spanX, spanY) / nCells;
  const grid = new Float32Array(nCells * nCells);
  for (let y = 0; y < nCells; y++)
    for (let x = 0; x < nCells; x++)
      grid[y * nCells + x] = elevAt((x + 0.5 - nCells / 2) * cs,
                                    (nCells / 2 - y - 0.5) * cs);
  return { W: nCells, H: nCells, cellSizeM: cs, grid, validMask: null };
}
global.fetch = async (url) => {
  if (String(url).includes('overpass'))
    return { ok: true, json: async () => ({ elements: [] }) };  // ellipse path
  throw new Error('unexpected fetch');
};
require(path.join(__dirname, 'caddy-elev.js'));
global.window.CaddyElev = { fetchElevGrid: async (bb, n) => gridFor(bb[0], bb[1], bb[2], bb[3], n) };

require(path.join(__dirname, 'greenmap.js'));
// wrap BEFORE the async boot's first await resolves
const GM = global.window.GreenMapCore;
const orig = GM.buildMesh3D;
GM.buildMesh3D = function (grid, W, H, cs, mask, elevRange, exag, mode, opts) {
  const r = orig(grid, W, H, cs, mask, elevRange, exag, mode, opts);
  console.log('[wrap] buildMesh3D W=' + W, 'polyLocalM=',
    opts && opts.polyLocalM ? opts.polyLocalM.length + 'pts' : 'NULL',
    '-> quads', r && r.count);
  return r;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    const st = getEl('gm-status').textContent;
    if (st && !st.includes('Loading')) break;
  }
  console.log('[wrap] status:', getEl('gm-status').textContent);
  getEl('view:3d')._fire('click');
  await sleep(200);
  fs.writeFileSync(path.join(OUTDIR, 'ellipse_fixed.png'), REAL_CANVAS.toBuffer('image/png'));
  console.log('[wrap] wrote', OUTDIR + '/ellipse_fixed.png');
  process.exit(0);
})().catch(e => { console.error('[wrap] FAILED', e); process.exit(1); });
