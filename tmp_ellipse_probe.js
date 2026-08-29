/* tmp_ellipse_probe.js — James played Westwood (NOT on OSM) → the tool ran
   its ELLIPSE FALLBACK geometry, the path v1.1.x sealing was never verified
   on. Repro: stub Overpass responses empty (=> polySource 'ellipse') but
   keep REAL USGS LiDAR, real exag slider, his cameras. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.ellipfix';
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
// REAL fetch, except Overpass → empty (no mapped green => ellipse fallback)
const realFetch = global.fetch || require('http').fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('overpass')) {
    return { ok: true, json: async () => ({ elements: [] }) };
  }
  return realFetch(url, opts);
};
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st.includes('mean slope') || st.toLowerCase().includes('failed')) break;
  }
  const st = getEl('gm-status').textContent || '';
  console.log('[ell] status:', st);
  getEl('view:3d')._fire('click');
  await sleep(300);
  getEl('gm-exag').value = '15';
  getEl('gm-exag')._fire('input');
  await sleep(500);
  const canvas = getEl('gm-canvas');
  const shot = async (n) => {
    fs.writeFileSync(path.join(OUTDIR, n + '.png'), REAL_CANVAS.toBuffer('image/png'));
    console.log('[ell] frame', n);
  };
  await shot('default');
  let cur = { yaw: 0, pitch: 35 };
  async function orbitTo(yaw, pitch) {
    const dyaw = ((yaw - cur.yaw) + 540) % 360 - 180;
    const dpit = pitch - cur.pitch;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dyaw), Math.abs(dpit)) / 2));
    const sx = 195, sy = 400;
    const ex = sx + dyaw / 0.35, ey = sy + dpit / 0.25;
    canvas._fire('pointerdown', { pointerId: 1, clientX: sx, clientY: sy });
    for (let i = 1; i <= steps; i++) { const t = i / steps;
      canvas._fire('pointermove', { pointerId: 1,
        clientX: sx + (ex - sx) * t, clientY: sy + (ey - sy) * t });
      await sleep(5); }
    canvas._fire('pointerup', { pointerId: 1, clientX: ex, clientY: ey });
    await sleep(50); cur = { yaw, pitch };
  }
  await orbitTo(120, 40); await shot('yaw120');
  await orbitTo(200, 20); await shot('low_glance');
  for (let i = 0; i < 8; i++) { canvas._fire('wheel', { deltaY: -120, preventDefault: () => {} }); await sleep(8); }
  await sleep(150);
  await shot('zoom');
  process.exit(0);
})().catch(e => { console.error('[ell] FAILED', e); process.exit(1); });
