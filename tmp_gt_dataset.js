/* tmp_gt_dataset.js — Build the Grok ground-truth dataset for auto-green
   detection. Two real sites (Westwood area, Newton IA):
     siteA 41.59362,-93.88235  OSM-mapped green  → GT = Overpass polygon
     siteB 41.59463,-93.88236  green ~100m north → GT = manual (vision trace)
   Per site saves:
     .gtds/<id>_grid.json   96x96 LiDAR + per-cell features (z, slope,
                            smooth3, tex5) in local metres
     .gtds/<id>_mosaic.png  satellite mosaic (real Esri tiles)
     .gtds/<id>_gt.json     ground-truth polygon (lon/lat) + provenance
     .gtds/<id>_mosaic_grid.png  mosaic with 20px coord grid burned in
   Feature computation is MINE (cheap); Grok only writes the segmentation
   function that consumes the JSON. */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');

global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1 };
const { Image: NodeImage } = require('canvas');
global.Image = NodeImage;   // satview's loader uses new Image()
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

const SITES = [
  { id: 'siteA', lat: 41.59362, lng: -93.88235, gt: 'osm' },
  { id: 'siteB', lat: 41.59463, lng: -93.88236, gt: 'manual' },
];
const OUT = '.gtds';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SITES) {
    console.log('[gt] === site', s.id, '===');
    const mLng = 111320 * Math.cos(s.lat * Math.PI / 180);
    const halfLat = 150 / 110540, halfLng = 150 / mLng;
    const bb = [s.lng - halfLng, s.lat - halfLat,
                s.lng + halfLng, s.lat + halfLat];

    // ---- LiDAR grid (real USGS 3DEP) ----
    const eg = await window.CaddyElev.fetchElevGrid(bb, 96);
    if (!eg || !eg.grid) { console.log('[gt] no elev for', s.id); continue; }
    const W = eg.W, H = eg.H, cs = eg.cellSizeM, g = eg.grid;

    // ---- per-cell features (my code, deterministic) ----
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
        // smooth3: std of z in 3x3
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
        // tex5: std of slope in 5x5
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

    // ---- satellite mosaic (real Esri tiles) ----
    const sat = await new Promise((res) => {
      window.CaddySat.load(bb).then(res);
      setTimeout(() => res({ fail: true }), 40000);
    });
    let exg = new Float32Array(W * H).fill(NaN);
    let bright = new Float32Array(W * H).fill(NaN);
    if (!sat.fail && sat.canvas) {
      const mosaicPng = sat.canvas.toBuffer('image/png');
      fs.writeFileSync(path.join(OUT, s.id + '_mosaic.png'), mosaicPng);
      const sampler = window.CaddySat.makeSampler(sat, bb);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = idx(x, y);
          if (!Number.isFinite(g[i])) continue;
          const lon = (bb[0] + bb[2]) / 2 + (x + 0.5 - W / 2) * cs / mLng;
          const lat = (bb[1] + bb[3]) / 2 + (H / 2 - y - 0.5) * cs / 110540;
          const p = sampler(lon, lat);
          if (p) {
            exg[i] = 2 * p[1] - p[0] - p[2];           // excess green
            bright[i] = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          }
        }
      // burn a coordinate grid onto a copy for manual GT tracing
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
    }

    // ---- ground truth: OSM polygon for siteA (real Overpass) ----
    let gt = null;
    if (s.gt === 'osm') {
      const q = `[out:json][timeout:15];` +
        `(way["golf"="green"](around:80,${s.lat},${s.lng}););out geom;`;
      const r = await fetch('https://overpass-api.de/api/interpreter?data=' +
        encodeURIComponent(q));
      const j = await r.json();
      const ways = (j.elements || []).filter(e => e.geometry);
      if (ways.length) {
        // pick the biggest by vertex count (the true green, not a neighbour)
        const w = ways.sort((a, b) =>
          b.geometry.length - a.geometry.length)[0];
        gt = { source: 'osm', wayId: w.id,
          poly: w.geometry.map(p => [p.lon, p.lat]) };
      }
    } else {
      gt = { source: 'manual-vision', poly: null };  // traced next step
    }

    const pack = {
      meta: { id: s.id, lat: s.lat, lng: s.lng, bbox: bb, W, H,
        cellSizeM: cs, centerLL: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2],
        mLng, mLat: 110540 },
      features: {
        z: Array.from(g),
        slope: Array.from(slope),
        smooth3: Array.from(smooth3),
        tex5: Array.from(tex5),
        exg: Array.from(exg),
        bright: Array.from(bright)
      },
      gt
    };
    fs.writeFileSync(path.join(OUT, s.id + '_grid.json'),
      JSON.stringify(pack));
    fs.writeFileSync(path.join(OUT, s.id + '_gt.json'),
      JSON.stringify(gt));
    const finite = g.filter(Number.isFinite).length;
    console.log('[gt]', s.id, 'grid', W + 'x' + H, 'valid', finite,
      '| mosaic', sat.fail ? 'FAILED' : sat.w + 'x' + sat.h,
      '| gt', gt ? gt.source + (gt.poly ? ' (' + gt.poly.length + 'pts)' : ' (pending)') : 'none');
    await sleep(1500);   // be polite to USGS/Overpass
  }
  console.log('[gt] dataset build complete');
  process.exit(0);
})().catch(e => { console.error('[gt] FAILED', e); process.exit(1); });
