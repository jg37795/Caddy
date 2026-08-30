// trace_crops.js — 4x zoomed, grid-labelled crops for tracing siteC/D/E
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const fs = require('fs');
  // Each site: find the green nearest the mosaic centre; crop 260x170
  // around it with 20px grid. To FIND it, first make a wide 2x crop of
  // the centre region for my eyes.
  for (const id of ['siteC', 'siteD', 'siteE']) {
    const img = await loadImage(`.gtds/${id}_mosaic_grid.png`);
    const c = createCanvas(1100, 760);
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    // wide centre crop: full-res 420x290 centred
    const W = img.width, H = img.height;
    const cw = 420, ch = 290, x0 = (W - cw) / 2, y0 = (H - ch) / 2;
    cx.drawImage(img, x0, y0, cw, ch, 0, 0, 1100, 760);
    cx.strokeStyle = 'rgba(255,255,255,0.5)';
    cx.fillStyle = '#ffe066';
    cx.font = 'bold 15px monospace';
    const sx = cw / 1100, sy = ch / 760;
    for (let gx = 0; gx <= 1100; gx += 50) {
      cx.beginPath(); cx.moveTo(gx, 0); cx.lineTo(gx, 760); cx.stroke();
      cx.fillText(String(Math.round(x0 + gx * sx)), gx + 2, 15);
    }
    for (let gy = 0; gy <= 760; gy += 50) {
      cx.beginPath(); cx.moveTo(0, gy); cx.lineTo(1100, gy); cx.stroke();
      cx.fillText(String(Math.round(y0 + gy * sy)), 2, gy + 17);
    }
    fs.writeFileSync(`.gtds/${id}_centre_wide.png`, c.toBuffer('image/png'));
    console.log('saved', id);
  }
})();
