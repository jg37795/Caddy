/* render_v1211_hole1.js — mirror the v1.21.1 cartoon pipeline for real
   Jester exec hole 1: buildAutoCourse-equivalent capture/assignment +
   holeMapSvg-equivalent projection + strip/chord/turf clip composition.
   Rasterises the resulting SVG structure to PNG via node-canvas and
   prints the clip/intersection math for the red-region diagnosis. */
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
  'function osmXY(lat, lng, refLat) { return { x: lng * OSM_M_PER_DEG * Math.cos((refLat * Math.PI) / 180), y: lat * OSM_M_PER_DEG }; }',
  extract('osmGeomLatLng'),
  extract('osmRing'),
  extract('osmSimplifyRing'),
  extract('osmOuterRings'),
  extract('osmPointInRing'),
  extract('osmDistPointToPathM'),
  extract('osmDistPathToRingM'),
  extract('osmSegsCross'),
  extract('osmPolylinesCross'),
  extract('osmFlightHitsRing'),
  'return { osmOuterRings, osmSimplifyRing, osmRing, osmDistPathToRingM, osmFlightHitsRing };',
].join('\n'));
const { osmOuterRings, osmSimplifyRing, osmRing,
  osmDistPathToRingM, osmFlightHitsRing } = sandbox();

const els = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'exec_v1211.json'), 'utf-8'));
const OSM_YD = 1.0936133;

// --- capture (mirror pushPolygon, incl. dedup)
const poly = { fairways: [], bunkers: [], water: [], tees: [], rough: [] };
for (const el of els) {
  const t = el.tags || {};
  const kind =
    t.golf === 'fairway' ? 'fairways' :
    t.golf === 'rough' ? 'rough' :
    t.golf === 'tee' ? 'tees' :
    t.golf === 'bunker' ? 'bunkers' :
    (t.golf === 'water_hazard' || t.golf === 'lateral_water_hazard' ||
      t.natural === 'water') ? 'water' : null;
  if (!kind) continue;
  const rings = osmOuterRings(el) || [];
  for (const ring of rings) {
    if (!ring || ring.length < 4) continue;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of ring) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    }
    const diagYd = Math.hypot(
      (maxLat - minLat) * 111320,
      (maxLng - minLng) * 111320 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180)
    ) / 0.9144;
    if (diagYd > 1200) continue;
    poly[kind].push(osmSimplifyRing(ring, 40));
  }
}
// dedup water within 25 yd centroid (v1.20.5)
const centroid = (r) => r.reduce((s, p) => ({
  lat: s.lat + p.lat / r.length, lng: s.lng + p.lng / r.length }), { lat: 0, lng: 0 });
const distYd = (a, b) => {
  const K = 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot((a.lng - b.lng) * K, (a.lat - b.lat) * 111320) / 0.9144;
};
const uniqWater = [];
for (const r of poly.water) {
  const c = centroid(r);
  const dup = uniqWater.find((k) => distYd(c, k.c) <= 25);
  if (dup) { if (r.length > dup.r.length) { dup.r = r; dup.c = c; } continue; }
  uniqWater.push({ r, c });
}
poly.water = uniqWater.map((k) => k.r);
console.log('captured:', Object.entries(poly).map(([k, v]) => k + ':' + v.length).join(' '));

// --- hole 1 record
const holeWay = els.find((e) => (e.tags || {}).golf === 'hole' &&
  String((e.tags || {}).ref) === '1');
const pathPts = holeWay.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
const greens = els.filter((e) => (e.tags || {}).golf === 'green').map((e) => {
  const ring = osmRing(e);
  if (!ring) return null;
  return { ring, centroid: centroid(ring) };
}).filter(Boolean);
const endPt = pathPts[pathPts.length - 1];
let green = null, bgd = Infinity;
for (const g of greens) {
  const d = distYd(g.centroid, endPt);
  if (d < bgd) { bgd = d; green = g; }
}
const effYd = Math.round(pathPts.reduce((s, p, i) => {
  if (!i) return 0;
  const K = 111320 * Math.cos(pathPts[0].lat * Math.PI / 180);
  return s + Math.hypot((p.lng - pathPts[i - 1].lng) * K,
    (p.lat - pathPts[i - 1].lat) * 111320) / 0.9144;
}, 0));
console.log('hole 1:', effYd, 'yd | green', bgd.toFixed(1), 'yd from end');

// --- assignment (mirror v1.20.4 considerShape)
const CORRIDOR_YD = 90, GRASS_YD = 55;
const shapes = { fairways: [], bunkers: [], water: [], tees: [], rough: [] };
const consider = (ring, key, cor) => {
  const d = osmDistPathToRingM(pathPts, ring) * OSM_YD;
  if (d <= cor) shapes[key].push(ring);
};
poly.fairways.forEach((r) => consider(r, 'fairways', GRASS_YD));
poly.rough.forEach((r) => consider(r, 'rough', GRASS_YD));
poly.tees.forEach((r) => consider(r, 'tees', GRASS_YD));
poly.bunkers.forEach((r) => consider(r, 'bunkers', CORRIDOR_YD));
poly.water.forEach((r) => consider(r, 'water', CORRIDOR_YD));
console.log('assigned hole 1:', Object.entries(shapes).map(([k, v]) =>
  k + ':' + v.length).join(' '));

