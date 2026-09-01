/* r6_verify_mask.js — coordinator's OWN check of R6-D2 (not Grok's script):
   corridorMaskRect must shrink a square mesh to the oriented corridor.
   Pure core, no jsdom. */
'use strict';
global.window = {};
require('../greenmap.js');
const GB = global.window.GreenMapCore;

// Synthetic 40x40 grid, 10 m cells (400 m square), valid everywhere.
const W = 40, H = 40, cs = 10;
const grid = new Float32Array(W * H).fill(100);
const eg = { grid, W, H, cellSizeM: cs, validMask: null };

// Tee at grid-local (-150, -100), green at (+150, +100) → diagonal axis.
// centreLL is grid centre in lat/lng; use a fake anchor and express
// tee/green as lat/lng offsets from centreLL (metres / 111320 etc).
const centerLL = [41.95, -93.75];
const mLat = 110540, mLng = 111320 * Math.cos(41.95 * Math.PI / 180);
const ll = (ex, ey) => ({ lat: centerLL[1] === undefined ? 0 : centerLL[1] + ey / mLat * 0, lng: 0 });
// Simpler: build lat/lng from EN offsets directly.
const toLL = (ex, ey) => ({ lat: 41.95 + ey / mLat, lng: -93.75 + ex / mLng });

const tee = toLL(-150, -100), green = toLL(150, 100);
// NOTE: ds.centerLL is [lng, lat] (bb is [w,s,e,n] → [(w+e)/2, (s+n)/2]).
const mask = GB.corridorMaskRect(eg, [-93.75, 41.95], green, tee, 30, 50);

let n = 0;
for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
console.log('cells kept:', n, 'of', W * H, '(' + (100 * n / (W * H)).toFixed(1) + '%)');
if (n === 0) { console.error('FAIL: mask kept NOTHING — check sign conventions'); process.exit(1); }
if (n >= W * H) { console.error('FAIL: mask kept everything'); process.exit(1); }

// Perpendicular half-width: cells far off-axis must be excluded.
// Axis unit u = (300, 200)/L, L = 360.6; perpendicular p = (-uy, ux).
const L = Math.hypot(300, 200);
const ux = 300 / L, uy = 200 / L;
let maxPerp = 0, maxAlong = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    const mx = (x + 0.5 - W / 2) * cs;
    const my = (H / 2 - y - 0.5) * cs;
    const dx = mx - 0, dy = my - 0;   // rect centre = grid centre (sym)
    const along = dx * ux + dy * uy;
    const perp = Math.abs(dx * -uy + dy * ux);
    if (perp > maxPerp) maxPerp = perp;
    if (Math.abs(along) > maxAlong) maxAlong = Math.abs(along);
  }
console.log('max perpendicular:', maxPerp.toFixed(1), 'm (must be <= 55 + cell diag 7.1)');
console.log('max along-axis:', maxAlong.toFixed(1), 'm (must be <= 180+30+7.1 = 217)');
if (maxPerp > 57.2) { console.error('FAIL: perpendicular bleed > halfwidth'); process.exit(1); }
if (maxAlong > 217.2) { console.error('FAIL: along bleed'); process.exit(1); }

// No-tee: everything valid stays.
const mask2 = GB.corridorMaskRect(eg, centerLL, green, null, 30, 50);
let n2 = 0; for (let i = 0; i < mask2.length; i++) if (mask2[i]) n2++;
if (n2 !== W * H) { console.error('FAIL: no-tee should keep all'); process.exit(1); }

console.log('R6-D2 COORDINATOR CHECK PASS');
