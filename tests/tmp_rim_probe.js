/* TEMP probe (not for commit): v1.0.87 rim-subdivision investigation.
   1. crash probe: masked cell with NaN elevation + valid neighbour
   2. hole-view subdivision reachability (all-valid mask)
   3. silhouette staircase quantification: polygon path vs ellipse fallback
   Run: node tests/tmp_rim_probe.js
*/
'use strict';
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'greenmap.js'));
const GM = global.window.GreenMapCore;

/* ---------- 1. NaN masked-cell crash probe ---------- */
{
  const W = 8, H = 8, cs = 0.625;
  const grid = new Float32Array(W * H).fill(10);
  const mask = new Uint8Array(W * H).fill(1);
  // one masked cell with NaN elevation, neighbours valid
  grid[3 * W + 3] = NaN;
  let threw = null, mesh = null;
  try {
    mesh = GM.buildMesh3D(grid, W, H, cs, mask, [9, 11], 8, 'slope',
      { smooth: true, ao: false, polyLocalM: [[-2, -2], [2, -2], [2, 2], [-2, 2]] });
  } catch (e) { threw = e; }
  console.log('1. NaN masked cell + polygon:',
    threw ? 'THROWS -> ' + threw.message : 'no throw (quads=' + (mesh && mesh.count) + ')');
}

/* ---------- 2. hole-view subdivision reachability ---------- */
{
  // Corridor mesh uses maskAll (every valid cell). If all cells are masked,
  // the `!mask[c]` subdivision condition can never fire.
  const W = 16, H = 16, cs = 2;
  const grid = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) grid[i] = 10 + (i % W) * 0.05;
  const maskAll = new Uint8Array(W * H).fill(1);
  const poly = [[-30, -30], [30, -30], [30, 30], [-30, 30]]; // irrelevant frame
  const mesh = GM.buildMesh3D(grid, W, H, cs, maskAll, [9, 12], 8, 'slope',
    { smooth: true, ao: false, polyLocalM: poly });
  console.log('2. all-valid corridor mask: subdivision fires? quad count =',
    mesh.count, '(16x15=240 => no cell subdivided => polyLocalM inert in hole view)');
}

/* ---------- 3. silhouette staircase quantification ---------- */
// Surface boundary = set of mask cells with a non-masked 4-neighbour (v1.0.86
// path) vs sub-quad edge (v1.0.87 polygon path). Measure max radial deviation
// of the surface silhouette from the true boundary for both.
function silhouetteDeviation(maskIsPoly, W, H, cs, poly, centre) {
  // outermost kept sample along each of 360 rays from centre
  let maxDev = 0, devSum = 0, n = 0;
  // reference radius along ray: polygon edge distance (ray march) or ellipse r
  const inRef = (mx, my) => maskIsPoly
    ? GM.pointInPoly(mx, my, poly)
    : (mx * mx + my * my) <= Math.pow(40 * 0.36, 2);
  for (let a = 0; a < 360; a += 2) {
    const th = a * Math.PI / 180;
    const ux = Math.cos(th), uy = Math.sin(th);
    // last inside position along ray at 0.02m resolution, from centre out
    let lastIn = null;
    for (let r = 0; r < 20; r += 0.02) {
      const mx = centre[0] + ux * r, my = centre[1] + uy * r;
      if (inRef(mx, my)) lastIn = r; else break;
    }
    if (lastIn === null) continue;
    // reference boundary radius = first outside r
    let rRef = lastIn;
    // cell-centre staircase boundary: march cells (mask semantics)
    // find max r whose containing cell centre is inside ref
    let lastCellIn = null;
    for (let r = 0; r < 20; r += 0.02) {
      const mx = centre[0] + ux * r, my = centre[1] + uy * r;
      const cx = Math.floor(mx / cs + W / 2), cy = Math.floor(H / 2 - my / cs);
      const i = cy * W + cx;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      if (inRef((cx + 0.5 - W / 2) * cs, (H / 2 - cy - 0.5) * cs)) lastCellIn = r;
    }
    const dev = Math.abs(lastCellIn - rRef);
    if (Number.isFinite(dev)) { maxDev = Math.max(maxDev, dev); devSum += dev; n++; }
  }
  return { maxDev, meanDev: devSum / Math.max(1, n) };
}
{
  // Realistic green view: 40m span, 64 cells (0.625m), wavy polygon
  const W = 64, H = 64, cs = 40 / 64;
  const poly = [];
  for (let k = 0; k < 48; k++) {
    const th = k / 48 * Math.PI * 2;
    const r = 7 + 1.3 * Math.sin(3 * th) + 0.8 * Math.cos(5 * th);
    poly.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  const mask = GM.polyMask(poly, W, H, cs);
  const cellCount = mask.reduce((a, b) => a + b, 0);
  console.log('3a. polygon path: mask cells =', cellCount);
  // v1.0.86 silhouette = cell-centre staircase: deviation vs true polygon
  const dev86 = silhouetteDeviation(true, W, H, cs, poly, [0, 0]);
  console.log('    v1.0.86 rim deviation from true polygon: max',
    dev86.maxDev.toFixed(2) + 'm  mean ' + dev86.meanDev.toFixed(2) + 'm',
    ' (~' + (dev86.maxDev / cs * 100).toFixed(0) + '% of a cell)');
  // px at typical iPhone zoom: 40m across 1170pt * 3 dpr
  const mPerPx = 40 / (390 * (window.devicePixelRatio || 1) * (390 / 390));
  console.log('    (40m span at 3x dpr ≈ 0.034 m/px → max notch ≈',
    (dev86.maxDev / 0.034).toFixed(0), 'px)');
  // v1.0.87 polygon path: sub-quads at cs/6 → residual staircase
  console.log('    v1.0.87 polygon-path step ≈', (cs / 6).toFixed(3), 'm ≈',
    (cs / 6 / 0.034).toFixed(1), 'px  (sub-pixel at 3x)');
  // ellipse fallback (Overpass failed): cell-tested ellipse, cs=0.625
  const devEll = silhouetteDeviation(false, W, H, cs, null, [0, 0]);
  console.log('3b. ellipse fallback rim deviation: max',
    devEll.maxDev.toFixed(2) + 'm  mean ' + devEll.meanDev.toFixed(2) + 'm',
    '→ notches ≈', (devEll.maxDev / 0.034).toFixed(0), 'px at 3x');
}
console.log('probe done');
