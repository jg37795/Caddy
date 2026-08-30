/* tmp_gt_expand.js — build 3 more GT sites (siteC/D/E) around the same
   course for threshold calibration. Same features as the original builder.
   Picks pins offset from A/B to land on DIFFERENT greens. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas, Image: NodeImage } = require('canvas');

global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1 };
global.Image = NodeImage;
global.document = {
  createElement: (t) => {
    if (t === 'canvas') {
      const c = createCanvas(8, 8);
      c.style = {};
      return c;
    }
    return { style: {}, appendChild() {} };
  },
  addEventListener() {},
};
require('./caddy-elev.js');
require('./satview.js');

// Course layout (from siteA/B work): greens run roughly N-S. Place new
// pins on distinct nearby greens — verified visually after build.
const SITES = [
  { id: 'siteC', lat: 41.59580, lng: -93.88210 },
  { id: 'siteD', lat: 41.59230, lng: -93.88260 },
  { id: 'siteE', lat: 41.59720, lng: -93.88220 },
];
const OUT = '.gtds';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SITES) {
    console.log('[gt] === site', s.id, '===');
    const mLng = 111320 * Math.cos(s.lat * Math.PI / 180);
    const halfLat = 150 / 110540, halfLng = 150 / mLng;
    const bb = [s.lng - halfLng, s.lat - halfLat,
                s.lng + halfLng, s.lat + halfLat];

    const eg = await window.CaddyElev.fetchElevGrid(bb, 96);
    if (!eg || !eg.grid) { console.log('[gt] no elev for', s.id); continue; }
    const W = eg.W, H = eg.H, cs = eg.cellSizeM, g = eg.grid;

    const idx = (x, y) => y * W + x;
    const val = (x, y) => (x >= 0 && y >= 0 && x < W && y < H &&
      Number.isFinite(g[idx(x, y)])) ? g[idx(x, y)] : null;
    const slope = new Float32Array(W * H).fill(NaN);
    const smooth3 = new Float32Array(W * H).fill(NaN);
    const tex5 = new Float32Array(W * H).fill(NaN);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        const zc = val(x, y); if (zc === null) continue;
        const zx1 = val(x + 1, y), zx0 = val(x - 1, y);
        const zy1 = val(x, y + 1), zy0 = val(x, y - 1);
        if (zx1 !== null && zx0 !== null && zy1 !== null && zy0 !== null)
          slope[i] = Math.hypot(zx1 - zx0, zy1 - zy0) / (2 * cs) * 100;
        let s3 = 0, n3 = 0, v3 = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const v = val(x + dx, y + dy);
            if (v !== null) { s3 += v; n3++; v3.push(v); }
          }
        if (n3 >= 5) {
          const m = s3 / n3;
          smooth3[i] = Math.sqrt(v3.reduce((a, v) => a + (v - m) * (v - m), 0)
            / n3);
        }
        let s5 = 0, n5 = 0, v5 = [];
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const sv = slope[idx(Math.min(W - 1, Math.max(0, x + dx)),
              Math.min(H - 1, Math.max(0, y + dy)))];
            if (Number.isFinite(sv)) { s5 += sv; n5++; v5.push(sv); }
          }
        if (n5 >= 12) {
          const m = s5 / n5;
          tex5[i] = Math.sqrt(v5.reduce((a, v) => a + (v - m) * (v - m), 0)
            / n5);
        }
      }

    const sat = await new Promise((res) => {
      window.CaddySat.load(bb).then(res);
      setTimeout(() => res({ fail: true }), 40000);
    });
    const exg = new Float32Array(W * H).fill(NaN);
    const bright = new Float32Array(W * H).fill(NaN);
    if (!sat.fail && sat.canvas) {
      fs.writeFileSync(path.join(OUT, s.id + '_mosaic.png'),
        sat.canvas.toBuffer('image/png'));
      const sampler = window.CaddySat.makeSampler(sat, bb);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = idx(x, y);
          if (!Number.isFinite(g[i])) continue;
          const lon = (bb[0] + bb[2]) / 2 + (x + 0.5 - W / 2) * cs / mLng;
          const lat = (bb[1] + bb[3]) / 2 + (H / 2 - y - 0.5) * cs / 110540;
          const p = sampler(lon, lat);
          if (p) {
            exg[i] = 2 * p[1] - p[0] - p[2];
            bright[i] = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          }
        }
      const gcan = createCanvas(sat.w, sat.h);
      const g2 = gcan.getContext('2d');
      g2.drawImage(sat.canvas, 0, 0);
      g2.strokeStyle = 'rgba(255,255,255,0.5)';
      g2.fillStyle = '#ffe066';
      g2.font = 'bold 16px sans-serif';
      for (let gx = 0; gx < sat.w; gx += 40) {
        g2.beginPath(); g2.moveTo(gx, 0); g2.lineTo(gx, sat.h); g2.stroke();
        g2.fillText(String(gx), gx + 2, 16);
      }
      for (let gy = 0; gy < sat.h; gy += 40) {
        g2.beginPath(); g2.moveTo(0, gy); g2.lineTo(sat.w, gy); g2.stroke();
        g2.fillText(String(gy), 2, gy + 18);
      }
      fs.writeFileSync(path.join(OUT, s.id + '_mosaic_grid.png'),
        gcan.toBuffer('image/png'));
    } else {
      console.log('[gt] mosaic FAILED for', s.id);
    }

    const pack = {
      meta: { id: s.id, lat: s.lat, lng: s.lng, bbox: bb, W, H,
        cellSizeM: cs, centerLL: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2],
        mLng, mLat: 110540 },
      features: {
        z: Array.from(g), slope: Array.from(slope),
        smooth3: Array.from(smooth3), tex5: Array.from(tex5),
        exg: Array.from(exg), bright: Array.from(bright)
      },
      gt: null   // traced next step
    };
    fs.writeFileSync(path.join(OUT, s.id + '_grid.json'),
      JSON.stringify(pack));
    console.log('[gt]', s.id, 'grid', W + 'x' + H,
      'mosaic', sat.fail ? 'FAILED' : 'ok');
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log('[gt] expansion complete — now trace C/D/E from the grid images');
  process.exit(0);
})().catch(e => { console.error('[gt] FAILED', e); process.exit(1); });
