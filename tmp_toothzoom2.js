/* TEMP: 3x magnify the tooth zone on the LATEST frame. */
'use strict';
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
(async () => {
  const img = await loadImage('.rimreal35/yaw200_pit35_zoom.png');
  const X = 620, Y = 1330, W = 320, H = 260;
  const c = createCanvas(W * 3, H * 3);
  const x2 = c.getContext('2d');
  x2.imageSmoothingEnabled = false;
  x2.drawImage(img, X, Y, W, H, 0, 0, W * 3, H * 3);
  fs.writeFileSync('.toothzoom2.png', c.toBuffer('image/png'));
  console.log('saved');
})();
