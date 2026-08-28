/* tmp_moat_probe.js — reproduce James's img_9406db27a88a moat exactly:
   his badge read "±0.6 m/cell · 100% valid" = the 64-cell FALLBACK grid.
   Force the 128 fetch to fail (his exact picker-64-fallback path), log
   buildMesh3D's clip-polygon presence, render his style of camera. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const OUTDIR = process.argv[2] || '.moatprobe';
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
// FORCE James's path: 128 fetch fails -> 64 fallback. Wrap AFTER require.
// FORCE64=0 -> let the 128 fetch through (primary-path verification).
{
  const orig = global.window.CaddyElev.fetchElevGrid;
  global.window.CaddyElev.fetchElevGrid = (bbox, n, ...rest) => {
    if (n >= 128 && process.env.FORCE64 !== '0') {
      console.log('[probe] FORCING 128-fetch failure -> 64 fallback (James path)');
      return Promise.reject(new Error('forced-128-fail'));
    }
    return orig(bbox, n, ...rest);
  };
}
require(path.join(__dirname, 'greenmap.js'));
// Instrument buildMesh3D: did it get the clip polygon? what grid size?
{
  const core = global.window.GreenMapCore;
  const orig = core.buildMesh3D;
  core.buildMesh3D = (grid, W, H, cs, mask, range, exag, mode, opts) => {
    const nPoly = opts && opts.polyLocalM ? opts.polyLocalM.length : null;
    let msum = 0; if (mask) for (let i = 0; i < mask.length; i++) msum += mask[i] ? 1 : 0;
    console.log(`[probe] buildMesh3D W=${W} cell=${cs.toFixed(4)} mask=${msum} polyLocalM=${nPoly} exag=${exag}`);
    if (nPoly !== null && nPoly < 3) console.log('[probe] !! polyLocalM EMPTY — clip disabled');
    return orig(grid, W, H, cs, mask, range, exag, mode, opts);
  };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let ok = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const st = getEl('gm-status').textContent || '';
    if (st.includes('mean slope') || st.includes('ridge') ||
        st.toLowerCase().includes('failed')) { ok = true; break; }
  }
  console.log('[probe] status:', getEl('gm-status').textContent, '(booted=' + ok + ')');
  await sleep(1000);
  getEl('view:3d')._fire('click');
  await sleep(300);
  const shot = async (n) => {
    fs.writeFileSync(path.join(OUTDIR, n + '.png'), REAL_CANVAS.toBuffer('image/png'));
    console.log('[probe] frame', n);
  };
  await shot('default');
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
  async function zoomTicks(n) {
    for (let i = 0; i < n; i++) {
      canvas._fire('wheel', { deltaY: -120, preventDefault: () => {} });
      await sleep(8);
    }
    await sleep(80);
  }
  // James's shot: 15x exaggeration (fire the REAL slider listener), then
  // his style of camera — glancing-ish, zoomed, red face + wall at lower left
  getEl('gm-exag').value = '15';
  getEl('gm-exag')._fire('input');
  await sleep(300);
  console.log('[probe] exag now:', (() => { try { return getEl('gm-exag-val').textContent; } catch (e) { return 'n/a'; } })());
  await orbitTo(160, 45); await shot('yaw160_pit45');
  await orbitTo(160, 30); await shot('yaw160_pit30');
  await orbitTo(200, 35); await shot('yaw200_pit35');
  await orbitTo(120, 40); await shot('yaw120_pit40');
  await zoomTicks(11);
  await shot('yaw200_pit35_zoom');
  await orbitTo(160, 30); await shot('yaw160_pit30_zoom');
  await orbitTo(120, 40); await shot('yaw120_pit40_zoom');
  console.log('[probe] done');
  process.exit(0);
})().catch(e => { console.error('[probe] FAILED', e); process.exit(1); });
