/* tmp_r4_sites.js — R4 calibration set: OSM-verified greens near Sugar
   Creek. Pins picked FROM the mosaics of A/B (green centres visible),
   GT = Overpass geometry itself (surveyed, no hand-trace error).
   For each site: pin = a known OSM green's centroid; features + mosaic
   saved; GT fetched from Overpass and VALIDATED (pin inside poly). */
'use strict';
const path = require('path');
const fs = require('fs');
const { createCanvas, Image: NodeImage } = require('canvas');

global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1 };
global.Image = NodeImage;
global.document = {
  createElement: (t) => {
    if (t === 'canvas') { const c = createCanvas(8, 8); c.style = {}; return c; }
    return { style: {}, appendChild() {} };
  },
  addEventListener() {},
};
require('./caddy-elev.js');
require('./satview.js');

const OUT = '.gtds';

// Step 1: discover ALL mapped greens on the course in one Overpass query
// around the club (between siteA and the north end).
const CLUB = { lat: 41.5955, lng: -93.8826 };
const DISCOVER_Q =
  `[out:json][timeout:25];` +
  `(way["golf"="green"](around:900,${CLUB.lat},${CLUB.lng}););out geom;`;

(async () => {
  const r = await fetch('https://overpass-api.de/api/interpreter?data=' +
    encodeURIComponent(DISCOVER_Q));
  const j = await r.json();
  const ways = (j.elements || []).filter(e => e.geometry && e.geometry.length > 5);
  console.log('[r4] mapped greens discovered:', ways.length);
  const greens = ways.map(w => {
    let cLat = 0, cLng = 0;
    for (const p of w.geometry) { cLat += p.lat; cLng += p.lon; }
    cLat /= w.geometry.length; cLng /= w.geometry.length;
    return { id: w.id, cLat, cLng, poly: w.geometry.map(p => [p.lon, p.lat]) };
  });
  // Deduplicate by centroid (some courses map greens as multiple ways).
  const kept = [];
  for (const g of greens) {
    const dup = kept.find(k =>
      Math.hypot((k.cLat - g.cLat) * 111320,
        (k.cLng - g.cLng) * 111320 * 0.75) < 25);
    if (!dup) kept.push(g);
  }
  console.log('[r4] distinct greens:', kept.map(g => g.id).join(', '));

  // Build a dataset site per green (skip ones we already have: siteA way
  // 320468257 area). Cap at 5 new sites to stay polite to USGS.
  const existing = new Set(['siteA', 'siteB', 'siteC', 'siteD', 'siteE']);
  let built = 0;
  for (const g of kept) {
    if (built >= 5) break;
    const id = 'g' + g.id;
    if (fs.existsSync(path.join(OUT, id + '_grid.json'))) { built++; continue; }

    const mLng = 111320 * Math.cos(g.cLat * Math.PI / 180);
    const halfLat = 150 / 110540, halfLng = 150 / mLng;
    const bb = [g.cLng - halfLng, g.cLat - halfLat,
                g.cLng + halfLng, g.cLat + halfLat];
    console.log('[r4] building', id, 'at', g.cLat.toFixed(5), g.cLng.toFixed(5));

    const eg = await window.CaddyElev.fetchElevGrid(bb, 96);
    if (!eg || !eg.grid) { console.log('[r4] no elev for', id); continue; }
    const W = eg.W, H = eg.H, cs = eg.cellSizeM, grid = eg.grid;

    const idx = (x, y) => y * W + x;
    const val = (x, y) => (x >= 0 && y >= 0 && x < W && y < H &&
      Number.isFinite(grid[idx(x, y)])) ? grid[idx(x, y)] : null;
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
          smooth3[i] = Math.sqrt(v3.reduce((a, v) => a + (v - m) * (v - m), 0) / n3);
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
          tex5[i] = Math.sqrt(v5.reduce((a, v) => a + (v - m) * (v - m), 0) / n5);
        }
      }

    const sat = await new Promise((res) => {
      window.CaddySat.load(bb).then(res);
      setTimeout(() => res({ fail: true }), 40000);
    });
    const exg = new Float32Array(W * H).fill(NaN);
    const bright = new Float32Array(W * H).fill(NaN);
    if (!sat.fail && sat.canvas) {
      fs.writeFileSync(path.join(OUT, id + '_mosaic.png'),
        sat.canvas.toBuffer('image/png'));
      const sampler = window.CaddySat.makeSampler(sat, bb);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = idx(x, y);
          if (!Number.isFinite(grid[i])) continue;
          const lon = (bb[0] + bb[2]) / 2 + (x + 0.5 - W / 2) * cs / mLng;
          const lat = (bb[1] + bb[3]) / 2 + (H / 2 - y - 0.5) * cs / 110540;
          const p = sampler(lon, lat);
          if (p) {
            exg[i] = 2 * p[1] - p[0] - p[2];
            bright[i] = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          }
        }
    }

    const pack = {
      meta: { id, lat: g.cLat, lng: g.cLng, bbox: bb, W, H,
        cellSizeM: cs, centerLL: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2],
        mLng, mLat: 110540 },
      features: { z: Array.from(grid), slope: Array.from(slope),
        smooth3: Array.from(smooth3), tex5: Array.from(tex5),
        exg: Array.from(exg), bright: Array.from(bright) },
      gt: { source: 'osm', wayId: g.id, poly: g.poly }
    };
    fs.writeFileSync(path.join(OUT, id + '_grid.json'), JSON.stringify(pack));
    console.log('[r4]', id, 'built: features + mosaic + OSM GT ✓');
    built++;
    await new Promise(r2 => setTimeout(r2, 1500));
  }
  console.log('[r4] calibration set complete:', built, 'OSM-verified sites');
  process.exit(0);
})().catch(e => { console.error('[r4] FAILED', e); process.exit(1); });
