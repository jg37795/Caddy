/* TEMP: wrap buildMesh3D during the REAL boot — count void/dropped cells
   inside the polygon, and locate them (rim distance). */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.voidprobe';
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
const GM = global.window.GreenMapCore;
const orig = GM.buildMesh3D;
let dumped = false;
GM.buildMesh3D = function (grid, W, H, cs, mask, er, ex, mode, opts) {
  const r = orig(grid, W, H, cs, mask, er, ex, mode, opts);
  if (!dumped && opts && opts.polyLocalM && W >= 64) {
    dumped = true;
    const P = opts.polyLocalM;
    let inPoly = 0, voidIn = 0, mask0Finite = 0;
    const voids = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const mx = (x + 0.5 - W / 2) * cs, my = (H / 2 - y - 0.5) * cs;
      if (!GM.pointInPoly(mx, my, P)) continue;
      inPoly++;
      if (!Number.isFinite(grid[i])) { voidIn++; voids.push([x, y]); }
      else if (!mask[i]) mask0Finite++;
    }
    console.log('[voids] fine grid', W + 'x' + H, 'inPoly cells:', inPoly,
      '| NaN inside polygon:', voidIn, '| finite-but-mask0:', mask0Finite);
    // neighbourhood color sanity: slope spikes around voids
    let spike = 0;
    for (const [vx, vy] of voids)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx2 = vx + dx, ny2 = vy + dy;
        if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
        if (Number.isFinite(grid[ny2 * W + nx2])) spike++;
      }
    console.log('[voids] finite neighbours adjacent to voids:', spike,
      '(these get extreme computed slopes)');
    fs.writeFileSync('.voidprobe/voids.json', JSON.stringify({ W, H, cs, voids }));
  }
  return r;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st && !st.includes('Loading')) break;
  }
  await sleep(1500);
  console.log('[voids] done, status:', getEl('gm-status').textContent);
  process.exit(0);
})().catch(e => { console.error('[voids] FAILED', e); process.exit(1); });
