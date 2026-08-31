window.GreenDetect.detect = function (data) {
  // Auto green detection R4: seeded region growing whose admissibility is
  // statistically similar to the near-pin core, plus loose absolute floors.
  // Per-site adaptation via a similarity-radius ladder stopped at the
  // growth knee (leaks push deep inland; real growth is a shallow ring),
  // then a local arc pass admits dappled lobes / cuts diverging arcs.
  const g = data && data.grid;
  if (!g || !g.W || !g.H || !g.cellSizeM || !g.z) return null;
  const W = g.W | 0, H = g.H | 0, cs = +g.cellSizeM, N = W * H;
  const z = g.z, sl = g.slope, sm = g.smooth3, tx = g.tex5, ex = g.exg, br = g.bright;
  if (!N || W < 8 || H < 8 || !z.length || !sl || !sm || !tx || !ex || !br ||
      !sl.length || !sm.length || !tx.length || !ex.length || !br.length) return null;
  const ca = cs * cs, OX = W / 2, OY = H / 2; const fin = (v) => v != null && v === v;
  const dist2 = (i) => {
    const dx = ((i % W) - OX) * cs, dy = (OY - ((i / W) | 0)) * cs; return dx * dx + dy * dy;
  };
  const medOf = (a) => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN;
  const madOf = (a, m) => a.length ? a.map((x) => Math.abs(x - m)).sort((x, y) => x - y)[a.length >> 1] : NaN;
  // slope-adjusted smoothness: tilt inflates raw smooth3 on terraced greens
  const smAdj = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (!fin(sm[i])) continue;
    smAdj[i] = sm[i] / (1 + 0.09 * Math.max(0, (fin(sl[i]) ? sl[i] : 0) - 2));
  }
  // ---- core signature: the near-pin neighbourhood's own statistics -------
  const FEATS = ['sm', 'sl', 'tx', 'ex', 'br'];
  const FLOOR = { sm: 0.10, sl: 3.0, tx: 1.2, ex: 12, br: 14 };
  const WT = { sm: 0.24, sl: 0.10, tx: 0.14, ex: 0.30, br: 0.22 };
  const getF = (k, i) => k === 'sm' ? smAdj[i] : k === 'sl' ? sl[i] : k === 'tx' ? tx[i] : k === 'ex' ? ex[i] : br[i];
  let core = null, rCore = Math.max(9, cs * 2.8);
  for (let pass = 0; pass < 2 && !core; pass++) {
    const vals = { sm: [], sl: [], tx: [], ex: [], br: [] };
    let nZ = 0; const r2 = rCore * rCore;
    for (let i = 0; i < N; i++) {
      if (!fin(z[i]) || dist2(i) > r2) continue;
      nZ++;
      for (const k of FEATS) { const v = getF(k, i); if (fin(v)) vals[k].push(v); }
    }
    if (nZ >= 8) {
      const c = {};
      for (const k of FEATS) {
        if (vals[k].length < 6) continue;
        const m = medOf(vals[k]);
        c[k] = { med: m, scale: Math.max(2.5 * madOf(vals[k], m), FLOOR[k]) };
      }
      if (c.sm || c.sl || c.br) core = c;
    }
    if (!core) rCore = Math.max(16, cs * 5);
  }
  if (!core) return null;
  // weighted squared similarity; per-feature cap so none can veto alone.
  // ref (local arc pass) substitutes medians only; missing ref features
  // are skipped and weights renormalised (a NaN here would kill every add).
  const simD2 = (i, ref, rMul) => {
    let s = 0, wsum = 0;
    for (const k of FEATS) {
      const med = ref ? ref[k] : core[k] ? core[k].med : undefined;
      if (med === undefined || med !== med || !core[k]) continue;
      wsum += WT[k]; const v = getF(k, i);
      if (!fin(v)) continue;
      const d = Math.min(2.0, Math.abs(v - med) / (core[k].scale * (rMul || 1))); s += WT[k] * d * d;
    }
    return wsum ? s / wsum : 9;
  };
  // loose absolute sanity floors — never replaced by adaptation
  const admissible = (i) => {
    if (!fin(z[i])) return false;
    const s = fin(sl[i]) ? sl[i] : 6, t = fin(tx[i]) ? tx[i] : 2, b = fin(br[i]) ? br[i] : 100;
    if (s > 21) return false;                    // rough-grade slope
    if (b < 42 && t < 0.7) return false;         // water: dark AND flat
    if (fin(smAdj[i]) && smAdj[i] > 0.85) return false;
    if (b > 205) return false;                   // sand / built
    return true;
  };
  const R2MAX = 42 * 42, oi = (OY | 0) * W + (OX | 0);
  function grow(R2) {
    const keep = new Uint8Array(N), q = [];
    if (fin(z[oi])) { keep[oi] = 1; q.push(oi); }   // pin is on the green
    const seedR2 = Math.min(rCore * rCore, R2MAX);
    for (let i = 0; i < N; i++) {
      if (keep[i] || dist2(i) > seedR2) continue;
      if (admissible(i) && simD2(i, null, 1) <= R2) { keep[i] = 1; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (keep[j] || dist2(j) > R2MAX || !admissible(j) || simD2(j, null, 1) > R2) continue;
        keep[j] = 1; q.push(j);
      }
    }
    return keep;
  }
  const dilate = (src) => {
    const d = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (src[y * W + x]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) d[ny * W + nx] = 1;
      }
    }
    return d;
  };
  const erode = (src) => {
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
  };
  function fillHoles(m) {
    const ext = new Uint8Array(N), eq = [];
    const ep = (i) => { if (i >= 0 && i < N && !m[i] && !ext[i]) { ext[i] = 1; eq.push(i); } };
    for (let x = 0; x < W; x++) { ep(x); ep((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { ep(y * W); ep(y * W + W - 1); }
    for (let qi = 0; qi < eq.length; qi++) {
      const i = eq[qi], x = i % W;
      if (x > 0) ep(i - 1); if (x < W - 1) ep(i + 1); if (i >= W) ep(i - W); if (i < N - W) ep(i + W);
    }
    for (let i = 0; i < N; i++) if (!m[i] && !ext[i]) m[i] = 1;
  }
  function pinComponent(m) {
    if (!m[oi]) return 0;
    const q = [oi], st = new Uint8Array(N); st[oi] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (m[j] === 1 && !st[j]) { st[j] = 1; q.push(j); }
      }
    }
    let n = 0;
    for (let i = 0; i < N; i++) { if (m[i] === 1) m[i] = 0; if (st[i]) { m[i] = 1; n++; } }
    return n;
  }
  function morph(mask) {
    // opening severs thin collar bridges; a re-added near-pin anchor keeps
    // a sparse seed alive through the erosion (site D failure mode)
    const anchor = new Uint8Array(N), r2a = (cs * 2.4) * (cs * 2.4);
    for (let i = 0; i < N; i++) if (mask[i] && dist2(i) <= r2a) anchor[i] = 1;
    const er = erode(mask);
    for (let i = 0; i < N; i++) if (anchor[i] && !er[i]) er[i] = 1;
    const out = dilate(er); fillHoles(out); pinComponent(out); return out;
  }
  // mean BFS depth of the increment (cells added since prev) from prev's
  // boundary: ring growth ~1, a leak that pushed deep inland >= 3
  function incDepth(prev, m) {
    const dep = new Int16Array(N).fill(-1), q = [];
    for (let i = 0; i < N; i++) {
      if (!prev[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * W + (x + dx);
        if (j >= 0 && j < N && m[j] && !prev[j]) { q.push(i); dep[i] = 0; break; }
      }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * W + (x + dx);
        if (j < 0 || j >= N || !m[j] || prev[j] || dep[j] >= 0) continue;
        dep[j] = dep[i] + 1; q.push(j);
      }
    }
    let sum = 0, n = 0;
    for (let i = 0; i < N; i++) if (m[i] && !prev[i]) { if (dep[i] < 0) return 9; sum += dep[i]; n++; }
    return n ? sum / n : 0;
  }
  // ---- similarity-radius ladder; stop at the growth knee ------------------
  // Inside the green, loosening the radius adds a shallow ring; a leak
  // floods deep. Keep the loosest radius whose increment stayed shallow.
  const KS = [0.30, 0.40, 0.52, 0.66, 0.85, 1.10];
  let bestMask = null, prevCells = 0, picked = -1, prevM = null;
  for (let ki = 0; ki < KS.length; ki++) {
    const m = morph(grow(2.25 * KS[ki] * KS[ki])); let n = 0;
    for (let i = 0; i < N; i++) n += m[i];
    const ok = n >= 25 && n * ca >= 300 && n * ca <= 3600 && m[oi];
    if (!ok) { if (picked >= 0) break; else continue; }
    if (picked >= 0 && prevM && incDepth(prevM, m) > 2.0) break;   // leak
    bestMask = m; prevM = m; prevCells = n; picked = ki;
    if (n * ca > 2100) break;                                      // double green
  }
  if (!bestMask) {
    // last resort: loosest grow, morphed; take it if remotely sane
    const m = morph(grow(2.25 * KS[KS.length - 1] * KS[KS.length - 1])); let n = 0;
    for (let i = 0; i < N; i++) n += m[i];
    if (n >= 20 && n * ca >= 220 && n * ca <= 4200 && m[oi]) { bestMask = m; picked = KS.length - 1; }
  }
  if (!bestMask) return null;
  const R2 = 2.25 * KS[Math.max(0, picked)] * KS[Math.max(0, picked)];
  // ---- local arc pass ------------------------------------------------------
  // Admit dappled/shaded lobes against the LOCAL blob edge's own medians
  // (not the global core); cut fringe arcs that diverge locally.
  function localRef(cx0, cy0, mask, radM) {
    const vals = { sm: [], sl: [], tx: [], ex: [], br: [] };
    const r2 = radM * radM, rc = Math.ceil(radM / cs) + 1;
    const xc = Math.round(OX + cx0 / cs), yc = Math.round(OY - cy0 / cs);
    for (let y = Math.max(0, yc - rc); y <= Math.min(H - 1, yc + rc); y++) {
      for (let x = Math.max(0, xc - rc); x <= Math.min(W - 1, xc + rc); x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        const dx = (x - OX) * cs - cx0, dy = (OY - y) * cs - cy0;
        if (dx * dx + dy * dy > r2) continue;
        for (const k of FEATS) { const v = getF(k, i); if (fin(v)) vals[k].push(v); }
      }
    }
    const ref = {};
    for (const k of FEATS) if (vals[k].length >= 4) ref[k] = medOf(vals[k]);
    return ref;
  }
  {
    const mask = bestMask;
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (mask[i]) continue;
        let adj = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * W + (x + dx)]) adj++;
        }
        if (adj < 2 || dist2(i) > R2MAX || !admissible(i)) continue;
        const ref = localRef((x - OX) * cs, (OY - y) * cs, mask, 8);
        if (simD2(i, ref, 1) <= 0.7 && simD2(i, null, 1) <= R2 * 2.6) add.push(i);
      }
      for (const i of add) mask[i] = 1;
      if (add.length) { fillHoles(mask); pinComponent(mask); }
      const cut = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        let adjOut = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!mask[(y + dy) * W + (x + dx)]) adjOut++;
        }
        if (adjOut < 3) continue;                        // fringe only
        const ref = localRef((x - OX) * cs, (OY - y) * cs, mask, 9);
        if (Object.keys(ref).length >= 3 && simD2(i, ref, 1) > 2.2) cut.push(i);
      }
      if (cut.length && cut.length < prevCells * 0.3) {
        for (const i of cut) mask[i] = 0;
        pinComponent(mask);
      }
    }
    bestMask = mask;
  }
  let nBest = 0;
  for (let i = 0; i < N; i++) nBest += bestMask[i];
  // pin-radius trim (greens <= ~34 m from the pin), then re-pin component
  {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (bestMask[i] && dist2(i) <= 34 * 34) m[i] = 1;
    pinComponent(m); let n = 0;
    for (let i = 0; i < N; i++) n += m[i];
    if (n >= 8) { bestMask = m; nBest = n; }
  }
  if (nBest < 8) return null;
  const chosen = bestMask, best = [];
  for (let i = 0; i < N; i++) if (chosen[i]) best.push(i);
  const area = nBest * ca;
  // ---- ring trace: 4-connected outer boundary on cell corners -------------
  const W1 = W + 1; const nxt = new Int32Array(W1 * (H + 1)).fill(-1);
  const addE = (x0, y0, x1, y1) => { nxt[y0 * W1 + x0] = y1 * W1 + x1; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!chosen[y * W + x]) continue; if (y === 0 || !chosen[(y - 1) * W + x]) addE(x, y, x + 1, y);
    if (x === W - 1 || !chosen[y * W + x + 1]) addE(x + 1, y, x + 1, y + 1);
    if (y === H - 1 || !chosen[(y + 1) * W + x]) addE(x + 1, y + 1, x, y + 1);
    if (x === 0 || !chosen[y * W + x - 1]) addE(x, y + 1, x, y);
  }
  const used = new Uint8Array(nxt.length), loops = [];
  for (let a = 0; a < nxt.length; a++) {
    if (nxt[a] < 0 || used[a]) continue;
    const loop = []; let cur = a, gd = 0;
    do {
      used[cur] = 1; loop.push([((cur % W1) - OX) * cs, (OY - ((cur / W1) | 0)) * cs]); cur = nxt[cur];
      if (cur < 0) break;
    } while (cur !== a && ++gd < 8000);
    if (loop.length >= 4) loops.push(loop);
  }
  if (!loops.length) return null;
  const areaAbs = (p) => {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const j = (i + 1) % n; a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    return Math.abs(a) * 0.5;
  };
  const inPoly = (px, py, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  let bcx = 0, bcy = 0;
  for (const i of best) { bcx += ((i % W) - OX) * cs; bcy += (OY - ((i / W) | 0)) * cs; }
  bcx /= best.length; bcy /= best.length; let ring = null;
  for (const lp of loops)                          // outer ring contains centroid
    if (inPoly(bcx, bcy, lp) && (!ring || areaAbs(lp) > areaAbs(ring))) ring = lp;
  if (!ring) { loops.sort((a, b) => areaAbs(b) - areaAbs(a)); ring = loops[0]; }
  // collar shrink: the traced ring rides the collar's outer edge (~1 m out)
  {
    let rcx = 0, rcy = 0;
    for (const p of ring) { rcx += p[0]; rcy += p[1]; }
    rcx /= ring.length; rcy /= ring.length;
    for (const p of ring) {
      const dx = p[0] - rcx, dy = p[1] - rcy, d = Math.hypot(dx, dy) || 1;
      const kk = Math.max(0.2, (d - 1.0) / d); p[0] = rcx + dx * kk; p[1] = rcy + dy * kk;
    }
  }
  const distSeg = (p, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  };
  const dp = (pts, eps) => {
    const n = pts.length;
    if (n <= 2) return pts.slice();
    let maxD = 0, idx = 0;
    for (let i = 1; i < n - 1; i++) {
      const d = distSeg(pts[i], pts[0], pts[n - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      const L = dp(pts.slice(0, idx + 1), eps), R = dp(pts.slice(idx), eps); return L.slice(0, -1).concat(R);
    }
    return [pts[0], pts[n - 1]];
  };
  const closed = ring.concat([ring[0]]); let eps = cs * 0.6, simp = dp(closed, eps), guard = 0;
  while (simp.length > 65 && guard++ < 18) { eps *= 1.35; simp = dp(closed, eps); }
  guard = 0;
  while (simp.length < 9 && eps > 0.06 && guard++ < 18) { eps *= 0.5; simp = dp(closed, eps); }
  if (simp.length >= 2 && simp[0][0] === simp[simp.length - 1][0] && simp[0][1] === simp[simp.length - 1][1]) simp.pop();
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
  if (simp.length < 8 || simp.length > 64) return null;
  // ---- confidence: blob's own stats vs the core signature -----------------
  const bVals = { sm: [], ex: [], br: [], tx: [] };
  for (const i of best) {
    if (fin(sm[i])) bVals.sm.push(smAdj[i]); if (fin(ex[i])) bVals.ex.push(ex[i]);
    if (fin(br[i])) bVals.br.push(br[i]); if (fin(tx[i])) bVals.tx.push(tx[i]);
  }
  let mismatch = 0, mw = 0;
  for (const k of ['sm', 'tx', 'ex', 'br']) {
    if (!core[k] || bVals[k].length < 5) continue;
    mw += WT[k]; const d = Math.min(2, Math.abs(medOf(bVals[k]) - core[k].med) / core[k].scale);
    mismatch += WT[k] * d * d;
  }
  mismatch /= mw || 1; let conf = 0.34;
  if (area >= 320 && area <= 2400) conf += 0.14; else if (area >= 260 && area <= 3200) conf += 0.06;
  else conf -= 0.12;
  if (mismatch <= 0.10) conf += 0.12; else if (mismatch <= 0.25) conf += 0.06;
  else if (mismatch > 0.6) conf -= 0.20;
  if (chosen[oi]) conf += 0.08;
  const coreBr = core.br ? core.br.med : 110;
  if (coreBr < 80 && mismatch > 0.25) conf -= 0.30;  // shaded + impure: null
  conf = Math.max(0, Math.min(1, conf));
  if (conf < 0.5) return null;
  return { poly: simp, confidence: Math.round(conf * 1000) / 1000 };
};