/* tmp_moat_pixels.js — scanline colour probe across the moat in
   .moatfix1/yaw120_pit40_zoom.png: what exactly is the black band?
   background (unpainted, grid lines visible) vs painted dark grey (wall). */
'use strict';
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const img = await loadImage('.moatfix1/yaw120_pit40_zoom.png');
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  // The moat in the downscaled vision view was around (250-460, 1000-1100)
  // at scale 585/1170 -> full-res x2: rows 1950-2200, cols 500-920.
  for (const y of [1990, 2030, 2070, 2110, 2150]) {
    let row = `y=${y}: `;
    for (let x = 480; x <= 960; x += 40) {
      const d = cx.getImageData(x, y, 1, 1).data;
      row += `[${x}]rgb(${d[0]},${d[1]},${d[2]}) `;
    }
    console.log(row);
  }
  // Also vertical scan through the worst staircase area (from vision: gap near x~660)
  for (const x of [600, 660, 720]) {
    let col = `x=${x}: `;
    for (let y = 1950; y <= 2210; y += 20) {
      const d = cx.getImageData(x, y, 1, 1).data;
      col += `[${y}]${d[0]},${d[1]},${d[2]} `;
    }
    console.log(col);
  }
})();
