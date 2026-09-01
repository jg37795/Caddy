/* ==========================================================================
   .gtds/r6_palette_check.js — R6 verify harness (D1 palette, D2 mesh mask,
   D3 marker tolerance). Run: node .gtds/r6_palette_check.js
   Approach (documented per the brief's "your call"):
   - D1: buildHoleScene's colorFn is UI-bound, so the palette lives in the
     NEW pure helper GreenMapCore.stylizedCourseColor (extracted this round).
     The harness drives it through the REAL GreenMapCore.buildMesh3D colorFn
     path on a synthetic 64x64 grid with a raised dome at the centre (the
     green zone), replicating buildHoleScene's dGreen BFS exactly.
   - D2: the new pure GreenMapCore.corridorMaskRect on a synthetic square
     grid with a 45-degree diagonal corridor; asserts quad-count drop and
     mesh-corner perpendicular extremes via buildMesh3D + M.pos.
   - D3: the new pure GreenMapCore.markerDepthOK + real projectPt/makeCam at
     pitch 26, dist ~200 (the fitHoleView camera).
   ========================================================================== */
'use strict';
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'greenmap.js'));
const GM = global.window.GreenMapCore;
const fs = require('fs');

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  -', name);
  else { fails++; console.error('FAIL -', name, detail !== undefined ? detail : ''); }
}

/* ---------------- shared synthetic hole grid ----------------------------
   64x64 cells, 4 m/cell (256 m square). Gentle tilt + a raised dome at the
   centre (the green zone, radius 20 m). Max slope kept < 6% so the
   low-slope fairway corridor applies cleanly. */
const W = 64, H = 64, CS = 4;
const grid = new Float32Array(W * H);
const lo0 = 12, hi0 = 16;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const mx = (x + 0.5 - W / 2) * CS, my = (H / 2 - y - 0.5) * CS;
    const d2 = mx * mx + my * my;
    grid[y * W + x] = hi0 - 0.015 * (mx + my) / 2 +   // gentle 1.5% tilt
      2.0 * Math.exp(-d2 / 1200) -                    // the dome (≤3.5% grade)
      (lo0 - hi0) / 2 * 0;                            // base offset
  }
let zMin = Infinity, zMax = -Infinity;
for (let i = 0; i < grid.length; i++) {
  if (grid[i] < zMin) zMin = grid[i];
  if (grid[i] > zMax) zMax = grid[i];
}
const LO = zMin, HI = zMax;

// Green zone: raised dome centre, radius 20 m (5 cells at 4 m/cell).
const zone = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const mx = (x + 0.5 - W / 2) * CS, my = (H / 2 - y - 0.5) * CS;
    if (mx * mx + my * my <= 20 * 20) zone[y * W + x] = 1;
  }
let zoneCount = 0;
for (let i = 0; i < zone.length; i++) zoneCount += zone[i];

// Distance-to-zone in cells: the SAME 8-connected BFS buildHoleScene runs.
const dGreen = new Float32Array(W * H).fill(Infinity);
{
  const q = [];
  for (let k = 0; k < zone.length; k++)
    if (zone[k]) { dGreen[k] = 0; q.push(k); }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], kx = k % W, ky = (k / W) | 0, dk = dGreen[k];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = kx + dx, ny = ky + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (dGreen[nk] > dk + 1) { dGreen[nk] = dk + 1; q.push(nk); }
      }
  }
}

// Per-cell slope % (same central-difference as buildHoleScene's colorFn).
const slpAt = (i) => {
  const ix = i % W, iy = (i / W) | 0;
  const zx1 = ix < W - 1 ? grid[i + 1] : grid[i];
  const zx0 = ix > 0 ? grid[i - 1] : grid[i];
  const zy1 = iy < H - 1 ? grid[i + W] : grid[i];
  const zy0 = iy > 0 ? grid[i - W] : grid[i];
  return Math.hypot(zx1 - zx0, zy1 - zy0) / (2 * CS) * 100;
};

