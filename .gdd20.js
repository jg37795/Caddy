window.GreenDetect.detect = function (data) {
  const g = data && data.grid, W = g && g.W | 0, H = g && g.H | 0, cs = g && g.cellSizeM, N = W * H;
  if (!g || !N || !g.z) { console.log("EXIT guard", !!g, N, g && !!g.z); return null; }
  const z = g.z, sl = g.slope, sm = g.smooth3, tx = g.tex5, ex = g.exg, br = g.bright;
  const ca = cs * cs, W1 = W + 1, fin = (v) => v === v;

  function pct(arr, ps) {
    const v = [];
    for (let i = 0; i < N; i++) if (arr[i] === arr[i]) v.push(arr[i]);
    if (!v.length) return ps.map(() => 0);
    v.sort((a, b) => a - b);
    return ps.map((p) => v[Math.min(v.length - 1, (p * (v.length - 1) / 100 + 0.5) | 0)]);
  }
  const rampL = (v, a, b) => {
    if (v !== v) return 0;
    if (b <= a) return v <= a ? 1 : 0;
    return v <= a ? 1 : v >= b ? 0 : (b - v) / (b - a);
  };
  const rampH = (v, a, b) => {
    if (v !== v) return 0.45; // missing sat must not veto LiDAR
    if (b <= a) return v >= b ? 1 : 0;
    return v >= b ? 1 : v <= a ? 0 : (v - a) / (b - a);
  };

  // slope-corrected smoothness so tilted greens still score
  const smA = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = fin(sl[i]) ? Math.max(0, sl[i]) : 6;
    smA[i] = fin(sm[i]) ? sm[i] / (1 + 0.07 * s) : NaN;
  }
  const [pSm8, pSm28] = pct(smA, [8, 28]);
  const [pTx8, pTx40] = pct(tx, [8, 40]);
  const [pEx40, pEx55, pEx80] = pct(ex, [40, 55, 80]);
  let nEx = 0;
  for (let i = 0; i < N; i++) if (fin(ex[i])) nEx++;
  const hasSat = nEx > N * 0.25 && pEx80 - pEx40 > 8;

  const score = new Float64Array(N);
  let maxNear = 0, maxNearI = ((H / 2) | 0) * W + ((W / 2) | 0);
  for (let i = 0; i < N; i++) {
    const ix = i % W, iy = (i / W) | 0;
    const dist = Math.hypot((ix - W / 2) * cs, (H / 2 - iy) * cs);
    if (!fin(z[i]) || !fin(smA[i])) { score[i] = 0; continue; }
    const sSm = rampL(smA[i], pSm8, Math.max(pSm28, pSm8 * 1.8));
    // v-tune3 (fixed texture band): percentile thresholds anchored to
    // the pond's near-zero tex5 and excluded the green's real mow
    // texture (tex5 3-7). Fixed band: green texture ~1.2..9.
    const sTx = rampH(tx[i], 1.0, 9.0) * 0.6
      + rampL(tx[i], 9.0, 16.0) * 0.4;
    // v-tune2: near-ZERO texture = water/pad (unnaturally flat); real
    // greens carry mow/slope texture (tex5 ~1-4 here)
    const sFlat = (tx[i] === tx[i] && tx[i] < 0.5) ? 0 : 1;
    const sSl = rampL(sl[i], 2.8, 8.5);
    let s = 0.42 * sSm + 0.30 * sTx + 0.28 * sSl;
    if (hasSat) {
      const sEx = rampH(ex[i], pEx55, pEx80);
      let sBr = 0.5;
      if (fin(br[i])) {
        const b = br[i];
        sBr = b < 28 || b > 225 ? 0 : b < 50 ? (b - 28) / 22 : b > 185 ? (225 - b) / 40 : 1;
      }
      s = 0.34 * sSm + 0.24 * sTx + 0.22 * sSl + 0.14 * sEx + 0.06 * sBr;
    }
    if (dist < 70) s += 0.035 * (1 - dist / 70);
    // v-tune: water/shadow hard exclusion (dark+flat = pond, never green)
    if ((hasSat && fin(br[i]) && br[i] < 70) || sFlat === 0) s = 0;
    score[i] = s;
    if (dist <= 55 && s > maxNear) { maxNear = s; maxNearI = i; }
  }
  console.error("[dbg] maxNear", maxNear.toFixed(2));
  if (maxNear < 0.36) { console.log("EXIT maxNear", maxNear.toFixed(3)); return null; }

  function grow(loT, hiT, maxR) {
    const keep = new Uint8Array(N), q = [];
    for (let i = 0; i < N; i++) {
      if (score[i] < hiT) continue;
      const ix = i % W, iy = (i / W) | 0;
      if (Math.hypot((ix - W / 2) * cs, (H / 2 - iy) * cs) <= maxR) { keep[i] = 1; q.push(i); }
    }
    if (!q.length && score[maxNearI] >= loT) { keep[maxNearI] = 1; q.push(maxNearI); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (keep[j] || score[j] < loT) continue;
        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 110) continue;
        keep[j] = 1; q.push(j);
      }
    }
    return keep;
  }
  function nOn(m) { let n = 0; for (let i = 0; i < N; i++) n += m[i]; return n; }
  function dilate(src) {
    const d = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (src[y * W + x]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) d[ny * W + nx] = 1;
      }
    }
    return d;
  }
  function erode(src) {
    const d = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !src[ny * W + nx]) { ok = 0; break; }
      }
      d[y * W + x] = ok;
    }
    return d;
  }

  let hi = Math.max(0.50, maxNear * 0.70), lo = Math.max(0.33, hi * 0.58);
  let keep = grow(lo, hi, 65), cnt = nOn(keep);
  for (let a = 0; a < 5; a++) {
    const area = cnt * ca;
    if (area > 2500) { lo += 0.055; hi += 0.035; keep = grow(lo, hi, 65); cnt = nOn(keep); }
    else if (area < 150 && lo > 0.26) { lo -= 0.05; keep = grow(lo, hi, 75); cnt = nOn(keep); }
    else break;
  }
  // clip tongues far from the high-score core (stops fairway leak)
  let csx = 0, csy = 0, cn = 0;
  for (let i = 0; i < N; i++) if (keep[i] && score[i] >= hi) {
    csx += (i % W - W / 2) * cs; csy += (H / 2 - ((i / W) | 0)) * cs; cn++;
  }
  if (cn) {
    csx /= cn; csy /= cn;
    for (let i = 0; i < N; i++) if (keep[i]) {
      const ix = i % W, iy = (i / W) | 0;
      if (Math.hypot((ix - W / 2) * cs - csx, (H / 2 - iy) * cs - csy) > 44) keep[i] = 0;
    }
  }
  keep = cnt * ca > 1400 ? dilate(erode(keep)) : erode(dilate(keep));
  // fill interior holes (output is a single ring)
  const ext = new Uint8Array(N), eq = [];
  const ep = (i) => { if (i >= 0 && i < N && !keep[i] && !ext[i]) { ext[i] = 1; eq.push(i); } };
  for (let x = 0; x < W; x++) { ep(x); ep((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { ep(y * W); ep(y * W + W - 1); }
  for (let qi = 0; qi < eq.length; qi++) {
    const i = eq[qi], x = i % W;
    if (x > 0) ep(i - 1); if (x < W - 1) ep(i + 1);
    if (i >= W) ep(i - W); if (i < N - W) ep(i + W);
  }
  for (let i = 0; i < N; i++) if (!keep[i] && !ext[i]) keep[i] = 1;

  const seen = new Uint8Array(N), comps = [];
  for (let i = 0; i < N; i++) {
    if (!keep[i] || seen[i]) continue;
    const cells = [], q = [i]; seen[i] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]; cells.push(c);
      const x = c % W, y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (keep[j] && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    comps.push(cells);
  }
  const ox = (W / 2) | 0, oy = (H / 2) | 0, oi = oy * W + ox;
  let best = null, bestKey = 1e15;
  for (const cells of comps) {
    const area = cells.length * ca;
    if (area < 150 || area > 2500) continue;
    let sx = 0, sy = 0, contains = 0, minD = 1e9, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const i of cells) {
      const ix = i % W, iy = (i / W) | 0;
      const mx = (ix - W / 2) * cs, my = (H / 2 - iy) * cs;
      sx += mx; sy += my;
      if (mx < minx) minx = mx; if (mx > maxx) maxx = mx;
      if (my < miny) miny = my; if (my > maxy) maxy = my;
      const d = Math.hypot(mx, my);
      if (d < minD) minD = d;
      if (i === oi) contains = 1;
    }
    if (maxx - minx < 8 || maxy - miny < 8) continue;
    const cd = Math.hypot(sx / cells.length, sy / cells.length);
    if (cd > 120) continue;
    const key = (contains ? 0 : 1) * 1e6 + cd + minD * 0.25;
    if (key < bestKey) { bestKey = key; best = cells; }
  }
  if (!best) { console.log("EXIT !best"); return null; }

  const chosen = new Uint8Array(N);
  for (const i of best) chosen[i] = 1;
  // 4-connected outer ring on cell corners (true footprint, not inset centres)
  const nxt = new Int32Array(W1 * (H + 1)).fill(-1);
  const addE = (x0, y0, x1, y1) => { nxt[y0 * W1 + x0] = y1 * W1 + x1; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!chosen[y * W + x]) continue;
    if (y === 0 || !chosen[(y - 1) * W + x]) addE(x, y, x + 1, y);
    if (x === W - 1 || !chosen[y * W + x + 1]) addE(x + 1, y, x + 1, y + 1);
    if (y === H - 1 || !chosen[(y + 1) * W + x]) addE(x + 1, y + 1, x, y + 1);
    if (x === 0 || !chosen[y * W + x - 1]) addE(x, y + 1, x, y);
  }
  const used = new Uint8Array(nxt.length), loops = [];
  for (let a = 0; a < nxt.length; a++) {
    if (nxt[a] < 0 || used[a]) continue;
    const loop = [];
    let cur = a, gd = 0;
    do {
      used[cur] = 1;
      loop.push([((cur % W1) - W / 2) * cs, (H / 2 - ((cur / W1) | 0)) * cs]);
      cur = nxt[cur];
      if (cur < 0) break;
    } while (cur !== a && ++gd < 8000);
    if (loop.length >= 4) loops.push(loop);
  }
  if (!loops.length) { console.log("EXIT !loops"); return null; }
  const areaAbs = (p) => {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const j = (i + 1) % n;
      a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    return Math.abs(a) * 0.5;
  };
  // v-tune4 (per brief: pick the component nearest the origin/pin —
  // the user dropped the pin ON the green). Largest-area was wrong:
  // a bigger smooth neighbour (apron/tee complex) beat the pin's green.
  const centroidOf = (p) => {
    let x = 0, y = 0;
    for (const pt of p) { x += pt[0]; y += pt[1]; }
    return [x / p.length, y / p.length];
  };
  loops.sort((a, b) => {
    const ca = centroidOf(a), cb = centroidOf(b);
    const da = ca[0] * ca[0] + ca[1] * ca[1];
    const db = cb[0] * cb[0] + cb[1] * cb[1];
    if (da !== db) return da - db;   // nearest origin first
    return areaAbs(b) - areaAbs(a);
  });
  console.error("[dbg] loops", loops.length,
    "areas", loops.map(l => areaAbs(l).toFixed(0)).join(","),
    "cents", loops.map(l => centroidOf(l).map(v => v.toFixed(0)).join(",")).join(" | "));
  const ring = loops[0];

  function distSeg(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  }
  function dp(pts, eps) {
    const n = pts.length;
    if (n <= 2) return pts.slice();
    let maxD = 0, idx = 0;
    const a = pts[0], b = pts[n - 1];
    for (let i = 1; i < n - 1; i++) {
      const d = distSeg(pts[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      const L = dp(pts.slice(0, idx + 1), eps), R = dp(pts.slice(idx), eps);
      return L.slice(0, -1).concat(R);
    }
    return [a, b];
  }
  const closed = ring.concat([ring[0]]);
  let eps = cs * 0.6, simp = dp(closed, eps), guard = 0;
  while (simp.length > 65 && guard++ < 18) { eps *= 1.35; simp = dp(closed, eps); }
  guard = 0;
  while (simp.length < 9 && eps > 0.06 && guard++ < 18) { eps *= 0.5; simp = dp(closed, eps); }
  if (simp.length >= 2) {
    const a = simp[0], b = simp[simp.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) simp.pop();
  }
  while (simp.length < 8 && simp.length >= 3) {
    const n2 = [];
    for (let i = 0; i < simp.length; i++) {
      const j = (i + 1) % simp.length;
      n2.push(simp[i], [(simp[i][0] + simp[j][0]) * 0.5, (simp[i][1] + simp[j][1]) * 0.5]);
    }
    simp = n2;
  }
  if (simp.length > 64) {
    const t = [];
    for (let i = 0; i < 64; i++) t.push(simp[((i * simp.length) / 64) | 0]);
    simp = t;
  }
  if (simp.length < 8 || simp.length > 64) { console.log("EXIT simp", simp.length); return null; }

  const area = best.length * ca;
  let smIn = 0, slIn = 0, nIn = 0, smRing = 0, nRing = 0, nHi = 0, scIn = 0, sx = 0, sy = 0;
  for (const i of best) {
    const ix = i % W, iy = (i / W) | 0;
    sx += (ix - W / 2) * cs; sy += (H / 2 - iy) * cs;
    if (fin(sm[i])) { smIn += sm[i]; nIn++; }
    if (fin(sl[i])) slIn += sl[i];
    if (score[i] >= hi) nHi++;
    scIn += score[i];
  }
  smIn /= nIn || 1; slIn /= nIn || 1; scIn /= best.length;
  const cx = sx / best.length, cy = sy / best.length;
  for (let i = 0; i < N; i++) {
    if (chosen[i] || !fin(sm[i])) continue;
    const d = Math.hypot((i % W - W / 2) * cs - cx, (H / 2 - ((i / W) | 0)) * cs - cy);
    if (d > 12 && d < 55) { smRing += sm[i]; nRing++; }
  }
  const smRatio = (nRing ? smRing / nRing : smIn * 2) / (smIn + 1e-6);
  let per = 0;
  for (let i = 0; i < simp.length; i++) {
    const j = (i + 1) % simp.length;
    per += Math.hypot(simp[j][0] - simp[i][0], simp[j][1] - simp[i][1]);
  }
  const compact = (4 * Math.PI * area) / (per * per + 1e-6);
  const cd = Math.hypot(cx, cy);

  let conf = 0.35; console.log("STATS area", area.toFixed(0), "smRatio", smRatio.toFixed(2), "slIn", slIn.toFixed(1), "compact", compact.toFixed(2), "cd", cd.toFixed(1), "nHi", nHi, "chosen", chosen[oi]);
  if (area >= 280 && area <= 950) conf += 0.15;
  else if (area >= 180 && area <= 1600) conf += 0.05;
  else conf -= 0.08;
  if (smRatio > 2.4) conf += 0.12;
  else if (smRatio > 1.55) conf += 0.06;
  else if (smRatio < 1.18) conf -= 0.25;
  if (slIn < 3.8) conf += 0.06;
  else if (slIn > 7) conf -= 0.12;
  if (chosen[oi]) conf += 0.08;
  else if (cd > 45) conf -= 0.15;
  if (compact >= 0.32 && compact <= 0.97) conf += 0.04;
  else if (compact < 0.18) conf -= 0.18;
  if (cd > 85) conf -= 0.08;
  if (nHi / best.length > 0.35) conf += 0.04;
  if (nHi < 8) conf -= 0.15;
  if (scIn < 0.42) conf -= 0.2;
  if (hasSat) {
    let e = 0, ne = 0;
    for (const i of best) if (fin(ex[i])) { e += ex[i]; ne++; }
    if (ne && e / ne > pEx55) conf += 0.05;
  }
  if (conf > 1) conf = 1;
  if (conf < 0.5) { console.log("EXIT conf", conf.toFixed(2)); return null; }
  return { poly: simp, confidence: Math.round(conf * 1000) / 1000 };
};