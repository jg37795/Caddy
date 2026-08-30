/* TEMP probe: what IS the Front-left orange cluster?
   Frames: A) arrows OFF B) 1x C) layer=arrows D) baseline. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.probecluster';
fs.mkdirSync(OUTDIR, { recursive: true });
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
global.requestAnimationFrame = (fn) => setImmediate(fn);
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st && !st.includes('Loading')) break;
  }
  await sleep(1000);
  getEl('view:3d')._fire('click');
  await sleep(300);
  const canvas = getEl('gm-canvas');
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
    await sleep(50); cur = { yaw, pitch };
  }
  const shot = async (n) => {
    fs.writeFileSync(path.join(OUTDIR, n + '.png'), REAL_CANVAS.toBuffer('image/png'));
    console.log('[probe] frame', n);
  };
  await orbitTo(160, 30);
  // A: baseline (arrows Both, 8x)
  await shot('A_baseline');
  // B: layer=shading (no arrows at all)
  getEl('layer:shading')._fire('click');
  await sleep(120);
  await shot('B_no_arrows');
  // C: back to both, exag 1x
  getEl('layer:both')._fire('click');
  const exagEl = getEl('gm-exag');
  exagEl.value = '1'; exagEl._fire('input');
  await sleep(120);
  await shot('C_exag1');
  // D: 8x again for reference
  exagEl.value = '8'; exagEl._fire('input');
  await sleep(120);
  await shot('D_exag8');
  console.log('[probe] done');
  process.exit(0);
})().catch(e => { console.error('[probe] FAILED', e); process.exit(1); });
