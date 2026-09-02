/* render_water_proof.js — renders the ASSEMBLED water ring vs the OLD
   broken capture (first-outer-member only) to PNGs and compares.
   Visual proof before shipping v1.19.3. */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const rings = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'exec_water_assembled.json'), 'utf-8'));
const ring = rings[0];

// Also reconstruct the OLD broken capture: member 0 only (closed naive).
const j = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'exec_water_real.json'), 'utf-8'));
const rel = j.elements.find(e => e.type === 'relation');
const oldShards = rel.members
  .filter(m => m.role === 'outer' && Array.isArray(m.geometry))
  .map(m => m.geometry.map(g => ({ lat: g.lat, lng: g.lon })));

// Project to pixels
const all = ring;
const minLat = Math.min(...all.map(p => p.lat));
const maxLat = Math.max(...all.map(p => p.lat));
const minLng = Math.min(...all.map(p => p.lng));
const maxLng = Math.max(...all.map(p => p.lng));
const W = 500, H = 500, PAD = 40;
const px = (p) => [
  PAD + (p.lng - minLng) / (maxLng - minLng || 1) * (W - 2 * PAD),
  H - PAD - (p.lat - minLat) / (maxLat - minLat || 1) * (H - 2 * PAD),
];
const trace = (ctx, pts, close) => {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = px(p);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
};

// Image 1: OLD capture (each member closed naively = shards)
const c1 = createCanvas(W, H);
const x1 = c1.getContext('2d');
x1.fillStyle = '#0e1411'; x1.fillRect(0, 0, W, H);
x1.fillStyle = 'rgba(58,143,212,0.45)';
x1.strokeStyle = 'rgba(126,200,255,0.5)'; x1.lineWidth = 1.5;
oldShards.forEach((shard) => {
  trace(x1, shard, true); x1.fill(); x1.stroke();
});
fs.writeFileSync(path.join(__dirname, 'water_old.png'), c1.toBuffer('image/png'));

// Image 2: NEW assembled ring (DP simplified to 40 pts)
let simplified = ring;
const dp = (pts, tol) => {
  // simple iterative DP for the proof render
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const K = 111320 * Math.cos(pts[0].lat * Math.PI / 180);
  const sq = (p, a, b) => {
    let dx = b.lng - a.lng, dy = b.lat - a.lat;
    if (!dx && !dy) { dx = p.lng - a.lng; dy = p.lat - a.lat; return dx*dx+dy*dy; }
    let t = ((p.lng - a.lng)*dx + (p.lat - a.lat)*dy) / (dx*dx+dy*dy);
    t = Math.max(0, Math.min(1, t));
    const ex = a.lng + t*dx - p.lng, ey = a.lat + t*dy - p.lat;
    return ex*ex*K*K + ey*ey*111320*111320;
  };
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sq(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol * tol) { keep[maxI] = true; stack.push([s, maxI], [maxI, e]); }
  }
  return pts.filter((_, i) => keep[i]);
};
const openRing = ring.slice();
if (openRing.length > 1) {
  const a = openRing[0], b = openRing[openRing.length - 1];
  if (Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7)
    openRing.pop();
}
simplified = dp(openRing, 2);
simplified.push(simplified[0]);
console.log('simplified pts:', simplified.length);

const c2 = createCanvas(W, H);
const x2 = c2.getContext('2d');
x2.fillStyle = '#0e1411'; x2.fillRect(0, 0, W, H);
x2.fillStyle = 'rgba(58,143,212,0.45)';
x2.strokeStyle = 'rgba(126,200,255,0.5)'; x2.lineWidth = 1.5;
trace(x2, simplified, true); x2.fill(); x2.stroke();
// shot line for scale reference (tee → pin across the lake roughly)
x2.strokeStyle = 'rgba(255,255,255,0.6)'; x2.setLineDash([4, 4]);
x2.beginPath();
x2.moveTo(20, H / 2); x2.lineTo(W - 20, H / 2);
x2.stroke();
fs.writeFileSync(path.join(__dirname, 'water_new.png'), c2.toBuffer('image/png'));

console.log('written: water_old.png / water_new.png');
