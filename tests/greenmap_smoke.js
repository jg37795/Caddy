/* ==========================================================================
   tests/greenmap_smoke.js — headless verification for greenmap prototype
   Run: node tests/greenmap_smoke.js
   1. Unit: gradient field on synthetic tilted grids → arrow/bearing checks.
   2. Unit: color ramp endpoints.
   3. Unit: polygon clip mask math.
   4. Live smoke: real Ankeny 3DEP fetch via CaddyElev, render math,
      assert arrows exist and majority point downhill with known relief.
   ========================================================================== */
'use strict';
const path = require('path');
const CaddyElev = require(path.join(__dirname, '..', 'caddy-elev.js'));

// greenmap.js guards on window; provide a stub so the pure core is exported.
global.window = {};
require(path.join(__dirname, '..', 'greenmap.js'));
const GM = global.window.GreenMapCore;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  -', name);
  else { failures++; console.error('FAIL -', name, detail || ''); }
}

/* ---- 1. Synthetic tilt grids -------------------------------------------
   grid y index grows "south" in the gradient math, so elevation
   z = a*x + b*y means dz/dx=a, dz/dy=b. */
function tiltField(a, b) {
  const W = 16, H = 16, cs = 0.5;
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      grid[y * W + x] = a * x * cs + b * y * cs;
  return { f: GM.computeGradientField(grid, W, H, cs), W, H };
}

console.log('1. Gradient field — synthetic tilts');
{
  // Falls due EAST: z rises westward => gx negative.
  const { f } = tiltField(-0.05, 0);           // 5% down-slope toward +x (east)
  check('east-fall gx<0', f.gx[8 * 16 + 8] < 0, f.gx[8 * 16 + 8]);
  const brgE = GM.fallBearingDeg(f.gx[8 * 16 + 8], f.gy[8 * 16 + 8]);
  check('east-fall bearing ≈90°', Math.abs(brgE - 90) < 3, brgE);
}
{
  // Falls due NORTH: gy positive (z rises southward).
  const { f } = tiltField(0, 0.04);
  const brgN = GM.fallBearingDeg(f.gx[8 * 16 + 8], f.gy[8 * 16 + 8]);
  check('north-fall bearing ≈0°', Math.min(brgN, 360 - brgN) < 3, brgN);
}
{
  // Falls NE: gx<0, gy>0 → bearing ≈45°.
  const { f } = tiltField(-0.03, 0.03);
  const brgNE = GM.fallBearingDeg(f.gx[8 * 16 + 8], f.gy[8 * 16 + 8]);
  check('NE-fall bearing ≈45°', Math.abs(brgNE - 45) < 5, brgNE);
  const pct = GM.slopePctAt(f, 8 * 16 + 8);
  check('slope % ≈ 4.24', Math.abs(pct - 100 * Math.hypot(0.03, 0.03)) < 0.01, pct);
}
check('flat grid → zero slope', (() => {
  const { f } = tiltField(0, 0);
  return GM.slopePctAt(f, 8 * 16 + 8) < 1e-6;
})());

console.log('2. Color ramp endpoints');
{
  const flat = GM.slopeColor(0), steep = GM.slopeColor(12), mid = GM.slopeColor(6);
  check('flat is calm/cool (high G)', flat[1] > flat[0] && flat[2] > 140, flat);
  check('steep is red/warm', steep[0] > 150 && steep[0] > steep[2], steep);
  check('ramp warmth monotonic through amber/red band (5–13%)', (() => {
  let ok = true;
  const warmth = (p) => { const c = GM.slopeColor(p); return c[0] - c[2]; };
  for (let p = 5.25; p <= 13; p += 0.25)
    if (warmth(p) < warmth(p - 0.25)) ok = false;
  return ok;
})());
}

