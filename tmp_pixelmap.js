/* TEMP: classify pixels in the cluster region — what is BETWEEN the dashes? */
'use strict';
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
(async () => {
  for (const name of ['A_baseline', 'B_no_arrows']) {
    const img = await loadImage(`.probecluster/${name}.png`);
    const c = createCanvas(380, 300);
    const x2 = c.getContext('2d');
    x2.drawImage(img, 240, 1150, 380, 300, 0, 0, 380, 300);
    const d = x2.getImageData(0, 0, 380, 300).data;
    const counts = { K: 0, G: 0, O: 0, W: 0, T: 0, o: 0 };
    const rows = [];
    for (let y = 0; y < 300; y += 3) {
      let row = '';
      for (let x = 0; x < 380; x += 2) {
        const i = (y * 380 + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let ch;
        if (r < 40 && g < 40 && b < 40) { ch = '.'; counts.K++; }          // near-black bg
        else if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 90) { ch = '#'; counts.G++; } // grey wall
        else if (r > 140 && r > b + 40) { ch = r > 190 ? 'O' : 'o'; counts[r > 190 ? 'O' : 'o']++; } // orange/red
        else if (r > 190 && g > 190 && b > 190) { ch = 'W'; counts.W++; }  // white
        else { ch = ' '; counts.T++; }
        row += ch;
      }
      rows.push(row);
    }
    console.log(`\n=== ${name} ===  counts:`, JSON.stringify(counts));
    console.log(rows.join('\n'));
  }
})();
