/* TEMP: synthetic LiDAR-void reproduction — NaN band along a rim arc.
   env VOIDS=0 -> control (no voids). Run: node tmp_void_synth.js poly .voidsynth */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const MODE = 'poly';
const OUTDIR = process.argv[2] || '.voidsynth';
const WITH_VOIDS = process.env.VOIDS !== '0';
fs.mkdirSync(OUTDIR, { recursive: true });
const REAL_CANVAS = createCanvas(1170, 2532);
const realCtx = REAL_CANVAS.getContext('2d');
const elRegistry = new Map();
function makeEl(key) {
  const listeners = {};
  const el = { _key: key, _listeners: listeners,
    style: {}, dataset: {}, title: '', textContent: '', value: '',
    classList: { _set: new Set(), add(c) { this._set.add(c); },
                 remove(c) { this._set.delete(c); },
                 contains(c) { return this._set.has(c); },
                 toggle(c, force) { const has = this._set.has(c);
                   const want = force === undefined ? !has : !!force;
                   if (want) this._set.add(c); else this._set.delete(c); return want; } },
    width: 300, height: 150,
    appendChild() {}, remove() {}, focus() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    getContext() { return realCtx; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    _fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); } };
  return el;
}
function getEl(key) {
  if (!elRegistry.has(key)) { const el = makeEl(key); elRegistry.set(key, el); }
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
        const el = getEl('layer:' + l); el.dataset.layer = l; return el; });
    if (sel === '#gm-ramplabels span') return [makeEl('sp1'), makeEl('sp2'), makeEl('sp3')];
    return []; },
  createElement: (tag) => {
    if (tag === 'canvas') { const c = createCanvas(300, 150); c.style = {}; return c; }
    return makeEl('created:' + tag + ':' + Math.random()); },
  addEventListener() {},
};
global.window = { devicePixelRatio: 3, addEventListener: () => {}, GreenMapCore: null, CaddyElev: null };
global.innerWidth = 390; global.innerHeight = 844;
global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '' };
global.requestAnimationFrame = (fn) => { fn(); return 0; };
const realWarn = console.warn; console.warn = (...a) => {
  if (String(a[0]).includes('no OSM green polygon') ||
      String(a[0]).includes('[CaddyElev]')) return;
  realWarn(...a); };
const LAT = 41.91314, LNG = -93.60971;
const N = 64, SPAN = 40, CS = SPAN / N;
function elevAt(mx, my) {
  const r = Math.hypot(mx, my);
  let z = 12 + 0.05 * mx + 0.10 * my + 0.7 * Math.sin(mx / 9) * Math.cos(my / 7);
  return z;
}
function gridFor(w, s, e, n2, nCells) {
  const cs = SPAN / nCells;
  const W = nCells, H = nCells;
  const grid = new Float32Array(W * H);
  let nVoid = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const mx = (x + 0.5 - W / 2) * cs;
      const my = (H / 2 - y - 0.5) * cs;
      let z = elevAt(mx, my);
      if (WITH_VOIDS) {
        // NaN band: NW arc r in [5.0, 5.75], azimuth 100..170 deg — inside
        // the polygon (r~7), ~1.2 cells wide — mimics LiDAR void slashes.
        const r = Math.hypot(mx, my);
        const az = Math.atan2(my, mx) * 180 / Math.PI;
        if (r > 5.0 && r < 5.75 && az > 100 && az < 170) { z = NaN; nVoid++; }
      }
      grid[y * W + x] = z;
    }
  console.log('[synth] voids injected:', nVoid);
  return { W, H, cellSizeM: cs, grid, validMask: null };
}
global.fetch = async (url) => {
  if (String(url).includes('overpass')) {
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
  throw new Error('unexpected fetch ' + url);
};
require(path.join(__dirname, 'caddy-elev.js'));
global.window.CaddyElev = { fetchElevGrid: async (bb, nCells) => gridFor(bb[0], bb[1], bb[2], bb[3], nCells) };
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (getEl('gm-status').textContent && !getEl('gm-status').textContent.includes('Loading')) break;
  }
  const canvas = getEl('gm-canvas');
  console.log('[synth] status:', getEl('gm-status').textContent, '| voids:', WITH_VOIDS);
  getEl('view:3d')._fire('click');
  await sleep(100);
  const shot = async (name) => {
    const p = path.join(OUTDIR, (WITH_VOIDS ? 'void_' : 'ctrl_') + name + '.png');
    fs.writeFileSync(p, REAL_CANVAS.toBuffer('image/png'));
    console.log('[frame]', p); };
  let cur = { yaw: 0, pitch: 45 };
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
    await sleep(30); cur = { yaw, pitch }; }
  await orbitTo(160, 30); await shot('yaw160_pit30');
  await orbitTo(160, 45); await shot('yaw160_pit45');
  console.log('[synth] done'); process.exit(0);
})().catch(e => { console.error('[synth] FAILED:', e); process.exit(1); });