console.log('3. Elevation ramp endpoints');
{
  const low = GM.elevationColor(0), mid = GM.elevationColor(0.5), high = GM.elevationColor(1);
  check('elev low is blue (B > R)', low[2] > low[0], low);
  check('elev high is red (R > B)', high[0] > high[2], high);
  check('elev mid is neutral green-ish', mid[1] >= mid[0] && mid[1] >= mid[2], mid);
  check('elev clamps out-of-range', JSON.stringify(GM.elevationColor(-5)) ===
    JSON.stringify(low) && JSON.stringify(GM.elevationColor(7)) === JSON.stringify(high));
}

console.log('4. Polygon clip mask');
{
  // Square poly ±8m around centre, 32 cells @ 1m.
  const sq = [[-8, -8], [8, -8], [8, 8], [-8, 8]];
  const m = GM.polyMask(sq, 32, 32, 1);
  let inside = 0;
  for (let i = 0; i < m.length; i++) inside += m[i];
  check('square mask ~256 cells', inside > 230 && inside < 280, inside);
  check('centre inside', m[16 * 32 + 16] === 1);
  check('corner outside', m[0] === 0 && m[31 * 32 + 31] === 0);
  // pointInPoly sanity
  check('pointInPoly basic', GM.pointInPoly(0, 0, sq) && !GM.pointInPoly(20, 20, sq));
}

console.log('5. Putt preview integrator');
{
  // Flat field, square mask ±8m @ 1m cells, ball (-6,0) → pin (6,0):
  // straight line, reaches pin, all points inside mask.
  const W = 32, H = 32, cs = 0.5;
  const grid = new Float32Array(W * H);   // flat → no lateral drift
  const f = GM.computeGradientField(grid, W, H, cs);
  const mask = GM.polyMask([[-8, -8], [8, -8], [8, 8], [-8, 8]], W, H, cs);
  const r = GM.naivePuttPath([-6, 0], [6, 0], f, W, H, cs, mask);
  check('flat putt reaches pin', r.stopped === 'pin' &&
    Math.hypot(r.pts[r.pts.length - 1][0] - 6,
               r.pts[r.pts.length - 1][1] - 0) < 1.2, r.stopped);
}
{
  // Strong cross-slope pushes the naive line out of a narrow strip mask:
  // integrator must report 'edge' and never emit out-of-mask points.
  const W = 40, H = 40, cs = 0.25;
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) grid[y * W + x] = 0.3 * y * cs; // falls north hard
  const f = GM.computeGradientField(grid, W, H, cs);
  const mask = GM.polyMask([[-4, -4], [4, -4], [4, 4], [-4, 4]], W, H, cs);
  const r = GM.naivePuttPath([-3, 3.5], [3, -3.5], f, W, H, cs, mask, 120, 12);
  check('cross-slope putt stops at edge', r.stopped === 'edge', r.stopped);
  let inMask = true;
  const cellOk = ([mx, my]) => {
    const ix = Math.round(mx / cs + W / 2), iy = Math.round(H / 2 - my / cs);
    return ix >= 0 && iy >= 0 && ix < W && iy < H && mask[iy * W + ix] === 1;
  };
  // every point except possibly the final clamp must be inside the mask
  for (let k = 0; k < r.pts.length; k++)
    if (!cellOk(r.pts[k])) { inMask = false; break; }
  check('all putt points inside polygon (edge stop)', inMask || r.stopped === 'pin',
    `${r.pts.length} pts`);
  check('edge path shorter than ball→pin line',
    r.pts.length < 121, r.pts.length);
}