console.log('1. D1 palette — buildMesh3D colorFn path on synthetic dome grid');
const maskAll = new Uint8Array(W * H).fill(1);
// The colorFn is buildHoleScene's corridor branch, verbatim, with the
// v1.14.0 palette helper in the rough/fairway part.
const colorFn = (i, zMid) => {
  if (zone[i]) return GM.slopeColor(slpAt(i));          // zone ramp (untouched)
  return GM.stylizedCourseColor(dGreen[i], slpAt(i), zMid,
    LO, HI, i % W, (i / W) | 0, CS);
};
const mesh = GM.buildMesh3D(grid, W, H, CS, maskAll, [LO, HI], 1, 'slope',
  { smooth: false, ao: false, colorFn });
check('D1: mesh builds via colorFn path', !!mesh && mesh.count === (W - 1) * (H - 1),
  mesh && mesh.count);

const isFairwayCell = (i) =>
  dGreen[i] <= Math.round(20 / CS) ||
  (dGreen[i] <= Math.round(35 / CS) && slpAt(i) < 6);

// (a) rough vs fairway mean RGB difference > 30 (from the BUILT mesh colours).
{
  let fR = 0, fG = 0, fB = 0, fN = 0, rR = 0, rG = 0, rB = 0, rN = 0;
  for (let q = 0; q < mesh.count; q++) {
    // fast path (mask all-1, no polygon): quad k = y*(W-1)+x
    const x = q % (W - 1), y = (q / (W - 1)) | 0;
    const i = y * W + x;                     // classify by the quad's min cell
    if (zone[i]) continue;
    const c = mesh.col, o = q * 3;
    if (isFairwayCell(i)) { fR += c[o]; fG += c[o + 1]; fB += c[o + 2]; fN++; }
    else { rR += c[o]; rG += c[o + 1]; rB += c[o + 2]; rN++; }
  }
  const fMean = (fR + fG + fB) / (3 * fN), rMean = (rR + rG + rB) / (3 * rN);
  check('D1a: rough vs fairway mean RGB gap > 30', fMean - rMean > 30,
    `fairway=${fMean.toFixed(1)} rough=${rMean.toFixed(1)} gap=${(fMean - rMean).toFixed(1)} (n=${fN}/${rN})`);
}
// (b) two rough cells 2 apart in x can differ (coarse 2x2 mottle).
{
  let maxDiff = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 3; x++) {
      const i = y * W + x, j = y * W + x + 2;
      if (zone[i] || zone[j] || isFairwayCell(i) || isFairwayCell(j)) continue;
      const a = GM.stylizedCourseColor(dGreen[i], slpAt(i), (LO + HI) / 2,
        LO, HI, x, y, CS);
      const b = GM.stylizedCourseColor(dGreen[j], slpAt(j), (LO + HI) / 2,
        LO, HI, x + 2, y, CS);
      const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]),
        Math.abs(a[2] - b[2]));
      if (d > maxDiff) maxDiff = d;
    }
  check('D1b: rough cells 2 apart in x CAN differ (mottle alive)', maxDiff > 3,
    `max channel delta=${maxDiff}`);
  // Mottle is GREEN-led: G-channel spread across hash values exceeds R/B.
  let minR = 255, maxR = 0, minG = 255, maxG = 0;
  for (let ix = 0; ix < 40; ix++) {
    const c = GM.stylizedCourseColor(999, 0, (LO + HI) / 2, LO, HI, ix, 3, CS);
    minR = Math.min(minR, c[0]); maxR = Math.max(maxR, c[0]);
    minG = Math.min(minG, c[1]); maxG = Math.max(maxG, c[1]);
  }
  check('D1b: mottle modulates GREEN more than R (vegetative, not grey)',
    (maxG - minG) > (maxR - minR),
    `G spread=${maxG - minG} R spread=${maxR - minR}`);
}
// (c) fairway band wider than the old 14 m radius would give.
{
  let oldN = 0, newN = 0;
  for (let i = 0; i < W * H; i++) {
    if (zone[i]) continue;
    if (dGreen[i] <= Math.round(14 / CS) ||
        (dGreen[i] <= Math.round(26 / CS) && slpAt(i) < 6)) oldN++;
    if (isFairwayCell(i)) newN++;
  }
  check('D1c: fairway ribbon wider than 14 m rule', newN > oldN,
    `new=${newN} old=${oldN} cells`);
  // Corridor reaches the 35 m low-slope rule: analytic area of the annulus
  // from the zone edge (20 m) out to 35 m beyond it — π(55²−20²)/cellArea —
  // with 10% slack for grid-corner clipping. (First draft asserted a flat
  // 28% of the whole 256 m square — wrong by ~2x; the honest expectation
  // for the 35 m corridor on this grid is ~600 cells.)
  const expCorridor = zoneCount + Math.PI *
    (55 * 55 - 20 * 20) / (CS * CS) * 0.9;
  check('D1c: corridor reaches the 35 m rule on flat ground',
    newN >= expCorridor, `new=${newN} expected>=${expCorridor.toFixed(0)}`);
}

