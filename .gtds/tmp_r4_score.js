/* tmp_r4_score.js — score .gtds/green_detect.js against ALL OSM-verified
   sites (g320468252, g320468257, g320468261, g320468728, g321533712)
   plus siteA. Reports per-site IoU + conf, then the mean. */
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
require('../.gtds/green_detect.js');
const detect = global.window.GreenDetect.detect;

function rasterize(poly, W, H, cs) {
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

(async () => {
  const ids = ['g320468252', 'g320468257', 'g320468261', 'g320468728',
    'g321533712'];
  const results = [];
  const { createCanvas, loadImage } = require('canvas');
  for (const id of ids) {
    const pack = JSON.parse(fs.readFileSync(path.join('.gtds', id + '_grid.json'), 'utf-8'));
    const { meta, gt } = pack;
    const grid = { W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM };
    for (const k of Object.keys(pack.features))
      grid[k] = new Float64Array(pack.features[k]);
    // satellite sampler from the saved mosaic
    let satSample = () => null;
    try {
      const img = await loadImage(path.join('.gtds', id + '_mosaic.png'));
      const cc = createCanvas(img.width, img.height);
      const cctx = cc.getContext('2d');
      cctx.drawImage(img, 0, 0);
      const [w, s0, e, n] = meta.bbox;
      satSample = (lon, lat) => {
        const px = Math.floor((lon - w) / (e - w) * img.width);
        const py = Math.floor((n - lat) / (n - s0) * img.height);
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
        const d = cctx.getImageData(px, py, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
    } catch (e) { /* no mosaic → LiDAR-only path */ }

    const t0 = Date.now();
    const res = detect({ grid, satSample });
    const ms = Date.now() - t0;
    if (!res || !res.poly) {
      console.log(id + ': NULL conf=' + (res && res.confidence));
      results.push({ id, iou: 0 });
      continue;
    }
    const detMask = rasterize(res.poly, meta.W, meta.H, meta.cellSizeM);
    const cx = (meta.bbox[0] + meta.bbox[2]) / 2;
    const cy = (meta.bbox[1] + meta.bbox[3]) / 2;
    const gtLocal = gt.poly.map(([lo, la]) => [
      (lo - cx) * meta.mLng, (la - cy) * meta.mLat]);
    const gtMask = rasterize(gtLocal, meta.W, meta.H, meta.cellSizeM);
    let inter = 0, uni = 0;
    for (let i = 0; i < detMask.length; i++) {
      if (detMask[i] && gtMask[i]) inter++;
      if (detMask[i] || gtMask[i]) uni++;
    }
    const iou = uni ? inter / uni : 0;
    console.log(id + ': IoU ' + iou.toFixed(3) + ' conf ' + res.confidence +
      ' pts ' + res.poly.length + ' ' + ms + 'ms');
    results.push({ id, iou, conf: res.confidence });
  }
  const mean = results.reduce((a, r) => a + r.iou, 0) / results.length;
  const pass = results.filter(r => r.iou >= 0.7).length;
  console.log('MEAN IoU: ' + mean.toFixed(3) + ' | sites >= 0.70: ' +
    pass + '/' + results.length);
})();
