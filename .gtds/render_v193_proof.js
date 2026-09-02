/* render_v193_proof.js — END-TO-END visual proof for v1.19.3:
   runs the REAL Jester Park exec water relation through the NEW
   osmOuterRings assembly + bounding gate + DP(2m, 40) exactly as
   buildAutoCourse now does, then renders the result. The shipped code
   path must produce a smooth, continuous lake — or v1.19.3 doesn't
   ship. */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// ---- Pull the pipeline functions out of app.js by evaluating the
// geometry helpers in isolation (they're module-private; extract by
// name from the source). Simpler and honest: re-declare NOTHING —
// slice the exact functions from app.js and eval them here.
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');
const extract = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  // walk braces to the matching close
  let i = src.indexOf('{', start), depth = 0, end = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  return src.slice(start, end + 1);
};
const sandboxSrc = [
  'const OSM_M_PER_DEG = 111320;',
  'const OSM_YD_PER_M = 1.0936133;',
  extract('osmGeomLatLng'),
  extract('osmRing'),
  extract('osmSimplifyRing'),
  extract('osmOuterRings'),
  'const SIMPLIFY_TOL_M = 2;',
].join('\n');
// osmSimplifyRing references SIMPLIFY_TOL_M declared in app.js above it;
// our sliced copy includes its own outer const only if within range —
// define after to be safe (const hoisting: must precede use at runtime,
// and osmSimplifyRing reads it lazily inside the call, so defining the
// const BEFORE invocation in the same scope works).
const sandbox = new Function(
  sandboxSrc + `
    return { osmOuterRings, osmSimplifyRing };
  `);
const { osmOuterRings, osmSimplifyRing } = sandbox();

// ---- Real data: the exec water relation captured live earlier
const j = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'exec_water_real.json'), 'utf-8'));
const rel = j.elements.find(e => e.type === 'relation' &&
  (e.tags || {}).natural === 'water');

const rings = osmOuterRings(rel) || [];
console.log('assembled rings:', rings.length,
  '| pts/ring:', rings.map(r => r.length).join(','));

// Apply the same gate + simplify as pushPolygon (diagonal > 1200 yd skip)
const gated = rings.filter((ring) => {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const diagYd = Math.hypot(
    (maxLat - minLat) * 111320,
    (maxLng - minLng) * 111320 *
      Math.cos((minLat + maxLat) / 2 * Math.PI / 180)) / 0.9144;
  console.log('ring diag:', Math.round(diagYd), 'yd');
  return diagYd <= 1200;
}).map((ring) => osmSimplifyRing(ring, 40));

console.log('after gate+simplify:', gated.length,
  '| pts:', gated.map(r => r.length).join(','));

// ---- Render
const all = gated.flat();
if (!all.length) { console.error('NOTHING TO RENDER — pipeline dropped everything'); process.exit(1); }
const minLat = Math.min(...all.map(p => p.lat));
const maxLat = Math.max(...all.map(p => p.lat));
const minLng = Math.min(...all.map(p => p.lng));
const maxLng = Math.max(...all.map(p => p.lng));
const W = 500, H = 500, PAD = 40;
const px = (p) => [
  PAD + (p.lng - minLng) / (maxLng - minLng || 1) * (W - 2 * PAD),
  H - PAD - (p.lat - minLat) / (maxLat - minLat || 1) * (H - 2 * PAD),
];
const canvas = require('canvas').createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1411'; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = 'rgba(58,143,212,0.45)';
ctx.strokeStyle = 'rgba(126,200,255,0.6)'; ctx.lineWidth = 1.5;
for (const ring of gated) {
  ctx.beginPath();
  ring.forEach((p, i) => {
    const [x, y] = px(p);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}
fs.writeFileSync(path.join(__dirname, 'water_v193.png'),
  canvas.toBuffer('image/png'));
console.log('written: water_v193.png');
