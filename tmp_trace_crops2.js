// trace_crops2.js — re-crop siteD (green near 614,612?) and siteE (edge
// green) tighter, plus siteC trace verification crop
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const fs = require('fs');
  const jobs = [
    // id, x0, y0, w, h (full-res), out scale
    ['siteC_verify', 470, 680, 110, 100],
    ['siteD_zoom', 560, 560, 130, 110],
    ['siteE_left', 452, 620, 110, 200],
  ];
  for (const [id, x0, y0, cw, ch] of jobs) {
    const img = await loadImage(`.gtds/${id.split('_')[0]}_mosaic_grid.png`);
    const scale = Math.min(1100 / cw, 1100 / ch);
    const c = createCanvas(Math.round(cw * scale), Math.round(ch * scale));
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(img, x0, y0, cw, ch, 0, 0, c.width, c.height);
    cx.strokeStyle = 'rgba(255,255,255,0.5)';
    cx.fillStyle = '#ffe066';
    cx.font = 'bold 14px monospace';
    const sx = cw / c.width, sy = ch / c.height;
    for (let gx = 0; gx <= c.width; gx += 80) {
      cx.beginPath(); cx.moveTo(gx, 0); cx.lineTo(gx, c.height); cx.stroke();
      cx.fillText(String(Math.round(x0 + gx * sx)), gx + 2, 14);
    }
    for (let gy = 0; gy <= c.height; gy += 80) {
      cx.beginPath(); cx.moveTo(0, gy); cx.lineTo(c.width, gy); cx.stroke();
      cx.fillText(String(Math.round(y0 + gy * sy)), 2, gy + 15);
    }
    fs.writeFileSync(`.gtds/${id}.png`, c.toBuffer('image/png'));
    console.log('saved', id);
  }
})();
