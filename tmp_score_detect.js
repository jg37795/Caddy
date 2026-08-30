/* tmp_score_detect.js — verify Grok's detectGreen against ground truth.
   Usage: node --experimental-fetch tmp_score_detect.js
   Scores IoU between the detected polygon and GT for siteA (OSM) and
   siteB (traced). PASS bar: A >= 0.75, B >= 0.70. */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1,
  GreenDetect: { detect: null } };
global.document = {
  createElement: (t) => {
    if (t === 'canvas') { const c = { style: {}, width: 8, height: 8,
      getContext: () => ({ getImageData: () => ({ data: [0,0,0,255] }) }) };
      return c; }
    return { style: {}, appendChild() {} };
  },
  addEventListener() {},
};
require('./.gtds/green_detect.js');
const detect = global.window.GreenDetect.detect;

function rasterize(poly, W, H, cs) {
  // rasterize polygon to a mask (point-in-poly per cell centre)
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const mx = (x + 0.5 - W / 2) * cs;
      const my = (H / 2 - y - 0.5) * cs;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (((yi > my) !== (yj > my)) &&
            (mx < (xj - xi) * (my - yi) / (yj - yi) + xi)) inside = !inside;
      }
      mask[y * W + x] = inside ? 1 : 0;
    }
  return mask;
}

function gtPolyToLocal(gt, meta, satW, satH) {
  // GT poly is lon/lat -> local metres (origin = grid centre)
  const cx = (meta.bbox[0] + meta.bbox[2]) / 2;
  const cy = (meta.bbox[1] + meta.bbox[3]) / 2;
  return gt.poly.map(([lon, lat]) => [
    (lon - cx) * meta.mLng,
    (lat - cy) * meta.mLat
  ]);
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni ? inter / uni : 0;
}

(async () => {
  const results = [];
  for (const id of ['siteA', 'siteB']) {
    const pack = JSON.parse(fs.readFileSync(
      path.join('.gtds', id + '_grid.json'), 'utf-8'));
    const gt = JSON.parse(fs.readFileSync(
      path.join('.gtds', id + '_gt.json'), 'utf-8'));
    const { meta } = pack;
    const grid = {
      W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM
    };
    for (const k of Object.keys(pack.features))
      grid[k] = new Float64Array(pack.features[k]);
    const satW = 1343, satH = 1353;
    const satSample = (lon, lat) => {
      // sample from the saved mosaic PNG via canvas (approximate nearest)
      if (!global.__mosaic || global.__mosaicId !== id) return null;
      const [w, s0, e, n] = meta.bbox;
      const px = Math.floor((lon - w) / (e - w) * satW);
      const py = Math.floor((n - lat) / (n - s0) * satH);
      if (px < 0 || py < 0 || px >= satW || py >= satH) return null;
      const d = global.__mosaicCtx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    };
    // load mosaic into memory for the sampler
    try {
      const { createCanvas, loadImage } = require('canvas');
      const img = await loadImage(path.join('.gtds', id + '_mosaic.png'));
      const cc = createCanvas(img.width, img.height);
      const cctx = cc.getContext('2d');
      cctx.drawImage(img, 0, 0);
      global.__mosaic = cc; global.__mosaicCtx = cctx;
      global.__mosaicId = id;
    } catch (e) { global.__mosaic = null; }

    const t0 = Date.now();
    const res = detect({ grid, satSample });
    const ms = Date.now() - t0;
    if (!res || !res.poly) {
      console.log(id + ': NULL (conf=' + (res && res.confidence) + ')',
        ms + 'ms');
      results.push({ id, iou: 0, ms });
      continue;
    }
    const detMask = rasterize(res.poly, meta.W, meta.H, meta.cellSizeM);
    const gtLocal = gtPolyToLocal(gt, meta, satW, satH);
    const gtMask = rasterize(gtLocal, meta.W, meta.H, meta.cellSizeM);
    const score = iou(detMask, gtMask);
    console.log(id + ': IoU ' + score.toFixed(3) +
      ' conf ' + res.confidence + ' pts ' + res.poly.length +
      ' ' + ms + 'ms');
    results.push({ id, iou: score, conf: res.confidence, ms });
  }
  const A = results.find(r => r.id === 'siteA');
  const B = results.find(r => r.id === 'siteB');
  let pass = true;
  if (!A || A.iou < 0.75) { console.log('FAIL siteA (need >= 0.75)'); pass = false; }
  if (!B || B.iou < 0.70) { console.log('FAIL siteB (need >= 0.70)'); pass = false; }
  console.log(pass ? 'ALL PASS — grok fn accepted' : 'BELOW BAR — iterate');
  process.exit(pass ? 0 : 1);
})();
