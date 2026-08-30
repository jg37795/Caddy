/* tmp_containcheck.js — for the S-H-empty cells: is the cell centre inside
   the GROWN ring per pointInPoly (concave-correct)? And are all raw verts
   inside grown (true containment)? Rules growPolyLocal in/out. */
'use strict';
global.window = { GreenMapCore: null };
require('./greenmap.js');
const C = global.window.GreenMapCore;
const LAT = 41.91314, LNG = -93.60971;
(async () => {
  const q = `[out:json][timeout:15];(way["golf"="green"](around:120,${LAT},${LNG}););out geom 1;`;
  const res = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
  const data = await res.json();
  const el = data.elements && data.elements[0];
  const poly = el.geometry.map(g => [(g.lon - LNG) * 111320 * Math.cos(LAT * Math.PI / 180),
                                     (g.lat - LAT) * 111320]);
  const grown = C.polyOffsetCache(poly, 0.25);
  const rawIn = poly.filter(p => C.pointInPoly(p[0], p[1], grown)).length;
  console.log(`raw verts strictly inside grown: ${rawIn}/${poly.length}`);
  const cs = 0.623;
  let emptySH = 0, emptyButInside = 0;
  for (let gy = -34; gy < 34; gy++)
    for (let gx = -34; gx < 34; gx++) {
      const x0 = gx * cs, x1 = (gx + 1) * cs, y0 = gy * cs, y1 = (gy + 1) * cs;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (!C.pointInPoly(cx, cy, poly)) continue;
      const pieces = C.clipQuadToPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], grown);
      const area2 = (pts) => { let a = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
          a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
        return Math.abs(a / 2); };
      let pa = 0; for (const pc of pieces) pa += area2(pc);
      if (pa < 1e-6) {
        emptySH++;
        // all four corners inside grown (concave-correct test)?
        const cin = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
          .filter(p => C.pointInPoly(p[0], p[1], grown)).length;
        if (cin === 4) emptyButInside++;
      }
    }
  console.log(`S-H-empty cells: ${emptySH}; of those, all-4-corners-inside-grown: ${emptyButInside}`);
  console.log(emptyButInside > 0 ? '=> S-H CONCAVE FAILURE CONFIRMED (cells fully inside the ring were deleted)'
                                 : '=> empties are genuinely outside grown — offset bug instead');
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
