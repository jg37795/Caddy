/* tmp_sawcheck2.js — dump the distinct colours in the near-rim fringe band
   where the dark triangles sit (right side near Back, 128-grid frame). */
'use strict';
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const img = await loadImage('.moatfix2/yaw120_pit40_zoom.png');
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const counts = new Map();
  for (let y = 1980; y <= 2200; y += 2)
    for (let x = 880; x <= 1130; x += 2) {
      const d = cx.getImageData(x, y, 1, 1).data;
      const key = `${d[0]},${d[1]},${d[2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('top colours in fringe band (count, rgb):');
  for (const [k, v] of sorted.slice(0, 24)) console.log(String(v).padStart(6), ' ', k);
  // specifically: how many near-background (sum < 90)?
  let dark = 0, tot = 0;
  for (const [k, v] of counts) {
    const [r, g, b] = k.split(',').map(Number);
    tot += v;
    if (r + g + b < 90) dark += v;
  }
  console.log(`\nnear-black pixels: ${dark}/${tot} (${(100 * dark / tot).toFixed(1)}%)`);
})();
