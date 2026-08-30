/* TEMP: objective dip-band comparison: black-pixel count between rim dashes and wall top. */
'use strict';
const { createCanvas, loadImage } = require('canvas');
(async () => {
  for (const f of ['.probecluster/A_baseline.png', '.rimreal12/yaw160_pit30.png', '.rimreal12/default.png']) {
    const img = await loadImage(f);
    const c = createCanvas(380, 300);
    const x2 = c.getContext('2d');
    x2.drawImage(img, 240, 1150, 380, 300, 0, 0, 380, 300);
    const d = x2.getImageData(0, 0, 380, 300).data;
    // Dip band: the rows where the orange dashes + gaps live (crop y 90..170)
    let black = 0, orange = 0, tot = 0;
    for (let y = 90; y < 170; y++)
      for (let x = 30; x < 220; x++) {
        const i = (y * 380 + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        tot++;
        if (r < 40 && g < 40 && b < 40) black++;
        else if (r > 140 && r > b + 40) orange++;
      }
    console.log(f, '-> black:', black, 'orange:', orange, 'of', tot);
  }
})();
