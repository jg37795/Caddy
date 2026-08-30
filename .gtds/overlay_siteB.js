// overlay_siteB.js — DET (blue) vs GT (magenta) overlay for siteB
const fs = require('fs');
global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1,
  GreenDetect: { detect: null } };
global.document = { createElement: (t) => ({ style: {}, width: 8, height: 8,
  getContext: () => ({ getImageData: () => ({ data: [0,0,0,255] }) }) }),
  addEventListener() {} };
require('../.gtds/green_detect.js');
(async () => {
  const { createCanvas, loadImage } = require('canvas');
  const pack = JSON.parse(fs.readFileSync('.gtds/siteB_grid.json'));
  const meta = pack.meta;
  const grid = { W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM };
  for (const k of Object.keys(pack.features))
    grid[k] = new Float64Array(pack.features[k]);
  const img = await loadImage('.gtds/siteB_mosaic.png');
  const cc = createCanvas(img.width, img.height);
  const cctx = cc.getContext('2d');
  cctx.drawImage(img, 0, 0);
  const satSample = (lon, lat) => {
    const [w, s0, e, n] = meta.bbox;
    const px = Math.floor((lon - w) / (e - w) * img.width);
    const py = Math.floor((n - lat) / (n - s0) * img.height);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
    const d = cctx.getImageData(px, py, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  };
  const res = global.window.GreenDetect.detect({ grid, satSample });
  const gt = JSON.parse(fs.readFileSync('.gtds/siteB_gt.json'));
  const c2 = createCanvas(img.width, img.height);
  const c2x = c2.getContext('2d');
  c2x.drawImage(img, 0, 0);
  c2x.strokeStyle = '#00c8ff'; c2x.lineWidth = 4;
  c2x.beginPath();
  res.poly.forEach(([mx, my], i) => {
    const lon = (meta.bbox[0] + meta.bbox[2]) / 2 + mx / meta.mLng;
    const lat = (meta.bbox[1] + meta.bbox[3]) / 2 + my / meta.mLat;
    const px = Math.round((lon - meta.bbox[0]) / (meta.bbox[2] - meta.bbox[0]) * img.width);
    const py = Math.round((meta.bbox[3] - lat) / (meta.bbox[3] - meta.bbox[1]) * img.height);
    if (i === 0) c2x.moveTo(px, py); else c2x.lineTo(px, py);
  });
  c2x.closePath(); c2x.stroke();
  c2x.strokeStyle = '#ff2bd6';
  c2x.beginPath();
  gt.polyPx.forEach(([px, py], i) => {
    if (i === 0) c2x.moveTo(px, py); else c2x.lineTo(px, py);
  });
  c2x.closePath(); c2x.stroke();
  fs.writeFileSync('.gtds/siteB_iou_overlay.png', c2.toBuffer('image/png'));
  console.log('siteB overlay saved');
})();
