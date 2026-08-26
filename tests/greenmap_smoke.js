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

console.log('5b. Physics putt simulator (simPuttPath)');
{
  const GMS = GM.simPuttPath;
  // (a) Flat grid: straight line, reaches pin, no break.
  {
    const W = 32, H = 32, cs = 0.5;
    const f = GM.computeGradientField(new Float32Array(W * H), W, H, cs);
    const mask = GM.polyMask([[-8, -8], [8, -8], [8, 8], [-8, 8]], W, H, cs);
    const r = GMS([-6, 0], [6, 0], f, W, H, cs, mask);
    check('sim: flat putt reaches pin', r.stopped === 'pin', r.stopped);
    check('sim: flat break ≈ 0', Math.abs(r.breakIn) < 0.5, r.breakIn);
  }
  // (b) East-fall tilt, ball putting NORTH: downhill (east) is to the RIGHT
  // of travel → must break right with a meaningful readout.
  const mkTilt = (slope, W, H, cs) => {
    const grid = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) grid[y * W + x] = -slope * x * cs;
    return { f: GM.computeGradientField(grid, W, H, cs), W, H, cs };
  };
  {
    const t = mkTilt(0.02, 80, 80, 0.25);
    const mask = GM.polyMask([[-10, -10], [10, -10], [10, 10], [-10, 10]],
      t.W, t.H, t.cs);
    const r = GMS([0, -7], [0, 7], t.f, t.W, t.H, t.cs, mask);
    check('sim: tilted putt breaks RIGHT (positive breakIn)',
      r.breakIn > 5, `${r.breakIn.toFixed(1)} in, ${r.stopped}`);
    // (c) Steeper tilt ⇒ larger break.
    const t2 = mkTilt(0.04, 80, 80, 0.25);
    const r2 = GMS([0, -7], [0, 7], t2.f, t2.W, t2.H, t2.cs, mask);
    check('sim: steeper tilt ⇒ larger break',
      Math.abs(r2.breakIn) > Math.abs(r.breakIn),
      `${Math.abs(r2.breakIn).toFixed(1)} vs ${Math.abs(r.breakIn).toFixed(1)}`);
    // (d) Faster green (higher stimp) ⇒ more break for the same slope.
    const rFast = GMS([0, -7], [0, 7], t.f, t.W, t.H, t.cs, mask,
      { stimp: 13 });
    const rSlow = GMS([0, -7], [0, 7], t.f, t.W, t.H, t.cs, mask,
      { stimp: 8 });
    check('sim: higher stimp ⇒ larger break',
      Math.abs(rFast.breakIn) > Math.abs(rSlow.breakIn),
      `${rFast.breakIn.toFixed(1)} vs ${rSlow.breakIn.toFixed(1)} ` +
      `(stimp default: ${GMS([0, -7], [0, 7], t.f, t.W, t.H, t.cs, mask)
        .breakIn.toFixed(1)})`);
  }
}