// --- projection (v1.20.9 fit: strip width only; along = hole)
const anchor = pathPts[0];
const mLat = 111320, mLng = 111320 * Math.cos(anchor.lat * Math.PI / 180);
const en = (ll) => ({
  x: ((ll.lng - anchor.lng) * mLng) / 0.9144,
  y: ((ll.lat - anchor.lat) * mLat) / 0.9144,
});
const tgt = en(pathPts[pathPts.length - 1]);
const L = Math.hypot(tgt.x, tgt.y) || 1e-9;
const ux = tgt.x / L, uy = tgt.y / L;
const pxb = uy, pyb = -ux;
const toAC = (ll) => {
  const p = en(ll);
  return { along: p.x * ux + p.y * uy, cross: p.x * pxb + p.y * pyb };
};
const W = 500, H = 300, padT = 24, padB = 24, padL = 28, padR = 32;
const innerH = H - padT - padB;
const spanX = W - padL - padR;
const ac = pathPts.map(toAC);
let aMin = Infinity, aMax = -Infinity, cMin = Infinity, cMax = -Infinity;
const acc = (p) => {
  aMin = Math.min(aMin, p.along); aMax = Math.max(aMax, p.along);
  cMin = Math.min(cMin, p.cross); cMax = Math.max(cMax, p.cross);
};
ac.forEach(acc);
const STRIP = 20;
cMin = Math.min(cMin, -STRIP); cMax = Math.max(cMax, STRIP);
(shapes.fairways || []).forEach((r) => r.forEach((ll) => acc(toAC(ll))));
(shapes.rough || []).forEach((r) => r.forEach((ll) => acc(toAC(ll))));
(shapes.bunkers || []).forEach((r) => r.forEach((ll) => acc(toAC(ll))));
if (green) green.ring.forEach((ll) => acc(toAC(ll)));
const PAD = 12;
const alongSpan = Math.max(40, aMax - aMin) + PAD * 2;
const crossSpan = Math.max(28, cMax - cMin) + PAD * 2;
const ydPerPx = Math.max(alongSpan / spanX, crossSpan / innerH);
const aMid = (aMin + aMax) / 2, cMid = (cMin + cMax) / 2;
const X = (a) => padL + spanX / 2 + (a - aMid) / ydPerPx;
const Y = (c) => padT + innerH / 2 + (c - cMid) / ydPerPx;
const P = (ll) => { const p = toAC(ll); return { x: X(p.along), y: Y(p.cross) }; };

// --- corridor + chord + turf rings in screen space
const offRing = (() => {
  const pts = ac.slice();
  const f = pts[0], s = pts[1];
  const d0 = Math.hypot(s.along - f.along, s.cross - f.cross) || 1e-9;
  pts.unshift({ along: f.along - (s.along - f.along) / d0 * STRIP,
    cross: f.cross - (s.cross - f.cross) / d0 * STRIP });
  const l = pts[pts.length - 1], pv = pts[pts.length - 2];
  const dN = Math.hypot(l.along - pv.along, l.cross - pv.cross) || 1e-9;
  pts.push({ along: l.along + (l.along - pv.along) / dN * STRIP,
    cross: l.cross + (l.cross - pv.cross) / dN * STRIP });
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    let dx, dy;
    if (i === 0) { dx = pts[1].along - pts[0].along; dy = pts[1].cross - pts[0].cross; }
    else if (i === pts.length - 1) { dx = pts[i].along - pts[i - 1].along; dy = pts[i].cross - pts[i - 1].cross; }
    else { dx = pts[i + 1].along - pts[i - 1].along; dy = pts[i + 1].cross - pts[i - 1].cross; }
    const len = Math.hypot(dx, dy) || 1e-9;
    const nx = -dy / len, ny = dx / len;
    left.push({ along: pts[i].along + nx * STRIP, cross: pts[i].cross + ny * STRIP });
    right.push({ along: pts[i].along - nx * STRIP, cross: pts[i].cross - ny * STRIP });
  }
  return left.concat(right.reverse());
})();
const chord = (() => {
  const a = ac[0], b = ac[ac.length - 1];
  const dx = b.along - a.along, dy = b.cross - a.cross;
  const len = Math.hypot(dx, dy) || 1e-9;
  const nx = -dy / len, ny = dx / len;
  const aE = { along: a.along - dx / len * STRIP, cross: a.cross - dy / len * STRIP };
  const bE = { along: b.along + dx / len * STRIP, cross: b.cross + dy / len * STRIP };
  return [
    { along: aE.along + nx * STRIP, cross: aE.cross + ny * STRIP },
    { along: bE.along + nx * STRIP, cross: bE.cross + ny * STRIP },
    { along: bE.along - nx * STRIP, cross: bE.cross - ny * STRIP },
    { along: aE.along - nx * STRIP, cross: aE.cross - ny * STRIP },
  ];
})();
const scr = (p) => ({ x: X(p.along), y: Y(p.cross) });
const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.cross > p.cross) !== (b.cross > p.cross) &&
        p.along < ((b.along - a.along) * (p.cross - a.cross)) /
          ((b.cross - a.cross) || 1e-12) + a.along) inside = !inside;
  }
  return inside;
};
// turf union test: any fairway/rough/green ring contains the point
const turfRings = [...shapes.fairways, ...shapes.rough,
  ...(green ? [green.ring] : [])];
