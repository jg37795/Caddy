/* tmp_sawcheck.js — classify the dark triangles in the 128-grid rim fringe:
   background rgb(14,20,17)? wall-body grey (110..72)? ribbon (149,156,151)? */
'use strict';
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const img = await loadImage('.moatfix2/yaw120_pit40_zoom.png');
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const classify = (r, g, b) => {
    if (r < 40 && g < 40 && b < 40) return 'BG';
    if (Math.abs(r - 149) < 12 && Math.abs(g - 156) < 12 && Math.abs(b - 151) < 12) return 'RIBBON';
    if (r >= 60 && r <= 130 && g >= 65 && g <= 135 && b >= 60 && b <= 130 && Math.abs(r - g) < 25) return 'WALL';
    if (g > r + 20 && g > b + 20) return 'SURF-teal';
    if (r > g + 40) return 'SURF-red';
    return `?(${r},${g},${b})`;
  };
  // Right-lower rim fringe (from vision, downscaled ~ (430-520, 950-1090) → x2)
  for (const y of [1940, 1980, 2020, 2060, 2100, 2140]) {
    let row = `y=${y}: `;
    for (let x = 860; x <= 1100; x += 20) {
      const d = cx.getImageData(x, y, 1, 1).data;
      row += `${classify(d[0], d[1], d[2])} `;
    }
    console.log(row);
  }
  // Count dark pixels across the whole fringe band rows 1880..2180, x 700..1160
  let bg = 0, wall = 0, rib = 0, surf = 0, other = 0;
  for (let y = 1880; y <= 2180; y += 4)
    for (let x = 700; x <= 1160; x += 4) {
      const d = cx.getImageData(x, y, 1, 1).data;
      const k = classify(d[0], d[1], d[2]);
      if (k === 'BG') bg++;
      else if (k === 'WALL') wall++;
      else if (k === 'RIBBON') rib++;
      else if (k.startsWith('SURF')) surf++;
      else other++;
    }
  console.log(`band census: BG=${bg} WALL=${wall} RIBBON=${rib} SURF=${surf} OTHER=${other}`);
})();
