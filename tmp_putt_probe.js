/* tmp_putt_probe.js — drop a ball (Ball button + tap), capture the solved
   makeable putt line + the status readout at 15x on the real green. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.puttprobe';
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st.includes('mean slope') || st.toLowerCase().includes('failed')) break;
  }
  await sleep(800);
  getEl('view:3d')._fire('click');
  await sleep(200);
  getEl('gm-exag').value = '15';
  getEl('gm-exag')._fire('input');
  await sleep(400);
  // Arm the ball, then tap mid-green (down+up, no move = tap).
  getEl('gm-ball')._fire('click');
  await sleep(100);
  const canvas = getEl('gm-canvas');
  // Far corner tap: max distance from the centre pin for a long breaker.
  canvas._fire('pointerdown', { pointerId: 1, clientX: 150, clientY: 420 });
  await sleep(20);
  canvas._fire('pointerup', { pointerId: 1, clientX: 150, clientY: 420 });
  await sleep(1500);
  console.log('[putt] status after tap:', getEl('gm-status').textContent);
  fs.writeFileSync(path.join(OUTDIR, 'putt3d.png'), REAL_CANVAS.toBuffer('image/png'));
  // Also change stimp to 12 and re-tap to confirm the line/status reacts.
  // zoom in for a close-up of the line
  for (let i = 0; i < 7; i++) { canvas._fire('wheel', { deltaY: -120, preventDefault: () => {} }); await sleep(8); }
  await sleep(150);
  fs.writeFileSync(path.join(OUTDIR, 'putt3d_zoom.png'), REAL_CANVAS.toBuffer('image/png'));
  console.log('[putt] done');
  process.exit(0);
})().catch(e => { console.error('[putt] FAILED', e); process.exit(1); });
