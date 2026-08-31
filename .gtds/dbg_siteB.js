// dbg_siteB.js — instrument siteB's component filters
const fs = require('fs');
global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1,
  GreenDetect: { detect: null } };
global.document = { createElement: (t) => ({ style: {}, width: 8, height: 8,
  getContext: () => ({ getImageData: () => ({ data: [0,0,0,255] }) }) }),
  addEventListener() {} };
let src = fs.readFileSync('.gdd38.js', 'utf-8');
src = src.replace(
  'if (maxx - minx < 8 || maxy - miny < 8) continue;',
  'console.log("COMP area", area.toFixed(0), "cd", cd.toFixed(1), ' +
  '"contains", contains, "bbox", (maxx-minx).toFixed(0) + "x" + (maxy-miny).toFixed(0)); ' +
  'if (maxx - minx < 8 || maxy - miny < 8) continue;');
// write the instrumented module and require it
fs.writeFileSync('.gtds/.dbg38.js', src);
require('../.gtds/.dbg38.js');
const pack = JSON.parse(fs.readFileSync('.gtds/siteB_grid.json'));
const meta = pack.meta;
const grid = { W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM };
for (const k of Object.keys(pack.features))
  grid[k] = new Float64Array(pack.features[k]);
try {
  const res = global.window.GreenDetect.detect({ grid, satSample: () => null });
  console.log('siteB result:', res === null ? 'NULL' : 'conf ' + res.confidence);
} catch (e) {
  console.log('ERR', e.message);
}
