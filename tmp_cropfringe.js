/* tmp_cropfringe.js — crop the 128-grid fringe (right of Back) at 2x so the
   dark triangles between tabs are classifiable by eye. */
'use strict';
const { createCanvas, loadImage } = require('canvas');
(async () => {
  const img = await loadImage('.bgflood/flood.png');
  const c = createCanvas(500, 500);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  // fringe region around x 880-1130, y 2000-2250 in full res
  cx.drawImage(img, 860, 1990, 460, 300, 0, 0, 920, 600);
  require('fs').writeFileSync('.fringecrop.png', c.toBuffer('image/png'));
  console.log('saved .fringecrop.png');
})();
