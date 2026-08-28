/* tmp_clipcheck.js — unit-test the three boundary primitives on the REAL
   OSM polygon (fetch once from Overpass — cheap, not USGS):
   1. winding (signed area)
   2. growPolyLocal(poly, +0.25)  — GROW: |area| must INCREASE
   3. polyOffsetCache(polyGrown, -0.935) — INSET: |area| must DECREASE
   4. clipQuadToPoly over the cell grid: identity for interior, real clip
      at rim, and NOT empty anywhere the mask would have cells. */
'use strict';
global.window = { GreenMapCore: null };
require('./greenmap.js');
const C = global.window.GreenMapCore;
const LAT = 41.91314, LNG = -93.60971, SPAN = 40;
(async () => {
  const q = `[out:json][timeout:15];(way["golf"="green"](around:120,${LAT},${LNG}););out geom 1;`;
  const res = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
  const data = await res.json();
  const el = data.elements && data.elements[0];
  if (!el || !el.geometry) { console.log('NO POLY'); process.exit(1); }
  const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
  const poly = el.geometry.map(g => [(g.lon - LNG) * 111320 * Math.cos(LAT * Math.PI / 180),
                                     (g.lat - LAT) * 111320]);
  const area2 = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2;
  };
  const A0 = area2(poly);
  console.log(`poly: ${poly.length} verts, signed area ${A0.toFixed(1)} m² → ${A0 > 0 ? 'CCW' : 'CW'}`);
  const grown = C.polyOffsetCache(poly, 0.25);
  const A1 = area2(grown);
  console.log(`growPolyLocal(+0.25): ${grown.length} verts, area ${A1.toFixed(1)} (${A1 > A0 ? 'GREW ✓' : 'SHRANK ✗BUG'})`);
  const inset = C.polyOffsetCache(grown, -0.623 * 1.5);
  const A2 = area2(inset);
  console.log(`polyOffsetCache(grown, -0.935): ${inset.length} verts, area ${A2.toFixed(1)} (${Math.abs(A2) < Math.abs(A1) ? 'INSET ✓' : 'GREW ✗BUG'})`);
  // Cell-grid clip test at the 64-grid cell size 0.623: cells whose centres
  // are inside the raw poly (like polyMask does).
  const cs = 0.623;
  let nIn = 0, nIdentity = 0, nClipped = 0, nEmpty = 0, nPartial = 0;
  const worst = [];
  for (let gy = -34; gy < 34; gy++) {
    for (let gx = -34; gx < 34; gx++) {
      const cx = (gx + 0.5) * cs, cy = (gy + 0.5) * cs; // cell CENTRE (mask convention)
      // cell corners in buildMesh3D convention: cxm(x)=(x+0.5-W/2)*cs → use same
      const x0 = cx - cs / 2, x1 = cx + cs / 2, y0 = cy - cs / 2, y1 = cy + cs / 2;
      if (!C.pointInPoly(cx, cy, poly)) continue;
      nIn++;
      const pieces = C.clipQuadToPoly(
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], grown);
      let pa = 0;
      for (const pc of pieces) pa += Math.abs(area2(pc));
      const cellA = cs * cs;
      if (pieces.length === 0 || pa < 1e-6) { nEmpty++; worst.push([gx, gy, 0]); }
      else if (pa > cellA * 0.999) nIdentity++;
      else { nClipped++; nPartial++; worst.push([gx, gy, pa / cellA]); }
    }
  }
  console.log(`cells centre-in-poly: ${nIn}`);
  console.log(`  clip=identity: ${nIdentity}  clipped(partial): ${nClipped}  EMPTY: ${nEmpty}`);
  console.log(`  sample partial fractions: ${worst.filter(w => w[2] > 0).slice(0, 12).map(w => w[2].toFixed(2)).join(' ')}`);
  // Deep-interior sanity: cells far from ring MUST be identity
  let deepId = 0, deepN = 0;
  for (let gy = -20; gy < 20; gy++) for (let gx = -20; gx < 20; gx++) {
    const cx = (gx + 0.5) * cs, cy = (gy + 0.5) * cs;
    if (!C.pointInPoly(cx, cy, poly)) continue;
    if (!C.pointInPoly(cx, cy, inset)) continue;   // only deep interior
    deepN++;
    const pieces = C.clipQuadToPoly(
      [[cx - cs / 2, cy - cs / 2], [cx + cs / 2, cy - cs / 2],
       [cx + cs / 2, cy + cs / 2], [cx - cs / 2, cy + cs / 2]], grown);
    let pa = 0; for (const pc of pieces) pa += Math.abs(area2(pc));
    if (pa > cs * cs * 0.999) deepId++;
  }
  console.log(`deep-interior cells: ${deepN}, identity: ${deepId} ${deepN === deepId ? '✓' : '✗ CLIP EATS INTERIOR CELLS'}`);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
