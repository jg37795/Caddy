// dbg41.js — run .gdd41 against siteB (it has chosen-cell + score prints)
global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1,
  GreenDetect: { detect: null } };
global.document = { createElement: (t) => ({ style: {}, width: 8, height: 8,
  getContext: () => ({ getImageData: () => ({ data: [0,0,0,255] }) }) }),
  addEventListener() {} };
require('../.gdd41.js');
const fs = require('fs');
const pack = JSON.parse(fs.readFileSync('.gtds/siteB_grid.json'));
const meta = pack.meta;
const grid = { W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM };
for (const k of Object.keys(pack.features))
  grid[k] = new Float64Array(pack.features[k]);
const res = global.window.GreenDetect.detect({ grid, satSample: () => null });
console.log('[dbg] siteB result:', res === null ? 'NULL' : 'conf ' + res.confidence);