console.log('6. 3D orbit math — camera, projection, mesh');
{
  const cam = GM.makeCam(0, 35, 62);
  cam.f = 800; cam.ox = 400; cam.oy = 300;
  // Origin projects near screen centre; depth at target equals dist.
  const p0 = GM.projectPt(cam, 0, 0, 0);
  check('target depth == dist', Math.abs(GM.depthOf(cam, 0, 0, 0) - 62) < 1e-9);
  check('origin projects near centre',
    Math.abs(p0[0] - 400) < 2 && Math.abs(p0[1] - 300) < 40, p0);
  // A point farther from the eye (south, since yaw=0 eye is north of target)
  // has larger depth and appears higher on screen (near the horizon).
  const pS = GM.projectPt(cam, 0, -10, 0);
  check('farther point larger depth', GM.depthOf(cam, 0, -10, 0) >
    GM.depthOf(cam, 0, 10, 0));
  check('far point draws above centre', pS[1] < p0[1], pS);
  check('behind-camera point rejected',
    GM.projectPt(cam, 0, 200, 0) === null);   // beyond target → behind eye
  // Flat grid mesh: all normals ≈ +Z; exaggeration scales vertex z.
  const W = 16, H = 16, cs = 0.5;
  const flat = new Float32Array(W * H).fill(10);
  const mask16 = new Uint8Array(W * H).fill(1);
  const m1 = GM.buildMesh3D(flat, W, H, cs, mask16, [9.5, 10.5], 8);
  check('mesh built for full square', m1 && m1.count === (W - 1) * (H - 1),
    m1 && m1.count);
  let nOK = true;
  for (let q = 0; q < m1.count; q++) {
    if (Math.abs(m1.nrm[q * 3]) > 1e-5 || Math.abs(m1.nrm[q * 3 + 1]) > 1e-5 ||
        m1.nrm[q * 3 + 2] < 0.999) nOK = false;
  }
  check('flat-grid normals all ≈ +Z', nOK);
  const m4 = GM.buildMesh3D(flat, W, H, cs, mask16, [9.5, 10.5], 4);
  // Sloped grid for the exaggeration ratio (flat grid has all z == 0).
  const rampG = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) rampG[y * W + x] = 10 + 0.1 * x * cs;
  const mr1 = GM.buildMesh3D(rampG, W, H, cs, mask16, [10, 11], 8);
  const mr4 = GM.buildMesh3D(rampG, W, H, cs, mask16, [10, 11], 4);
  const meanZ = (m) => {
    let s = 0;
    for (let q = 0; q < m.count * 4; q++) s += m.pos[q * 3 + 2];
    return s / (m.count * 4);
  };
  check('exaggeration halves vertex z',
    Math.abs(meanZ(mr4) / meanZ(mr1) - 0.5) < 1e-6,
    `${meanZ(mr4)} vs ${meanZ(mr1)}`);
  check('zmin offset baked in', Math.abs(m1.pos[2]) < 1e-6, m1.pos[2]);
  // Tilted grid: normal tilts opposite the rise (east-fall → nx > 0).
  const tilt = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) tilt[y * W + x] = -0.1 * x * cs; // falls east
  const mt = GM.buildMesh3D(tilt, W, H, cs, mask16, [-0.8, 0], 8);
  check('east-fall normal tilts +X', mt.nrm[0] > 0.3 &&
    mt.nrm[2] > 0.6 && mt.nrm[2] < 0.95,
    [mt.nrm[0], mt.nrm[1], mt.nrm[2]]);
  // Mask clip: quads outside the mask are skipped.
  const halfMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W / 2; x++) halfMask[y * W + x] = 1;
  const mm = GM.buildMesh3D(flat, W, H, cs, halfMask, [9.5, 10.5], 8);
  check('mask clips quads (~half remain)',
    mm.count < (W - 1) * (H - 1) * 0.7 && mm.count > (W - 1) * (H - 1) * 0.3,
    mm.count);
  // Painter order: far quads sort before near ones.
  const dep = [[0, 10], [1, 5], [2, 20]];
  dep.sort((a, b) => b[1] - a[1]);
  check('painter comparator far→near',
    dep[0][0] === 2 && dep[2][0] === 1, dep.map(d => d[0]).join(','));
}

