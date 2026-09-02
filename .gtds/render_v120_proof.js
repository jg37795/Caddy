/* render_v120_proof.js — END-TO-END visual proof for v1.20.0:
   pulls REAL exec hole 1 geometry (path, green, shapes) from OSM via
   the assembled pipeline, projects through the NEW true-scale mapping
   (uniform yd/px, no clamp), and renders the cartoon exactly as the
   app will draw it. Compare against James's OSM reference screenshot. */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');
const extract = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', start), depth = 0, end = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  return src.slice(start, end + 1);
};
const sandbox = new Function([
  'const OSM_M_PER_DEG = 111320;',
  'const OSM_YD_PER_M = 1.0936133;',
  'const SIMPLIFY_TOL_M = 2;',
  extract('osmGeomLatLng'),
  extract('osmRing'),
  extract('osmSimplifyRing'),
  extract('osmOuterRings'),
  'return { osmOuterRings, osmSimplifyRing, osmRing };',
].join('\n'));
const { osmOuterRings, osmSimplifyRing, osmRing } = sandbox();

// ---- Real data captured live from the exec area
const areaId = 3610543316;   // relation 10543316 (exec course)
const q = `[out:json][timeout:25];area(${areaId})->.a;(
  way["golf"="hole"](area.a);
  way["golf"="green"](area.a);
  way["golf"="fairway"](area.a);
  relation["natural"="water"](area.a);
  way["natural"="water"](area.a);
  way["golf"="bunker"](area.a);
  way["golf"="tee"](area.a);
);out geom;`;
fs.writeFileSync(path.join(__dirname, 'exec_full_q.txt'), q);

