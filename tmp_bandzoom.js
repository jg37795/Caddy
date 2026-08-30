/* TEMP: 4x zoom of the dash band + exact color census. */
'use strict';
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
(async () => {
  const img = await loadImage('.rimreal12/yaw160_pit30.png');
  const X = 320, Y = 1250, W = 240, H = 90;
  const c = createCanvas(W * 4, H * 4);
  const x2 = c.getContext('2d');
  x2.imageSmoothingEnabled = false;
  x2.drawImage(img, X, Y, W, H, 0, 0, W * 4, H * 4);
  fs.writeFileSync('.bandzoom.png', c.toBuffer('image/png'));
  const c2 = createCanvas(W, H);
  const x3 = c2.getContext('2d');
  x3.drawImage(img, X, Y, W, H, 0, 0, W, H);
  const d = x3.getImageData(0, 0, W, H).data;
  const census = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = `${d[i] >> 4},${d[i+1] >> 4},${d[i+2] >> 4}`;
    census.set(key, (census.get(key) || 0) + 1);
  }
  const top = [...census.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log('top color buckets (r16,g16,b16): count');
  for (const [k, v] of top) {
    const [r, g, b] = k.split(',').map(Number);
    console.log(`  rgb(${r*16},${g*16},${b*16})~ : ${v}`);
  }
})();
