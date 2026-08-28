/* tmp_proj_audit.js — project EVERY corridor quad with the hole-view camera
   and count: in-frame vs behind-camera vs off-screen; also a coarse coverage
   map of which screen cells get NO quad → compare against the void. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.holevoid';
fs.mkdirSync(OUTDIR, { recursive: true });
const REAL_CANVAS = createCanvas(1170, 2532);
const realCtx = REAL_CANVAS.getContext('2d');
const elRegistry = new Map();
function makeEl(key) {
  const listeners = {};
  const el = { style: {}, dataset: {}, textContent: '', value: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const h = this._s.has(c); const w = f === undefined ? !h : !!f;
        if (w) this._s.add(c); else this._s.delete(c); return w; } },
    width: 300, height: 150, appendChild() {}, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    getContext() { return realCtx; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    _fire(t, ev) { (listeners[t] || []).forEach(fn => fn(ev || {})); } };
  return el;
}
function getEl(k) { if (!elRegistry.has(k)) elRegistry.set(k, makeEl(k)); return elRegistry.get(k); }
global.document = {
  getElementById: (id) => getEl(id),
  querySelector: (s) => getEl('q:' + s),
  querySelectorAll: (s) => {
    if (s === '.gm-view-btn') return ['2d', '3d', 'hole'].map(v => { const e = getEl('view:' + v); e.dataset.view = v; return e; });
    if (s === '.gm-layer-btn') return ['shading', 'arrows', 'both'].map(l => { const e = getEl('layer:' + l); e.dataset.layer = l; return e; });
    if (s === '#gm-ramplabels span') return [makeEl('a'), makeEl('b'), makeEl('c')];
    return []; },
  createElement: (t) => t === 'canvas' ? Object.assign(createCanvas(300, 150), { style: {} }) : makeEl('c:' + t),
  addEventListener() {},
};
global.window = { devicePixelRatio: 3, addEventListener: () => {}, GreenMapCore: null, CaddyElev: null };
global.innerWidth = 390; global.innerHeight = 844; global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '' };
global.requestAnimationFrame = (fn) => setImmediate(fn);
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'greenmap.js'));
const GM0 = global.window.GreenMapCore;
let lastCorridorMesh = null;
const origB = GM0.buildMesh3D;
GM0.buildMesh3D = function (grid, W, H, cs, mask, range, exag, mode, opts) {
  const m = origB(grid, W, H, cs, mask, range, exag, mode, opts);
  if (m && W === 96) lastCorridorMesh = m;
  return m;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st.includes('mean slope') || st.toLowerCase().includes('failed')) break;
  }
  await sleep(2500);
  getEl('view:3d')._fire('click');
  await sleep(300);
  getEl('view:hole')._fire('click');
  await sleep(800);
  const M = lastCorridorMesh;
  if (!M) { console.log('[audit] no corridor mesh captured'); process.exit(1); }
  // rebuild the same camera render3D uses in hole view after applyHoleFraming
  const cam = GM0.makeCam(0, 26, Math.max(120, Math.min(400, 300 * 0.9)));
  cam.f = Math.min(REAL_CANVAS.width, REAL_CANVAS.height) * 1.15;
  cam.ox = REAL_CANVAS.width / 2;
  cam.oy = REAL_CANVAS.height * 0.62;
  let behind = 0, inframe = 0, offscreen = 0;
  // coverage raster 30x30
  const CW = 30, CH = 30;
  const cov = new Uint8Array(CW * CH);
  for (let q = 0; q < M.count; q++) {
    let okAny = false; const pts = [];
    for (let c = 0; c < 4; c++) {
      const p = GM0.projectPt(cam, M.pos[q * 12 + c * 3],
        M.pos[q * 12 + c * 3 + 1], M.pos[q * 12 + c * 3 + 2]);
      if (p) { okAny = true; pts.push(p); }
    }
    if (!okAny) { behind++; continue; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 < 0 || y1 < 0 || x0 > REAL_CANVAS.width || y0 > REAL_CANVAS.height) { offscreen++; continue; }
    inframe++;
    const gx0 = Math.max(0, Math.floor(x0 / REAL_CANVAS.width * CW));
    const gx1 = Math.min(CW - 1, Math.ceil(x1 / REAL_CANVAS.width * CW));
    const gy0 = Math.max(0, Math.floor(y0 / REAL_CANVAS.height * CH));
    const gy1 = Math.min(CH - 1, Math.ceil(y1 / REAL_CANVAS.height * CH));
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) cov[gy * CW + gx] = 1;
  }
  console.log('[audit] quads behind=' + behind, 'offscreen=' + offscreen, 'inframe=' + inframe, 'total=' + M.count);
  // print coverage map (X = covered, . = hole) top row = y0
  for (let gy = 0; gy < CH; gy++) {
    let row = '';
    for (let gx = 0; gx < CW; gx++) row += cov[gy * CW + gx] ? 'X' : '.';
    console.log('[audit]', row);
  }
  process.exit(0);
})().catch(e => { console.error('[audit] FAILED', e); process.exit(1); });
