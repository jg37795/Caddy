/* tmp_sat_probe.js — hole view with satellite texture: boot at Westwood,
   switch to Hole view, wait for mosaic, capture. Verifies satview end-to-end
   (tile fetch via node-canvas Image, mosaic, per-quad sampling). */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas, Image } = require('canvas');
const OUTDIR = '.satview';
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
  createElement: (t) => {
    if (t === 'canvas') {
      const c = createCanvas(300, 150);
      c.style = {};
      return c;
    }
    return makeEl('c:' + t);
  },
  addEventListener() {},
};
// Image shim: node-canvas Image + real http fetch of the tile bytes
// v1.3.0: no Image shim needed — satview.js fetches bytes itself and feeds
// node-canvas Image a Buffer (the browser path passes a URL, which also
// works). Real node-canvas Image is used directly.
global.Image = require('canvas').Image;
global.window = { devicePixelRatio: 3, addEventListener: () => {}, GreenMapCore: null, CaddyElev: null };
global.innerWidth = 390; global.innerHeight = 844; global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '?lat=41.59362&lng=-93.88235' };
global.requestAnimationFrame = (fn) => setImmediate(fn);
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'satview.js'));
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if ((st.includes('mean slope') || st.toLowerCase().includes('no 3dep')) && i > 3) break;
  }
  await sleep(2000);   // corridor + satellite mosaic headroom
  console.log('[sat] status:', getEl('gm-status').textContent);
  getEl('view:3d')._fire('click');
  await sleep(200);
  getEl('view:hole')._fire('click');
  await sleep(1500);
  fs.writeFileSync(path.join(OUTDIR, 'hole_sat.png'), REAL_CANVAS.toBuffer('image/png'));
  console.log('[sat] hole frame saved');
  process.exit(0);
})().catch(e => { console.error('[sat] FAILED', e); process.exit(1); });