(async () => {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
  });
  const j = await res.json();
  const els = j.elements || [];
  console.log('elements:', els.length);
  fs.writeFileSync(path.join(__dirname, 'exec_full_real.json'),
    JSON.stringify(els));

  // ---- Mirror buildAutoCourse's shape capture + assignment (hole 1)
  const holeWays = els.filter(e => (e.tags || {}).golf === 'hole' &&
    String((e.tags || {}).ref) === '1');
  const holeWay = holeWays[0];
  if (!holeWay) { console.error('no hole 1 way'); process.exit(1); }
  const pathPts = holeWay.geometry.map(g => ({ lat: g.lat, lng: g.lon }));
  const greenRings = els.filter(e => (e.tags || {}).golf === 'green')
    .map(e => osmRing(e)).filter(Boolean);
  const greens = els.filter(e => (e.tags || {}).golf === 'green')
    .map(e => {
      const ring = osmRing(e);
      if (!ring) return null;
      const c = ring.reduce((s, p) => ({ lat: s.lat + p.lat / ring.length,
        lng: s.lng + p.lng / ring.length }), { lat: 0, lng: 0 });
      return { ring, centroid: c };
    }).filter(Boolean);
  const endPt = pathPts[pathPts.length - 1];
  // v1.20.1: associate the green NEAREST the path end (like the real
  // importer) — greens[0] can belong to another hole.
  let green = null, bestGd = Infinity;
  for (const g of greens) {
    if (!g.centroid) continue;
    const d = Math.hypot(
      (g.centroid.lng - endPt.lng) * 111320 *
        Math.cos(endPt.lat * Math.PI / 180),
      (g.centroid.lat - endPt.lat) * 111320) / 0.9144;
    if (d < bestGd) { bestGd = d; green = g; }
  }

  const CORRIDOR_YD = 90;
  const distToPathYd = (pt, pts) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const K = 111320 * Math.cos(a.lat * Math.PI / 180);
      const ax = a.lng * K, ay = a.lat * 111320;
      const bx = b.lng * K, by = b.lat * 111320;
      const px2 = pt.lng * K, py2 = pt.lat * 111320;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1,
        ((px2 - ax) * dx + (py2 - ay) * dy) / (dx * dx + dy * dy || 1e-12)));
      const d = Math.hypot(px2 - (ax + t * dx), py2 - (ay + t * dy));
      if (d < best) best = d;
    }
    return best / 0.9144;
  };
  const grab = (kinds) => {
    const out = [];
    for (const kind of kinds) {
      for (const el of els) {
        const t = el.tags || {};
        const match = kind === 'water'
          ? (t.natural === 'water' || t.golf === 'water_hazard' ||
             t.golf === 'lateral_water_hazard')
          : t.golf === kind;
        if (!match) continue;
        const rings = osmOuterRings(el) || [];
        for (const ring of rings) {
          if (!ring || ring.length < 4) continue;
          const simple = osmSimplifyRing(ring, 40);
          if (!simple) continue;
          const c = simple.reduce((s, p) => ({ lat: s.lat + p.lat / simple.length,
            lng: s.lng + p.lng / simple.length }), { lat: 0, lng: 0 });
          if (distToPathYd(c, pathPts) <= CORRIDOR_YD) out.push(simple);
        }
      }
    }
    return out;
  };
  const shapes = {
    fairways: grab(['fairway']),
    bunkers: grab(['bunker']),
    water: grab(['water']),
    tees: grab(['tee']),
    rough: grab(['rough']),
  };
  console.log('shapes:', Object.entries(shapes).map(([k, v]) =>
    k + ':' + v.length).join(' '));

  // ---- True-scale mapping (exactly the new prep.js fit)
  const greenRing = green ? green.ring : null;
  let crossMin = -40, crossMax = 40;
  const survey = (ll) => {
    // rough cross vs the straight tee→green axis (proof-grade)
    const K = 111320 * Math.cos(pathPts[0].lat * Math.PI / 180);
    const ax = (pathPts[pathPts.length - 1].lng - pathPts[0].lng) * K;
    const ay = (pathPts[pathPts.length - 1].lat - pathPts[0].lat) * 111320;
    const L = Math.hypot(ax, ay) || 1e-9;
    const px2 = (ll.lng - pathPts[0].lng) * K;
    const py2 = (ll.lat - pathPts[0].lat) * 111320;
    const c = (px2 * (ay / L) - py2 * (ax / L));
    if (c < crossMin) crossMin = c;
    if (c > crossMax) crossMax = c;
  };
  pathPts.forEach(survey);
  if (greenRing) greenRing.forEach(survey);
  // v1.20.2: shapes expand the window again (the 140-yd cap clipped
  // the donut pond into slivers); grass corridor tightened instead.
  Object.values(shapes).forEach(arr => arr.forEach(ring => ring.forEach(survey)));
  const crossSpan = Math.min(200, Math.max(110, crossMax - crossMin) + 28);
  const W = 500, H = 300, padT = 24, padB = 24, padL = 28, padR = 32;
  const spanX = W - padL - padR;
  const effYd = Math.round(pathPts.reduce((s, p, i) => {
    if (!i) return 0;
    const K = 111320 * Math.cos(pathPts[0].lat * Math.PI / 180);
    return s + Math.hypot((p.lng - pathPts[i - 1].lng) * K,
      (p.lat - pathPts[i - 1].lat) * 111320) / 0.9144;
  }, 0));
  const fitLen = Math.max(120, effYd);
  const ydPerPx = Math.max(fitLen / spanX, crossSpan / (H - padT - padB));
  // project along/cross with the viewer-behind-tee basis
  const K = 111320 * Math.cos(pathPts[0].lat * Math.PI / 180);
  const gx = (pathPts[pathPts.length - 1].lng - pathPts[0].lng) * K;
  const gy = (pathPts[pathPts.length - 1].lat - pathPts[0].lat) * 111320;
  const L = Math.hypot(gx, gy) || 1e-9;
  const ux = gx / L, uy = gy / L;
  const pxb = uy, pyb = -ux;
  const toXY = (ll) => {
    const ex = (ll.lng - pathPts[0].lng) * K;
    const ny = (ll.lat - pathPts[0].lat) * 111320;
    return { along: ex * ux + ny * uy, cross: ex * pxb + ny * pyb };
  };
  const X = (along) => padL + along / ydPerPx;
  const Y = (cross) => (padT + (H - padB)) / 2 + cross / ydPerPx;
  const traceRing = (ctx, ring) => {
    ctx.beginPath();
    ring.forEach((ll, i) => {
      const { along, cross } = toXY(ll);
      const x = X(along), y = Y(cross);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  };

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1411'; ctx.fillRect(0, 0, W, H);
  const drawPolys = (rings, fill, stroke) => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1;
    rings.forEach((ring) => { traceRing(ctx, ring); ctx.fill(); ctx.stroke(); });
  };
  drawPolys(shapes.rough, 'rgba(38,66,48,0.35)', 'rgba(0,0,0,0)');
  drawPolys(shapes.fairways, 'rgba(64,152,99,0.42)', 'rgba(122,232,160,0.35)');
  // v1.20.2: brighter water so the horseshoe arms read at cartoon scale
  ctx.lineWidth = 1.5;
  drawPolys(shapes.water, 'rgba(58,143,212,0.55)', 'rgba(126,200,255,0.8)');
  drawPolys(shapes.bunkers, 'rgba(196,138,18,0.55)', 'rgba(255,209,102,0.75)');
  drawPolys(shapes.tees, 'rgba(130,190,140,0.4)', 'rgba(200,240,205,0.4)');
  if (greenRing) drawPolys([greenRing], 'rgba(125,255,155,0.25)', '#7dff9b');
  // hole path (thin)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath();
  pathPts.forEach((ll, i) => {
    const { along, cross } = toXY(ll);
    const x = X(along), y = Y(cross);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  // straight shot line tee→green (v1.19.1 ball flight)
  ctx.strokeStyle = '#5ea8ff'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  const t0 = toXY(pathPts[0]);
  const t1 = toXY(pathPts[pathPts.length - 1]);
  ctx.moveTo(X(t0.along), Y(t0.cross));
  ctx.lineTo(X(t1.along), Y(t1.cross));
  ctx.stroke();
  fs.writeFileSync(path.join(__dirname, 'hole1_v120.png'),
    canvas.toBuffer('image/png'));
  console.log('written: hole1_v120.png |', effYd, 'yd | ydPerPx',
    ydPerPx.toFixed(2));
})().catch((e) => { console.error(e); process.exit(1); });