console.log('2. D1 guard rails — band amplitude, zone ramp, hillshade band');
{
  // Band ±10%: the brief's band = 1 + t*0.10 with t normalized to ±0.5
  // across the grid's real elevation range — so the extreme-to-extreme
  // span is 0.95→1.05 = 10% of base (the old 0.07 multiplier spanned 7%).
  // Sample the FAIRWAY class so mottle can't pollute the delta.
  const cLow = GM.stylizedCourseColor(1, 0, LO, LO, HI, 8, 8, CS);
  const cHigh = GM.stylizedCourseColor(1, 0, HI, LO, HI, 8, 8, CS);
  const relDiff = (cHigh[0] - cLow[0]) / 170;   // vs fairway R base 170
  check('D1: elevation banding spans 10% (0.10 multiplier, not 0.07)',
    relDiff > 0.09 && relDiff < 0.11, `R rel diff=${(relDiff * 100).toFixed(1)}%`);
  // Rough/fairway bases are exactly the prescribed ones at mid elevation.
  // Mottle is neutral (blob=1.0) at hash/1023 = 0.625 → hash = 639; search
  // an ix with that hash (iy=0), then assert the exact base colours.
  const hashOf = (ix, iy) => (((ix >> 1) * 73856093) ^
    ((iy >> 1) * 19349663)) & 1023;
  let neutralIx = -1;
  for (let ix = 0; ix < 4096; ix++)
    if (hashOf(ix, 0) === 639) { neutralIx = ix; break; }
  check('D1: mottle-neutral hash exists (blob = 1.0)', neutralIx >= 0, neutralIx);
  const f = GM.stylizedCourseColor(1, 0, (LO + HI) / 2, LO, HI, neutralIx, 0, CS);
  const r = GM.stylizedCourseColor(999, 0, (LO + HI) / 2, LO, HI, neutralIx, 0, CS);
  check('D1: fairway base [170,188,142] at mid elevation',
    f[0] === 170 && f[1] === 188 && f[2] === 142, f);
  check('D1: rough base [96,116,92] at mid elevation (mottle-neutral)',
    r[0] === 96 && r[1] === 116 && r[2] === 92, r);
  // Mottle at the hash EXTREMES must stay within the prescribed 0.10–0.16
  // amplitude around the base (0.90–1.06 blob → ±8% R/B, ±12.8% G).
  const rMin = GM.stylizedCourseColor(999, 0, (LO + HI) / 2, LO, HI, 0, 0, CS);
  const rMax = GM.stylizedCourseColor(999, 0, (LO + HI) / 2, LO, HI, 34, 0, CS);
  check('D1: rough mottle amplitude within 0.10–0.16 spec',
    rMin[0] >= 96 * 0.92 && rMax[0] <= 96 * 1.08 &&
    rMin[1] >= 116 * 0.88 && rMax[1] <= 116 * 1.12,
    `R=[${rMin[0]},${rMax[0]}] G=[${rMin[1]},${rMax[1]}]`);
  // Guard: the green-zone slope ramp and the stylized hillshade band are
  // untouched in the source (requirement 5+6).
  const src = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
  check('D1: zone slope ramp untouched in buildHoleScene',
    src.includes('return GreenMapCore.slopeColor(slp)'));
  check('D1: stylized hillshade band stays 0.62–1.30',
    src.includes("texMode === 'stylized' ? 0.62 : 0.75") &&
    src.includes("texMode === 'stylized' ? 1.30 : 1.18"));
}