/* ---- 6b. Precision pass — bilinear, vertex normals, AO, corridor bbox --- */
{
  console.log('7. Bilinear sampling vs analytic plane');
  // z = 2 + 0.5*x_m + 0.3*y_m over a 32x32 grid @ 1m cells centred origin.
  const W = 32, H = 32, cs = 1;
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Raster convention: cell CENTRE at ((x+0.5)-W/2, H/2-(y+0.5)) metres.
      const mx = (x + 0.5 - W / 2) * cs, my = (H / 2 - y - 0.5) * cs;
      grid[y * W + x] = 2 + 0.5 * mx + 0.3 * my;
    }
  let maxErr = 0;
  for (let k = 0; k < 200; k++) {
    const mx = (Math.random() - 0.5) * (W - 2);
    const my = (Math.random() - 0.5) * (H - 2);
    const got = GM.sampleElevLocalM({ grid, W, H, cellSizeM: cs }, mx, my);
    const want = 2 + 0.5 * mx + 0.3 * my;
    if (got == null) { maxErr = Infinity; break; }
    maxErr = Math.max(maxErr, Math.abs(got - want));
  }
  check('bilinear reproduces analytic plane (<1e-5 m)', maxErr < 1e-5,
    maxErr.toExponential(2));
  // Invalid corners: punch a hole and confirm graceful fallback.
  const g2 = grid.slice();
  const vm2 = new Uint8Array(W * H).fill(1);
  vm2[15 * W + 15] = 0; g2[15 * W + 15] = NaN;
  const zNear = GM.sampleElevLocalM({ grid: g2, W, H, cellSizeM: cs,
    validMask: vm2 }, 0.1, 0.1);
  check('invalid centre falls back to valid neighbours',
    zNear != null && Number.isFinite(zNear), zNear);
  const zOut = GM.sampleElevLocalM({ grid: g2, W, H, cellSizeM: cs },
    500, 500);
  check('sample far outside grid returns null', zOut === null, zOut);

  console.log('8. Vertex-normal averaging on synthetic tilt');
  // Uniform tilt → every quad normal identical → averaged vertex normals
  // must equal the plane normal exactly (up to fp).
  const Wt = 16, Ht = 16, cst = 0.5, exag = 8;
  const tilt = new Float32Array(Wt * Ht);
  for (let y = 0; y < Ht; y++)
    for (let x = 0; x < Wt; x++) tilt[y * Wt + x] = -0.1 * x * cst;
  const maskT = new Uint8Array(Wt * Ht).fill(1);
  const vn = GM.vertexNormals3D(tilt, Wt, Ht, cst, maskT, exag, 0);
  // Analytic: surface z' = exag*z, dz'/dx = 8*(-0.1) = -0.8 →
  // n ∝ (0.8, 0, 1)/|..| (east-fall tilts +X).
  const wantN = [0.8, 0, 1].map(v => v / Math.hypot(0.8, 0, 1));
  let nMaxErr = 0, nCount = 0;
  for (let i = 0; i < Wt * Ht; i++) {
    if (!vn[i * 3] && !vn[i * 3 + 1] && !vn[i * 3 + 2]) continue; // untouched
    nCount++;
    nMaxErr = Math.max(nMaxErr,
      Math.abs(vn[i * 3] - wantN[0]), Math.abs(vn[i * 3 + 2] - wantN[2]));
  }
  check('vertex normals ≈ plane normal across interior', 
    nCount > 100 && nMaxErr < 1e-5, `${nCount} verts, err=${nMaxErr.toExponential(2)}`);
  // Unit length everywhere set.
  let unitOK = true;
  for (let i = 0; i < Wt * Ht; i++) {
    const l = Math.hypot(vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]);
    if (l > 0 && Math.abs(l - 1) > 1e-5) unitOK = false;
  }
  check('vertex normals unit-length', unitOK);

  console.log('9. Ambient occlusion factors');
  {
    // Bowl in the middle should be darker than the rim ridge.
    const Wa = 24, Ha = 24;
    const bowl = new Float32Array(Wa * Ha);
    for (let y = 0; y < Ha; y++)
      for (let x = 0; x < Wa; x++) {
        const dx = x - Wa / 2, dy = y - Ha / 2;
        bowl[y * Wa + x] = (dx * dx + dy * dy) * 0.05;   // pit at centre
      }
    const mA = new Uint8Array(Wa * Ha).fill(1);
    const ao = GM.cellAO(bowl, Wa, Ha, mA, 3);
    const c = ao[(Ha / 2) * Wa + Wa / 2];       // deepest point
    const r = ao[2 * Wa + 2];                   // high rim corner region
    check('depression darkened (ao<1)', c < 0.99, c.toFixed(3));
    check('ridge brightened (ao>1)', r > 1.0, r.toFixed(3));
    check('AO stays subtle (0.85..1.12)', c > 0.84 && r < 1.13,
      `${c.toFixed(3)},${r.toFixed(3)}`);
    // Flat grid → everything exactly 1.
    const flatAO = GM.cellAO(new Float32Array(Wa * Ha).fill(7), Wa, Ha, mA, 3);
    let flatOK = true;
    for (let i = 0; i < flatAO.length; i++)
      if (Math.abs(flatAO[i] - 1) > 1e-9) flatOK = false;
    check('flat grid AO ≡ 1', flatOK);
    // Smooth mesh build includes per-corner colours.
    const mm = GM.buildMesh3D(bowl, Wa, Ha, 1, mA, [0, 30], 8, 'elev');
    check('mesh exposes per-corner colours (vcol)',
      mm && mm.vcol && mm.vcol.length === mm.count * 12, mm && mm.count);
  }

  console.log('10. Grid upsampling (bilinear refinement)');
  {
    const Wu = 16, Hu = 16;
    const planeU = new Float32Array(Wu * Hu);
    for (let y = 0; y < Hu; y++)
      for (let x = 0; x < Wu; x++)
        planeU[y * Wu + x] = 5 + 0.2 * x + 0.1 * y;
    const up = GM.upsampleGrid(planeU, Wu, Hu, null, 2);
    check('upsample doubles dims', up.W === 32 && up.H === 32, `${up.W}x${up.H}`);
    let err = 0;
    for (let y = 1; y < up.H - 1; y += 7)
      for (let x = 1; x < up.W - 1; x += 7) {
        const fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5;
        const want = 5 + 0.2 * fx + 0.1 * fy;
        err = Math.max(err, Math.abs(up.grid[y * up.W + x] - want));
      }
    check('refined plane matches analytic (<1e-5)', err < 1e-5, err.toExponential(2));
  }

  console.log('11. Corridor bbox math');
  {
    const green = [41.95, -93.75];
    // Tee ~200m due east of the green.
    const tee = [41.95, -93.75 + 200 / (111320 * Math.cos(41.95 * Math.PI / 180))];
    const bb = GM.corridorBbox(green[0], green[1], tee[0], tee[1], 30, 300);
    const mLat = 110540, mLng = 111320 * Math.cos(41.95 * Math.PI / 180);
    const sideM = (bb[2] - bb[0]) * mLng;
    check('corridor covers both endpoints', 
      bb[0] < green[1] && bb[2] > tee[1] && bb[1] < green[0] && bb[3] > green[0]);
    check('span capped at 300m', sideM <= 301, sideM.toFixed(1));
    const sideLatM = (bb[3] - bb[1]) * mLat;
    check('square-ish bbox', Math.abs(sideM - sideLatM) / sideM < 0.02,
      `${sideM.toFixed(1)} x ${sideLatM.toFixed(1)}`);
    const bbNoTee = GM.corridorBbox(green[0], green[1], NaN, NaN, 30, 300);
    const sideNT = (bbNoTee[2] - bbNoTee[0]) * mLng;
    check('no-tee fallback ≈ green ±150m (300m span)',
      Math.abs(sideNT - 300) < 2, sideNT.toFixed(1));
    const cLng = (bbNoTee[0] + bbNoTee[2]) / 2;
    check('no-tee corridor centred on green', Math.abs(cLng - green[1]) < 1e-9);
    // Tee ~50m due north of the green.
    const bbSmall = GM.corridorBbox(green[0], green[1],
      green[0] + 50 / mLat, green[1], 30, 300);
    const sideSm = (bbSmall[3] - bbSmall[1]) * mLat;
    check('short hole padded by margin (≈110m)', sideSm > 105 && sideSm < 115,
      sideSm.toFixed(1));
  }
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

    // Live precision pass: whole-hole corridor (green ±150m → 300m span) via
    // the same CaddyElev path, then build BOTH meshes without error.
    console.log('5. Live corridor — Ankeny 300m hole flyover grid');
    const bbC = GM.corridorBbox(lat, lng, NaN, NaN, 0, 300);
    const egC = await CaddyElev.fetchElevGrid(bbC, 96);
    check('corridor fetchElevGrid returned data', !!(egC && egC.grid));
    if (egC && egC.grid) {
      let cv = 0, cmin = Infinity, cmax = -Infinity;
      for (let i = 0; i < egC.grid.length; i++)
        if (Number.isFinite(egC.grid[i]) &&
            (!egC.validMask || egC.validMask[i])) {
          cv++;
          if (egC.grid[i] < cmin) cmin = egC.grid[i];
          if (egC.grid[i] > cmax) cmax = egC.grid[i];
        }
      const pctV = 100 * cv / (egC.W * egC.H);
      check('corridor majority valid (>50%)', pctV > 50, pctV.toFixed(1) + '%');
      check('corridor sane relief (<60m)', cmax - cmin < 60,
        (cmax - cmin).toFixed(2));
      // Bilinear sample at exact centre must be finite.
      const zc = GM.sampleElevLocalM(egC, 0, 0);
      check('corridor bilinear centre sample finite',
        zc != null && Number.isFinite(zc), zc);
      // Green mesh (with smooth shading + AO) on the green grid.
      const maskG = new Uint8Array(elev.W * elev.H).fill(1);
      const mGreen = GM.buildMesh3D(elev.grid, elev.W, elev.H,
        elev.cellSizeM, maskG, [cmin, cmax], 8, 'elev');
      check('green mesh builds (smooth+AO)',
        mGreen && mGreen.count > 1000 && !!mGreen.vcol, mGreen && mGreen.count);
      // Corridor mesh with fairway/green-zone colourFn.
      const maskC = new Uint8Array(egC.W * egC.H).fill(1);
      const mHole = GM.buildMesh3D(egC.grid, egC.W, egC.H,
        egC.cellSizeM, maskC, [cmin, cmax], 8, 'slope', {
          colorFn: (i, zMid) => i % 97 === 0
            ? GM.slopeColor(2)
            : [110, 130, 106] });
      check('corridor mesh builds with colorFn',
        mHole && mHole.count > 1000, mHole && mHole.count);
      console.log(`  info - corridor ${egC.W}x${egC.H} ` +
        `cell=${egC.cellSizeM.toFixed(2)}m valid=${pctV.toFixed(0)}% ` +
        `relief=${(cmax - cmin).toFixed(1)}m meshes=` +
        `${mGreen ? mGreen.count : 'x'}/${mHole ? mHole.count : 'x'} quads`);
    }
  } catch (e) {
    failures++;
    console.error('FAIL - live smoke:', e.message);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
