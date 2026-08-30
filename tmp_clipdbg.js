/* tmp_clipdbg.js — find one EMPTY clip cell and trace SH stage by stage. */
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
  // sanity dump of grown ring
  const bad = [];
  grown.forEach((p, i) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) bad.push([i, p]);
  });
  console.log('grown NaN verts:', bad.length, JSON.stringify(bad.slice(0, 5)));
  // duplicate consecutive verts?
  let dups = 0;
  for (let i = 0; i < grown.length; i++) {
    const a = grown[i], b = grown[(i + 1) % grown.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) dups++;
  }
  console.log('grown zero-length edges:', dups);
  const cs = 0.623;
  // find empty cells
  const area2 = (pts) => { let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2; };
  let shown = 0;
  for (let gy = -34; gy < 34 && shown < 3; gy++)
    for (let gx = -34; gx < 34 && shown < 3; gx++) {
      const x0 = gx * cs, x1 = (gx + 1) * cs, y0 = gy * cs, y1 = (gy + 1) * cs;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (!C.pointInPoly(cx, cy, poly)) continue;
      const q4 = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const pieces = C.clipQuadToPoly(q4, grown);
      let pa = 0; for (const pc of pieces) pa += Math.abs(area2(pc));
      if (pa < 1e-6 && shown < 3) {
        shown++;
        console.log(`\nEMPTY cell gx=${gx} gy=${gy} centre=(${cx.toFixed(2)},${cy.toFixed(2)})`);
        // manual SH trace
        let out = [q4];
        const n = grown.length;
        let a2 = 0;
        for (let i = 0, j = n - 1; i < n; j = i++)
          a2 += grown[j][0] * grown[i][1] - grown[i][0] * grown[j][1];
        const ccw = a2 > 0;
        for (let e = 0; e < n && out.length; e++) {
          const A = grown[e], B = grown[(e + 1) % n];
          const ex = B[0] - A[0], ey = B[1] - A[1];
          const side = (px, py) =>
            (ex * (py - A[1]) - ey * (px - A[0])) * (ccw ? 1 : -1);
          const next = [];
          for (const subj of out) {
            const pts = subj; const nv = pts.length; const r2 = [];
            for (let i = 0; i < nv; i++) {
              const P = pts[i], Q = pts[(i + 1) % nv];
              const sP = side(P[0], P[1]), sQ = side(Q[0], Q[1]);
              if (sP >= 0) { r2.push(P);
                if (sQ < 0) { const t = sP / (sP - sQ);
                  r2.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t,
                           P[2] + (Q[2] - P[2]) * t]); } }
              else if (sQ >= 0) { const t = sP / (sP - sQ);
                r2.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t,
                         P[2] + (Q[2] - P[2]) * t]); }
            }
            console.log(`  edge ${e}: in=${pts.length} out=${r2.length} sides=[${pts.map(p => side(p[0], p[1]).toFixed(3)).join(' ')}]`);
            if (r2.length === 4) next.push(r2);
            else if (r2.length > 4)
              for (let i = 1; i < r2.length - 1; i++)
                next.push([r2[0], r2[i], r2[i + 1], r2[i + 1]]);
            else if (r2.length === 3) next.push([r2[0], r2[1], r2[2], r2[2]]);
          }
          out = next;
        }
        console.log('  final pieces:', out.length);
      }
    }
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