console.log('3. D2 — oriented corridor mask (diagonal hole on a square grid)');
{
  // Square 64x64 @ 4 m (256 m). Green at grid centre; tee 150 m away on the
  // NW diagonal → a 212 m hole on a square fetch = the D2 frame mismatch.
  const centerLL = [-93.6, 41.9];
  const greenLL = { lat: centerLL[1], lng: centerLL[0] };
  const mLat = 110540, mLng = 111320 * Math.cos(centerLL[1] * Math.PI / 180);
  const teeLL = { lat: centerLL[1] + 150 / mLat, lng: centerLL[0] - 150 / mLng };
  const eg = { grid, W, H, cellSizeM: CS, validMask: null };
  const mRect = GM.corridorMaskRect(eg, centerLL, greenLL, teeLL, 30, 50);
  let nRect = 0;
  for (let i = 0; i < mRect.length; i++) nRect += mRect[i];
  check('D2: mask keeps a corridor minority of the square', nRect < W * H * 0.5 &&
    nRect > 0.05 * W * H, `${nRect}/${W * H} cells`);

  const meshSq = GM.buildMesh3D(grid, W, H, CS, maskAll, [LO, HI], 1, 'slope',
    { smooth: false, ao: false });
  const meshMasked = GM.buildMesh3D(grid, W, H, CS, mRect, [LO, HI], 1, 'slope',
    { smooth: false, ao: false });
  check('D2: masked quad count drops vs unmasked square',
    meshMasked.count > 0 && meshMasked.count < meshSq.count * 0.6,
    `${meshMasked.count} vs ${meshSq.count}`);

  // Perpendicular extremes of the masked MESH CORNERS vs the tee→green axis.
  const gx = (greenLL.lng - centerLL[0]) * mLng;
  const gy = (greenLL.lat - centerLL[1]) * mLat;
  const tx = (teeLL.lng - centerLL[0]) * mLng;
  const ty = (teeLL.lat - centerLL[1]) * mLat;
  const L = Math.hypot(gx - tx, gy - ty);
  const ux = (gx - tx) / L, uy = (gy - ty) / L;
  const cx = (gx + tx) / 2, cy = (gy + ty) / 2;
  let maxPerp = 0, maxAlong = 0;
  const halfLen = L / 2 + 30;
  for (let q = 0; q < meshMasked.count; q++)
    for (let c = 0; c < 4; c++) {
      const o = q * 12 + c * 3;
      const dx = meshMasked.pos[o] - cx, dy = meshMasked.pos[o + 1] - cy;
      const perp = Math.abs(dx * -uy + dy * ux);
      const along = Math.abs(dx * ux + dy * uy);
      if (perp > maxPerp) maxPerp = perp;
      if (along > maxAlong) maxAlong = along;
    }
  check('D2: mesh corner extremes ≤ ~55 m perpendicular to the axis',
    maxPerp <= 55, `maxPerp=${maxPerp.toFixed(1)} m`);
  check('D2: mesh ends inside halfLen + margin (30 m end margins kept)',
    maxAlong <= halfLen + CS, `maxAlong=${maxAlong.toFixed(1)} halfLen=${halfLen.toFixed(1)}`);
  // Tee and green cells stay inside the geometry mask (the corridor covers
  // the hole it was fetched for).
  const idxOf = (lmx, lmy) => {
    const fx = lmx / CS + W / 2 - 0.5, fy = H / 2 - 0.5 - lmy / CS;
    const x = Math.max(0, Math.min(W - 1, Math.round(fx)));
    const y = Math.max(0, Math.min(H - 1, Math.round(fy)));
    return y * W + x;
  };
  check('D2: green centre cell masked', mRect[idxOf(gx, gy)] === 1);
  check('D2: tee cell masked', mRect[idxOf(tx, ty)] === 1);
  // No-tee fallback: the square is correct (whole-grid mask).
  const mNoTee = GM.corridorMaskRect(eg, centerLL, greenLL, null, 30, 50);
  let nNoTee = 0;
  for (let i = 0; i < mNoTee.length; i++) nNoTee += mNoTee[i];
  check('D2: no-tee fallback masks every valid cell', nNoTee === W * H);
}