const onTurf = (ll) => turfRings.some((r) => {
  const ring = r.map(toAC);
  return inRing(toAC(ll), ring);
});
const inStrip = (ll) => {
  const p = toAC(ll);
  return inRing(p, offRing) || inRing(p, chord);
};

// --- rasterize: turf, then water ∩ (strip∪chord) ∩ turf
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1411'; ctx.fillRect(0, 0, W, H);
const pathRing = (ring) => {
  ctx.beginPath();
  ring.forEach((ll, i) => {
    const q = P(ll);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
};
ctx.fillStyle = 'rgba(38,66,48,0.35)';
(shapes.rough || []).forEach((r) => { pathRing(r); ctx.fill(); });
ctx.fillStyle = 'rgba(64,152,99,0.42)';
(shapes.fairways || []).forEach((r) => { pathRing(r); ctx.fill(); });
if (green) {
  ctx.fillStyle = 'rgba(125,255,155,0.25)';
  pathRing(green.ring); ctx.fill();
}
// water: for each water ring, scanline test — draw only if the SAMPLE
// point is inside strip/chord AND turf (mirror of the double clip).
// Proof approach: fill the full ring, then read pixels? Simpler: draw
// water ring clipped by canvas clip to corridor path + turf via
// manual per-triangle fan around centroid (approximation OK for proof).
const waterPix = [];
ctx.save();
ctx.beginPath();
offRing.forEach((p, i) => {
  const q = scr(p);
  i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
});
ctx.closePath();
chord.forEach((p, i) => {
  const q = scr(p);
  i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
});
ctx.closePath();
ctx.clip('evenodd');
// second clip: turf
ctx.beginPath();
turfRings.forEach((r) => {
  r.forEach((ll, i) => {
    const q = P(ll);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
});
ctx.clip('nonzero');
ctx.fillStyle = 'rgba(58,143,212,0.75)';
ctx.strokeStyle = 'rgba(126,200,255,0.9)';
ctx.lineWidth = 1.5;
(shapes.water || []).forEach((r) => { pathRing(r); ctx.fill(); ctx.stroke(); });
ctx.restore();
// hole line
ctx.strokeStyle = '#5ea8ff'; ctx.lineWidth = 2.5;
ctx.beginPath();
ac.forEach((p, i) => {
  const q = scr(p);
  i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
});
ctx.stroke();

// --- diagnosis: sample the pond near the crossing
const w = shapes.water || [];
console.log('water rings:', w.length);
w.forEach((r, ri) => {
  const c = centroid(r);
  const p = toAC(c);
  console.log(` ring${ri}: centroid strip=${inRing(p, offRing)} chord=${inRing(p, chord)} turf=${onTurf(c)} (${(p.along | 0)},${(p.cross | 0)})ac`);
});
// sample grid over the crossing zone the text mentions (~48-71 yd out)
let anyVisible = 0, anyWater = 0;
for (let a = 30; a <= 90; a += 6) {
  for (let c = -60; c <= 20; c += 6) {
    // reconstruct an approximate latlng by walking the chord
    const t0 = ac[0], tN = ac[ac.length - 1];
    const fr = a / Math.hypot(tN.along - t0.along, tN.cross - t0.cross);
    const ll = {
      lat: anchor.lat + ((tN.along - t0.along) * fr * ux + (tN.cross - t0.cross) * fr * pxb) * 0.9144 / mLat,
      lng: anchor.lng + ((tN.along - t0.along) * fr * ux + (tN.cross - t0.cross) * fr * pxb) * 0.9144 / mLng,
    };
    const p = toAC(ll);
    p.along = a; p.cross = c; // force the sample grid point
    const inW = w.some((r) => inRing(p, r.map(toAC)));
    if (!inW) continue;
    anyWater++;
    const vis = (inRing(p, offRing) || inRing(p, chord)) && onTurf({
      lat: anchor.lat + (p.along * ux + p.cross * pxb) * 0.9144 / mLat,
      lng: anchor.lng + (p.along * ux + p.cross * pyb) * 0.9144 / mLng,
    });
    if (vis) anyVisible++;
  }
}
console.log(`crossing-zone samples: water=${anyWater} visible=${anyVisible}`);
fs.writeFileSync(path.join(__dirname, 'hole1_v1211.png'),
  canvas.toBuffer('image/png'));
console.log('written hole1_v1211.png | ydPerPx', ydPerPx.toFixed(2));