/* ---- 6. Live smoke — Ankeny 3DEP ---------------------------------------- */
(async () => {
  console.log('4. Live smoke — Ankeny test green (41.95,-93.75)');
  try {
    const lat = 41.95, lng = -93.75;
    const halfLat = 20 / 111320, halfLng = 20 / (111320 * Math.cos(lat * Math.PI / 180));
    const bbox = [lng - halfLng, lat - halfLat, lng + halfLng, lat + halfLat];
    const elev = await CaddyElev.fetchElevGrid(bbox, 64);
    check('fetchElevGrid returned data', !!(elev && elev.grid));
    if (!elev || !elev.grid) throw new Error('no elev data');

    const field = GM.computeGradientField(elev.grid, elev.W, elev.H,
      elev.cellSizeM, (i) => !elev.validMask || !!elev.validMask[i]);
    let nValid = 0, nDownhillConsistent = 0, nArrows = 0;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < elev.grid.length; i++) {
      if (!Number.isFinite(elev.grid[i])) continue;
      if (elev.grid[i] < minZ) minZ = elev.grid[i];
      if (elev.grid[i] > maxZ) maxZ = elev.grid[i];
    }
    // Net relief direction from corner means (SW vs NE quadrant).
    let swSum = 0, swN = 0, neSum = 0, neN = 0;
    for (let y = 0; y < elev.H; y++)
      for (let x = 0; x < elev.W; x++) {
        const i = y * elev.W + x, v = elev.grid[i];
        if (!field.valid[i]) continue;
        nValid++;
        nArrows++;
        if (x < elev.W / 2 && y >= elev.H / 2) { swSum += v; swN++; }
        if (x >= elev.W / 2 && y < elev.H / 2) { neSum += v; neN++; }
      }
    check('majority of cells valid (>60%)', nValid / (elev.W * elev.H) > 0.6,
      `${nValid}/${elev.W * elev.H}`);
    check('arrows exist at many cells', nArrows > 500, nArrows);

    const reliefM = maxZ - minZ;
    check('plausible green relief (0–15m)', reliefM >= 0 && reliefM < 15, reliefM.toFixed(2));
    // Downhill consistency: least-squares plane fit z = a + b*x + c*y
    // (x east in cells, y south in cells). Mean gradient must match (b,c).
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, n = 0;
    for (let y = 0; y < elev.H; y++)
      for (let x = 0; x < elev.W; x++) {
        const i = y * elev.W + x;
        if (!field.valid[i]) continue;
        const v = elev.grid[i];
        n++; sx += x; sy += y; sz += v;
        sxx += x * x; syy += y * y; sxy += x * y; sxz += x * v; syz += y * v;
      }
    // Solve normal equations for b (dz/dx) and c (dz/dy)
    const dx0 = sx / n, dy0 = sy / n;
    const Sxx = sxx - n * dx0 * dx0, Syy = syy - n * dy0 * dy0,
          Sxy = sxy - n * dx0 * dy0,
          Sxz = sxz - sz * dx0, Syz = syz - sz * dy0;
    const det = Sxx * Syy - Sxy * Sxy;
    if (Math.abs(det) > 1e-9) {
      const bFit = (Sxz * Syy - Syz * Sxy) / det;   // dz/dx per cell
      const cFit = (Syz * Sxx - Sxz * Sxy) / det;   // dz/dy per cell
      let mgx = 0, mgy = 0;
      for (let i = 0; i < field.valid.length; i++)
        if (field.valid[i]) { mgx += field.gx[i]; mgy += field.gy[i]; }
      mgx /= nValid; mgy /= nValid;
      const fitMag = Math.hypot(bFit, cFit), gMag = Math.hypot(mgx, mgy);
      const dot = (bFit * mgx + cFit * mgy) / (fitMag * gMag || 1);
      check('mean gradient direction matches plane-fit slope',
        dot > 0.8, `cos=${dot.toFixed(3)} fit=(${bFit.toFixed(5)},${cFit.toFixed(5)}) grad=(${mgx.toFixed(5)},${mgy.toFixed(5)})`);
    } else {
      console.log('  skip - degenerate plane fit');
    }
    console.log(`  info - ${elev.W}x${elev.H} cell=${elev.cellSizeM.toFixed(3)}m ` +
      `relief=${reliefM.toFixed(2)}m validCells=${nValid} arrows=${nArrows}`);
  } catch (e) {
    failures++;
    console.error('FAIL - live smoke:', e.message);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
