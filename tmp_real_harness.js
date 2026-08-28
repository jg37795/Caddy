/* REAL-DATA harness: boots greenmap.js with REAL Overpass + REAL USGS 3DEP
   fetches (Node 17 --experimental-fetch), renders the ACTUAL "Test green —
   real C" preset through the real render3D at 8x, saves frames. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = process.argv[2] || '.rimreal';
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
// NOTE: no fetch stub — Node 17 --experimental-fetch provides REAL fetch,
// and caddy-elev.js + greenmap.js hit the REAL Overpass/USGS endpoints.
require(path.join(__dirname, 'caddy-elev.js'));
require(path.join(__dirname, 'greenmap.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  // wait for the real boot (Overpass + USGS can take a few seconds)
  let ok = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st && !st.includes('Loading')) { ok = true; break; }
  }
  console.log('[real] status:', getEl('gm-status').textContent, '(booted=' + ok + ')');
  await sleep(1000);
  getEl('view:3d')._fire('click');
  await sleep(300);
  const shot = async (n) => {
    fs.writeFileSync(path.join(OUTDIR, n + '.png'), REAL_CANVAS.toBuffer('image/png'));
    console.log('[real] frame', n);
  };
  await shot('default');
  // v-fix(harness-zoom): James views PINCH-ZOOMED CLOSE (his 22:06 15x shot
  // fills the screen; at harness default dist the rim band is sub-pixel and
  // every artifact hides). Fire N real wheel ticks: dist *= 0.9 per tick,
  // clamped by the app at min 25. 10 ticks ≈ dist 31 from default ~90.
  async function zoomTicks(n) {
    for (let i = 0; i < n; i++) {
      canvas._fire('wheel', { deltaY: -120, preventDefault: () => {} });
      await sleep(8);
    }
    await sleep(80);
  }
  // v-fix(harness-orbit): fire pointer events at the REAL render canvas
  // ('gm-canvas' — where greenmap.js registers its pointerdown/move/up
  // handlers), not the 'view:hole' BUTTON stub, which has no camera
  // listeners. The old target made every "orbited" frame byte-identical to
  // the default view (md5-proven) — glancing-angle verdicts were fake.
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
  await orbitTo(160, 45); await shot('yaw160_pit45');
  await orbitTo(160, 30); await shot('yaw160_pit30');
  await orbitTo(200, 35); await shot('yaw200_pit35');
  // ZOOMED frames — the close-up regime James actually views at. 11 ticks
  // from ~90 lands near dist 25-28 (the clamp), matching his pinch-zoom.
  await zoomTicks(11);
  await shot('yaw200_pit35_zoom');
  await orbitTo(160, 30); await shot('yaw160_pit30_zoom');
  console.log('[real] done');
  process.exit(0);
})().catch(e => { console.error('[real] FAILED', e); process.exit(1); });
