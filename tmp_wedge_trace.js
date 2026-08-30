/* tmp_wedge_trace.js — instrument drawWallRibbon + lipStroke to log every
   primitive whose screen bbox covers the wedge pixel box, plus the surface
   quads covering it. Numbers, not screenshots. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = '.wedgetrace';
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

// Wedge pixel box (full-res canvas coords) from the pixel-grid scan:
const BX = [884, 912], BY = [1992, 2008];
const hits = { ribbon: [], lip: [], surf: [] };

// 1) Ribbon: wrap the ctx used by greenmap? Simpler: patch fill on the
// realCtx to record fill() calls with their current path bounds + fillStyle.
const origFill = realCtx.fill.bind(realCtx);
// device -> user coords (the app runs the ctx under a scale(dpr) transform)
const toUser = (px, py) => {
  try {
    const t = realCtx.getTransform();
    const inv = t.inverse ? t.inverse() : t;
    return [px * inv.a + py * inv.c + inv.e, px * inv.b + py * inv.d + inv.f];
  } catch (e) { return [px, py]; }
};
const boxPts = [[888, 1998], [898, 2000], [908, 2002], [894, 1994], [902, 1996]];
realCtx.fill = function (...a) {
  try {
    const st = this.fillStyle;
    let inside = 0;
    for (const [dx, dy] of boxPts) {
      const [ux, uy] = toUser(dx, dy);
      if (this.isPointInPath(ux, uy)) inside++;
    }
    if (inside >= 2) {
      const key = typeof st === 'string' ? st : 'grad';
      hits[key.startsWith('rgb(255') || key === 'rgba(150,158,152,0.98)' ? 'ribbon'
        : key.startsWith('rgb(0,') ? 'lip' : 'other:' + key].push(inside);
    }
  } catch (e) {}
  return origFill(...a);
};
const origStroke = realCtx.stroke.bind(realCtx);
realCtx.stroke = function (...a) {
  try {
    const st = this.strokeStyle;
    let inside = 0;
    for (const [dx, dy] of boxPts) {
      const [ux, uy] = toUser(dx, dy);
      if (this.isPointInStroke(ux, uy)) inside++;
    }
    if (inside >= 1 && typeof st === 'string')
      hits.lip.push('stroke:' + st + 'x' + inside);
  } catch (e) {}
  return origStroke(...a);
};
// 2) Surface quads: they fill with rgb(...) strings too; classify by colour
//    pattern: teal/red fills — record separately below by checking the
//    fillStyle source. We tag by intercepting set fillStyle on surface:
// too invasive; instead AFTER the render, we just report what painted the box.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let ok = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st.includes('mean slope') || st.toLowerCase().includes('failed')) { ok = true; break; }
  }
  await sleep(800);
  getEl('view:3d')._fire('click');
  await sleep(200);
  getEl('gm-exag').value = '15';
  getEl('gm-exag')._fire('input');
  await sleep(400);
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
  for (let i = 0; i < 11; i++) { canvas._fire('wheel', { deltaY: -120, preventDefault: () => {} }); await sleep(8); }
  await sleep(100);
  await orbitTo(120, 40);
  await sleep(300);
  // Record across a real 60-degree sweep (zero-delta drag renders nothing).
  hits.ribbon = []; hits.lip = []; hits.surf = [];
  await orbitTo(90, 40);
  await orbitTo(150, 40);
  await orbitTo(120, 40);
  await sleep(300);
  console.log('[trace] paint hits in wedge box:', JSON.stringify(hits, null, 1).slice(0, 2000));
  // and the pixel state
  const d = realCtx.getImageData(896, 2000, 1, 1).data;
  console.log('[trace] wedge pixel now:', d[0], d[1], d[2]);
  process.exit(0);
})().catch(e => { console.error('[trace] FAILED', e); process.exit(1); });