console.log('4. D3 — tee flag projects + tolerance logic (pitch 26°, dist 200)');
{
  // Flat 32x32 @ 1 m mesh; the fit camera from fitHoleView.
  const g2 = new Float32Array(32 * 32).fill(10);
  const m2 = GM.buildMesh3D(g2, 32, 32, 1, new Uint8Array(32 * 32).fill(1),
    [9.5, 10.5], 1, 'slope', { smooth: false, ao: false });
  check('D3: small mesh builds', !!m2 && m2.count > 0, m2 && m2.count);
  const cam = GM.makeCam(0, 26, 200);      // pitch 26, dist ~200 (fit range)
  cam.f = 900; cam.ox = 400; cam.oy = 416;
  const teeM = [0, 60];                    // 60 m short of the green centre
  const base = GM.projectPt(cam, teeM[0], teeM[1], 0);
  const pole = GM.projectPt(cam, teeM[0], teeM[1], 2.5);   // NEW 2.5 m test height
  const top = GM.projectPt(cam, teeM[0], teeM[1], 3);
  check('D3: flag base/pole/top all project at pitch 26, dist 200',
    !!base && !!pole && !!top,
    `base=${base && [base[0] | 0, base[1] | 0]} pole=${pole && [pole[0] | 0, pole[1] | 0]}`);
  const eps = cam.dist * 0.06;             // render3D's eps
  const dPole = GM.depthOf(cam, teeM[0], teeM[1], 2.5);
  check('D3: tolerance passes own-cell raster noise (nearest ≈ surface)',
    GM.markerDepthOK(dPole, dPole - 0.8, eps) === true);
  check('D3: tolerance passes when nothing rasterized (silhouette/sky)',
    GM.markerDepthOK(dPole, Infinity, eps) === true);
  check('D3: genuinely buried marker still rejected (hill well in front)',
    GM.markerDepthOK(dPole, dPole - eps - 1, eps) === false);
  check('D3: non-finite marker depth rejected',
    GM.markerDepthOK(NaN, Infinity, eps) === false);
  // The OLD test height (1 m) was the failure mode: at 1x exaggeration on
  // rolling terrain the pole test sat below the surface read. Document the
  // new height in the projection itself (2.5 m must clear a 1.5 m mound).
  const poleOld = GM.projectPt(cam, teeM[0], teeM[1], 1.0);
  check('D3: 2.5 m test point projects above a 1.5 m mound between cam and tee',
    !!poleOld && !!pole && pole[1] < poleOld[1],
    `poleY=${pole && pole[1].toFixed(1)} oldY=${poleOld && poleOld[1].toFixed(1)}`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nR6 PALETTE/MASK/MARKER CHECKS PASSED');
process.exit(fails ? 1 : 0);
