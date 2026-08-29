/* tmp_trace_probe.js — reproduce James's flow: traced outline in localStorage
   (15 pts around a green), Overpass EMPTY (unmapped course), real USGS.
   Expect: polySource 'traced', green renders in 2D + 3D. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.tracefix';
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
// A traced outline like James's Westwood one: ~15 pts around a green whose
// centroid is the launch point.
const C = { lat: 41.59362, lng: -93.88235 };
const ring = [];
for (let a = 0; a < 15; a++) {
  const th = a / 15 * Math.PI * 2;
  ring.push([C.lat + Math.sin(th) * 0.00012, C.lng + Math.cos(th) * 0.00016]);
}
const STORE = { [C.lat.toFixed(3) + ',' + C.lng.toFixed(3)]: {
  lat: C.lat, lng: C.lng, vertices: ring, updatedAt: Date.now() } };
global.localStorage = {
  getItem: (k) => k === 'caddy:greenOutline:v1' ? JSON.stringify(STORE) : null,
  setItem() {},
};
global.location = { search: '?lat=' + C.lat + '&lng=' + C.lng };
global.requestAnimationFrame = (fn) => setImmediate(fn);
const realFetch = global.fetch || null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('overpass')) return { ok: true, json: async () => ({ elements: [] }) };
  return realFetch(url, opts);
};
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if ((st.includes('mean slope') || st.toLowerCase().includes('no 3dep') ||
         st.toLowerCase().includes('failed')) && i > 3) break;
  }
  console.log('[trace] status:', getEl('gm-status').textContent);
  console.log('[trace] loc:', getEl('gm-loc').textContent);
  fs.writeFileSync(path.join(OUTDIR, 'twod.png'), REAL_CANVAS.toBuffer('image/png'));
  // Now 3D at 15x glancing — does the traced drum render sealed?
  getEl('view:3d')._fire('click');
  await sleep(300);
  getEl('gm-exag').value = '15';
  getEl('gm-exag')._fire('input');
  await sleep(400);
  const canvas = getEl('gm-canvas');
  let cur = { yaw: 0, pitch: 35 };
  const sx0 = 195, sy0 = 400;
  const dyaw = ((200 - cur.yaw) + 540) % 360 - 180, dpit = 20 - cur.pitch;
  const steps = 60;
  canvas._fire('pointerdown', { pointerId: 1, clientX: sx0, clientY: sy0 });
  for (let i = 1; i <= steps; i++) { const t = i / steps;
    canvas._fire('pointermove', { pointerId: 1,
      clientX: sx0 + dyaw / 0.35 * t, clientY: sy0 + dpit / 0.25 * t });
    await sleep(5); }
  canvas._fire('pointerup', { pointerId: 1,
    clientX: sx0 + dyaw / 0.35, clientY: sy0 + dpit / 0.25 });
  await sleep(120);
  fs.writeFileSync(path.join(OUTDIR, 'threed.png'), REAL_CANVAS.toBuffer('image/png'));
  console.log('[trace] frames saved');
  process.exit(0);
})().catch(e => { console.error('[trace] FAILED', e); process.exit(1); });
