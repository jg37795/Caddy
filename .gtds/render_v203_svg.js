/* render_v203_svg.js — v1.20.3 proof: render the REAL assembled water
   ring as SVG (the cartoon's exact renderer) and check the hollow.
   If SVG shows the bowtie-hollow that canvas didn't, the fix is
   winding normalisation at assembly (force consistent orientation by
   arc traversal, never mixed). */
'use strict';
const fs = require('fs');
const path = require('path');
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
  'return { osmOuterRings, osmSimplifyRing };',
].join('\n'));
const { osmOuterRings, osmSimplifyRing } = sandbox();

const j = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'exec_water_real.json'), 'utf-8'));
const rel = j.elements.find(e => e.type === 'relation' &&
  (e.tags || {}).natural === 'water');
const ring = (osmOuterRings(rel) || []).map(r => osmSimplifyRing(r, 40))[0];

// Signed area (shoelace) — winding direction
const shoelace = (r) => {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) {
    s += (r[i].lng * r[i + 1].lat - r[i + 1].lng * r[i].lat);
  }
  return s / 2;
};
console.log('signed area (deg^2):', shoelace(ring).toFixed(6),
  shoelace(ring) < 0 ? 'CW' : 'CCW');

// Segment-crossing count
function segInt(p1, p2, p3, p4) {
  const d = (a, b, c) => (c.lng - b.lng) * (a.lat - b.lat) -
    (b.lng - a.lng) * (c.lat - b.lat);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
let crossings = 0;
for (let i = 0; i < ring.length - 1; i++)
  for (let k = i + 2; k < ring.length - 1; k++) {
    if (i === 0 && k === ring.length - 2) continue;
    if (segInt(ring[i], ring[i + 1], ring[k], ring[k + 1])) crossings++;
  }
console.log('crossings:', crossings);

// Render as SVG exactly like the cartoon does (class + CSS colors),
// then rasterise via resvg? No resvg — use canvas with an SVG path
// via Path2D (node-canvas supports Path2D with SVG path strings and
// the same fill rules as SVG).
const { createCanvas, Path2D } = require('canvas');
const W = 500, H = 500, PAD = 40;
const minLat = Math.min(...ring.map(p => p.lat));
const maxLat = Math.max(...ring.map(p => p.lat));
const minLng = Math.min(...ring.map(p => p.lng));
const maxLng = Math.max(...ring.map(p => p.lng));
const pts = ring.map(p => [
  PAD + (p.lng - minLng) / (maxLng - minLng || 1) * (W - 2 * PAD),
  H - PAD - (p.lat - minLat) / (maxLat - minLat || 1) * (H - 2 * PAD),
]);
const d = pts.map((p, i) => (i ? 'L' : 'M') +
  ` ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1411'; ctx.fillRect(0, 0, W, H);
// Build the same path the cartoon emits, then fill with BOTH rules by
// re-tracing (node-canvas 2.x lacks Path2D; ctx.fill(rule) is
// supported since 2.9 via ctx.fill('nonzero'|'evenodd')).
const trace = (c) => {
  c.beginPath();
  pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
  c.closePath();
};
ctx.fillStyle = 'rgba(58,143,212,0.55)';
trace(ctx); ctx.fill('nonzero');
ctx.strokeStyle = 'rgba(126,200,255,0.8)'; ctx.lineWidth = 1.5;
trace(ctx); ctx.stroke();
// Evenodd comparison in a second panel
const c2 = createCanvas(W, H);
const x2 = c2.getContext('2d');
x2.fillStyle = '#0e1411'; x2.fillRect(0, 0, W, H);
x2.fillStyle = 'rgba(58,143,212,0.55)';
trace(x2); x2.fill('evenodd');
x2.strokeStyle = 'rgba(126,200,255,0.8)'; x2.lineWidth = 1.5;
trace(x2); x2.stroke();
fs.writeFileSync(path.join(__dirname, 'water_nonzero.png'),
  canvas.toBuffer('image/png'));
fs.writeFileSync(path.join(__dirname, 'water_evenodd.png'),
  c2.toBuffer('image/png'));
console.log('written: water_nonzero.png / water_evenodd.png');
