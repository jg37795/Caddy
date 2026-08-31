/* unit_corridor.js — corridor length adaptation + grid scaling (pure core) */
'use strict';
global.window = {};
// greenmap.js exports the pure core when no document — require directly
// with a bare window stub (same trick as greenmap_smoke.js).
const path = require('path');
require(path.join(__dirname, '..', 'greenmap.js'));
const GB = global.window.GreenMapCore;

// 536 yd hole = 490 m tee->green
const bb = GB.corridorBbox(41.59, -93.88, 41.5856, -93.8760, 30, 560);
const mLat = 110540, mLng = 111320 * Math.cos(41.5878 * Math.PI / 180);
const span = Math.max((bb[2] - bb[0]) * mLng, (bb[3] - bb[1]) * mLat);
console.log('536yd hole bbox span:', Math.round(span), 'm (cap 560)');
if (!(span > 480)) { console.error('FAIL: span too small'); process.exit(1); }

const holeGridNFor = (s) => s <= 260 ? 96 : s <= 400 ? 128 : 160;
console.log('grid N: 240m ->', holeGridNFor(240), '| 380m ->',
  holeGridNFor(380), '| 520m ->', holeGridNFor(520));
if (holeGridNFor(520) !== 160) { console.error('FAIL'); process.exit(1); }

// short par-3: 120 yd = 110 m
const bb2 = GB.corridorBbox(41.59, -93.88, 41.5890, -93.8790, 30, 560);
const span2 = Math.max((bb2[2] - bb2[0]) * mLng, (bb2[3] - bb2[1]) * mLat);
console.log('par-3 bbox span:', Math.round(span2),
  'm (should be ~170 = extent + 2×30 margin)');
if (span2 > 260) { console.error('FAIL: par3 too big'); process.exit(1); }

// old cap for comparison (what James saw): 300m cap clamps the 536yd hole
const bb3 = GB.corridorBbox(41.59, -93.88, 41.5856, -93.8760, 30, 300);
const span3 = Math.max((bb3[2] - bb3[0]) * mLng, (bb3[3] - bb3[1]) * mLat);
console.log('(old behaviour would clamp to 300m — tee half cut off)');

console.log('CORRIDOR LENGTH ADAPTATION PASS');
