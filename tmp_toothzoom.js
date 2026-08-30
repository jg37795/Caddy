/* TEMP: 5x magnify the tooth region + exact pixel census per tooth. */
'use strict';
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
(async () => {
  const img = await loadImage('.rimreal31/yaw200_pit35_zoom.png');
  // Tooth zone: bottom-right of the surface (from vision: ~x 640-900, y 1350-1560 in 1170x2532)
  const X = 620, Y = 1330, W = 320, H = 260;
  const c = createCanvas(W * 3, H * 3);
  const x2 = c.getContext('2d');
  x2.imageSmoothingEnabled = false;
  x2.drawImage(img, X, Y, W, H, 0, 0, W * 3, H * 3);
  fs.writeFileSync('.toothzoom.png', c.toBuffer('image/png'));
  console.log('saved .toothzoom.png');
})();
