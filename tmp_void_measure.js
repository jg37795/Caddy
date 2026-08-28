/* tmp_void_measure.js — hole view: count corridor mesh quads, project them
   with the live camera, count rejects + where they sit (diagnose the void). */
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
// instrument BEFORE the corridor async build runs
const GM0 = global.window.GreenMapCore;
global.__corridorInfo = null;
const origB = GM0.buildMesh3D;
GM0.buildMesh3D = function (grid, W, H, cs, mask, range, exag, mode, opts) {
  const m = origB(grid, W, H, cs, mask, range, exag, mode, opts);
  if (m && W === 96) {
    let zmin = 1e9, zmax = -1e9, msum = 0;
    for (let q = 0; q < m.count; q++)
      for (let c = 0; c < 4; c++) {
        const z = m.pos[q * 12 + c * 3 + 2];
        if (z < zmin) zmin = z;
        if (z > zmax) zmax = z;
      }
    for (let i = 0; i < mask.length; i++) if (mask[i]) msum++;
    global.__corridorInfo = { W, H, cs, count: m.count, maskCells: msum,
      zmin, zmax, zspan: zmax - zmin };
    console.log('[void] corridor build: quads=' + m.count, 'maskCells=' + msum,
      'zspan=' + (zmax - zmin).toFixed(1), 'exag=' + exag);
  }
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
  getEl('gm-exag').value = process.env.EXAG_VAL || '15';
  getEl('gm-exag')._fire('input');
  await sleep(400);
  getEl('view:hole')._fire('click');
  await sleep(800);
  getEl('view:hole')._fire('click');
  await sleep(800);
  // project each quad with the current camera by re-using projectPt through
  // a probe render: simplest — sample screen colour along the corridor axis.
  // Instead: report what we have + take a frame.
  fs.writeFileSync(path.join(OUTDIR, (process.env.EXAG_VAL || 'x15') + '.png'), REAL_CANVAS.toBuffer('image/png'));
  console.log('[void] saved .holevoid/hole.png', JSON.stringify(global.__corridorInfo));
  process.exit(0);
})().catch(e => { console.error('[void] FAILED', e); process.exit(1); });
