/* tmp_foldcheck.js — are the offset rings self-intersecting (folded)?
   A folded grown/inset ring makes pointInPoly and clipQuadToPoly produce
   garbage in the fold regions — the predicted root cause of the 250 empty
   clips + moat arcs. */
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
  const segInt = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };
  const crossings = (pts) => {
    const n = pts.length; let c = 0; const where = [];
    for (let i = 0; i < n; i++) {
      const a1 = pts[i], a2 = pts[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        const b1 = pts[j], b2 = pts[(j + 1) % n];
        if (segInt(a1, a2, b1, b2)) { c++; if (where.length < 8) where.push([i, j]); }
      }
    }
    return { c, where };
  };
  console.log(`raw poly: ${poly.length} verts, crossings:`, crossings(poly).c);
  for (const h of [0.0625, 0.25, 0.5, -0.15, -0.935]) {
    const r = C.polyOffsetCache(poly, h);
    const x = crossings(r);
    console.log(`offset h=${h}: ${r.length} verts, crossings: ${x.c}`, x.where.length ? JSON.stringify(x.where) : '');
  }
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
