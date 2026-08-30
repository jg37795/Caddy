/* TEMP: hole-view artifact repro — orbit + zoomed frames. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
fs.mkdirSync('.rimdebug', { recursive: true });
const REAL_CANVAS = createCanvas(1170, 2532);
const realCtx = REAL_CANVAS.getContext('2d');
const elRegistry = new Map();
function makeEl(key) {
  const listeners = {};
  const el = {
    style: {}, dataset: {}, textContent: '', value: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const h = this._s.has(c); const w = f === undefined ? !h : !!f;
        if (w) this._s.add(c); else this._s.delete(c); return w; } },
    width: 300, height: 150, appendChild() {}, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    getContext() { return realCtx; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    _fire(t, ev) { (listeners[t] || []).forEach(fn => fn(ev || {})); },
  };
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
    return [];
  },
  createElement: (t) => t === 'canvas' ? Object.assign(createCanvas(300, 150), { style: {} }) : makeEl('c:' + t),
  addEventListener() {},
};
global.window = { devicePixelRatio: 3, addEventListener: () => {}, GreenMapCore: null, CaddyElev: null };
global.innerWidth = 390; global.innerHeight = 844; global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '' };
global.requestAnimationFrame = (fn) => { fn(); return 0; };
console.warn = () => {};
const LAT = 41.91314, LNG = -93.60971;
function elevAt(mx, my) { const r = Math.hypot(mx, my);
  return 12 + 0.045 * mx + 0.03 * my + 0.9 * Math.sin(mx / 9) * Math.cos(my / 7)
    + 1.1 * Math.exp(-Math.pow((r - 6) / 3.2, 2)); }
function gridFor(w, s, e, n2, n) {
  const cs = Math.max((e - w) * 111320 * Math.cos(LAT * Math.PI / 180), (n2 - s) * 110540) / n;
  const g = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    g[y * n + x] = elevAt((x + 0.5 - n / 2) * cs, (n / 2 - y - 0.5) * cs);
  return { W: n, H: n, cellSizeM: cs, grid: g, validMask: null };
}
global.fetch = async () => ({ ok: true, json: async () => ({ elements: [] }) });
require(path.join(__dirname, 'caddy-elev.js'));
global.window.CaddyElev = { fetchElevGrid: async (bb, n) => gridFor(bb[0], bb[1], bb[2], bb[3], n) };
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) { await sleep(50);
    if (getEl('gm-status').textContent && !getEl('gm-status').textContent.includes('Loading')) break; }
  await sleep(1500);
  const canvas = getEl('view:hole');
  // simulate corridor landing while ALREADY in hole view (production flow):
  getEl('view:hole')._fire('click');
  await sleep(200);
  const shot = async (n) => {
    fs.writeFileSync(path.join('.rimdebug', n + '.png'), REAL_CANVAS.toBuffer('image/png'));
    console.log('[holeart]', n);
  };
  await shot('hole_default');
  // orbit a bit for a second angle
  let cur = { yaw: 0, pitch: 26 };
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
    await sleep(30); cur = { yaw, pitch };
  }
  await orbitTo(40, 35); await shot('hole_yaw40_pit35');
  console.log('[holeart] done');
  process.exit(0);
})().catch(e => { console.error('[holeart] FAILED', e); process.exit(1); });
