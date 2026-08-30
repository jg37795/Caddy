// run_both.js — quick harness for both sites
global.window = { addEventListener: () => {}, GreenMapCore: null,
  CaddyElev: null, CaddySat: null, devicePixelRatio: 1,
  GreenDetect: { detect: null } };
global.document = { createElement: (t) => ({ style: {}, width: 8, height: 8,
  getContext: () => ({ getImageData: () => ({ data: [0,0,0,255] }) }) }),
  addEventListener() {} };
require('../.gdd27.js');
const fs = require('fs');
for (const id of ['siteA', 'siteB']) {
  const pack = JSON.parse(fs.readFileSync('.gtds/' + id + '_grid.json'));
  const meta = pack.meta;
  const grid = { W: meta.W, H: meta.H, cellSizeM: meta.cellSizeM };
  for (const k of Object.keys(pack.features))
    grid[k] = new Float64Array(pack.features[k]);
  const res = global.window.GreenDetect.detect({ grid, satSample: () => null });
  console.log(id + ':', res === null ? 'NULL'
    : 'conf ' + res.confidence + ' pts ' + res.poly.length);
}
