/* ==========================================================================
   greenmap.js — 3D Green slope view (integral Caddy app view).
   Launched from the Play tab's "3D Green" pill; loads the current hole's
   green via ?lat&lng&teelat&teelng.

   Layers:
     · Slope heat-map — per-cell color from Horn gradient magnitude
       (cool/neutral = flat → amber/orange/red = steep), bilinear-smoothed.
     · Flow arrows — dense downhill drainage arrows, length ∝ steepness.
     · Both / Shading / Arrows toggles.

   Data:
     · window.CaddyElev.fetchElevGrid (caddy-elev.js) for USGS 3DEP 1m data.
     · OSM green polygon via Overpass; ellipse fallback if none.

   Pure functions are exported as window.GreenMapCore for headless tests.
   ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     1. PURE CORE (exported for tests)
     ====================================================================== */
  const GreenMapCore = {};

  // Horn gradient. gx/gy in metres per metre of elevation change (dz/dx),
  // pointing UP-slope in grid space (x → east, y → south/screen-down).
  GreenMapCore.computeGradientField = function (grid, W, H, cellSize, validMask) {
    const gx = new Float32Array(W * H);
    const gy = new Float32Array(W * H);
    const validOut = new Uint8Array(W * H);
    const v = validMask || (() => true);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const c = i, l = i - 1, r = i + 1, t = i - W, b = i + W;
        const okC = v(c);
        if (!okC || x === 0 || x === W - 1 || y === 0 || y === H - 1 ||
            !v(l) || !v(r) || !v(t) || !v(b)) continue;
        // Horn: weighted central differences over 3x3.
        // Convention: gx = dz/dx (east+), gy = dz/dy (grid y grows SOUTH).
        let dzdx = ((grid[r - W] + 2 * grid[r] + grid[r + W]) -
                    (grid[l - W] + 2 * grid[l] + grid[l + W])) / (8 * cellSize);
        let dzdy = ((grid[b - 1] + 2 * grid[b] + grid[b + 1]) -
                    (grid[t - 1] + 2 * grid[t] + grid[t + 1])) / (8 * cellSize);
        if (!Number.isFinite(dzdx)) dzdx = 0;
        if (!Number.isFinite(dzdy)) dzdy = 0;
        gx[i] = dzdx; gy[i] = dzdy;
        validOut[i] = 1;
      }
    }
    return { gx, gy, valid: validOut };
  };

  // Slope percent at a cell from the gradient field.
  GreenMapCore.slopePctAt = function (field, i) {
    return Math.hypot(field.gx[i], field.gy[i]) * 100;
  };

  // Compass bearing (deg, 0=N, clockwise) the surface FALLS toward.
  // Grid y grows southward, so downhill in (east, north) = (-gx, +gy).
  GreenMapCore.fallBearingDeg = function (gx, gy) {
    return (Math.atan2(-gx, gy) * 180 / Math.PI + 360) % 360;
  };

  GreenMapCore.bearingLabel = function (deg) {
    const names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  };

  // Color ramp: flat = calm sage/grey-green → steep = amber → red.
  // pct 0..12+ mapped through control points; returns [r,g,b].
  GreenMapCore.slopeColor = function (pct) {
    const stops = [
      [0.0, [176, 194, 181]],   // flat — pale sage grey
      [1.5, [150, 186, 172]],   // gentle
      [3.0, [126, 178, 160]],   // mild
      [5.0, [214, 196, 118]],   // amber creeping in
      [7.5, [230, 158, 84]],    // orange
      [10.0, [214, 96, 62]],    // deep orange/red
      [13.0, [200, 40, 38]]     // severe deep red
    ];
    const p = Math.max(0, Math.min(stops[stops.length - 1][0], pct));
    for (let k = 1; k < stops.length; k++) {
      if (p <= stops[k][0]) {
        const [p0, c0] = stops[k - 1], [p1, c1] = stops[k];
        const t = (p - p0) / (p1 - p0);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * t),
          Math.round(c0[1] + (c1[1] - c0[1]) * t),
          Math.round(c0[2] + (c1[2] - c0[2]) * t)
        ];
      }
    }
    return stops[stops.length - 1][1];
  };

  // Elevation ramp (18Birdies convention): low = deep blue,
  // mid = neutral green, high = warm red. t is normalized 0..1.
  GreenMapCore.elevationColor = function (t) {
    const stops = [
      [0.00, [42, 84, 154]],    // deep blue — low
      [0.25, [82, 148, 186]],   // blue-teal
      [0.50, [146, 188, 158]],  // neutral sage green — mid
      [0.72, [222, 196, 118]],  // warm sand
      [0.88, [226, 130, 74]],   // orange
      [1.00, [208, 62, 48]]     // warm red — high
    ];
    const p = Math.max(0, Math.min(1, t));
    for (let k = 1; k < stops.length; k++) {
      if (p <= stops[k][0]) {
        const [p0, c0] = stops[k - 1], [p1, c1] = stops[k];
        const u = (p - p0) / (p1 - p0);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * u),
          Math.round(c0[1] + (c1[1] - c0[1]) * u),
          Math.round(c0[2] + (c1[2] - c0[2]) * u)
        ];
      }
    }
    return stops[stops.length - 1][1];
  };

  // Ray casting point-in-polygon (LL or any planar coords).
  GreenMapCore.pointInPoly = function (x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  // Inset (negative-grow) a polygon — cached companion to growPolyLocal for
  // the near-rim fast-path test. Same mitre-join math, h negative.
  GreenMapCore.polyOffsetCache = function (pts, h) {
    return growPolyLocal(pts, h);
  };

  // v-fix(quad-clip): clip ONE quad (4 corners [x,y]) to a convex-ish
  // polygon with the Sutherland–Hodgman algorithm, returning 0, 1 or
  // several clipped quads. The subject is a quad, the clip region a
  // polygon with n edges: run SH once per clip edge. Elevation z is
  // interpolated bilinearly by the same weights as x/y, so the clipped
  // pieces sit exactly on the original surface. A quad fully inside is
  // returned unchanged (reference-identical); a quad fully outside
  // returns []; straddlers are cut EXACTLY at the polygon line.
  // v-fix(clip-concave): Sutherland–Hodgman against ALL edges is only valid
  // for CONVEX clip polygons. The real OSM green is CONCAVE — the old
  // whole-polygon pass deleted cells sitting in the re-entrant shadow of
  // every concave arc (250/942 valid cells on the test green, 239 of them
  // entirely INSIDE the ring; each deleted cell = a hole in the surface =
  // the black moat between surface edge and wall at 15x, James 06:43 shot).
  // Fix: ear-clip the polygon into triangles (an EXACT cover of any simple
  // polygon, winding-agnostic), S-H the quad against each triangle, and
  // return the union of pieces. Same primitive, correct for every shape.
  // Triangulation is memoized per polygon reference (buildMesh3D clips the
  // same ring for every boundary cell in one build).
  const _triCache = new Map();
  GreenMapCore.triangulatePoly = function (pts) {
    const n = pts.length;
    if (n < 3) return [];
    const cached = _triCache.get(pts);
    if (cached) return cached;
    let area2 = 0;
    for (let i = 0, j = n - 1; i < n; j = i++)
      area2 += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    const ccw = area2 > 0;
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 4 * n + 16) {
      let clipped = false;
      for (let k = 0; k < idx.length; k++) {
        const a = idx[(k + idx.length - 1) % idx.length],
              b = idx[k],
              c = idx[(k + 1) % idx.length];
        const A = pts[a], B = pts[b], C2 = pts[c];
        const cross = (B[0] - A[0]) * (C2[1] - A[1]) -
                      (B[1] - A[1]) * (C2[0] - A[0]);
        const convex = ccw ? cross > 1e-9 : cross < -1e-9;
        if (!convex) continue;
        // No other vertex inside this ear (collinear ring members excluded
        // by the strict cross test above).
        let contains = false;
        for (const m of idx) {
          if (m === a || m === b || m === c) continue;
          const P = pts[m];
          const s1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
          const s2 = (C2[0] - B[0]) * (P[1] - B[1]) - (C2[1] - B[1]) * (P[0] - B[0]);
          const s3 = (A[0] - C2[0]) * (P[1] - C2[1]) - (A[1] - C2[1]) * (P[0] - C2[0]);
          const inside = ccw ? (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9)
                             : (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
          if (inside) { contains = true; break; }
        }
        if (contains) continue;
        tris.push([A, B, C2]);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;    // degenerate input: keep what we have
    }
    if (idx.length === 3)
      tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
    _triCache.set(pts, tris);
    return tris;
  };
  GreenMapCore.clipQuadToPoly = function (q, poly) {
    const tris = GreenMapCore.triangulatePoly(poly);
    if (!tris.length) return [];
    const out = [];
    for (const tri of tris) {
      let subj = [q];
      // S-H of the (remaining) subject against this ONE triangle edge.
      for (let e = 0; e < 3 && subj.length; e++) {
        const A = tri[e], B = tri[(e + 1) % 3];
        const ex = B[0] - A[0], ey = B[1] - A[1];
        const side = (px, py) => ex * (py - A[1]) - ey * (px - A[0]);
        const next = [];
        for (const pts of subj) {
          const nv = pts.length;
          const res = [];
          for (let i = 0; i < nv; i++) {
            const P = pts[i], Q = pts[(i + 1) % nv];
            const sP = side(P[0], P[1]), sQ = side(Q[0], Q[1]);
            if (sP >= 0) {
              res.push(P);
              if (sQ < 0) {
                const t = sP / (sP - sQ);
                res.push([P[0] + (Q[0] - P[0]) * t,
                          P[1] + (Q[1] - P[1]) * t,
                          P[2] + (Q[2] - P[2]) * t]);
              }
            } else if (sQ >= 0) {
              const t = sP / (sP - sQ);
              res.push([P[0] + (Q[0] - P[0]) * t,
                        P[1] + (Q[1] - P[1]) * t,
                        P[2] + (Q[2] - P[2]) * t]);
            }
          }
          if (res.length === 4) next.push(res);
          else if (res.length > 4)
            for (let i = 1; i < res.length - 1; i++)
              next.push([res[0], res[i], res[i + 1], res[i + 1]]);
          else if (res.length === 3)
            next.push([res[0], res[1], res[2], res[2]]);
          // res.length < 3 → subject fully outside this triangle: dropped.
        }
        subj = next;
      }
      for (const piece of subj) out.push(piece);
    }
    return out;
  };

  // Build a per-cell mask (Uint8Array W*H) from a polygon given in local
  // metre coords centred on the green centre (+x east, +y north).
  GreenMapCore.polyMask = function (polyLocalM, W, H, cellSize) {
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const mx = (x + 0.5 - W / 2) * cellSize;
        const my = (H / 2 - (y + 0.5)) * cellSize;
        if (GreenMapCore.pointInPoly(mx, my, polyLocalM)) mask[y * W + x] = 1;
      }
    }
    return mask;
  };

  // Naive putt-line preview v2: integrate lateral gradient along a straight
  // ball→pin line with MIDPOINT gradient sampling (more stable), smaller
  // steps, stopping at the pin OR when leaving the green polygon/mask.
  // ballM/pinM are local-metre coords [x E, y N]. Returns { pts, stopped }
  // where stopped === 'edge' if it left the green before reaching the pin.
  // CLEARLY A PREVIEW — not a real putt simulator.
  GreenMapCore.naivePuttPath = function (ballM, pinM, field, W, H, cellSizeM,
                                          mask, steps = 120, sensitivity = 6) {
    const toCell = ([mx, my]) => [
      Math.round(mx / cellSizeM + W / 2),
      Math.round(H / 2 - my / cellSizeM)];
    const [bx, by] = toCell(ballM), [px, py] = toCell(pinM);
    const dx = px - bx, dy = py - by;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;          // along line (grid coords)
    const nx = -uy, ny = ux;                     // perpendicular
    const ds = len / steps;
    const toMetres = (cx, cy) => [
      (cx - W / 2) * cellSizeM,
      (H / 2 - cy) * cellSizeM];
    const pts = [];
    let off = 0;

    const cellOk = (cx, cy) => {
      const ix = Math.round(cx), iy = Math.round(cy);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return -1;
      const i = iy * W + ix;
      return (field.valid[i] && (!mask || mask[i])) ? i : -1;
    };

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = bx + dx * t + nx * off;
      const cy = by + dy * t + ny * off;
      // Stop when we reach the pin (remaining along-line distance ≤ 1 step).
      if (len * (1 - t) <= ds) {
        pts.push(pinM);
        return { pts, stopped: 'pin' };
      }
      const i = cellOk(cx, cy);
      if (i < 0) {
        // Stepped off the green — stop at the last in-mask point.
        return { pts, stopped: 'edge' };
      }
      pts.push(toMetres(cx, cy));
      // Midpoint gradient sampling: sample half a step ahead for stability.
      const mi = cellOk(cx + ux * ds / 2 + nx * off / 2,
                        cy + uy * ds / 2 + ny * off / 2);
      if (mi >= 0) {
        const lat = -(field.gx[mi] * nx + field.gy[mi] * ny); // lateral pull
        off += lat * sensitivity * ds;
      }
    }
    return { pts, stopped: 'pin' };
  };
  /* ---- Physics-based putt roll model (pure, headless-testable) ----------
     Ball rolls with friction deceleration k ∝ Stimpmeter (stimp 10 →
     ~0.4 m/s²) and steers under the lateral component of gravity from the
     surface slope perpendicular to its velocity. v0 is chosen so the ball
     would just reach the pin on flat ground: v0 = sqrt(2·k·d).
     v1.1.3 (accuracy pass): gravity ALONG the roll now applies too —
     uphill slows the ball, downhill speeds it (×5/7 rolling factor, same
     factor on the lateral turn); finer default substeps. Previously the
     speed profile was flat-ground-only, so uphill putts didn't die and
     downhill ones didn't run — the speed was as wrong as the line.
     Stops at: pin (<0.30 m) | dead (speed <0.15 m/s) | edge (left mask).
     Returns { pts, stopped, breakIn } — breakIn is the max perpendicular
     deviation from the straight ball→pin line in INCHES, signed
     (positive = breaks to the RIGHT of the ball→pin direction). */
  GreenMapCore.simPuttPath = function (ballM, pinM, field, W, H, cellSizeM,
                                       mask, opts) {
    const o = opts || {};
    const stimp = Number.isFinite(o.stimp) ? o.stimp : 10;
    const dt = o.dt || 0.008;           // finer substeps (was 0.02)
    const GRAV = 9.81;
    const ROLL = 5 / 7;                 // rolling-ball factor
    const K_FLAT_AT_10 = 0.4;           // stimp 10 ⇒ k ≈ 0.4 m/s²
    const V_DEAD = 0.15;                // ball "dies" below this speed
    const PIN_R = 0.30;                 // holed within 30 cm
    const MAX_S = 12000;                // hard step cap (finer dt)

    // Faster greens (higher Stimpmeter) roll with LESS friction.
    const k = K_FLAT_AT_10 * 10 / Math.max(1, stimp);
    let dx = pinM[0] - ballM[0], dy = pinM[1] - ballM[1];
    const d = Math.hypot(dx, dy);
    if (d < PIN_R)
      return { pts: [ballM.slice(), pinM.slice()], stopped: 'pin', breakIn: 0 };
    // v1.1.3: optional launch controls for the aim solver — aimOffRad
    // offsets the initial direction, pace scales the flat-ground speed,
    // endV reports the arrival speed (die-pace detection).
    const v0 = Math.sqrt(2 * k * d) * (Number.isFinite(o.pace) ? o.pace : 1);
    let theta = Math.atan2(dy, dx) + (Number.isFinite(o.aimOffRad) ? o.aimOffRad : 0);
    let v = v0;
    let mx = ballM[0], my = ballM[1];
    const ux0 = dx / d, uy0 = dy / d;   // straight-line reference direction

    const cellIdx = (x, y) => {
      const ix = Math.round(x / cellSizeM + W / 2);
      const iy = Math.round(H / 2 - y / cellSizeM);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return -1;
      const i = iy * W + ix;
      return (field.valid[i] && (!mask || mask[i])) ? i : -1;
    };

    const pts = [[mx, my]];
    let maxDev = 0, devSign = 0;
    let stopped = 'dead';
    let endV = 0;
    for (let s = 0; s < MAX_S; s++) {
      const i = cellIdx(mx, my);
      if (i < 0) { stopped = 'edge'; break; }
      // Slope in local metres (x E, y N): field.gy was computed against the
      // south-positive grid axis, so the north component is -gy.
      const gradx = field.gx[i], grady = -field.gy[i];
      const ux = Math.cos(theta), uy = Math.sin(theta);
      // Perpendicular (left-positive) unit vector and the slope component
      // along it → lateral acceleration g·grad_perp rotates the velocity.
      const nx = -uy, ny = ux;
      const gradPerp = gradx * nx + grady * ny;
      // v1.1.3: gravity ALONG the roll (× rolling factor) — uphill slows,
      // downhill speeds. gradAlong > 0 = surface rising along travel.
      const gradAlong = gradx * ux + grady * uy;
      const aAlong = -GRAV * ROLL * gradAlong;
      // Gravity accelerates DOWN-slope: a = −g·∇h, perp component here
      // (same rolling factor on the turn).
      const aLat = -GRAV * ROLL * gradPerp;
      theta += (aLat / Math.max(v, 1e-6)) * dt;
      // Friction: constant deceleration along the direction of travel,
      // combined with the along-slope acceleration.
      v = Math.max(0, v + (aAlong - k) * dt);
      mx += Math.cos(theta) * v * dt;
      my += Math.sin(theta) * v * dt;
      pts.push([mx, my]);
      // Signed deviation from the straight line (positive = right of aim).
      const devRight = -(ux0 * (my - ballM[1]) - uy0 * (mx - ballM[0]));
      if (Math.abs(devRight) > Math.abs(maxDev)) { maxDev = devRight; }
      // Proximity beats "died": v0 arrives at the pin with ≈0 residual
      // speed on flat ground, so check reach BEFORE calling it dead.
      if (Math.hypot(pinM[0] - mx, pinM[1] - my) <= PIN_R) {
        stopped = 'pin';
        pts.push([pinM[0], pinM[1]]);
        endV = v;
        break;
      }
      if (v < V_DEAD) { stopped = 'dead'; break; }
    }
    devSign = maxDev >= 0 ? 1 : -1;
    return {
      pts, stopped,
      endV,
      breakIn: devSign * Math.abs(maxDev) * 39.3701   // metres → inches
    };
  };

  /* ---- Makeable-line aim solver (v1.1.3, pure, headless-testable) -------
     The old preview simulated ONLY "aim straight at the pin" — it drew the
     putt you'd miss, not the putt you should play. solvePutt searches the
     launch (aim offset, speed factor) for a launch whose roll finishes in
     the cup, then reports BOTH the makeable line and what the straight-aim
     putt would have done (for the honest "play N inches of break" readout).
     Strategy per James: ONE line — the one you should play. Returns
     { ok, pts, stopped, breakIn (in of break the MAKEABLE line plays),
       straightBreak (in the naive straight putt would break),
       diePace (true when the makeable line arrives <0.35 m/s) }
     ok=false when no launch within the search box holes out (extreme
     slope) — caller shows an honest "no makeable line" message. */
  GreenMapCore.solvePutt = function (ballM, pinM, field, W, H, cellSizeM,
                                     mask, opts) {
    const o = opts || {};
    const stimp = Number.isFinite(o.stimp) ? o.stimp : 10;
    const sim = (aimOffRad, pace) => GreenMapCore.simPuttPath(
      ballM, pinM, field, W, H, cellSizeM, mask,
      { stimp, aimOffRad, pace });
    // Launch search v3: aim and pace control different axes — aim moves the
    // endpoint ACROSS the ball→pin line, pace moves it ALONG it. So: for
    // each pace, BRACKET the aim where the roll crosses the pin line
    // (signed endpoint lateral changes sign) and bisect; a crossing within
    // 30 cm of the cup is the makeable line. (Grid+hope v2 missed islands
    // narrower than one coarse step — a provably makeable putt reported
    // unsolvable.) aimOff sign: positive aims LEFT of the pin.
    // v-fix(double-base): simPuttPath computes the straight-line angle
    // INTERNALLY and adds aimOffRad on top — pass the OFFSET ONLY. Passing
    // base+a aimed every launch off by the whole ball→pin angle (the flat
    // test grid passed only because its base is 0 — the worst kind of
    // false green). a is the aim offset in radians, + = left of the pin.
    const d = Math.hypot(pinM[0] - ballM[0], pinM[1] - ballM[1]);
    const ux0 = (pinM[0] - ballM[0]) / d, uy0 = (pinM[1] - ballM[1]) / d;
    const endLat = (r) => {
      const last = r.pts[r.pts.length - 1];
      return ux0 * (last[1] - ballM[1]) - uy0 * (last[0] - ballM[0]);
    };
    const endDist = (r) => {
      const last = r.pts[r.pts.length - 1];
      return Math.hypot(last[0] - pinM[0], last[1] - pinM[1]);
    };
    let best = null;                 // { a, pace, r } holed launch
    let fallback = null;             // closest miss (for ok:false path)
    const note = (r, a, pace) => {
      const dd = endDist(r);
      if (!fallback || dd < fallback.d) fallback = { a, pace, r, d: dd };
    };
    // v-fix(uphill-pace): the ladder must cover FIRM uphill putts — climbing
    // a 10% face bleeds ~0.7 m/s², so a Front-fringe putt needs ~1.6× the
    // flat-ground speed. Capping at 1.25 reported provably makeable uphill
    // putts as "no line" (far-tap probe). Die paces first, firm paces last.
    const PACES = [1.0, 1.06, 0.94, 1.12, 0.88, 1.18, 1.25, 1.35, 1.5, 1.7];
    for (const pace of PACES) {
      if (best) break;
      // Bracket: 13 aims, find adjacent pair whose endpoint laterals straddle 0.
      let lo = null, hi = null;
      let prevA = null, prevLat = null;
      for (let i = 0; i <= 12 && !lo; i++) {
        const a = -0.30 + 0.60 * i / 12;
        const r = sim(a, pace);
        if (r.stopped === 'pin') { best = { a, pace, r }; break; }
        note(r, a, pace);
        const lat = endLat(r);
        if (prevA !== null && Math.sign(lat) !== Math.sign(prevLat)) {
          lo = { a: prevA, lat: prevLat }; hi = { a, lat };
        }
        prevA = a; prevLat = lat;
      }
      if (best || !lo) continue;
      // Bisect the crossing (8 rounds), holed anywhere along the way wins.
      for (let it = 0; it < 8 && !best; it++) {
        const mid = (lo.a + hi.a) / 2;
        const r = sim(mid, pace);
        if (r.stopped === 'pin') { best = { a: mid, pace, r }; break; }
        note(r, mid, pace);
        const lat = endLat(r);
        if (Math.sign(lat) === Math.sign(lo.lat)) { lo = { a: mid, lat }; }
        else { hi = { a: mid, lat }; }
      }
    }
    // (No polish stage: bisection already converges to ~mm of the crossing,
    // and the cup is 30 cm wide — a "still holed" nudge stage only walked
    // the aim around inside the cup radius and drifted the reported line.)
    const straight = GreenMapCore.simPuttPath(ballM, pinM, field, W, H,
      cellSizeM, mask, { stimp });
    if (!best)
      return { ok: false, pts: straight.pts, stopped: straight.stopped,
        straightBreak: straight.breakIn };
    return {
      ok: true,
      pts: best.r.pts, stopped: best.r.stopped,
      breakIn: best.r.breakIn,
      straightBreak: straight.breakIn,
      aimIn: best.a * 180 / Math.PI,        // aim offset, degrees (+ = left)
      diePace: Number.isFinite(best.r.endV) ? best.r.endV < 0.35 : false
    };
  };

  /* ---- 3D orbit view math (pure, headless-testable) --------------------- */

  // Orbit camera basis. Eye sits at azimuth yawDeg (0 = from north/+Y),
  // elevation pitchDeg above the horizon, distance `dist` from the target
  // (target = green centre at origin; z handled by caller via relative pts).
  GreenMapCore.makeCam = function (yawDeg, pitchDeg, dist) {
    const yaw = yawDeg * Math.PI / 180;
    const pit = Math.max(1e-3, Math.min(Math.PI / 2 - 1e-3,
      pitchDeg * Math.PI / 180));
    const sa = Math.sin(yaw), ca = Math.cos(yaw);
    const sp = Math.sin(pit), cp = Math.cos(pit);
    // eye offset dir (unit): e = (sa*cp, ca*cp, sp); fwd = -e
    const fwd = [-sa * cp, -ca * cp, -sp];
    const right = [-ca, sa, 0];
    const up2 = [-sa * sp, -ca * sp, cp];
    return { fwd, right, up2, dist };
  };

  // Depth of a target-relative point along the camera forward axis.
  GreenMapCore.depthOf = function (cam, x, y, z) {
    return cam.dist + x * cam.fwd[0] + y * cam.fwd[1] + z * cam.fwd[2];
  };

  // Perspective projection of a target-relative point to screen px.
  // cam needs .f (focal px), .ox, .oy set by the renderer.
  GreenMapCore.projectPt = function (cam, x, y, z) {
    const d = GreenMapCore.depthOf(cam, x, y, z);
    if (d < 0.5) return null;                 // behind camera
    const cx = x * cam.right[0] + y * cam.right[1] + z * cam.right[2];
    const cy = x * cam.up2[0] + y * cam.up2[1] + z * cam.up2[2];
    const s = cam.f / d;
    return [cam.ox + cx * s, cam.oy - cy * s, d];
  };

  // Surface normal of a quad given 4 corners A,B,C,D (in winding order).
  // Uses diagonals for robustness: n = normalize(C-A × D-B).
  GreenMapCore.quadNormal = function (A, B, C, D) {
    const ux = C[0] - A[0], uy = C[1] - A[1], uz = C[2] - A[2];
    const vx = D[0] - B[0], vy = D[1] - B[1], vz = D[2] - B[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };

  // Flat-shade a base [r,g,b] with a fixed light direction (sky-ish).
  // k = ambient 0.55 + diffuse 0.45 · max(0, n·L).
  // Fixed NW-high sun: 315° azimuth, 45° altitude. Light vector points FROM
  // the surface TOWARD the sun, in local terrain coords (+x E, +y N, +z up).
  // Constant between sessions by construction (never derived from time/GPS).
  GreenMapCore.LIGHT_DIR = (() => {
    const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
    const L = [Math.cos(alt) * Math.sin(az),
               Math.cos(alt) * Math.cos(az),
               Math.sin(alt)];
    const l = Math.hypot(L[0], L[1], L[2]);
    return [L[0] / l, L[1] / l, L[2] / l];
  })();
  GreenMapCore.shadeColor = function (rgb, n) {
    const lam = Math.max(0, n[0] * GreenMapCore.LIGHT_DIR[0] +
      n[1] * GreenMapCore.LIGHT_DIR[1] + n[2] * GreenMapCore.LIGHT_DIR[2]);
    const k = 0.55 + 0.45 * lam;
    return [
      Math.min(255, Math.round(rgb[0] * k)),
      Math.min(255, Math.round(rgb[1] * k)),
      Math.min(255, Math.round(rgb[2] * k))
    ];
  };

  /* ---- Precision sampling (bilinear, invalid-aware) --------------------- */

  // Bilinear elevation at fractional grid coords where integer values land on
  // cell CENTRES. Weights of invalid/non-finite corners are dropped and the
  // rest renormalised; falls back to nearest valid cell; null if none.
  GreenMapCore.bilinearCellZ = function (grid, W, H, fx, fy, validMask) {
    const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H &&
      Number.isFinite(grid[y * W + x]) && (!validMask || validMask[y * W + x]);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let sum = 0, wsum = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const x = Math.max(0, Math.min(W - 1, x0 + dx));
        const y = Math.max(0, Math.min(H - 1, y0 + dy));
        if (!ok(x, y)) continue;
        const wgt = (dx ? fx - x0 : 1 - (fx - x0)) *
                    (dy ? fy - y0 : 1 - (fy - y0));
        sum += grid[y * W + x] * wgt;
        wsum += wgt;
      }
    }
    if (wsum > 1e-9) return sum / wsum;
    // nearest-valid fallback
    const xn = Math.max(0, Math.min(W - 1, Math.round(fx)));
    const yn = Math.max(0, Math.min(H - 1, Math.round(fy)));
    return ok(xn, yn) ? grid[yn * W + xn] : null;
  };

  // Sample an eg-like {grid,W,H,cellSizeM[,validMask]} at local metres
  // (x E, y N) relative to the grid centre — bilinear, not nearest-cell.
  GreenMapCore.sampleElevLocalM = function (egLike, mx, my) {
    if (!egLike || !egLike.grid) return null;
    const fx = mx / egLike.cellSizeM + egLike.W / 2 - 0.5;
    const fy = egLike.H / 2 - 0.5 - my / egLike.cellSizeM;
    if (fx < -1 || fy < -1 || fx > egLike.W || fy > egLike.H) return null;
    return GreenMapCore.bilinearCellZ(
      egLike.grid, egLike.W, egLike.H,
      Math.max(0, Math.min(egLike.W - 1 + 0.999, fx)),
      Math.max(0, Math.min(egLike.H - 1 + 0.999, fy)),
      egLike.validMask);
  };

  /* ---- Smooth shading: per-vertex normals + ambient occlusion ----------- */

  // Per-vertex normals: each vertex normal = normalised mean of the up-to-4
  // adjacent quad face normals (computed from real exaggerated positions).
  // Returns Float32Array(W*H*3); zero vector where no quad touches.
  GreenMapCore.vertexNormals3D = function (grid, W, H, cellSizeM, mask,
                                           exag, zmin) {
    const vn = new Float32Array(W * H * 3);
    const hgt = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
      const i = cy * W + cx;
      if (!mask[i] || !Number.isFinite(grid[i])) return null;
      return [(cx + 0.5 - W / 2) * cellSizeM,
              (H / 2 - cy - 0.5) * cellSizeM,
              (grid[i] - zmin) * exag];
    };
    // Face normals per quad (x,y): corner of quads grid.
    const qn = new Float32Array((W - 1) * (H - 1) * 3);
    const qok = new Uint8Array((W - 1) * (H - 1));
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const A = hgt(x, y), B = hgt(x + 1, y),
              C = hgt(x + 1, y + 1), D = hgt(x, y + 1);
        if (!A || !B || !C || !D) continue;
        const n = GreenMapCore.quadNormal(A, B, C, D);
        if (n[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
        qn.set(n, (y * (W - 1) + x) * 3);
        qok[y * (W - 1) + x] = 1;
      }
    }
    const addQ = (vx, vy, qx, qy, acc) => {
      if (qx < 0 || qy < 0 || qx >= W - 1 || qy >= H - 1 ||
          !qok[qy * (W - 1) + qx]) return;
      const o = (qy * (W - 1) + qx) * 3;
      acc[0] += qn[o]; acc[1] += qn[o + 1]; acc[2] += qn[o + 2];
      void vx; void vy;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!hgt(x, y)) continue;
        const acc = [0, 0, 0];
        addQ(x, y, x - 1, y - 1, acc);
        addQ(x, y, x,     y - 1, acc);
        addQ(x, y, x - 1, y,     acc);
        addQ(x, y, x,     y,     acc);
        const len = Math.hypot(acc[0], acc[1], acc[2]);
        if (len < 1e-9) continue;
        const o = (y * W + x) * 3;
        vn[o] = acc[0] / len; vn[o + 1] = acc[1] / len; vn[o + 2] = acc[2] / len;
      }
    }
    return vn;
  };

  // Soft ambient-occlusion approximation per cell: compare z against its ring
  // neighbourhood (Chebyshev radius `radius`). Depressions darken (down to
  // ×0.86), ridges brighten (up to ×1.10). Returns Float32Array factors.
  GreenMapCore.cellAO = function (grid, W, H, validMask, radius = 3) {
    const ao = new Float32Array(W * H).fill(1);
    const r = Math.max(1, radius | 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!validMask[i] || !Number.isFinite(grid[i])) continue;
        const z = grid[i];
        let sum = 0, sumAbs = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx;
            if (!validMask[j] || !Number.isFinite(grid[j])) continue;
            sum += grid[j]; sumAbs += Math.abs(grid[j]); n++;
          }
        }
        if (n < 4) continue;
        const dev = z - sum / n;
        const mad = Math.max(1e-4, (sumAbs / n) * 0.35);
        const t = Math.max(-1, Math.min(1, dev / mad));
        ao[i] = 1 + t * 0.12;   // ±12% max — subtle, never alarmist
      }
    }
    return ao;
  };

  // Bilinear 2× (or factor×) refinement of a grid + mask, for smoother mesh
  // shading without extra data fetches. Mask refined by nearest source cell.
  GreenMapCore.upsampleGrid = function (grid, W, H, validMask, factor = 2) {
    const f = Math.max(1, Math.round(factor));
    if (f === 1) return { grid, W, H, validMask };
    const W2 = W * f, H2 = H * f;
    const out = new Float32Array(W2 * H2);
    const m2 = validMask ? new Uint8Array(W2 * H2) : null;
    for (let y = 0; y < H2; y++) {
      const fy = (y + 0.5) / f - 0.5;
      const sy = Math.max(0, Math.min(H - 1, Math.floor(fy)));
      for (let x = 0; x < W2; x++) {
        const fx = (x + 0.5) / f - 0.5;
        const sx = Math.max(0, Math.min(W - 1, Math.floor(fx)));
        if (m2) m2[y * W2 + x] = validMask[sy * W + sx];
        const z = GreenMapCore.bilinearCellZ(grid, W, H,
          Math.max(0, Math.min(W - 1 + 0.999, fx)),
          Math.max(0, Math.min(H - 1 + 0.999, fy)), validMask);
        out[y * W2 + x] = Number.isFinite(z) ? z : grid[sy * W + sx];
      }
    }
    return { grid: out, W: W2, H: H2, validMask: m2 };
  };

  /* ---- Whole-hole flyover corridor --------------------------------------- */

  // Square bbox covering tee→green (or green alone when tee is null) plus a
  // margin, with the span capped (default 300 m) to stay inside API limits.
  // Returns [w, s, e, n].
  GreenMapCore.corridorBbox = function (latA, lngA, latB, lngB,
                                        marginM = 30, capSpanM = 300) {
    const pts = [[latA, lngA]];
    const hasTee = Number.isFinite(latB) && Number.isFinite(lngB);
    if (hasTee) pts.push([latB, lngB]);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    pts.forEach(([la, lo]) => {
      w = Math.min(w, lo); e = Math.max(e, lo);
      s = Math.min(s, la); n = Math.max(n, la);
    });
    const mLat = 110540;
    const mLng = 111320 * Math.cos(((s + n) / 2) * Math.PI / 180);
    const spanM = Math.max((e - w) * mLng, (n - s) * mLat);
    // No known tee → spec fallback: green centre ±150m (full-cap square).
    const mg = marginM == null ? 30 : marginM;
    const sideM = hasTee
      ? Math.min(capSpanM, spanM + 2 * mg)
      : capSpanM;
    const hx = sideM / 2 / mLng, hy = sideM / 2 / mLat;
    const cLat = (s + n) / 2, cLng = (w + e) / 2;
    return [cLng - hx, cLat - hy, cLng + hx, cLat + hy];
  };

  // Build the 3D mesh once per grid load / exaggeration change.
  // Quad (x,y) spans cells (x,y)..(x+1,y+1); kept only when all four cells
  // are inside the mask with finite heights. Vertex world coords:
  // mx=(cx-W/2)*cs, my=(H/2-cy)*cs, mz=(z-zmin)*exag.
  // opts: { smooth=true, ao=true, aoRadius=3, colorFn(i, zMid) -> [r,g,b] }.
  // smooth: per-corner lighting from averaged vertex normals (quad colour =
  // mean of its 4 corner shades → continuous look across quads).
  // ao: per-cell ambient-occlusion factor multiplies the lit colour.
  // Returns { count, pos, col, nrm, zmin } or null when empty.
  GreenMapCore.buildMesh3D = function (grid, W, H, cellSizeM, mask,
                                       elevRange, exag, mode, opts) {
    const O = Object.assign({ smooth: true, ao: true, aoRadius: 3,
                              colorFn: null,
                              // v-fix(rim-precision): true boundary polygon
                              // (local metres) for edge-cell subdivision.
                              polyLocalM: null }, opts || {});
    let zmin = Infinity;
    for (let i = 0; i < grid.length; i++)
      if (mask[i] && Number.isFinite(grid[i]) && grid[i] < zmin) zmin = grid[i];
    if (!Number.isFinite(zmin)) return null;
    const hgt = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
      const i = cy * W + cx;
      if (!mask[i] || !Number.isFinite(grid[i])) return null;
      return [grid[i], i];
    };
    const vn = O.smooth
      ? GreenMapCore.vertexNormals3D(grid, W, H, cellSizeM, mask, exag, zmin)
      : null;
    const aoF = O.ao ? GreenMapCore.cellAO(grid, W, H, mask, O.aoRadius)
                     : null;
    const quads = [];
    const [lo, hi] = elevRange;
    const litCorner = (baseCol, ci, quadN) => {
      const nrm = vn && (vn[ci * 3] || vn[ci * 3 + 1]) ? 
        [vn[ci * 3], vn[ci * 3 + 1], vn[ci * 3 + 2]] : quadN;
      const c = GreenMapCore.shadeColor(baseCol, nrm);
      const k = aoF ? Math.max(0.5, Math.min(1.4, aoF[ci])) : 1;
      return [Math.min(255, c[0] * k), Math.min(255, c[1] * k),
              Math.min(255, c[2] * k)];
    };
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const c00 = hgt(x, y), c10 = hgt(x + 1, y),
              c01 = hgt(x, y + 1), c11 = hgt(x + 1, y + 1);
        if (!c00 && !c10 && !c01 && !c11) continue;
        // v-fix(edgefill): if ANY corner is valid but an outer neighbour is
        // masked (edge-of-polygon cells), clone the nearest valid elevation
        // into the missing corner. Previously the whole quad was dropped,
        // leaving a one-cell gap ring between the surface and the skirt —
        // the skirt's interior walls showed through it.
        const anyC = c00 || c10 || c01 || c11;
        const f = (c) => c || anyC;
        // Vertex positions use the raster cell-CENTRE convention (matches
        // masks, arrows and picking exactly).
        const cxm = (cx) => (cx + 0.5 - W / 2) * cellSizeM;
        const cym = (cy) => (H / 2 - cy - 0.5) * cellSizeM;
        const v00 =[cxm(x), cym(y), (f(c00)[0] - zmin) * exag];
        const v10 = [cxm(x + 1), cym(y), (f(c10)[0] - zmin) * exag];
        const v01 = [cxm(x), cym(y + 1), (f(c01)[0] - zmin) * exag];
        const v11 = [cxm(x + 1), cym(y + 1), (f(c11)[0] - zmin) * exag];
        const zMid = (f(c00)[0] + f(c10)[0] + f(c01)[0] + f(c11)[0]) / 4;
        const n = GreenMapCore.quadNormal(v00, v10, v11, v01);
        if (n[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
        // Base colour: custom override (hole corridor), else mode ramp.
        let baseCol;
        if (O.colorFn) {
          baseCol = O.colorFn(f(c00)[1], zMid);
          if (!baseCol) continue;             // colorFn may cull the quad
        } else if (mode === 'elev') {
          const t = (zMid - lo) / Math.max(1e-6, hi - lo);
          baseCol = O.elevColorFn
            ? O.elevColorFn(t) : GreenMapCore.elevationColor(t);
        } else {
          const gxv = (f(c10)[0] - f(c00)[0] + f(c11)[0] - f(c01)[0]) / 2;
          const gyv = (f(c01)[0] - f(c00)[0] + f(c11)[0] - f(c10)[0]) / 2;
          const slopePct = Math.hypot(gxv, gyv) / cellSizeM * 100;
          baseCol = GreenMapCore.slopeColor(slopePct);
        }
        const corners = [
          litCorner(baseCol, f(c00)[1], n), litCorner(baseCol, f(c10)[1], n),
          litCorner(baseCol, f(c11)[1], n), litCorner(baseCol, f(c01)[1], n)];
        const col = [
          (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4,
          (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4,
          (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4];
        // v-fix(rim-precision): subdivide boundary cells 6×6 and keep only
        // sub-quads whose centre lies inside the true boundary polygon — the
        // surface silhouette follows the real outline to ~cellSize/12 instead
        // of the jagged grid-cell staircase seen from the side. Interior
        // cells (all 4 corners masked) keep the fast single-quad path.
        // v-fix(nan-corner): a corner is null when its cell is masked OR its
        // elevation is non-finite (LiDAR void). Test the corner objects for
        // existence BEFORE indexing mask[c[1]] — v1.0.87 dereferenced a null
        // corner here and crashed the whole mesh build whenever a void sat
        // beside valid cells inside the polygon.
        // v-fix(fastpath-overhang): the fast whole-cell path required only
        // that the 4 corner NODES be masked — but a cell whose corners are
        // inside the grown ring can still POKE PAST the ring between nodes
        // (ring curvature cuts inside the straight cell edge). Those
        // unclipped square corners sat above the wall-top profile as the
        // staircase+black-gap zipper at the near rim (3x magnified proof,
        // .toothzoom.png). Cells NEAR the ring now go through the
        // sub-quad + Sutherland–Hodgman clip path; only cells entirely in
        // the deep interior (all corners inside the ring INSET one cell)
        // keep the fast path.
        let nearRim = false;
        if (O.polyLocalM && O.polyLocalM.length > 2) {
          const insetRing = O.polyInset || (O.polyInset =
            GreenMapCore.polyOffsetCache(O.polyLocalM, -cellSizeM * 1.5));
          const pad = cellSizeM * 0.71;   // half-diagonal reach of a corner
          nearRim =
            !GreenMapCore.pointInPoly(cxm(x) - pad, cym(y) - pad, insetRing) ||
            !GreenMapCore.pointInPoly(cxm(x + 1) + pad, cym(y) - pad, insetRing) ||
            !GreenMapCore.pointInPoly(cxm(x + 1) + pad, cym(y + 1) + pad, insetRing) ||
            !GreenMapCore.pointInPoly(cxm(x) - pad, cym(y + 1) + pad, insetRing);
        }
        if (nearRim ||
            (O.polyLocalM && O.polyLocalM.length > 2 &&
             (!c00 || !c10 || !c01 || !c11 ||
              !mask[c00[1]] || !mask[c10[1]] ||
              !mask[c01[1]] || !mask[c11[1]]))) {
          const SUB = 6;
          // v-fix(whole-cell-clip): clip the WHOLE CELL to the ring in ONE
          // Sutherland–Hodgman pass. The 6×6 sub-quad pass is obsolete:
          // its purpose (interpolating across void corners) is now handled
          // by the void-parity zAt below, and along a diagonal ring the
          // independent sub-quad clips produced alternating degenerate
          // slivers = a serrated zipper silhouette. One clip per cell: the
          // drawn edge IS the ring polygon — continuous by construction.
          const out = [];
          // v-fix(void-parity): zAt must be the SAME interpolant as
          // surfZ3 (which drives the wall top + lip) — blend ONLY finite
          // node values with renormalized weights, same nearest-finite
          // fallback. Previously void corners cloned a neighbour's value
          // here while surfZ3 renormalized: two different heights near
          // LiDAR voids → wall top ≠ drawn edge → the alternating black
          // teeth at the rim (tooth zooms, layer isolation, all prior
          // cull/height fixes never touched this convention mismatch).
          const n00 = grid[y * W + x],           n10 = grid[y * W + x + 1];
          const n01 = grid[(y + 1) * W + x],     n11 = grid[(y + 1) * W + x + 1];
          const zAt = (fx, fy) => {
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy,       w11 = fx * fy;
            let h = 0, wsum = 0;
            if (Number.isFinite(n00)) { h += n00 * w00; wsum += w00; }
            if (Number.isFinite(n10)) { h += n10 * w10; wsum += w10; }
            if (Number.isFinite(n01)) { h += n01 * w01; wsum += w01; }
            if (Number.isFinite(n11)) { h += n11 * w11; wsum += w11; }
            if (wsum > 1e-9) return (h / wsum - zmin) * exag;
            // all four void: nearest finite within 3 nodes (same policy
            // and ordering as surfZ3's ring search).
            for (let r = 1; r <= 3; r++)
              for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                  if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                  const nx2 = x + dx, ny2 = y + dy;
                  if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
                  const v = grid[ny2 * W + nx2];
                  if (Number.isFinite(v)) return (v - zmin) * exag;
                }
            return 0;
          };
          {
            const pieces = GreenMapCore.clipQuadToPoly(
              [[cxm(x), cym(y), zAt(0, 0)],
               [cxm(x + 1), cym(y), zAt(1, 0)],
               [cxm(x + 1), cym(y + 1), zAt(1, 1)],
               [cxm(x), cym(y + 1), zAt(0, 1)]],
              O.polyLocalM);
            for (const v of pieces)
              out.push({ v, col: col.map(Math.round), vc: corners, n });
          }
          quads.push(...out);
          continue;
        }
        quads.push({ v: [v00, v10, v11, v01],
                     col: col.map(Math.round),
                     vc: corners, n });
      }
    }
    const count = quads.length;
    if (!count) return null;
    const pos = new Float32Array(count * 12);
    const col = new Float32Array(count * 3);
    const vcol = new Float32Array(count * 12);
    const nrm = new Float32Array(count * 3);
    quads.forEach((q, k) => {
      q.v.forEach((p, c) => { pos.set(p, k * 12 + c * 3); });
      if (q.vc) q.vc.forEach((p, c) => { vcol.set(p, k * 12 + c * 3); });
      col.set(q.col, k * 3);
      nrm.set(q.n, k * 3);
    });
    return { count, pos, col, vcol, nrm, zmin };
  };

  // Classic topo rainbow ramp (18Birdies-style): deep blue → cyan → green →
  // yellow → orange → red. Used as the default elevation ramp for the
  // 3D/hole views; 2D keeps the softer legacy ramp.
  GreenMapCore.elevationColorRainbow = function (t) {
    const stops = [
      [0.00, [38, 56, 152]],    // deep blue — low
      [0.20, [40, 140, 205]],   // cyan-blue
      [0.40, [64, 170, 92]],    // green
      [0.60, [240, 222, 70]],   // yellow
      [0.80, [242, 146, 48]],   // orange
      [1.00, [204, 50, 42]]     // red — high
    ];
    const p = Math.max(0, Math.min(1, t));
    for (let k = 1; k < stops.length; k++) {
      if (p <= stops[k][0]) {
        const [p0, c0] = stops[k - 1], [p1, c1] = stops[k];
        const u = (p - p0) / (p1 - p0);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * u),
          Math.round(c0[1] + (c1[1] - c0[1]) * u),
          Math.round(c0[2] + (c1[2] - c0[2]) * u)
        ];
      }
    }
    return stops[stops.length - 1][1];
  };

  // Nice contour interval from the actual elevation range: range/10 snapped
  // to a human-friendly step (1/2/2.5/5 × 10^k). Returns metres.
  GreenMapCore.contourInterval = function (lo, hi) {
    const range = Math.max(0, hi - lo);
    if (!(range > 0)) return 0.05;
    const raw = range / 10;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    // Snap to the NEAREST nice value (1 / 2 / 2.5 / 5 / 10 × 10^k).
    let nice = 1, best = Infinity;
    for (const c of [1, 2, 2.5, 5, 10]) {
      const d = Math.abs(norm - c);
      if (d < best) { best = d; nice = c; }
    }
    return nice * mag;
  };

  // Marching-squares contour segments along a grid: for each cell and each
  // contour level crossing it, emit the segment between the two crossed
  // edges. Points are local metres [x E, y N]; z is the interpolated RAW
  // elevation at the crossing. Only cells fully inside `mask` participate.
  GreenMapCore.contourSegments = function (vals, W, H, cellSizeM, mask,
                                           interval) {
    const segs = [];
    if (!(interval > 0) || !vals || W < 2 || H < 2) return segs;
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < vals.length; i++)
      if (mask[i] && Number.isFinite(vals[i])) {
        if (vals[i] < vmin) vmin = vals[i];
        if (vals[i] > vmax) vmax = vals[i];
      }
    if (!Number.isFinite(vmin) || !(vmax > vmin)) return segs;
    const mx = (cx) => (cx + 0.5 - W / 2) * cellSizeM;
    const my = (cy) => (H / 2 - cy - 0.5) * cellSizeM;
    const val = (cx, cy) => {
      const i = cy * W + cx;
      return (cx >= 0 && cy >= 0 && cx < W && cy < H && mask[i] &&
              Number.isFinite(vals[i])) ? vals[i] : null;
    };
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const v = [val(x, y), val(x + 1, y), val(x + 1, y + 1),
                   val(x, y + 1)];
        if (v.some(c => c === null)) continue;
        // Cell corner positions (local metres).
        const px = [mx(x), mx(x + 1), mx(x + 1), mx(x)];
        const py = [my(y), my(y), my(y + 1), my(y + 1)];
        // Edges: 0-1, 1-2, 2-3, 3-0.
        const eA = [0, 1, 2, 3], eB = [1, 2, 3, 0];
        const vHi = Math.max(v[0], v[1], v[2], v[3]);
        const vLo = Math.min(v[0], v[1], v[2], v[3]);
        let L = Math.ceil(vLo / interval) * interval;
        for (; L <= vHi; L += interval) {
          const hits = [];
          for (let e = 0; e < 4; e++) {
            const a = v[eA[e]], b = v[eB[e]];
            if ((a < L && b >= L) || (b < L && a >= L)) {
              const t = (L - a) / (b - a);
              hits.push([px[eA[e]] + (px[eB[e]] - px[eA[e]]) * t,
                         py[eA[e]] + (py[eB[e]] - py[eA[e]]) * t]);
            }
          }
          if (hits.length >= 2)
            segs.push({ z: L, a: hits[0], b: hits[1] });
        }
      }
    }
    return segs;
  };

  // Skirt wall quads: extrude a closed boundary polygon (local metres) down
  // to a base plane. zAt([mx,my]) returns the top surface height; baseZ is
  // the floor height. Returns [{ v: [topA, topB, botB, botA] }, …].
  GreenMapCore.buildSkirtQuads = function (polyLocalM, zAt, baseZ = 0) {
    if (!polyLocalM || polyLocalM.length < 3) return [];
    const quads = [];
    const n = polyLocalM.length;
    for (let i = 0; i < n; i++) {
      const p1 = polyLocalM[i], p2 = polyLocalM[(i + 1) % n];
      const z1 = zAt(p1), z2 = zAt(p2);
      if (!Number.isFinite(z1) || !Number.isFinite(z2)) continue;
      quads.push({
        v: [
          [p1[0], p1[1], z1],
          [p2[0], p2[1], z2],
          [p2[0], p2[1], baseZ],
          [p1[0], p1[1], baseZ]
        ]
      });
    }
    return quads;
  };

  window.GreenMapCore = GreenMapCore;

  // Headless (node) runs stop here — pure core is all tests need.
  if (typeof document === 'undefined') return;

  /* ======================================================================
     2. DATA LOADING
     ====================================================================== */
  // v1.1.7: test presets removed — the tool loads the green handed to it by
  // the Play tab. Bare URL (no params) falls back to the last-launched
  // green remembered in localStorage, so Back-and-return keeps working.
  const SPAN_M = 40;         // bbox side, metres
  // v-fix(hi-res-lidar): 128×128 real 3DEP samples (0.31 m/cell) replace the
  // fake 2× bilinear upsample of 64×64 — same render cost (the upsample
  // branch auto-skips at W ≥ 100), half the cell error, finer rim trim.
  const GRID_N = 128;        // cells per side

  const qs = new URLSearchParams(
    (typeof location !== 'undefined' && location.search) || '');
  // v1.1.7: remember the last-launched green so a bare greenmap.html (Back
  // re-entry, PWA relaunch) still shows YOUR green, not a test preset.
  const LAST_GREEN_KEY = 'caddy:greenmap:lastGreen';
  let lastGreen = null;
  try {
    lastGreen = JSON.parse(localStorage.getItem(LAST_GREEN_KEY) || 'null');
  } catch (e) { lastGreen = null; }
  const state = {
    lat: parseFloat(qs.get('lat')) ||
      (lastGreen && Number.isFinite(lastGreen.lat) ? lastGreen.lat : 41.91314),
    lng: parseFloat(qs.get('lng')) ||
      (lastGreen && Number.isFinite(lastGreen.lng) ? lastGreen.lng : -93.60971),
    teeLL: (Number.isFinite(parseFloat(qs.get('teelat'))) &&
            Number.isFinite(parseFloat(qs.get('teelng'))))
      ? { lat: parseFloat(qs.get('teelat')), lng: parseFloat(qs.get('teelng')) }
      : null,
    layer: 'both',           // shading | arrows | both
    mode: 'slope',           // slope | elev — color ramp mode
    view: { scale: null, ox: 0, oy: 0 },   // set after first render
    grid: null, field: null, mask: null, bbox: null,
    polyLocal: null,         // boundary polygon in local metres (always set
                             // after load: OSM outline or synthetic ellipse)
    polySource: null,        // 'osm' | 'ellipse' — where polyLocal came from
    elevRange: [0, 1],       // min/max elevation inside mask (elev mode)
    pin: null,               // local metre coords of pin marker
    ball: null,              // local metre coords for putt preview
    showPutt: false,
    viewMode: '2d',          // 2d | 3d | hole
    stimp: (() => {          // green speed for the putt preview (persisted)
      try {
        const v = parseInt(localStorage.getItem('gm-stimp'), 10);
        return [8, 10, 12].includes(v) ? v : 10;
      } catch (e) { return 10; }
    })(),
    v3: { yaw: 0, pitch: 35, dist: 62, exag: 8 },
    mesh: null,              // built 3D mesh (per grid load / exag change)
    meshArrows: [],          // subsampled downhill arrows on the surface
    // Precision bookkeeping
    greenZ: null,            // bilinear elevation (m) at the green centre
    quality: null,           // { cellM, pctValid } — shown in the legend
    // Dataset registry: green vs whole-hole corridor. The active one is
    // mirrored into state.grid/field/mask/elevRange so all existing
    // interaction/pick code keeps working unchanged.
    active: 'green',
    datasets: {
      green: null,
      hole: null             // { eg, field, maskAll, zoneMask, mesh, arrows,
    }                        //  spanM, centerLL, failed, msg }
  };

  // Mirror live state fields into the registry entry for the active dataset.
  function saveActive() {
    const ds = state.datasets[state.active];
    if (!ds) return;
    ds.grid = state.grid; ds.field = state.field; ds.mask = state.mask;
    ds.bbox = state.bbox; ds.elevRange = state.elevRange;
    ds.polyLocal = state.polyLocal; ds.mesh = state.mesh;
    ds.arrows = state.meshArrows;
  }

  // Switch the live state fields (grid/field/mask/…) between registered
  // datasets so all existing interaction/pick/render code keeps working.
  function activateDataset(name) {
    if (name === state.active || !state.datasets[name]) return false;
    saveActive();
    state.active = name;
    const ds = state.datasets[name];
    state.grid = ds.grid; state.field = ds.field; state.mask = ds.mask;
    state.bbox = ds.bbox; state.elevRange = ds.elevRange;
    state.polyLocal = ds.polyLocal;
    state.polySource = ds.polySource || state.polySource;
    // v-fix(single-elev-source): each dataset carries the grid its mesh was
    // built from; surfZ3 must follow the ACTIVE dataset.
    if (ds.meshGrid) state.meshGrid = ds.meshGrid;
    state.mesh = ds.mesh;
    // v1.3.1: arrows come from the dataset when fresh, else rebuild —
    // never draw arrows that belong to a DIFFERENT mesh (float bug).
    state.meshArrows = ds.arrows || [];
    if (!state.meshArrows.length && state.mesh) rebuildMeshArrows();
    return true;
    }

  async function fetchGreenPolygon(lat, lng, signal) {
    try {
      const q =
        `[out:json][timeout:15];` +
        `(way["golf"="green"](around:120,${lat},${lng}););` +
        `out geom 1;`;
      const res = await fetch(
        'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q),
        { signal });
      if (!res.ok) throw new Error('overpass ' + res.status);
      const data = await res.json();
      // v1.3.1: remember whether OSM had ANY green near the launch point —
      // the loc badge uses it to offer "switch to OSM" when a trace wins.
      const anyGreen = !!(data.elements && data.elements.length);
      window.__osmGreenNearby = anyGreen;
      const el = data.elements && data.elements[0];
      if (!el || !el.geometry) return null;
      return el.geometry.map(g => [g.lon, g.lat]);
    } catch (e) {
      console.warn('[greenmap] no OSM green polygon:', e.message);
      window.__osmGreenNearby = false;
      return null;
    }
  }

  // v1.2.2: loading card — shown while Overpass/USGS fetch, with a live
  // status line. Hidden the moment the green renders (or fails).
  function setLoading(msg) {
    const card = document.getElementById('gm-loading');
    const line = document.getElementById('gm-load-status');
    if (!card) return;
    if (msg === false) { card.hidden = true; return; }
    card.hidden = false;
    if (line && msg) line.textContent = msg;
  }

  async function loadGreen() {
    const status = document.getElementById('gm-status');
    status.textContent = 'Fetching USGS 3DEP elevation…';
    setLoading('Fetching slope data');
    const halfLat = (SPAN_M / 2) / 111320;
    const halfLng = (SPAN_M / 2) / (111320 * Math.cos(state.lat * Math.PI / 180));
    const bbox = [state.lng - halfLng, state.lat - halfLat,
                  state.lng + halfLng, state.lat + halfLat];

    let elev = null;
    try {
      elev = await window.CaddyElev.fetchElevGrid(bbox, GRID_N);
      // v-fix(picker-64-fallback): GRID_N 64→128 invalidated every cached
      // preset; switching courses now re-hits USGS, which throttles under
      // load — presets degraded to "no data". On a 128 failure, retry at
      // 64: instant from the old cache when present, otherwise a much
      // lighter request the server is far more willing to serve.
      if (!elev || !elev.grid) {
        elev = await window.CaddyElev.fetchElevGrid(bbox, 64);
      }
    } catch (e) {
      console.error('[greenmap]', e);
      try {
        elev = await window.CaddyElev.fetchElevGrid(bbox, 64);
      } catch (e2) { console.error('[greenmap] 64-fallback also failed', e2); }
    }

    const polyLL = await fetchGreenPolygon(state.lat, state.lng);
    setLoading('Reading green shape');

    if (!elev || !elev.grid) {
      status.textContent = 'No 3DEP data here — try another location.';
      setLoading(false);
      return;
    }
    state.bbox = bbox;
    state.grid = elev;

    const field = GreenMapCore.computeGradientField(
      elev.grid, elev.W, elev.H, elev.cellSizeM, (i) => !elev.validMask || elev.validMask[i]);

    // Clip mask: real polygon if we got one (in local metres), else a
    // synthetic 48-point ellipse POLYGON. v-fix(fallback-poly): the fallback
    // previously fed only a cell-centre mask to the renderer, so the surface
    // rim was a grid staircase — sawtooth jaggies at glancing orbit angles.
    // Feeding the same smooth polygon the OSM path uses lets the v1.0.87 rim
    // subdivision run here too: one boundary pipeline for both paths.
    // v-fix(trace-priority) v1.2.3: a TRACED outline ALWAYS beats OSM.
    // James traced Westwood's green, but his launch point was ~11 m off the
    // green centre and Overpass still matched a golf polygon near it —
    // badge said "✓ real green outline (OSM)" and his trace was ignored
    // ("when I try load my own green it doesn't load anything"). The trace
    // is ground truth (he drew THIS green on the satellite image); OSM is
    // the fallback when no trace exists.
    let mask = null;
    const tracedHit = (() => {
      try {
        const store = JSON.parse(
          localStorage.getItem('caddy:greenOutline:v1') || '{}');
        for (const k of Object.keys(store)) {
          const o = store[k];
          if (!o || !Array.isArray(o.vertices) || o.vertices.length < 3)
            continue;
          if (Math.hypot(
                (o.lat - state.lat) * 111320,
                (o.lng - state.lng) * 111320 * Math.cos(
                  state.lat * Math.PI / 180)) < 100) return o;
        }
      } catch (e) { /* no store */ }
      return null;
    })();
    // v1.2.5 (source choice): ?src=osm|traced overrides the default order
    // (trace first) — set by tapping the loc badge when both exist.
    const srcPref = qs.get('src');
    const useTrace = tracedHit && srcPref !== 'osm';
    const useOsm = polyLL && !useTrace && srcPref !== 'traced';
    state.__altOsm = !!(tracedHit && polyLL);   // both available → badge offers switch
    state.__altTrace = state.__altOsm;
    if (useTrace) {
      const mLat = 111320;
      const mLng = 111320 * Math.cos(state.lat * Math.PI / 180);
      state.polyLocal = tracedHit.vertices.map(([la, ln]) => [
        (ln - state.lng) * mLng, (la - state.lat) * mLat ]);
      state.polySource = 'traced';
      mask = GreenMapCore.polyMask(state.polyLocal,
        elev.W, elev.H, elev.cellSizeM);
    } else if (useOsm) {
      const polyLocal = polyLL.map(([lon, la]) => [
        (lon - state.lng) * 111320 * Math.cos(state.lat * Math.PI / 180),
        (la - state.lat) * 111320
      ]);
      state.polyLocal = polyLocal;
      state.polySource = 'osm';
      mask = GreenMapCore.polyMask(polyLocal, elev.W, elev.H, elev.cellSizeM);
    } else {
      const rM = SPAN_M * 0.36;
      const poly = [];
      for (let a = 0; a < 48; a++) {
        const th = a / 48 * Math.PI * 2;
        poly.push([Math.cos(th) * rM, Math.sin(th) * rM]);
      }
      state.polyLocal = poly;
      state.polySource = 'ellipse';
      mask = GreenMapCore.polyMask(state.polyLocal,
        elev.W, elev.H, elev.cellSizeM);
    }
    state.mask = mask;
    state.field = field;
    state.pin = [0, 0]; // pin at green centre

    // Precision: exact bilinear elevation at the green centre (reference
    // for the tooltip's ft-relative readout), plus data-quality numbers.
    state.greenZ = GreenMapCore.sampleElevLocalM(elev, 0, 0);

    let nValid = 0, nMasked = 0, maxS = 0, sumS = 0;
    let minZ = Infinity, maxZ = -Infinity;
    let nCellValid = 0;
    for (let i = 0; i < mask.length; i++) {
      if (Number.isFinite(elev.grid[i]) &&
          (!elev.validMask || elev.validMask[i])) nCellValid++;
      if (mask[i]) {
        nMasked++;
        const z = elev.grid[i];
        if (Number.isFinite(z)) {
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
      if (field.valid[i]) {
        nValid++;
        const s = GreenMapCore.slopePctAt(field, i);
        sumS += s; if (s > maxS) maxS = s;
      }
    }
    if (Number.isFinite(minZ) && Number.isFinite(maxZ) && maxZ > minZ)
      state.elevRange = [minZ, maxZ];
    // Data-quality note for the legend (subtle, not alarmist).
    state.quality = { cellM: elev.cellSizeM,
                      pctValid: 100 * nCellValid / (elev.W * elev.H) };
    updateQualityNote();
    // Register the green dataset, then start the corridor fetch in parallel.
    state.datasets.green = { grid: state.grid, field: state.field,
      mask: state.mask, bbox: state.bbox, elevRange: state.elevRange,
      polyLocal: state.polyLocal, polySource: state.polySource,
      mesh: null, arrows: [] };
    const t0 = performance.now();
    buildScene();
    fitView();
    buildHeatImage(); // v-fix: was never invoked — heat canvas stayed transparent
    render();
    loadCorridor();   // fire-and-forget; Hole view activates when ready
    console.log('[greenmap] load', `mode=${state.mode}`,
      `polyVerts=${state.polyLocal ? state.polyLocal.length : 0}`,
      state.polySource === 'ellipse' ? 'ellipse fallback' : 'osm polygon',
      `renderMs=${(performance.now() - t0).toFixed(1)}`);
    console.log('[greenmap] grid', `${elev.W}x${elev.H}`,
      'cellSize(m)', elev.cellSizeM.toFixed(3),
      `valid ${(100 * nValid / mask.length).toFixed(0)}%`,
      `in-mask ${nMasked}`, `mean slope ${(sumS / Math.max(1, nValid)).toFixed(2)}%`,
      `max slope ${maxS.toFixed(1)}%`);
    const SRC_LABEL = state.polySource === 'traced'
      ? 'traced outline' : state.polySource === 'ellipse'
        ? 'ellipse fallback' : 'OSM green shape';
    status.textContent = `${SRC_LABEL} · ` +
      `${(sumS / Math.max(1, nValid)).toFixed(1)}% mean slope`;
    setLoading(false);
    setLocLabel(state.polySource);
    // v1.1.7: remember this green for bare-URL relaunches (Back/PWA resume).
    try {
      localStorage.setItem(LAST_GREEN_KEY, JSON.stringify({
        lat: state.lat, lng: state.lng }));
    } catch (e) { /* private mode etc. — non-fatal */ }
  }

  /* ======================================================================
     2b. WHOLE-HOLE FLYOVER CORRIDOR
     ====================================================================== */
  const HOLE_SPAN_CAP_M = 300;
  const HOLE_GRID_N = 96;

  function updateQualityNote() {
    const el = document.getElementById('gm-quality');
    if (!el) return;
    if (!state.quality) { el.textContent = ''; return; }
    el.textContent = `± ${state.quality.cellM.toFixed(1)} m/cell · ` +
      `${state.quality.pctValid.toFixed(0)}% valid · ` +
      'USGS 3DEP LiDAR (vintage varies)';
  }

  // Fetch the tee→green corridor grid (or green ±150 m when no tee is known)
  // and pre-build its mesh + arrows. Never throws into broken UI: on failure
  // the Hole view degrades to green-only 3D with an inline message.
  async function loadCorridor() {
    try {
      const bb = GreenMapCore.corridorBbox(state.lat, state.lng,
        state.teeLL ? state.teeLL.lat : NaN,
        state.teeLL ? state.teeLL.lng : NaN,
        30, HOLE_SPAN_CAP_M);
      const eg = await window.CaddyElev.fetchElevGrid(bb, HOLE_GRID_N);
      if (!eg || !eg.grid) throw new Error('no corridor coverage');
      const [w, s, e, n] = bb;
      const midLat = ((s + n) / 2) * Math.PI / 180;
      const mLng = 111320 * Math.cos(midLat), mLat = 110540;
      const spanM = Math.max((e - w) * mLng, (n - s) * mLat);

      // Interaction mask = every valid cell (whole corridor is explorable).
      const maskAll = new Uint8Array(eg.W * eg.H);
      for (let i = 0; i < maskAll.length; i++)
        if (Number.isFinite(eg.grid[i]) &&
            (!eg.validMask || eg.validMask[i])) maskAll[i] = 1;

      const field = GreenMapCore.computeGradientField(
        eg.grid, eg.W, eg.H, eg.cellSizeM,
        (i) => !eg.validMask || !!eg.validMask[i]);

      // Green-zone highlight mask in corridor-local metres.
      const gOffX = (state.lng - (w + e) / 2) * mLng;   // green centre offset
      const gOffY = (state.lat - (s + n) / 2) * mLat;
      const zoneMask = new Uint8Array(eg.W * eg.H);
      for (let y = 0; y < eg.H; y++)
        for (let x = 0; x < eg.W; x++) {
          const mx = (x + 0.5 - eg.W / 2) * eg.cellSizeM - gOffX;
          const my = (eg.H / 2 - y - 0.5) * eg.cellSizeM - gOffY;
          let inside;
          if (state.polyLocal && state.polyLocal.length > 2)
            inside = GreenMapCore.pointInPoly(mx, my, state.polyLocal);
          else {
            const rM = SPAN_M * 0.36;
            inside = (mx * mx + my * my) / (rM * rM) <= 1;
          }
          if (inside) zoneMask[y * eg.W + x] = 1;
        }

      // Dataset record (mesh + arrows built by buildHoleScene below).
      // v1.4.4 (VOID BRIDGE): steep forested slopes drop LiDAR returns —
      // void ISLANDS inside the corridor. buildMesh3D drops quads touching
      // a null corner, so each void = a hole showing background = the black
      // blocks all over James's 16:34 screenshot. Bridge them: 3 passes of
      // "any void cell beside valid cells takes their mean" — enough for
      // return-dropout islands (real no-data regions outside the corridor
      // rim stay void, they're behind the wall anyway).
      {
        const W = eg.W, H = eg.H, gr = eg.grid;
        let filled = 0;
        for (let pass = 0; pass < 3; pass++) {
          const add = [];
          for (let y = 1; y < H - 1; y++)
            for (let x = 1; x < W - 1; x++) {
              const i = y * W + x;
              if (Number.isFinite(gr[i])) continue;
              let sum = 0, n2 = 0;
              const nb = [i - 1, i + 1, i - W, i + W];
              for (const j of nb)
                if (Number.isFinite(gr[j])) { sum += gr[j]; n2++; }
              if (n2) add.push([i, sum / n2]);
            }
          for (const [i, v] of add) gr[i] = v;
          filled += add.length;
          if (!add.length) break;
        }
        // validMask must follow — sampling/masks treat non-finite as void.
        if (eg.validMask && filled)
          for (let i = 0; i < gr.length; i++)
            if (Number.isFinite(gr[i])) eg.validMask[i] = 1;
        if (filled) console.log('[greenmap] corridor void bridge:', filled,
          'cells filled over', 3, 'passes');
      }

      const ds = {
        grid: eg, field, mask: maskAll, bbox: bb,
        elevRange: state.elevRange, polyLocal: null,
        mesh: null, arrows: [],
        eg, zoneMask, spanM, centerLL: [(w + e) / 2, (s + n) / 2],
        gOff: [gOffX, gOffY],
        failed: false, msg: ''
      };
      state.datasets.hole = ds;

      buildHoleScene();
      console.log('[greenmap] corridor ready', `${eg.W}x${eg.H}`,
        `span=${spanM.toFixed(0)}m`,
        'zone cells', zoneMask.reduce((a, b) => a + b, 0));
      // v1.3.0: satellite texture for hole view — fetch tiles for the
      // corridor bbox and re-render when ready. Failure is silent: the
      // topo-colour mesh stays (honest fallback, no broken view).
      if (window.CaddySat && !ds.failed) {
        window.CaddySat.load(bb).then((sat) => {
          if (sat.fail) {
            console.log('[greenmap] satellite tiles unavailable — topo colours');
            return;
          }
          ds.sat = sat;
          ds.satSampler = window.CaddySat.makeSampler(sat, bb);
          console.log('[greenmap] satellite mosaic ready', sat.w + 'x' + sat.h);
          // v1.4.5 (BAKE): sample the photo ONCE into per-quad colours
          // (M.qPhoto) and blend into per-corner vertex colours (M.vcol)
          // so render3D does ZERO photo work per frame. Rotation lag gone.
          bakeSatelliteTexture(ds);
          if (state.viewMode === 'hole' && state.active === 'hole') render();
        }).catch(() => { /* topo colours stay */ });
      }
      // If the user is already waiting in Hole view, land them on it now.
      if (state.viewMode === 'hole' && state.active !== 'hole') {
        activateDataset('hole');
        fitHoleView();
        setStatus('Whole-hole 3D — drag = orbit · pinch/scroll = zoom · ' +
          'green highlighted, blue flag = tee');
        render();
      }
      return ds;
    } catch (err) {
      console.warn('[greenmap] corridor fetch failed:', err.message);
      state.datasets.hole = { failed: true,
        msg: 'Hole flyover unavailable here — showing green-only 3D.' };
      if (state.viewMode === 'hole') {
        // Graceful fallback without touching wireChrome scope: drop back to
        // green-only 3D and say why.
        state.viewMode = '3d';
        document.querySelectorAll('.gm-view-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.view === '3d'));
        if (state.active !== 'green') activateDataset('green');
        setStatus(state.datasets.hole.msg);
        render();
      }
      return null;
    }
  }

  // v1.4.5 (BAKE): sample the satellite photo once per quad + once per
  // VERTEX corner, mix with the tint (with the readability floor), and
  // store on the mesh: M.qPhoto (quad-centre fill) and M.vcol (per-corner
  // colours replaced by photo+tint blends). render3D then paints pure
  // gradients from baked colours — zero getImageData during rotation.
  // Re-runs on every buildHoleScene (exag/mode change) via the sat loader
  // callback AND here when the sat already arrived.
  function bakeSatelliteTexture(ds) {
    const M = ds.mesh;
    const sat = ds.sat;
    if (!M || !sat || !ds.satSampler || !M.gridRef) return;
    const gr = M.gridRef, cs = gr.cellSizeM;
    const mLat = 111320;
    const mLng = 111320 * Math.cos(ds.centerLL[1] * Math.PI / 180);
    const zone = ds.zoneMask;
    const FLOOR = 42;
    const qPhoto = new Array(M.count).fill(null);
    // per-corner: vcol layout is 12 floats/quad (4 corners × RGB)
    const vcol = new Float32Array(M.vcol ? M.vcol.length : M.count * 12);
    if (M.vcol) vcol.set(M.vcol);
    for (let q = 0; q < M.count; q++) {
      const ix = q % (gr.W - 1), iy = (q / (gr.W - 1)) | 0;
      const mx = (ix + 1 - gr.W / 2) * cs;
      const my = (gr.H / 2 - iy - 1) * cs;
      const inZone = zone && zone[Math.min(gr.W * gr.H - 1,
        iy * gr.W + ix + 1)];
      const photoShare = inZone ? 0.65 : 0.9;
      const tintR = M.col[q * 3], tintG = M.col[q * 3 + 1],
            tintB = M.col[q * 3 + 2];
      const mix = (p) => {
        if (!p) return null;
        const r0 = (p[0] * photoShare + tintR * (1 - photoShare)) | 0,
              g0 = (p[1] * photoShare + tintG * (1 - photoShare)) | 0,
              b0 = (p[2] * photoShare + tintB * (1 - photoShare)) | 0;
        const lum = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
        const k = lum < FLOOR ? FLOOR / Math.max(1, lum) : 1;
        return [
          Math.min(255, r0 * k | 0),
          Math.min(255, g0 * k | 0),
          Math.min(255, b0 * k | 0)
        ];
      };
      const samp = (ox, oy) => ds.satSampler(
        ds.centerLL[0] + (mx + ox * cs) / mLng,
        ds.centerLL[1] + (my + oy * cs) / mLat);
      const mid = mix(samp(0, 0));
      if (mid) qPhoto[q] = `rgb(${mid[0]},${mid[1]},${mid[2]})`;
      // corners: blend photo+tint into the existing vertex colours so the
      // painter's smooth-shading gradient carries the photo across quads.
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (let c = 0; c < 4; c++) {
        const p = mix(samp(corners[c][0], corners[c][1]));
        if (!p) continue;
        const o = q * 12 + c * 3;
        vcol[o] = p[0]; vcol[o + 1] = p[1]; vcol[o + 2] = p[2];
      }
    }
    M.qPhoto = qPhoto;
    M.vcol = vcol;
    console.log('[greenmap] satellite texture baked:',
      M.count, 'quads');
  }

  // Build/refresh the corridor mesh: muted fairway tones outside the green
  // zone, active-mode ramp (slope % / elevation) inside it.
  function buildHoleScene() {
    const ds = state.datasets.hole;
    if (!ds || !ds.grid) return;
    const [lo, hi] = ds.elevRange || [0, 1];
    const zone = ds.zoneMask, g = ds.eg.grid;
        // v-fix(corridor-grid): ds.grid is the ElevGrid OBJECT (like green view's
        // state.grid) so surfZ3/picking work in hole view; mesh + colour reads use
        // ds.eg.grid (the raw Float32Array). Previously ds.grid was the bare array
        // — buildMesh3D got undefined dims and Hole view spun on "Preparing…".
        // v-fix(single-elev-source): corridor dressing (tee marker, labels,
        // arrows) must sample the corridor grid, not green view's fine grid.
        state.meshGrid = { grid: ds.eg.grid, W: ds.eg.W, H: ds.eg.H,
          cellSizeM: ds.eg.cellSizeM };
        ds.meshGrid = state.meshGrid;
        // v1.4.1: record the exag the mesh was BUILT at — render3D rebuilds
        // when it drifts from state.v3.exag (the float-then-snap bug: mesh
        // built at exag A renders while walls/arrows sample exag B).
        ds.meshExag = state.v3.exag;
    ds.mesh = GreenMapCore.buildMesh3D(g, ds.eg.W, ds.eg.H,
      ds.eg.cellSizeM, ds.mask, ds.elevRange, state.v3.exag, state.mode,
      {
        smooth: true, ao: true, aoRadius: 4,
        elevColorFn: (t) => GreenMapCore.elevationColorRainbow(t),
        // v-fix(one-ring): same grown-ring trim as green view (wall top + lip
        // use the same ring), or the corridor's zone edge slivers.
        polyLocalM: null,
        colorFn: (i, zMid) => {
          if (zone && zone[i]) {
            // Active-ramp colour for green cells (3D → rainbow topo).
            if (state.mode === 'elev')
              return GreenMapCore.elevationColorRainbow(
                (zMid - lo) / Math.max(1e-6, hi - lo));
            // Slope % from raw neighbours (cheap central difference).
            const W = ds.eg.W, cs = ds.eg.cellSizeM;
            const ix = i % W, iy = (i / W) | 0;
            const zx1 = ix < W - 1 ? g[i + 1] : g[i];
            const zx0 = ix > 0 ? g[i - 1] : g[i];
            const zy1 = iy < ds.eg.H - 1 ? g[i + W] : g[i];
            const zy0 = iy > 0 ? g[i - W] : g[i];
            const slp = Math.hypot(zx1 - zx0, zy1 - zy0) / (2 * cs) * 100;
            return GreenMapCore.slopeColor(slp);
          }
          // Muted fairway, gently varied by relative elevation.
          // v1.1.4: brightened — the old base read near-black on shaded
          // exaggerated faces and the whole tee half vanished into the
          // background at glancing angles.
          const t = Math.max(-1, Math.min(1,
            (zMid - (lo + hi) / 2) / Math.max(0.5, hi - lo)));
          const k = 1 + t * 0.10;
          return [138 * k, 154 * k, 130 * k].map(Math.round);
        }
      });
    if (ds.mesh) ds.mesh.gridRef = state.meshGrid;
    // v1.4.5: mesh rebuilt (exag/mode change) — re-bake any satellite that
    // already arrived, so the photo colours follow the new mesh.
    if (ds.sat && ds.satSampler) bakeSatelliteTexture(ds);
    // Downhill arrows over the corridor (sparse — bigger step than 2D).
    // v1.1.4: step 5 → 14 — the corridor spawned ~350 arrows at the green
    // view's density, a swarming thicket over a hole this size (~90 now).
    const arr = [];
    const step = 14;
    for (let y = 1; y < ds.eg.H - 1; y += step)
      for (let x = 1; x < ds.eg.W - 1; x += step) {
        const i = y * ds.eg.W + x;
        if (!ds.mask[i] || !ds.field.valid[i]) continue;
        // v-fix(hole-void-parity): a mesh quad whose corner nodes are NaN
        // (LiDAR void) is dropped at build time, but the ARROW on that cell
        // still projected — white arrows floating over pure background in
        // the void stretches (hole-view probe). Same rule as the green
        // view's void parity: no finite corner nodes ⇒ no arrow.
        if (!Number.isFinite(g[i]) || !Number.isFinite(g[i + 1]) ||
            !Number.isFinite(g[i + ds.eg.W]) ||
            !Number.isFinite(g[i + ds.eg.W + 1])) continue;
        const gxv = ds.field.gx[i], gyv = ds.field.gy[i];
        const mag = Math.hypot(gxv, gyv);
        if (mag < 1e-5) continue;
        arr.push({
          mx: (x + 0.5 - ds.eg.W / 2) * ds.eg.cellSizeM,
          my: (ds.eg.H / 2 - y - 0.5) * ds.eg.cellSizeM,
          dxm: -gxv / mag, dym: gyv / mag,
          lenM: 0.9 + Math.min(2.4, mag * 100 / 4.0),
          slopePct: mag * 100
        });
      }
    ds.arrows = arr;
  }


  const canvas = document.getElementById('gm-canvas');
  const ctx = canvas.getContext('2d');
  const heatCanvas = document.createElement('canvas');

  function fitView() {
    const g = state.grid;
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    state.view.scale = Math.min(canvas.width, canvas.height) / (SPAN_M * 1.25);
    state.baseScale = state.view.scale;   // zoom clamp reference resets on fit
    state.view.ox = canvas.width / 2;
    state.view.oy = canvas.height / 2;
  }

  // local metres (x E, y N) -> screen px
  function toScreen(mx, my) {
    return [state.view.ox + mx * state.view.scale,
            state.view.oy - my * state.view.scale];
  }
  function fromScreen(px, py) {
    return [(px - state.view.ox) / state.view.scale,
            (state.view.oy - py) / state.view.scale];
  }

  function buildHeatImage() {
    const g = state.grid, f = state.field, m = state.mask;
    heatCanvas.width = g.W; heatCanvas.height = g.H;
    const img = ctx.createImageData(g.W, g.H);
    const d = img.data;
    for (let y = 0; y < g.H; y++) {
      for (let x = 0; x < g.W; x++) {
        const i = y * g.W + x;
        const o = i * 4;
        if (!m[i] || !f.valid[i]) { d[o + 3] = 0; continue; }
        let c;
        if (state.mode === 'elev') {
          const z = g.grid[i];
          const [lo, hi] = state.elevRange;
          c = GreenMapCore.elevationColor((z - lo) / Math.max(1e-6, hi - lo));
        } else {
          c = GreenMapCore.slopeColor(GreenMapCore.slopePctAt(f, i));
        }
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    heatCanvas.getContext('2d').putImageData(img, 0, 0);
  }

  // v-fix: coalesced render scheduling — during drags/pinches multiple input
  // events land per frame; this guarantees at most one full redraw per frame.
  let rafPending = false;
  function render() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (state.viewMode === '3d' || state.viewMode === 'hole') render3D();
      else render2D();
    });
  }

  function render2D() {
    const g = state.grid;
    ctx.fillStyle = '#0e1411';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!g) return;

    const [sx0, sy0] = toScreen(-SPAN_M / 2, SPAN_M / 2);

    // --- heat-map (bilinear smoothing via scaled drawImage) ---
    if (state.layer !== 'arrows') {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(heatCanvas, sx0, sy0, SPAN_M * state.view.scale, SPAN_M * state.view.scale);
    }

    // --- crisp green boundary outline ---
    drawGreenOutline();

    // --- flow arrows ---
    if (state.layer !== 'shading') {
      const step = 4;   // v1.2.3: sparser to pay for bolder strokes (readable)
      for (let y = 1; y < g.H - 1; y += step) {
        for (let x = 1; x < g.W - 1; x += step) {
          const i = y * g.W + x;
          if (!state.mask[i] || !state.field.valid[i]) continue;
          drawArrow(x + 0.5, y + 0.5, i);
        }
      }
    }

    // --- putt line preview ---
    if (state.showPutt && state.ball && state.pin) drawPutt();

    // --- pin marker ---
    drawPin();

    // --- scale bar ---
    drawScaleBar();
  }

  function drawGreenOutline() {
    const s = state.view.scale;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (state.polyLocal && state.polyLocal.length > 2) {
      state.polyLocal.forEach(([mx, my], k) => {
        const [sx, sy] = toScreen(mx, my);
        if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    } else {
      // ellipse fallback — same radius as the mask build
      const rM = SPAN_M * 0.36;
      ctx.ellipse(state.view.ox, state.view.oy, rM * s, rM * s, 0, 0, 7);
    }
    // dark halo underneath, soft light line on top → crisp on any fill
    ctx.strokeStyle = 'rgba(10,16,13,0.55)';
    ctx.lineWidth = Math.max(3, (window.devicePixelRatio || 1) * 2.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(248,252,249,0.75)';
    ctx.lineWidth = Math.max(1.5, (window.devicePixelRatio || 1) * 0.8);
    ctx.stroke();
  }

  function drawArrow(cellX, cellY, i) {
    const g = state.grid;
    const mx = (cellX - g.W / 2) * g.cellSizeM;
    const my = (g.H / 2 - cellY) * g.cellSizeM;
    const gxv = state.field.gx[i], gyv = state.field.gy[i];
    const mag = Math.hypot(gxv, gyv);
    if (mag < 1e-5) return;
    const slopePct = mag * 100;
    const lenM = 0.72 + Math.min(1.85, slopePct / 4.0);  // ∝ steepness, capped ~15% longer
    // downhill dir in local metres: east comp = -gx; north comp = +gy
    // (gy was computed with +y = south/screen-down, so flipping sign gives N)
    const dxm = -gxv / mag, dym = gyv / mag;
    const [x1, y1] = toScreen(mx - dxm * lenM / 2, my - dym * lenM / 2);
    const [x2, y2] = toScreen(mx + dxm * lenM / 2, my + dym * lenM / 2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const dpr = window.devicePixelRatio || 1;
    // v1.2.3 (readable arrows): James — "the arrows are so thin it's hard
    // to tell which way they're pointing". Bolder shaft + BIGGER head with
    // a steeper sweep; density reduced (step 3→4 below) so bolder arrows
    // don't turn into a thicket.
    const hs = Math.max(4.2, state.view.scale * 0.085);
    ctx.lineCap = 'round';
    // shaft: dark halo underneath, light stroke on top — legible on any fill
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(12,18,15,0.9)';
    ctx.lineWidth = Math.max(4.0, state.view.scale * 0.065);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246,251,247,0.98)';
    ctx.lineWidth = Math.max(2.0, state.view.scale * 0.032);
    ctx.stroke();
    // head: dark halo triangle slightly larger, then light on top
    const drawHead = (size, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(ang - 0.55), y2 - size * Math.sin(ang - 0.55));
      ctx.lineTo(x2 - size * Math.cos(ang + 0.55), y2 - size * Math.sin(ang + 0.55));
      ctx.closePath(); ctx.fill();
    };
    drawHead(hs * 1.45, 'rgba(12,18,15,0.9)');
    drawHead(hs, 'rgba(246,251,247,0.98)');
  }

  function drawPin() {
    if (!state.pin) return;
    const [px, py] = toScreen(state.pin[0], state.pin[1]);
    const s = state.view.scale;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, s * 0.03);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - s * 1.1); ctx.stroke();
    ctx.fillStyle = '#e04444';
    ctx.beginPath(); ctx.moveTo(px, py - s * 1.1);
    ctx.lineTo(px + s * 0.45, py - s * 0.95);
    ctx.lineTo(px, py - s * 0.78); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(px, py, Math.max(2, s * 0.06), 0, 7); ctx.fill();
  }

  function drawPutt() {
    // v1.1.3: the MAKEABLE line. solvePutt searches launch aim+pace until
    // the simulated roll finishes in the cup, then draws the line you
    // should play — not the straight-aim putt you'd miss (old behaviour
    // simulated "aim at the pin" only; on any real slope that line lied).
    const g = state.grid;
    if (!state.field) return;
    const r = GreenMapCore.solvePutt(
      state.ball, state.pin, state.field, g.W, g.H, g.cellSizeM, state.mask,
      { stimp: state.stimp });
    state.puttResult = r;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1.5, state.view.scale * 0.035);
    ctx.setLineDash([state.view.scale * 0.18, state.view.scale * 0.12]);
    ctx.beginPath();
    r.pts.forEach((p, k) => {
      const [sx, sy] = toScreen(p[0], p[1]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // ball dot at start
    const start = toScreen(state.ball[0], state.ball[1]);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(start[0], start[1],
      Math.max(3, state.view.scale * 0.08), 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(10,16,13,0.8)'; ctx.lineWidth = 1;
    ctx.stroke();
    setStatus(puttStatusText(r));
  }

  // v1.1.3: ONE status readout for the putt line, shared by 2D and 3D.
  // Makeable line: "Play N in of break · die/firm pace". Unmakeable: honest
  // "no makeable line — <n> in of break" instead of a hopeful fake arc.
  function puttStatusText(r) {
    const sb = Math.abs(r.straightBreak) >= 0.5
      ? Math.round(r.straightBreak) : r.straightBreak.toFixed(1);
    if (!r.ok)
      return `No makeable line from here — the slope would break the ` +
        `straight putt ~${sb} in. Consider a different angle.`;
    const side = r.straightBreak > 0 ? 'right' : 'left';
    const lb = Math.abs(r.breakIn) >= 0.5
      ? Math.round(Math.abs(r.breakIn)) : Math.abs(r.breakIn).toFixed(1);
    const pace = r.diePace ? 'die it at the cup' : 'firm — take the break out';
    return `Play ~${lb} in of break (${side}) · ${pace}`;
  }

  function drawScaleBar() {
    const targetPx = 90;
    const mPerTarget = targetPx / state.view.scale;
    const nice = [1, 2, 5, 10, 20, 50].reduce((a, b) =>
      Math.abs(b - mPerTarget) < Math.abs(a - mPerTarget) ? b : a);
    const px = nice * state.view.scale;
    ctx.strokeStyle = 'rgba(232,239,233,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, canvas.height - 20);
    ctx.lineTo(16 + px, canvas.height - 20);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,239,233,0.85)';
    ctx.font = `${11 * (window.devicePixelRatio || 1)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(nice + ' m', 16, canvas.height - 26);
  }

  /* ======================================================================
     3b. 3D ORBIT VIEW (18Birdies-style shaded elevation mesh)
     ====================================================================== */

  // Precompute mesh + surface arrows once per grid load / exaggeration change.
  function buildScene() {
    const g = state.grid;
    if (!g) return;
    saveActive();
    const ds = state.datasets[state.active];
    const isHole = state.active === 'hole';
    if (isHole) {
      buildHoleScene();
      state.mesh = ds.mesh;
      // v1.3.1: rebuildHoleScene already rebuilt arrows via rebuildMeshArrows
      // (ds.arrows mirrors state.meshArrows — keep them in sync).
      ds.arrows = state.meshArrows;
      return;
    }
    // Green mesh: 2× bilinear refinement (128-class internal grid when the
    // 64-cell fetch allows) → visibly smoother shading at no data cost.
    let mg = g.grid, mW = g.W, mH = g.H, mMask = state.mask, aoR = 3,
        cellM = g.cellSizeM;
    if (!isHole && g.W >= 32 && g.W < 100) {
      const up = GreenMapCore.upsampleGrid(g.grid, g.W, g.H,
        g.validMask || null, 2);
      mg = up.grid; mW = up.W; mH = up.H; aoR = 5;
      cellM = g.cellSizeM / 2;
      mMask = new Uint8Array(mW * mH);
      for (let y = 0; y < mH; y++)
        for (let x = 0; x < mW; x++) {
          const sx = Math.min(g.W - 1, (x / 2) | 0);
          const sy = Math.min(g.H - 1, (y / 2) | 0);
          mMask[y * mW + x] = state.mask[sy * g.W + sx];
        }
      // v-fix(fine-mask-poly): derive the FINE mask from the true boundary
            // polygon directly. Nearest-upsampling the coarse (cell-centre) mask
            // under-covers the polygon by up to one COARSE cell wherever the
            // outline bulges past masked coarse centres — the mesh had no cells
            // there at all, so no amount of boundary-cell subdivision could fill
            // them and the rim kept macro teeth (dark background showing through
            // at glancing orbit angles). Polygon-first mask + finite-elevation
            // check gives the subdividing rim full coverage to the true outline.
            // v-fix(surface-meets-wall): test against the polygon GROWN to the skirt's
                  // wall-top ring (+0.25 m) — surface edge, wall top and rim lip must be
                  // the SAME ring. v1.0.93 grew the mask but not the sub-quad trim, so
                  // whole-cell interior quads overhung the trimmed boundary by up to a
                  // full fine cell — the hanging triangle teeth and widening slits.
                  if (state.polyLocal && state.polyLocal.length > 2) {
                    const P = growPolyLocal(state.polyLocal, RING_M);
              for (let y = 0; y < mH; y++)
                for (let x = 0; x < mW; x++) {
                  const i = y * mW + x;
                  const mx = (x + 0.5 - mW / 2) * cellM;
                  const my = (mH / 2 - y - 0.5) * cellM;
                  mMask[i] = (GreenMapCore.pointInPoly(mx, my, P) &&
                              Number.isFinite(mg[i])) ? 1 : 0;
                }
            }
      void cellM;
          }
          // v-fix(meshgrid-scope): attach the build grid TO the mesh — surfZ3 reads
          // M.gridRef, so the elevation source can never be poisoned by another
          // dataset (the corridor loader used to overwrite the shared slot).
          state.meshGrid = { grid: mg, W: mW, H: mH, cellSizeM: cellM };
          ds.meshGrid = state.meshGrid;
          state.mesh = GreenMapCore.buildMesh3D(
      mg, mW, mH, cellM, mMask, state.elevRange,
      state.v3.exag, state.mode, {
        smooth: true, ao: true, aoRadius: aoR,
        // 18Birdies look: 3D views default to the classic topo rainbow.
        elevColorFn: (t) => GreenMapCore.elevationColorRainbow(t),
        // v-fix(rim-precision): true boundary polygon for edge subdivision.
        // v-fix(one-ring): trim against the GROWN ring — the same ring the
        // skirt wall tops and rim lip use. Trimming the sub-quads against the
        // bare polygon left a sub-cell sliver between surface edge and wall
        // top at the far rim; the wall showed through it as gray teeth.
        polyLocalM: (state.polyLocal && state.polyLocal.length > 2)
          ? growPolyLocal(state.polyLocal, RING_M)
          : null });
    if (state.mesh) state.mesh.gridRef = state.meshGrid;
    ds.mesh = state.mesh;
    rebuildMeshArrows();
  }

  // v1.3.1: arrow rebuild extracted — buildHoleScene and the exag-rebuild
  // path both need it, and render3D needs to know when the current
  // state.meshArrows no longer match state.mesh (the float-then-snap bug).
  function rebuildMeshArrows() {
    const ds = state.active === 'hole' ? state.datasets.hole : null;
    // v-fix(arrow-index) v1.3.2: THE v1.3.1 bug — ds.eg is the ElevGrid
    // OBJECT; indexing it with g[i] gives undefined, Number.isFinite
    // fails, and EVERY arrow was dropped (James: "3d arrows show
    // nothing"). Index the RAW array: ds.eg.grid (green view: state.grid
    // is the ElevGrid object, so its .grid too).
    const g = ds ? ds.eg.grid : (state.grid && state.grid.grid) || state.grid;
    const W = ds ? ds.eg.W : state.grid.W;
    const H = ds ? ds.eg.H : state.grid.H;
    const cellSizeM = ds ? ds.eg.cellSizeM : state.grid.cellSizeM;
    const field = ds ? ds.field : state.field;
    const mask = ds ? ds.mask : state.mask;
    if (!g || !field || !mask) return;
    const arr = [];
    const step = ds ? 14 : 11;   // corridor sparser (v1.1.4)
    for (let y = ds ? 1 : 4; y < H - 1; y += step)
      for (let x = ds ? 1 : 4; x < W - 1; x += step) {
        const i = y * W + x;
        if (!mask[i] || !field.valid[i]) continue;
        // void parity: all four corner nodes finite (row-major, W stride).
        if (!Number.isFinite(g[i]) || !Number.isFinite(g[i + 1]) ||
            !Number.isFinite(g[i + W]) || !Number.isFinite(g[i + W + 1]))
          continue;
        const gxv = field.gx[i], gyv = field.gy[i];
        const mag = Math.hypot(gxv, gyv);
        if (mag < 1e-5) continue;
        arr.push({
          mx: (x + 0.5 - W / 2) * cellSizeM,
          my: (H / 2 - y - 0.5) * cellSizeM,
          dxm: -gxv / mag, dym: gyv / mag,
          lenM: 1.6,
          slopePct: mag * 100
        });
      }
    state.meshArrows = arr;
    if (ds) ds.arrows = arr;   // keep the dataset mirror in sync
  }

  // Bilinear surface height (exaggerated world z) at local metres.
  // v-fix(single-elev-source): sample the MESH's own grid (state.meshGrid —
  // the fine upsampled grid the surface was actually built from), falling
  // back to the coarse fetch grid only when no fine grid exists. Previously
  // skirt walls / rim lip / labels sampled the COARSE grid while the surface
  // mesh used the FINE grid: at high exaggeration (13.5×) the height
  // mismatch opened a screen-space slit between wall top and surface edge —
  // see-through to the other side. One elevation source ⇒ exact seal.
  function surfZ3(mx, my) {
    const M = state.mesh;
    if (!M) return 0;
    // v-fix(meshgrid-scope): the elevation source travels ON the mesh object
    // (M.gridRef). The previous shared state.meshGrid slot was overwritten by
    // the corridor loader ~1s after launch while the user sat in green view —
    // green-view skirt/lip heights then sampled the COARSE corridor grid
    // (black band / see-through at steep rims on first render; dragging the
    // Exag slider "fixed" it by re-running buildScene). Attached to the mesh,
    // it can never mismatch the active dataset.
    const g = M.gridRef || state.grid;
    if (!g) return 0;
    const fx = mx / g.cellSizeM + g.W / 2 - 0.5;
    const fy = g.H / 2 - 0.5 - my / g.cellSizeM;
    const x0 = Math.max(0, Math.min(g.W - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(g.H - 1, Math.floor(fy)));
    const x1 = Math.min(g.W - 1, x0 + 1), y1 = Math.min(g.H - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    // v-fix(void-bilinear): NaN (LiDAR void) nodes previously blended as
    // ZERO elevation — the interpolated surface dipped at every void, and
    // the wall top followed it below the drawn surface edge → alternating
    // black slits along the rim wherever the ring crossed void cells (the
    // teeth that survived every cull strategy; the no-wall probe proved the
    // wall owned them). Blend ONLY finite nodes with renormalized weights;
    // if all four are void, search outward rings (≤3 cells) for the nearest
    // finite node.
    const nodes = [
      [g.grid[y0 * g.W + x0], (1 - tx) * (1 - ty)],
      [g.grid[y0 * g.W + x1], tx * (1 - ty)],
      [g.grid[y1 * g.W + x0], (1 - tx) * ty],
      [g.grid[y1 * g.W + x1], tx * ty]];
    let h = 0, wsum = 0;
    for (const [v, w] of nodes)
      if (Number.isFinite(v)) { h += v * w; wsum += w; }
    if (wsum > 1e-9) {
      return (h / wsum - M.zmin) * state.v3.exag;
    }
    const cx = Math.round(fx), cy = Math.round(fy);
    for (let r = 1; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx2 = cx + dx, ny2 = cy + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= g.W || ny2 >= g.H) continue;
          const v = g.grid[ny2 * g.W + nx2];
          if (Number.isFinite(v)) return (v - M.zmin) * state.v3.exag;
        }
    return (0 - M.zmin) * state.v3.exag;
  }

  // ---- 18Birdies-grade scene dressing -----------------------------------
  // Active-frame green boundary polygon (local metres), or null.
  function greenBoundaryPts() {
    if (state.active === 'green') {
      if (state.polyLocal && state.polyLocal.length > 2)
        return state.polyLocal;
      const pts = [];                     // ellipse fallback
      for (let a = 0; a < 48; a++) {
        const th = a / 48 * Math.PI * 2;
        pts.push([Math.cos(th) * SPAN_M * 0.36,
                  Math.sin(th) * SPAN_M * 0.36]);
      }
      return pts;
    }
    if (state.active === 'hole' && state.datasets.hole &&
        !state.datasets.hole.failed) {
      const [gox, goy] = state.datasets.hole.gOff;
      const gD = state.datasets.green;
      if (gD && gD.polyLocal && gD.polyLocal.length > 2)
        return gD.polyLocal.map(([mx, my]) => [mx + gox, my + goy]);
      const rM = SPAN_M * 0.36, pts = [];
      for (let a = 0; a < 48; a++) {
        const th = a / 48 * Math.PI * 2;
        pts.push([gox + Math.cos(th) * rM, goy + Math.sin(th) * rM]);
      }
      return pts;
    }
    return null;
  }

  // v-fix(dressing-z): set each frame by render3D — screen-space occlusion
  // test (px, py, depth) → true when the surface hides that point. Null when
  // no depth buffer is available (headless/2D).
  let dressingOcclusion = null;
  // v1.1.4(hole-silhouette): true when no geometry was rasterized at the
  // pixel — set per frame next to dressingOcclusion.
  let dressingOffSurface = null;

  // Thin semi-transparent iso-lines at fixed elevation intervals
  // (marching-squares along the live grid), projected onto the surface.
  // v1.4.1: paint the collected underside quads (from the last render's
  // classification) as a flat dark underlay. Called BEFORE the wall so the
  // wall covers them except in AA seam gaps.
  function paintSurfaceUnderlay(cam) {
    const M = state.mesh;
    const underQuads = state.__underQuads || [];
    if (!M || !underQuads.length) return;
    ctx.fillStyle = 'rgb(52,58,55)';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.6);
    for (const q of underQuads) {
      let ok = true;
      const pts = [];
      for (let c = 0; c < 4; c++) {
        const p = GreenMapCore.projectPt(cam, M.pos[q * 12 + c * 3],
          M.pos[q * 12 + c * 3 + 1], M.pos[q * 12 + c * 3 + 2]);
        if (!p) { ok = false; break; }
        pts.push(p);
      }
      if (!ok) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.lineTo(pts[3][0], pts[3][1]);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  function drawContours3D(cam, clipRing) {
    const g = state.grid, M = state.mesh;
    if (!g || !M || !state.mask) return;
    const [lo, hi] = state.elevRange || [0, 1];
    // Interval derives from the green's ACTUAL elevation range (range/10,
    // snapped to a nice value) — never hardcoded.
    const iv = GreenMapCore.contourInterval(lo, hi);
    const segs = GreenMapCore.contourSegments(
      g.grid, g.W, g.H, g.cellSizeM, state.mask, iv);
    if (!segs.length) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.7, (window.devicePixelRatio || 1) * 0.55);
    ctx.strokeStyle = 'rgba(16,26,20,0.32)';
    ctx.beginPath();
    for (const s of segs) {
      // v1.4.1: clip to the inset green polygon (midpoint test) — dashes
      // must never land outside the drawn surface.
      if (clipRing &&
          !GreenMapCore.pointInPoly((s.a[0] + s.b[0]) / 2,
            (s.a[1] + s.b[1]) / 2, clipRing)) continue;
      const p1 = GreenMapCore.projectPt(cam, s.a[0], s.a[1],
        (s.z - M.zmin) * state.v3.exag);
      const p2 = GreenMapCore.projectPt(cam, s.b[0], s.b[1],
        (s.z - M.zmin) * state.v3.exag);
      if (!p1 || !p2) continue;
      // v-fix(dressing-z): drop contour segments hidden behind the surface.
      if (dressingOcclusion &&
          dressingOcclusion(p1[0], p1[1], p1[2]) &&
          dressingOcclusion(p2[0], p2[1], p2[2])) continue;
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
    }
    ctx.stroke();
  }

  // THE one-ring (v1.0.97): every boundary-offset consumer — fine mask,
  // sub-quad trim, skirt wall tops, depth-prepass skirt, rim lip — grows the
  // bare boundary polygon by exactly THIS many metres. v1.0.94 said "one
  // ring" but the skirt/lip computed cellSize*0.25 ≈ 0.156 m (quarter-COARSE-
  // cell, a units slip) while the mask/trim used a literal 0.25 m — a ~9 cm
  // mismatch that left the surface's outer band unsupported over the wall on
  // steep falling rims (serrated background-through teeth at glancing angles,
  // pale tabs past the silhouette from above). Metres, one constant, one ring.
  const RING_M = 0.25;
  // Cached boundary ring INSET 0.15 m for the arrow silhouette gate
  // (v-fix arrow-silhouette); re-derived whenever state.polyLocal changes.
  let arrowRing = null, arrowRingSrc = null;

  // v-fix(skirt-grow): offset the boundary polygon OUTWARD by h metres along
  // each vertex's outward bisector. Wall tops built on the grown ring always
  // sit OUTSIDE the drawn surface edge (rim quads overshoot the polygon by up
  // to half a fine cell where interior cells keep whole-cell quads), so every
  // rim pixel has wall behind it — no black gaps between surface and skirt.
  function growPolyLocal(pts, h) {
    if (!pts || pts.length < 3 || !(Math.abs(h) > 0)) return pts;
    const n = pts.length;
    let area2 = 0;
    for (let i = 0, j = n - 1; i < n; j = i++)
      area2 += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    const ccw = area2 > 0;
    // Outward unit normal of edge a→b (from polygon winding, not centroid —
    // correct for concave shapes).
    const edgeN = (a, b) => {
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const l = Math.hypot(ex, ey) || 1;
      return ccw ? [ey / l, -ex / l] : [-ey / l, ex / l];
    };
    // v-fix(mitre-join): offset each EDGE's supporting LINE by h, then
    // rebuild vertices as intersections of consecutive offset lines.
    // Offsetting VERTICES along bisectors (the old code) under-covers at
    // sharp CONCAVE corners — the two offset edge lines cross before the
    // bisector point lands, so the ring dipped INSIDE the drawn surface
    // edge and the wall top left a red surface fragment visible past the
    // grey at glancing angles (Front-left dip, .rimreal10 zoom). Line-line
    // offsets give a true mitre join at every winding. Parallel/degenerate
    // neighbours fall back to the bisector point.
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      const n1 = edgeN(prev, p), n2 = edgeN(p, next);
      // Offset line 1: point A = prev + n1*h, dir d1 = p - prev.
      // Offset line 2: point B = p + n2*h,    dir d2 = next - p.
      const ax = prev[0] + n1[0] * h, ay = prev[1] + n1[1] * h;
      const d1x = p[0] - prev[0], d1y = p[1] - prev[1];
      const bx = p[0] + n2[0] * h, by = p[1] + n2[1] * h;
      const d2x = next[0] - p[0], d2y = next[1] - p[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) {
        // Near-parallel edges (collinear run): the offset lines coincide —
        // either offset point is the vertex.
        out[i] = [bx, by];
        continue;
      }
      const t = ((bx - ax) * d2y - (by - ay) * d2x) / den;
      out[i] = [ax + d1x * t, ay + d1y * t];
    }
    return out;
  }

  // v-fix(wall-envelope): the skirt wall top must never sit BELOW the drawn
  // surface edge. The rim trim keeps sub-quads up to one sub-quad inside the
  // ring, and on terrain that rises inward the drawn edge is HIGHER than the
  // surface sampled AT the ring — the old ring-sampled wall top left a strip
  // between edge and wall top covered by neither (black, gap widens with
  // exaggeration: James 21:38/21:40/21:44 shots). Envelope: per wall-top
  // vertex, take the MAX finite surface height sampled along the bare→ring
  // segment — by construction ≥ every drawn rim quad corner in the strip,
  // at ANY exaggeration. Returns { quads, topZ } — quads in the exact shape
  // buildSkirtQuads produced, topZ aligned to the grown-ring vertices (the
  // rim lip reuses it so the lip hugs the true wall top).
  function wallQuadsWithEnvelope(bpts) {
    const sPts = growPolyLocal(bpts, RING_M);
    const M = state.mesh;
    const quads = [];
    const topZ = new Array(sPts.length);
    for (let i = 0; i < sPts.length; i++) {
      const p2 = sPts[i];
      const p1 = bpts[i % bpts.length];   // bare vertex (same ring order)
      let zTop = -Infinity;
      // 7 samples (t step 1/6): surfZ3 along an arbitrary line is quadratic
      // (bilinear), so the continuous max can sit between samples — 7 points
      // bounds the underestimate to <1 mm of z at any real gradient.
      // v-fix(precise): was 4 samples.
      for (const t of [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6, 1]) {
        const mx = p1[0] + (p2[0] - p1[0]) * t;
        const my = p1[1] + (p2[1] - p1[1]) * t;
        const z = surfZ3(mx, my);
        if (Number.isFinite(z) && z > zTop) zTop = z;
      }
      if (!Number.isFinite(zTop))
        zTop = ((sampleElevRaw(p2[0], p2[1]) - M.zmin) * state.v3.exag) || 0;
      topZ[i] = zTop;
    }
    for (let i = 0; i < sPts.length; i++) {
      const j = (i + 1) % sPts.length;
      const a = sPts[i], b = sPts[j];
      if (!Number.isFinite(topZ[i]) || !Number.isFinite(topZ[j])) continue;
      quads.push({
        v: [[a[0], a[1], topZ[i]], [b[0], b[1], topZ[j]],
            [b[0], b[1], 0], [a[0], a[1], 0]]
      });
    }
    return { quads, topZ, sPts };
  }

  // v-fix(wall-profile): densify the boundary ring — every polygon edge is
  // split into ~step-metre segments. The SURFACE edge's height along the
  // polygon is piecewise-linear with breakpoints at every quad cut; a wall
  // top built only at polygon VERTICES chords across that profile and
  // diverges mid-edge by the surface curvature → alternating hairline
  // slits/overlaps at the junction (seen at 12× zoom). Sampling every
  // ~0.25 m bounds the chord error to <0.1 mm of z at real gradients:
  // wall top, lip and surface edge become the same profile at any zoom.
  function densifyRing(pts, step) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const A = pts[i], B = pts[(i + 1) % n];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const k = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < k; s++) {
        const t = s / k;
        out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      }
    }
    return out;
  }

  // v-fix(wall-ribbon): a filled ribbon that backs the entire rim: top edge
  // = surface heights along the grown ring (the wall top), bottom edge =
  // the same heights minus a small drop, plus a drop to z=0 for the full
  // wall. Drawn as ONE canvas path (no per-segment stroke seams, no normal
  // culling, no gates): painted BEFORE the surface it is invisible wherever
  // surface quads cover it, and it guarantees that any pixel between the
  // drawn surface edge and the wall body is wall-grey — never background.
  // This is the final seal for the "black teeth" class: the ribbon exists
  // at EVERY ring point by construction.
  // v1.2.4 RIBBON DELETED: the 26px crest band was a pre-one-crest seam
  // sealer; with plates + backboard sharing skirtRingHeights it is pure
  // redundancy — and its pale slivers at silhouette-tangent segments were
  // the "stepped flap / see-through base" on Westwood (layer bisect:
  // RIBBON_OFF flipped the artifact off). One wall architecture: backboard
  // + plates, one crest function. (v1.0.95 lesson re-proven: a backstop
  // kept after its root cause is fixed becomes the next artifact.)

  // Solid gray side walls extruding the green boundary down to the base
  // plane (z=0 pre-exaggeration) — gives the model physical thickness.
  // v-fix(quad-clip): with the surface now clipped EXACTLY to the grown ring,
  // the drawn edge height at a ring point IS surfZ3(ring). The wall top must
  // equal it (any excess paints grey over the near face — the v1.0.98
  // strip-max envelope did exactly that; any shortfall opens a slit). One
  // height function, one ring: wall top = lip = surface edge.
  // v-fix(one-crest) v1.2.4: ONE height function for every wall layer.
  // Previously plates used exact ring heights (with a `|| 0` fallback that
  // collapsed LiDAR-void points to zero height) while ribbon + backboard
  // used a ±2-max crest envelope — two different interpolants = the pale
  // flap riding above the plates at the silhouette edge (James's Westwood
  // "base is still see-through" + the vertical seam at the notch boundary).
  // Now: ±2 crest + nearest-finite carry for EVERYTHING. A max cannot be
  // undercut; carry cannot notch; all layers share it so none can poke
  // past another. (+0.06 lip lift applied identically by ribbon/backboard.)
  function skirtRingHeights(bpts) {
    const pts = densifyRing(growPolyLocal(bpts, RING_M), 0.25);
    const n = pts.length;
    const exact = pts.map(([mx, my]) => surfZ3(mx, my));
    const heights = exact.map((z, i) => {
      let m = -Infinity;
      for (let d = -2; d <= 2; d++) {
        const zn = exact[(i + d + n) % n];
        if (Number.isFinite(zn) && zn > m) m = zn;
      }
      if (Number.isFinite(m)) return m;
      // all-NaN window (LiDAR void): carry nearest finite height
      for (let d = 1; d < n; d++) {
        const za = exact[(i + d) % n];
        if (Number.isFinite(za)) return za;
        const zb = exact[(i - d + n) % n];
        if (Number.isFinite(zb)) return zb;
      }
      return 0;
    });
    return { pts, heights };
  }

  function drawSkirt(cam, bpts, allowBackFaces) {
    const exag = state.v3.exag, M = state.mesh;
    // v-fix(wall-profile): DENSIFIED ring (~0.25 m segments) — the wall top
    // follows the surface edge's piecewise-linear height profile instead of
    // chording between polygon vertices.
    const { pts: sPts, heights: sHeights } = skirtRingHeights(bpts);
    const hMap = new Map();
    sPts.forEach((p, i) => hMap.set(p, sHeights[i]));
    const zAt = (p) => hMap.get(p) ?? 0;
    const quads = GreenMapCore.buildSkirtQuads(sPts, zAt, 0);
    state.v3.wallTopZ = null;      // lip falls back to ring sampling
    // v-fix(skirtcull): cull wall quads whose OUTWARD face points away from
    // the camera. These are the far-side walls — previously they were drawn
    // unconditionally in a pass after the surface, so their interior (back)
    // faces showed above/behind the green rim as visible "inner walls".
    // A solid skirt is only ever seen from its outside.
    // v-fix(skirt-winding): outward direction comes from the polygon WINDING
    // (signed area), not "away from the centroid" — the centroid test
    // misclassified walls in CONCAVE sections of a non-convex green outline
    // (real OSM greens), culling walls that face the camera. Those gaps read
    // as red teeth hanging over black background at glancing angles.
    let area2 = 0;
    for (let i = 0, j = sPts.length - 1; i < sPts.length; j = i++)
      area2 += sPts[j][0] * sPts[i][1] - sPts[i][0] * sPts[j][1];
    const polyCCW = area2 > 0;
    // Camera position in local terrain coords (target + dist back along -fwd).
    const camPos = [
      -cam.fwd[0] * cam.dist, -cam.fwd[1] * cam.dist, -cam.fwd[2] * cam.dist];
    const items = [];
    for (const q of quads) {
      // v-fix(zipper-final): draw EVERY wall quad — no normal culling at
      // all. Ordering: the skirt paints after the surface, so the far-side
      // crest problem is moot (wall top ≡ surface edge now — same ring,
      // same function: nothing can rise above the surface). The near-side
      // zipper was the last artifact: normals on the wavy densified ring
      // flip segment-to-segment, so ANY normal-based cull leaves alternating
      // gaps. Depth-gate back faces so the inner wall never paints over the
      // near rim (barn door): if the depth buffer says this quad's centre is
      // behind surface geometry, skip it.
      const mx = (q.v[0][0] + q.v[1][0]) / 2,
            my = (q.v[0][1] + q.v[1][1]) / 2;
      // Outward normal (edge perpendicular per polygon winding).
      const ex = q.v[1][0] - q.v[0][0], ey = q.v[1][1] - q.v[0][1];
      const l = Math.hypot(ex, ey) || 1;
      const wnx = polyCCW ? ey / l : -ey / l;
      const wny = polyCCW ? -ex / l : ex / l;
      const isBack = wnx * (camPos[0] - mx) +
                     wny * (camPos[1] - my) <= 0;
      // v-fix(far-lip-envelope): the far wall's top follows the RING height,
      // which chords between cell-corner crests — in the V between two rim
      // tabs the crest dips and a sightline at 15x passes over it to the
      // background (single black triangle between tabs, .fringecrop.png).
      // Back quads only: raise the top to the MAX surface height along the
      // segment. By construction that max is a height the adjacent surface
      // tabs themselves reach, so the crest can never overtop the silhouette
      // (the v1.0.98 grey-over-near-face bug came from enveloping the NEAR
      // walls, which the surface already covers — near walls stay exact).
      if (isBack) {
        // v-fix(far-lip-widen): sample ±2 densified-vertex lengths BEYOND the
        // segment along its own tangent (13 points ≈ ±0.5 m window) — the
        // V-notch pitch between rim tabs is a full cell (0.31–0.62 m), so a
        // window shorter than that can still sit below the tab tops.
        let zMax = -Infinity;
        const sxx = q.v[1][0] - q.v[0][0], syy = q.v[1][1] - q.v[0][1];
        for (const tt of [-1, -2 / 3, -1 / 3, 0, 1 / 6, 1 / 3, 1 / 2,
                          2 / 3, 5 / 6, 1, 4 / 3, 5 / 3, 2]) {
          const ex2 = q.v[0][0] + sxx * tt;
          const ey2 = q.v[0][1] + syy * tt;
          const z = surfZ3(ex2, ey2);
          if (Number.isFinite(z) && z > zMax) zMax = z;
        }
        if (zMax > -Infinity) { q.v[0][2] = zMax; q.v[1][2] = zMax; }
      }
      if (isBack && !allowBackFaces) {
        // AFTER pass: back faces are depth-gated (fill visible holes only).
        // v-fix(drum): the underlay pass (allowBackFaces=true, runs BEFORE
        // the surface) draws EVERY quad unconditionally — a closed drum.
        // The far-side holes in James's 04:44 15x shots were far wall quads
        // culled by the old near/far split with nothing behind them; 18Birdies'
        // reference shell is closed all the way around. The surface painter
        // runs later and overpaints the drum wherever the surface exists, so
        // the drum can only ADD coverage, never overwrite the green.
        // v1.4.1: the depth gate used dressingOcclusion, whose zbuf EXCLUDED
        // surface undersides this round — so gated back walls behind an
        // underside were skipped and dark teeth showed between the red face
        // and the wall. The gate is redundant with the backboard (which
        // already fills crest→base unconditionally) — drop it entirely.
        void allowBackFaces;
      }
      let dsum = 0, ok = true;
      const sp = [];
      for (let c = 0; c < 4; c++) {
        const p = GreenMapCore.projectPt(cam, q.v[c][0], q.v[c][1],
          q.v[c][2]);
        if (!p) { ok = false; break; }
        sp.push(p); dsum += p[2];
      }
      if (ok) items.push({ sp, d: dsum / 4 });
    }
    items.sort((a, b) => b.d - a.d);      // far → near
    // v-fix(drum-backboard): ONE filled band between the crest ring and the
    // base ring, drawn BEFORE the plates. Plates are individual quads — at a
    // convex ring corner they fan apart in screen space and a wedge of
    // background showed through between them (the last 15x triangle; three
    // crest-envelope variants and per-vertex welds could not seal it,
    // .fringecrop.png series). A single closed fill has no inter-quad seams:
    // cracks become impossible by construction. Same grey family as the
    // plates (they paint over it with their gradient); wherever the green
    // surface exists the later surface painter overpaints the band top.
    {
      // v-fix(one-crest): the backboard uses the SHARED heights — it can
      // never disagree with the plates or ribbon again.
      const crest = [], base = [];
      for (let i = 0; i < sPts.length; i++) {
        const [mx, my] = sPts[i];
        // v1.3.1: crest EXACTLY at the shared heights — the old +0.06 lift
        // (inherited from the deleted ribbon) poked the backboard above the
        // far rim from high-pitch cameras: James's "still see through to
        // the other side" grey band (screenshot 06:48). Plates already sit
        // at heights; the surface edge is the same one-ring — nothing to lift.
        crest.push(GreenMapCore.projectPt(cam, mx, my, sHeights[i]));
        base.push(GreenMapCore.projectPt(cam, mx, my, 0));
      }
      ctx.fillStyle = 'rgb(96,104,100)';
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.6);
      // v-fix(bb-trapezoids): the single crest+base run SELF-CANCELS — the
      // far half of the base ring projects INSIDE the near half's ellipse
      // with opposite winding, so nonzero-fill carved the band's middle back
      // out (Westwood ellipse path, glancing 15x: wall ended mid-air, the
      // drum read see-through below the ribbon; [bb] logged fills=1 yet the
      // fill's lower region was unpainted). Per-adjacent-point trapezoids
      // are individually simple — nothing to cancel — and the same-colour
      // stroke seals their hairline seams (seam-cover trick).
      for (let i = 0; i < sPts.length; i++) {
        const j = (i + 1) % sPts.length;
        if (!crest[i] || !base[i] || !crest[j] || !base[j]) continue;
        // v1.4.1: EXTEND the trapezoid UP by 3 device px past the crest —
        // the sawtooth teeth were AA gaps between the surface's bottom edge
        // and the backboard crest (sub-pixel coverage gaps on the steep
        // face). Overdraw upward is safe: the surface paints later and
        // overpaints anything above its own edge.
        const LIFT = 3 * (window.devicePixelRatio || 1);
        const lift = (p, q2) => {
          const dx = q2[0] - p[0], dy = q2[1] - p[1];
          const l = Math.hypot(dx, dy) || 1;
          return [p[0] - dx / l * LIFT, p[1] - dy / l * LIFT];
        };
        const c0 = lift(crest[i], base[i]), c1 = lift(crest[j], base[j]);
        ctx.beginPath();
        ctx.moveTo(c0[0], c0[1]);
        ctx.lineTo(c1[0], c1[1]);
        ctx.lineTo(base[j][0], base[j][1]);
        ctx.lineTo(base[i][0], base[i][1]);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }
    // v-fix(wall-no-stroke): the per-quad dark stroke drew a near-black line
    // along the wall TOP — visible in James's screenshots as a persistent
    // black zigzag line between surface and wall ("that black line"), and as
    // the corrugated vertical ribs. The gradient alone gives the wall its
    // shading; the top edge is sealed by the grey rim lip instead. Stroke
    // only the BOTTOM edge (against the base plane) so the wall still reads
    // as segmented plates where it meets the floor.
    for (const it of items) {
      const [a, b, c, d] = it.sp;
      const grad = ctx.createLinearGradient(a[0], a[1], d[0], d[1]);
      grad.addColorStop(0, 'rgb(110,118,113)');
      grad.addColorStop(1, 'rgb(72,80,76)');
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.strokeStyle = grad;   // v1.4.1: same-colour seam cover on ALL edges
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.6);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Raw bilinear elevation (metres) — used only as a skirt fallback.
  function sampleElevRaw(mx, my) {
    const g = state.grid;
    if (!g) return 0;
    const fx = mx / g.cellSizeM + g.W / 2 - 0.5;
    const fy = g.H / 2 - 0.5 - my / g.cellSizeM;
    const x0 = Math.max(0, Math.min(g.W - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(g.H - 1, Math.floor(fy)));
    return Number.isFinite(g.grid[y0 * g.W + x0])
      ? g.grid[y0 * g.W + x0] : 0;
  }

  // Receding perspective grid on the base plane beneath/around the green —
  // subtle lines at ~5m spacing, fading with distance from the centre.
  function drawGridFloor(cam, bpts) {
    let minX = Infinity, maxX = -Infinity,
        minY = Infinity, maxY = -Infinity;
    for (const [mx, my] of bpts) {
      if (mx < minX) minX = mx;
      if (mx > maxX) maxX = mx;
      if (my < minY) minY = my;
      if (my > maxY) maxY = my;
    }
    if (!Number.isFinite(minX)) return;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const R = Math.max(25,
      Math.ceil((Math.max(maxX - minX, maxY - minY) / 2 + 18) / 5) * 5);
    const STEP = 5;
    const dpr = window.devicePixelRatio || 1;
    ctx.lineWidth = Math.max(0.6, dpr * 0.5);
    ctx.lineCap = 'butt';
    const seg = (am, bm) => {
      const pa = GreenMapCore.projectPt(cam, am[0], am[1], 0);
      const pb = GreenMapCore.projectPt(cam, bm[0], bm[1], 0);
      if (!pa || !pb) return;
      const dMid = Math.hypot((am[0] + bm[0]) / 2 - cx,
                              (am[1] + bm[1]) / 2 - cy);
      const aMid = Math.max(0.04, 0.17 - dMid / (R * 2.2));
      const grad = ctx.createLinearGradient(pa[0], pa[1], pb[0], pb[1]);
      grad.addColorStop(0, 'rgba(200,212,204,0.03)');
      grad.addColorStop(0.5, `rgba(188,202,193,${aMid.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(200,212,204,0.03)');
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    };
    for (let gx = Math.floor((cx - R) / STEP) * STEP;
         gx <= cx + R; gx += STEP)
      seg([gx, cy - R], [gx, cy + R]);
    for (let gy = Math.floor((cy - R) / STEP) * STEP;
         gy <= cy + R; gy += STEP)
      seg([cx - R, gy], [cx + R, gy]);
  }

  // v1.4.0: soft dark ellipse where the drum meets the ground plane —
  // grounds the model visually and hides any light bleed at the base seam.
  // v1.4.1: contact shading that FOLLOWS the real base ring — the v1.4.0
  // screen-space ellipse ignored projection rotation (huge floating oval in
  // James's 11:57 shot). Now: stroke the actual projected wall-base ring
  // (the same densified ring the wall uses) with a soft dark line + wider
  // halo. Hugs the drum exactly at every yaw.
  function drawBaseContactRing(cam, bpts) {
    const ring = densifyRing(growPolyLocal(bpts, RING_M), 0.25);
    const pts = ring.map(([mx, my]) =>
      GreenMapCore.projectPt(cam, mx, my, 0));
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const strokeRing = (color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        if (!p) continue;
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      }
      if (started) { ctx.closePath(); ctx.stroke(); }
    };
    strokeRing('rgba(6,10,8,0.20)', Math.max(4, 8 * dpr));
    strokeRing('rgba(6,10,8,0.45)', Math.max(2, 3 * dpr));
    ctx.restore();
  }

  // Front/Back labels at the green's short-axis edges (green view), or
  // Tee/Green labels (hole view).
  function drawEdgeLabels(cam, bpts) {
    const dpr = window.devicePixelRatio || 1;
    const label = (txt, mx, my) => {
      const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my));
      if (!p) return;
      ctx.font = `600 ${11 * dpr}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(8,12,10,0.78)';
      ctx.lineJoin = 'round';
      ctx.strokeText(txt, p[0], p[1] - 7 * dpr);
      ctx.fillStyle = '#f2f6f3';
      ctx.fillText(txt, p[0], p[1] - 7 * dpr);
      ctx.textAlign = 'left';
    };
    if (state.viewMode === 'hole') {
      const dsH = state.datasets.hole;
      const teeM = (dsH && !dsH.failed && state.teeLL) ? (() => {
        const mLat = 110540;
        const mLng = 111320 * Math.cos(dsH.centerLL[1] * Math.PI / 180);
        return [(state.teeLL.lng - dsH.centerLL[0]) * mLng,
                (state.teeLL.lat - dsH.centerLL[1]) * mLat];
      })() : null;
      if (teeM) label('Tee', teeM[0], teeM[1]);
      let greenM = null;
      if (bpts && bpts.length) {
        let sx = 0, sy = 0;
        for (const p of bpts) { sx += p[0]; sy += p[1]; }
        greenM = [sx / bpts.length, sy / bpts.length];
        label('Green', greenM[0], greenM[1]);
      }
      // v1.1.4: tee→green aim line + yardage readout (only when a real tee
      // is known — no fake numbers, same rule as everywhere else).
      if (teeM && greenM) {
        const a = GreenMapCore.projectPt(cam, teeM[0], teeM[1],
          surfZ3(teeM[0], teeM[1]) + 0.3);
        const b = GreenMapCore.projectPt(cam, greenM[0], greenM[1],
          surfZ3(greenM[0], greenM[1]) + 0.3);
        if (a && b && !(dressingOcclusion &&
            dressingOcclusion(a[0], a[1], a[2]) &&
            dressingOcclusion(b[0], b[1], b[2]))) {
          ctx.setLineDash([4 * dpr, 6 * dpr]);
          ctx.strokeStyle = 'rgba(255,255,255,0.30)';
          ctx.lineWidth = Math.max(1, dpr * 0.7);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.setLineDash([]);
          const yd = Math.hypot(greenM[0] - teeM[0], greenM[1] - teeM[1]) *
            1.09361;
          const mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2 - 8 * dpr;
          ctx.font = `600 ${11 * dpr}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3 * dpr;
          ctx.strokeStyle = 'rgba(8,12,10,0.78)';
          ctx.lineJoin = 'round';
          const txt = `${Math.round(yd)} yd`;
          ctx.strokeText(txt, mx2, my2);
          ctx.fillStyle = '#ffd166';
          ctx.fillText(txt, mx2, my2);
          ctx.textAlign = 'left';
        }
      }
      return;
    }
    if (!bpts || bpts.length < 2) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, my] of bpts) {
      if (my < minY) minY = my;
      if (my > maxY) maxY = my;
    }
    let sx = 0;
    for (const p of bpts) sx += p[0];
    const midX = sx / bpts.length;
    // v-fix(label-z): Front/Back labels are depth-tested like all other
    // dressing — a label on the far side of a rise/dip must not float over
    // the near surface. Occluded labels are simply not drawn.
    const labVis = (mx, my) => {
      const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my));
      if (!p) return false;
      return !(dressingOcclusion && dressingOcclusion(p[0], p[1], p[2]));
    };
    if (labVis(midX, minY)) label('Front', midX, minY);
    if (labVis(midX, maxY)) label('Back', midX, maxY);
  }

  function currentCam() {
    const cam = GreenMapCore.makeCam(
      state.v3.yaw, state.v3.pitch, state.v3.dist);
    cam.f = Math.min(canvas.width, canvas.height) * 1.15;
    cam.ox = canvas.width / 2;
    // Hole view: raise the principal point above centre so the green end of
    // the corridor sits low-centre in frame.
    // v1.1.4: match fitHoleView's principal point (0.52) so what the fit
    // verified is what renders (was 0.62 — the fit/camera mismatch put the
    // green end low in frame even after the numeric fit).
    cam.oy = canvas.height * (state.viewMode === 'hole' ? 0.52 : 0.56);
    return cam;
  }

  // Shared hole-view framing: corridor fills ~80% of viewport width given
  // cam.f ⇒ dist ≈ span·0.9, clamped to a sensible range.
  // v1.1.4 (hole fit): the old framing was a hardcoded guess —
  // dist = span*0.9 clamped [120,400], oy 0.62 — tuned for 1x and blind to
  // exaggeration. At 15x the corridor is a ~300 m tall slab: 2849/9025
  // quads projected OFF-SCREEN (tmp_proj_audit coverage map) and the tee
  // half of the hole vanished behind the frame edge while its arrows still
  // projected (the "floating over void" look). Fix: numeric fit — project
  // the ACTUAL mesh with the candidate camera and walk dist out until every
  // quad is in frame with a margin. Exact at any exag; re-run on exag
  // change and on corridor ready.
  function fitHoleView() {
    const ds = state.datasets.hole;
    const M = ds && ds.mesh;
    if (!M || !M.count) return;
    const f = Math.min(canvas.width, canvas.height) * 1.15;
    state.v3.pitch = 26;
    state.v3.yaw = 0;
    for (let dist = 80; dist <= 2000; dist += 20) {
      const cam = GreenMapCore.makeCam(state.v3.yaw, state.v3.pitch, dist);
      cam.f = f;
      cam.ox = canvas.width / 2;
      cam.oy = canvas.height * 0.52;
      let ok = true;
      const mW = canvas.width * 0.96, mH = canvas.height * 0.90;
      for (let q = 0; q < M.count && ok; q++) {
        for (let c = 0; c < 4 && ok; c++) {
          const p = GreenMapCore.projectPt(cam, M.pos[q * 12 + c * 3],
            M.pos[q * 12 + c * 3 + 1], M.pos[q * 12 + c * 3 + 2]);
          if (!p || p[0] < (canvas.width - mW) / 2 ||
              p[0] > (canvas.width + mW) / 2 ||
              p[1] < (canvas.height - mH) / 2 ||
              p[1] > (canvas.height + mH) / 2) ok = false;
        }
      }
      if (ok) { state.v3.dist = dist; return; }
    }
    state.v3.dist = 2000;      // even max didn't fit — clamp
  }

  function render3D() {
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#0e1411';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.viewMode === 'hole' &&
        (!state.grid || !state.mesh || state.active !== 'hole')) {
      // Corridor still loading (or fell back) — glass loading card with a
      // spinner, never a broken or silent UI.
      // v-fix: keep re-rendering so the spinner actually animates (it was
      // painted once and frozen — looked like a hang).
      setTimeout(() => { if (state.viewMode === 'hole' &&
        (!state.grid || !state.mesh || state.active !== 'hole')) render(); }, 90);
      const failed = state.datasets.hole && state.datasets.hole.failed;
      const msg = failed ? state.datasets.hole.msg : 'Preparing hole flyover…';
      const cw = canvas.width, ch = canvas.height;
      ctx.textAlign = 'center';
      if (!failed) {
        // Subtle spinner arc, rotating with wall-clock time.
        const cxm = cw / 2, cym = ch / 2 - 34 * dpr;
        const r = 15 * dpr;
        const t = (performance.now() / 900) % (Math.PI * 2);
        ctx.strokeStyle = 'rgba(157,179,166,0.25)';
        ctx.lineWidth = 3.5 * dpr;
        ctx.beginPath(); ctx.arc(cxm, cym, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd166';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cxm, cym, r, t, t + Math.PI * 1.15);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(232,239,233,0.9)';
      ctx.font = `${14 * dpr}px sans-serif`;
      ctx.fillText(msg, cw / 2, ch / 2 + (failed ? 0 : 18 * dpr));
      ctx.textAlign = 'left';
      // Keep the spinner spinning until the corridor lands (or fails).
      if (!failed)
        requestAnimationFrame(() => {
          if (state.viewMode === 'hole' &&
              (!state.grid || !state.mesh || state.active !== 'hole'))
            render3D();
        });
      // v-fix: show elapsed seconds + a Cancel that returns to 3D, so a slow
      // USGS fetch on mobile never looks like an infinite hang.
      const elapsed = ((performance.now() - (state.holeLoadT0 ||
        (state.holeLoadT0 = performance.now()))) / 1000) | 0;
      if (elapsed > 3) {
        ctx.fillStyle = 'rgba(232,239,233,0.55)';
        ctx.font = `${11 * dpr}px sans-serif`;
        ctx.fillText(elapsed + 's — slow map server', cw / 2,
          ch / 2 + (failed ? 20 : 38) * dpr);
      }
      ctx.textAlign = 'left';
      return;
    }
    state.holeLoadT0 = 0;
    if (!state.grid || !state.mesh) return;
    const cam = currentCam();
    // v1.4.1 (exag drift): if the hole mesh was built at a different exag
    // than the current slider (the float-then-snap class), rebuild NOW —
    // walls/arrows sample state.v3.exag live and would disagree with the
    // stale mesh for exactly one frame.
    const dsNow = state.datasets[state.active];
    if (dsNow && dsNow.meshExag !== undefined &&
        Math.abs(dsNow.meshExag - state.v3.exag) > 1e-6) {
      buildScene();
    }
    const M = state.mesh;

    // v-fix(seethrough): the base-plane grid floor extends UNDER the green,
    // so it must be painted BEFORE the surface quads. It was previously drawn
    // after them, so its translucent grid lines showed through the green as
    // if the surface were clear glass. (Skirt walls still paint after — they
    // are nearer than the surface rim at normal orbit pitches.)
    const bpts = greenBoundaryPts();
        // v-fix(hole-flat): hole view is a PAINTED TERRAIN map — no extruded
        // green skirt (it became a free-standing corrugated pillar: the corridor
        // base plane sits far below the corridor surface) and no base-plane grid
        // square floating in space under the pillar. Zone colour on the surface
        // is the whole story here.
        if (bpts && state.viewMode !== 'hole') {
          // v1.4.0 (SOLID DRUM): the grid floor painted AFTER the wall —
          // from high cameras its translucent lines + pale disc projected
          // over the near wall and read as a translucent/see-through base
          // (James's screenshot: grid lines visibly ON the drum wall).
          // Order is now: floor FIRST, then wall, then surface — nothing
          // that belongs under the drum can land on top of it.
          drawGridFloor(cam, bpts);
          // v1.4.1: underside underlay paints HERE — before the wall. The
          // undersides belong BEHIND the wall (they're the far side of the
          // terrain); the wall overpaints them except in the sub-pixel AA
          // gaps at the surface↔wall seam, which is exactly where they
          // should show. (Painting them AFTER the wall — the first attempt
          // — put dark triangles ON the wall: the "teeth".)
          paintSurfaceUnderlay(cam);
          // v1.4.0 contact ring: a soft dark ellipse at the base seals the
          // drum-to-ground junction so the model reads as sitting ON the
          // terrain (no floating edge, no light bleed at the base seam).
          drawBaseContactRing(cam, bpts);
          drawSkirt(cam, bpts, true);
        }
    // v-fix(curtain-removed): the v1.0.92 unculled rim curtain was a backstop
    // for the wall-top slit that the v1.0.94 ONE-RING alignment closed for
    // good. Unculled, it drew on BOTH sides — its top ring crested above the
    // stepped surface edge on the FAR side (gray teeth that "render away when
    // I face them"). Removed: the wall pass + one-ring alignment seal the rim
    // without it (verified on real OSM+LiDAR data at multiple angles).

    // v1.4.1 (underside-over-wall): James's 11:57 shot — the surface's own
    // UNDERSIDE painted OVER the solid wall on the falling flank. But a
    // HARD cull leaves black sawtooth slivers where culled quads used to
    // paper the surface↔wall seam (verified in .v141moat). Fix: culled
    // undersides move to an UNDERLAY pass painted right after the wall —
    // they can only ADD coverage in the seam, and the main surface painter
    // overpaints them wherever real surface exists (drum philosophy).
    const n = M.count;
    const sx = new Float32Array(n * 4), sy = new Float32Array(n * 4);
    const dep = new Float32Array(n), order = new Int32Array(n);
    let visible = new Uint8Array(n);
    let nVis = 0;
    const surfCamX = -cam.fwd[0] * cam.dist,
          surfCamY = -cam.fwd[1] * cam.dist;
    state.__underQuads = [];
    const underQuads = state.__underQuads;
    const isUnder = new Uint8Array(n);
    // v1.4.3 (CULL REMOVED — the two-day root cause, proven): at pitch 45
    // the far side of the dome is GEOMETRICALLY a backface (its top normal
    // tilts away from the camera) — ANY backface cull removes the far
    // surface and exposes the dark underlay ("I can still see the other
    // side", both 8x and 15x; harness census: wash 1505–2028 px inside the
    // rim with v1.4.2's true-3D test, same with the horizontal test). The
    // painter's algorithm never had a problem there: far→near ordering
    // paints the near surface over the far surface correctly. The ONLY
    // real defect (v1.4.1, underside painting OVER the wall) is fixed by
    // paint ORDER — underlay runs before the wall — which needs the
    // classification but NOT a cull. So: classify undersides for the
    // underlay pass, draw EVERY quad in the main painter. Nothing can
    // show through: every face paints, ordered far→near.
    for (let q = 0; q < n; q++) {
      const o0 = q * 12;
      const ax = M.pos[o0 + 3] - M.pos[o0],
            ay = M.pos[o0 + 4] - M.pos[o0 + 1],
            az = M.pos[o0 + 5] - M.pos[o0 + 2];
      const bx = M.pos[o0 + 9] - M.pos[o0],
            by = M.pos[o0 + 10] - M.pos[o0 + 1],
            bz = M.pos[o0 + 11] - M.pos[o0 + 2];
      // 3D face normal = a × b (up for top faces by mesh winding)
      const nx = ay * bz - az * by,
            ny = az * bx - ax * bz,
            nz = ax * by - ay * bx;
      const cxq = (M.pos[o0] + M.pos[o0 + 3] + M.pos[o0 + 6] +
                   M.pos[o0 + 9]) / 4;
      const cyq = (M.pos[o0 + 1] + M.pos[o0 + 4] + M.pos[o0 + 7] +
                   M.pos[o0 + 10]) / 4;
      const czq = (M.pos[o0 + 2] + M.pos[o0 + 5] + M.pos[o0 + 8] +
                   M.pos[o0 + 11]) / 4;
      const vx = surfCamX - cxq, vy = surfCamY - cyq,
            vz = -cam.fwd[2] * cam.dist - czq;
      if (nx * vx + ny * vy + nz * vz <= 0) {
        underQuads.push(q);   // back face → also underlay (pre-wall), but
        isUnder[q] = 1;       // still painted in the main pass below.
      }
      let dsum = 0, ok = true;
      for (let c = 0; c < 4; c++) {
        const o = q * 12 + c * 3;
        const p = GreenMapCore.projectPt(cam, M.pos[o], M.pos[o + 1],
          M.pos[o + 2]);
        if (!p) { ok = false; break; }
        sx[q * 4 + c] = p[0]; sy[q * 4 + c] = p[1]; dsum += p[2];
      }
      if (!ok) continue;
      dep[q] = dsum / 4; order[nVis++] = q; visible[q] = 1;
    }
    const vis = Array.prototype.slice.call(order, 0, nVis)
      .sort((a, b) => dep[b] - dep[a]);       // far → near (painter's algo)

    // v-fix(dressing-z): coarse screen-space depth buffer of the NEAREST
    // geometry at each cell, built from the projected quads. Dressing layers
    // (contours, arrows, outline, putt line, labels) are depth-tested against
    // it so elements hidden behind a dip/rim/skirt wall no longer bleed
    // through. v-fix(zjit): per-corner depth interpolation (barycentric), not
    // flat quad-mean depth — the old approximation made border cells flip
    // in/out while rotating (jitter).
    const ZCELL = 3 * dpr;
    const zw = Math.max(1, Math.ceil(canvas.width / ZCELL));
    const zh = Math.max(1, Math.ceil(canvas.height / ZCELL));
    const zbuf = new Float32Array(zw * zh).fill(Infinity);
    const dpx = new Float32Array(n * 4), dpy = new Float32Array(n * 4),
          dpd = new Float32Array(n * 4);
    for (let q = 0; q < n; q++) {
      for (let c = 0; c < 4; c++) {
        const o = q * 12 + c * 3;
        const p = GreenMapCore.projectPt(cam, M.pos[o], M.pos[o + 1],
          M.pos[o + 2]);
        dpx[q * 4 + c] = p ? p[0] : NaN;
        dpy[q * 4 + c] = p ? p[1] : NaN;
        dpd[q * 4 + c] = p ? p[2] : NaN;
      }
    }
    const rasTri = (ax, ay, da, bx, by, db, cx, cy, dc) => {
      if ([ax, ay, da, bx, by, db, cx, cy, dc].some(v => !Number.isFinite(v)))
        return;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / ZCELL));
      const x1 = Math.min(zw - 1, Math.ceil(Math.max(ax, bx, cx) / ZCELL));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / ZCELL));
      const y1 = Math.min(zh - 1, Math.ceil(Math.max(ay, by, cy) / ZCELL));
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-9) return;
      for (let gy = y0; gy <= y1; gy++)
        for (let gx = x0; gx <= x1; gx++) {
          const px = (gx + 0.5) * ZCELL, py = (gy + 0.5) * ZCELL;
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
          const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const d = l1 * da + l2 * db + l3 * dc;
          const zi = gy * zw + gx;
          if (d < zbuf[zi]) zbuf[zi] = d;
        }
    };
    for (let q = 0; q < n; q++) {
      if (isUnder[q]) continue;   // v1.4.1: undersides must NOT own depth —
                                  // the wall paints over them (sawtooth fix)
      const i = q * 4;
      rasTri(dpx[i], dpy[i], dpd[i], dpx[i + 1], dpy[i + 1], dpd[i + 1],
             dpx[i + 2], dpy[i + 2], dpd[i + 2]);
      rasTri(dpx[i], dpy[i], dpd[i], dpx[i + 2], dpy[i + 2], dpd[i + 2],
             dpx[i + 3], dpy[i + 3], dpd[i + 3]);
    }
    // v-fix(skirtz): front-facing skirt walls rasterize into the depth buffer
    // too — dressing behind the near gray base walls must be hidden by them.
    // v-fix(hole-flat): skipped in hole view (no skirt painted there).
    const haveSkirt = bpts && bpts.length > 2 && state.viewMode !== 'hole';
    const skirtCamPos = haveSkirt ? [
      -cam.fwd[0] * cam.dist, -cam.fwd[1] * cam.dist, -cam.fwd[2] * cam.dist
    ] : null;
    if (haveSkirt) {
      // v-fix(wall-profile): depth-prepass walls match drawSkirt exactly —
      // DENSIFIED ring, ring-sampled tops (identical construction).
      const sQuads = GreenMapCore.buildSkirtQuads(
        densifyRing(growPolyLocal(bpts, RING_M), 0.25),
        ([mx, my]) =>
          Number.isFinite(surfZ3(mx, my)) ? surfZ3(mx, my) :
          ((sampleElevRaw(mx, my) - M.zmin) * state.v3.exag || 0), 0);
      let area2 = 0;
      const gPts = densifyRing(growPolyLocal(bpts, RING_M), 0.25);
      for (let i = 0, j = gPts.length - 1; i < gPts.length; j = i++)
        area2 += gPts[j][0] * gPts[i][1] - gPts[i][0] * gPts[j][1];
      const polyCCW = area2 > 0;
      for (const q of sQuads) {
        const ex = q.v[1][0] - q.v[0][0], ey = q.v[1][1] - q.v[0][1];
        const l = Math.hypot(ex, ey) || 1;
        const nx = polyCCW ? ey / l : -ey / l;
        const ny = polyCCW ? -ex / l : ex / l;
        const mx = (q.v[0][0] + q.v[1][0]) / 2,
              my = (q.v[0][1] + q.v[1][1]) / 2;
        if (nx * (skirtCamPos[0] - mx) + ny * (skirtCamPos[1] - my) <= 0)
          continue;                                  // back face — skip
        const sp = q.v.map(v => GreenMapCore.projectPt(
          cam, v[0], v[1], v[2]));
        if (sp.some(p => !p)) continue;
        rasTri(sp[0][0], sp[0][1], sp[0][2],
               sp[1][0], sp[1][1], sp[1][2],
               sp[2][0], sp[2][1], sp[2][2]);
        rasTri(sp[0][0], sp[0][1], sp[0][2],
               sp[2][0], sp[2][1], sp[2][2],
               sp[3][0], sp[3][1], sp[3][2]);
      }
    }
    // Occlusion test: true if geometry-depth sample at/behind the point.
    // v-fix(ztol2): tolerance is 6% of camera distance. The outline/arrow
    // points sit ON the surface, and the depth-buffer raster error near the
    // rim scales with zoom — at 3% a close zoom misclassified on-surface
    // points as hidden (outline vanished when zooming in or rotating).
    // Hidden rim geometry on an exaggerated green is 20-40% farther, so 6%
    // keeps a wide safety margin in both directions.
    const eps = cam.dist * 0.06;
    const isOccluded = (px, py, depth) => {
      const gx = Math.floor(px / ZCELL), gy = Math.floor(py / ZCELL);
      if (gx < 0 || gy < 0 || gx >= zw || gy >= zh) return false;
      const zb = zbuf[gy * zw + gx];
      return Number.isFinite(zb) && depth > zb + eps;
    };

    dressingOcclusion = isOccluded;
    // v1.1.4(hole-silhouette): true when NO geometry was rasterized at this
    // pixel. The occlusion test above passes vacuously there (zbuf Infinity
    // ⇒ "not hidden"), so dressing past the silhouette leaked onto raw
    // background. Hole view has no corridor polygon to gate arrows (green
    // view does), so its arrows gate on this instead.
    dressingOffSurface = (px, py) => {
      const gx = Math.floor(px / ZCELL), gy = Math.floor(py / ZCELL);
      if (gx < 0 || gy < 0 || gx >= zw || gy >= zh) return true;
      return !Number.isFinite(zbuf[gy * zw + gx]);
    };

    for (const q of vis) {
      ctx.beginPath();
      ctx.moveTo(sx[q * 4], sy[q * 4]);
      ctx.lineTo(sx[q * 4 + 1], sy[q * 4 + 1]);
      ctx.lineTo(sx[q * 4 + 2], sy[q * 4 + 2]);
      ctx.lineTo(sx[q * 4 + 3], sy[q * 4 + 3]);
      ctx.closePath();
      // v-fix(precision): smooth shading — linear gradient between opposite
      // corner shades (from averaged vertex normals + AO) when they differ
      // enough to matter; flat mean-colour otherwise (cheap + seam-free).
      let fill = null;
      let strokeCol = null;   // v1.4.4: per-quad seam-cover colour
      const midCol = `rgb(${M.col[q * 3] | 0},${M.col[q * 3 + 1] | 0},${M.col[q * 3 + 2] | 0})`;
      if (state.layer === 'arrows') {
        fill = 'rgb(24,32,27)';   // near-background green-black
      // v1.4.5 (BAKE, don't sample per frame): v1.4.4 sampled the photo at
      // 4 corners + centre PER QUAD PER FRAME during rotation — ~36k
      // getImageData calls + gradient allocations per orbit frame = the
      // lag. The photo does NOT change when the camera rotates: bake the
      // per-quad photo colours ONCE into qUV (quad-centre RGB) and use the
      // EXISTING per-corner vertex colours (M.vcol) for the gradient. Zero
      // per-frame photo work; rotation renders at painter speed again.
      } else if (state.viewMode === 'hole' && state.active === 'hole' &&
                 M.gridRef && M.qPhoto) {
        const pq = M.qPhoto[q];
        if (pq) fill = pq;
      }
      if (!fill && M.vcol) {
        const c0 = q * 12, c2 = q * 12 + 6;
        const dr = Math.abs(M.vcol[c2] - M.vcol[c0]);
        const dg = Math.abs(M.vcol[c2 + 1] - M.vcol[c0 + 1]);
        const db = Math.abs(M.vcol[c2 + 2] - M.vcol[c0 + 2]);
        if (Math.max(dr, dg, db) > 5) {
          const grad = ctx.createLinearGradient(
            sx[q * 4], sy[q * 4], sx[q * 4 + 2], sy[q * 4 + 2]);
          grad.addColorStop(0, `rgb(${M.vcol[c0] | 0},${M.vcol[c0 + 1] | 0},${M.vcol[c0 + 2] | 0})`);
          grad.addColorStop(1, `rgb(${M.vcol[c2] | 0},${M.vcol[c2 + 1] | 0},${M.vcol[c2 + 2] | 0})`);
          fill = grad;
        }
      }
      ctx.fillStyle = fill || midCol;
      ctx.strokeStyle = strokeCol || fill || midCol;   // seam cover
      // v-fix(seam-cover): at grazing angles (steep 8×-exaggerated cliffs
      // seen edge-on) consecutive quad rows leave hairline AA seams that a
      // 1-device-px stroke can't cover — background sliced through as
      // horizontal slits. Same-colour stroke at ~0.6 CSS px seals them with
      // no visible thickening.
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.6);
      ctx.fill(); ctx.stroke();
    }
    void visible;

    // v1.4.1: the grid floor ALSO draws after the surface here (its lines
    // crossing the base plane behind the drum are wanted), but it must
    // never paint OVER the drum — clip it to outside the projected base
    // ring by simply drawing it BEFORE was not enough for the far side:
    // the far floor lines that project OVER the near wall come from the
    // same drawGridFloor call, so gate: skip when the old order bug
    // re-manifests. Actually the v1.4.0 reorder handles it; this second
    // call is REMOVED (it was re-painting lines over the near wall).

    // v-fix(quad-clip): the screen-space ERASE pass is REMOVED. The surface
    // geometry is now polygon-clipped at build time (clipQuadToPoly), so no
    // overhang ever exists to erase: no near-plane fold cases, no bitten
    // green, no fringe from mask/erase ring mismatch. The silhouette is the
    // polygon — wall top, lip and surface edge all sample surfZ3 on the same
    // grown ring.

    // 18Birdies dressing: contour iso-lines on the surface…
    // v1.4.1: contours clipped to the GREEN polygon — on steep falling
    // flanks they projected BELOW the rim onto the wall/background as
    // floating dark dashes (the "teeth" misdiagnosed twice).
    if (state.polyLocal && state.polyLocal.length > 2) {
      const contourRing = growPolyLocal(state.polyLocal, -0.05);
      drawContours3D(cam, contourRing);
    } else {
      drawContours3D(cam, null);
    }
    // v1.4.1: the second drawGridFloor call HERE (after the surface) was
    // re-painting translucent floor lines OVER the near wall — the actual
    // "translucent base" mechanism. It now draws once, BEFORE the wall.

    // Hole view: tee marker only. The white green-zone outline was removed
    // (v1.0.87) — it was buggy at the rim and the mesh rim now follows the
    // true polygon edge precisely, so the outline added nothing.
    if (state.active === 'hole' && state.datasets.hole &&
        !state.datasets.hole.failed && state.datasets.hole.zoneMask) {
      // Tee marker: blue flag where a tee position is known.
            // v-fix(tee-occ): depth-tested like all dressing — the pole used to be
            // drawn unconditionally, floating in mid-air when the tee sat behind a
            // hill. The flagpole is 3 m tall: test at ~1 m height on the pole.
            if (state.teeLL) {
              const dsH = state.datasets.hole;
              const mLat = 110540;
              const mLng = 111320 * Math.cos(dsH.centerLL[1] * Math.PI / 180);
              const tmx = (state.teeLL.lng - dsH.centerLL[0]) * mLng;
              const tmy = (state.teeLL.lat - dsH.centerLL[1]) * mLat;
              const base = GreenMapCore.projectPt(cam, tmx, tmy, surfZ3(tmx, tmy));
              const top = GreenMapCore.projectPt(cam, tmx, tmy, surfZ3(tmx, tmy) + 3);
              const pole = GreenMapCore.projectPt(cam, tmx, tmy,
                surfZ3(tmx, tmy) + 1);
              const occluded = pole && dressingOcclusion &&
                dressingOcclusion(pole[0], pole[1], pole[2]);
              if (base && top && !occluded) {
                ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1.5, dpr * 1.0);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]);
          ctx.lineTo(top[0], top[1]); ctx.stroke();
          const fs = Math.max(4, cam.f / top[2] * 0.09);
          ctx.fillStyle = '#4488e0';
          ctx.beginPath();
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(top[0] + fs, top[1] + fs * 0.28);
          ctx.lineTo(top[0], top[1] + fs * 0.56);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    // White green outline removed entirely (v1.0.87) — persistently buggy at
    // the rim, and the mesh rim now follows the true polygon edge precisely.
    // v-fix(rim-lip): the silhouette's last row of sub-quads ends in a fine
    // polygon-clipped serration (dark background pokes between teeth). Draw
    // the skirt wall TOP edge as a thin grey line along the boundary.
    // v-fix(lip-per-seg): stroke PER SEGMENT, each depth-tested — the old
    // all-or-nothing version refused to draw whenever ANY point was hidden,
    // leaving whole rim stretches (e.g. the Back at low angles) naked with
    // sub-cell jaggies showing ("a couple pixels hanging off the edge").
    if (bpts && state.viewMode !== 'hole' && state.polyLocal &&
        state.polyLocal.length > 2 && state.active === 'green') {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // v-fix(lip-seal): the lip is the green's coping — it must ALSO be the
      // seal for sub-pixel junction seams. Two strokes: a slightly wider
      // base pass (covers the wall/surface profile mismatch's last pixels),
      // then the crisp line on top. Both at the SAME DENSIFIED ring and the
      // same surfZ3 heights the wall top uses — one profile everywhere.
      const lipPts = densifyRing(growPolyLocal(state.polyLocal, RING_M), 0.25);
      const lipStroke = (widthPx, style) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = widthPx;
        let prev = null;
        let firstVis = null;
        for (const [mx, my] of lipPts) {
          const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my) + 0.05);
          // v-fix(lip-occ-cell): a point is hidden only when occluded at
          // ring height AND at +0.5 m. The coarse depth cells (9 px) at a
          // rim-tab boundary hold the ADJACENT tab's nearer depth, so the
          // old single-height test classified visible far-lip segments as
          // hidden and skipped them — leaving a 3 px wedge of background
          // between the tab edge and the ribbon (last 15x triangle,
          // .fringecrop.png). The second sample clears the contamination;
          // genuinely buried segments still fail BOTH tests.
          const pHi = GreenMapCore.projectPt(cam, mx, my,
            surfZ3(mx, my) + 0.5);
          const hidden = !p || (dressingOcclusion &&
            dressingOcclusion(p[0], p[1], p[2]) &&
            (!pHi || dressingOcclusion(pHi[0], pHi[1], pHi[2])));
          if (!hidden && !firstVis) firstVis = { p, hidden };
          if (!hidden && prev && !prev.hidden) {
            ctx.beginPath();
            ctx.moveTo(prev.p[0], prev.p[1]);
            ctx.lineTo(p[0], p[1]);
            ctx.stroke();
          }
          prev = { p, hidden };
        }
        // close the ring (last → first)
        if (prev && !prev.hidden && firstVis && !firstVis.hidden) {
          ctx.beginPath();
          ctx.moveTo(prev.p[0], prev.p[1]);
          ctx.lineTo(firstVis.p[0], firstVis.p[1]);
          ctx.stroke();
        }
      };
      // v1.1.3 prettify: warmer sage-grey lip so the band blends with the
      // green instead of fighting it (was cool blue-grey).
      lipStroke(Math.max(2.2, 0.75 * (window.devicePixelRatio || 1)),
        'rgba(156,166,155,0.95)');
      lipStroke(1.1 * (window.devicePixelRatio || 1),
        'rgba(184,192,182,0.95)');
    }

    // Surface break arrows (downhill), drawn on top of the mesh.
    // v2 fix: arrows show in 'both' and 'arrows' modes; 'shading' hides them.
    // v1.3.1 (float-then-snap): the FIRST render after the corridor lands
    // drew arrows for the PREVIOUS dataset (or none) — state.meshArrows was
    // rebuilt only in buildHoleScene; the mesh was rebuilt by the exag
    // handler with fresh arrows, so the first frame floated and the slider
    // "snapped" them. Rebuild arrows right here when the mesh was rebuilt
    // after them (cheap: ~90 arrows), or draw nothing — never stale floats.
    if (state.layer !== 'shading') {
      if (state.__arrowsStale) {
        state.__arrowsStale = false;
        rebuildMeshArrows();
      }
      const dpr = window.devicePixelRatio || 1;
    ctx.lineCap = 'round';
    for (const a of state.meshArrows) {
      // v1.1.3 (18Birdies look): arrows are UNIFORM screen-space dashes.
      // The old full-segment projection let a 1.6 m surface arrow plunge
      // seven screen metres down an exaggerated cliff face — long poles on
      // every steep stretch. Now: centre projected at surface height,
      // direction taken from the HORIZONTAL downhill bearing (what you see
      // looking down at the green), fixed pixel length. Direction honest,
      // length calm. Edge/occlusion gates still test the TRUE segment so a
      // dash can never hang past the silhouette.
      const zC = surfZ3(a.mx, a.my);
      const pC = GreenMapCore.projectPt(cam, a.mx, a.my, zC);
      const xHm = a.mx + a.dxm * 1.0, yHm = a.my + a.dym * 1.0;
      const pH = GreenMapCore.projectPt(cam, xHm, yHm, zC);
      if (!pC || !pH) continue;
      const x1m = a.mx - a.dxm * a.lenM / 2, y1m = a.my - a.dym * a.lenM / 2;
      const x2m = a.mx + a.dxm * a.lenM / 2, y2m = a.my + a.dym * a.lenM / 2;
      // v-fix(arrow-silhouette): arrows are occlusion-tested but nothing
      // stops a rim arrow from projecting past the SURFACE EDGE into the
      // background — nothing is rasterized there, so the depth test always
      // passes and the arrow tip/tail drew as pale specks hanging off the
      // silhouette (honest glancing-angle harness, .rimreal8, Front-left
      // rim). Gate every arrow sample (mid + both ends) inside the boundary
      // ring INSET 0.15 m so tips land on real drawn surface, never the
      // trimmed margin.
      if (state.active === 'green' &&
          state.polyLocal && state.polyLocal.length > 2) {
        if (arrowRingSrc !== state.polyLocal) {
          arrowRingSrc = state.polyLocal;
          arrowRing = growPolyLocal(state.polyLocal, -0.15);
        }
        // v-fix(arrow-chord): 3-point tests (mid + ends) fail on CONCAVE
        // ring sections — a chord between two inside points exits the
        // polygon (James 22:06 15x: arrows crossing the silhouette exactly
        // at the concave stretch). Sample the WHOLE segment; every point
        // must be inside.
        let inside = true;
        for (let s = 0; s <= 6 && inside; s++) {
          const t = s / 6;
          const px2 = x1m + (x2m - x1m) * t, py2 = y1m + (y2m - y1m) * t;
          if (!GreenMapCore.pointInPoly(px2, py2, arrowRing)) inside = false;
        }
        if (!inside) continue;
      }
      // v-fix(dressing-z): drop arrows hidden behind the surface — test the
      // midpoint AND both endpoints so a partially-hidden arrow (tail behind
      // a rim, tip in front) can't streak across the near face.
      const pMid = pC;
      const p1 = GreenMapCore.projectPt(cam, x1m, y1m, surfZ3(x1m, y1m));
      const p2 = GreenMapCore.projectPt(cam, x2m, y2m, surfZ3(x2m, y2m));
      const occ = (p) => dressingOcclusion && dressingOcclusion(p[0], p[1], p[2]);
      if ((pMid && occ(pMid)) || (p1 && occ(p1)) || (p2 && occ(p2))) continue;
      // Uniform screen-space arrow along the horizontal downhill direction.
      const ang = Math.atan2(pH[1] - pC[1], pH[0] - pC[0]);
      const len = 9 * dpr;
      const ax = pC[0], ay = pC[1];
      const bx = ax + Math.cos(ang) * len, by = ay + Math.sin(ang) * len;
      const cx0 = ax - Math.cos(ang) * len, cy0 = ay - Math.sin(ang) * len;
      // v1.1.4(hole-silhouette): hole view has no boundary polygon to gate
      // with — arrows past the terrain silhouette passed occlusion vacuously
      // (zbuf Infinity there ⇒ "not hidden") and drew over raw background.
      // Gate: tail, centre and head must all sit on rasterized surface.
      if (state.viewMode === 'hole' && dressingOffSurface) {
        if (dressingOffSurface(cx0, cy0) ||
            dressingOffSurface(ax, ay) ||
            dressingOffSurface(bx, by)) continue;
      }
      const hs = len * 0.42;
      ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(bx, by);
      // v3-visual: bolder uniform black arrow with a stronger white halo.
      ctx.strokeStyle = 'rgba(12,18,15,0.9)';
      ctx.lineWidth = Math.max(3.8, dpr * 2.2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.98)';
      ctx.lineWidth = Math.max(1.8, dpr * 1.05);
      ctx.stroke();
      const head = (size, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - size * Math.cos(ang - 0.42),
                   by - size * Math.sin(ang - 0.42));
        ctx.lineTo(bx - size * Math.cos(ang + 0.42),
                   by - size * Math.sin(ang + 0.42));
        ctx.closePath(); ctx.fill();
      };
      head(hs * 1.55, 'rgba(12,18,15,0.9)');
      head(hs * 1.02, 'rgba(255,255,255,0.98)');
    }
    }

    // Putt line projected onto the surface (green view only).
    // v1.1.3: the MAKEABLE line from solvePutt (same as 2D) — one model,
    // one readout, both views.
    if (state.active === 'green' &&
        state.showPutt && state.ball && state.pin && state.field) {
      const g = state.grid;
      const r = GreenMapCore.solvePutt(
        state.ball, state.pin, state.field, g.W, g.H, g.cellSizeM,
        state.mask, { stimp: state.stimp });
      state.puttResult = r;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      let started = false;
      r.pts.forEach(([mx, my]) => {
        const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my));
        if (!p) { started = false; return; }
        // v-fix(dressing-z): putt path dips behind the surface when hidden;
        // v-fix(chord): breaks instead of bridging across the hidden span.
        if (dressingOcclusion && dressingOcclusion(p[0], p[1], p[2])) {
          started = false; return;
        }
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1.5, dpr * 1.1);
      ctx.stroke();
      ctx.setLineDash([]);
      // v1.2.5 prettify: the BALL as a proper golf ball — white sphere with
      // a dark contact shadow + dimple hint, sized by depth, occluded like
      // all dressing (was: flat white dot).
      const bp = GreenMapCore.projectPt(cam, state.ball[0], state.ball[1],
        surfZ3(state.ball[0], state.ball[1]));
      if (bp && !(dressingOcclusion &&
          dressingOcclusion(bp[0], bp[1], bp[2] + 0.15))) {
        // v1.3.2 (READABLE ball): the depth-proportional size was 3-4 px on
        // a phone — the "prettified" ball was indistinguishable from the
        // old dot (James: "flag and ball still look the same"). Fixed
        // floor of 7 CSS px + white outline so it pops on any surface.
        const br = Math.max(7 * (window.devicePixelRatio || 1),
          cam.f / bp[2] * 0.014);
        // contact shadow
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.ellipse(bp[0], bp[1] + br * 0.75, br * 1.05, br * 0.42,
          0, 0, 7);
        ctx.fill();
        // sphere: radial gradient white → grey
        const bg = ctx.createRadialGradient(
          bp[0] - br * 0.35, bp[1] - br * 0.4, br * 0.15,
          bp[0], bp[1], br);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(0.65, '#eef2ef');
        bg.addColorStop(1, '#b9c2bc');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(bp[0], bp[1], br, 0, 7);
        ctx.fill();
        // crisp outline so the sphere reads against green/red
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = Math.max(1, br * 0.14);
        ctx.stroke();
        // dimple hint: three faint dots
        ctx.fillStyle = 'rgba(120,130,124,0.35)';
        for (const [dx, dy] of [[-0.3, -0.1], [0.15, 0.2], [0.3, -0.25]]) {
          ctx.beginPath();
          ctx.arc(bp[0] + br * dx, bp[1] + br * dy, br * 0.13, 0, 7);
          ctx.fill();
        }
      }
      setStatus(puttStatusText(r));
    }

    // Pin: small flag standing upright at its grid position (green view only;
    // the corridor frame uses a tee marker instead).
    if (state.active === 'green' && state.pin) {
      const [pmx, pmy] = state.pin;
      const base = GreenMapCore.projectPt(cam, pmx, pmy, surfZ3(pmx, pmy));
      const top = GreenMapCore.projectPt(cam, pmx, pmy,
        surfZ3(pmx, pmy) + 2.2);            // ~2.2 m flagpole (un-exaggerated feel)
      // v-fix(pin-occ): depth-test the pole like every other dressing
      // element — behind a rise, the flag must not float in mid-air.
      const mid = GreenMapCore.projectPt(cam, pmx, pmy,
        surfZ3(pmx, pmy) + 0.8);
      const pinHidden = mid && dressingOcclusion &&
        dressingOcclusion(mid[0], mid[1], mid[2]);
      if (base && top && !pinHidden) {
        // v1.2.5 prettify: flag reads as a real pin — shaded pole with knob,
        // red-white pennant, cup ring at the base (was: white stick + flat
        // red triangle).
        const ps = Math.max(2.2 * (window.devicePixelRatio || 1),
          cam.f / top[2] * 0.004);  // pole width — visible floor (v1.3.2)
        // cup ring at the base
        const cs2 = Math.max(3, cam.f / base[2] * 0.012);
        ctx.strokeStyle = 'rgba(8,12,10,0.55)';
        ctx.lineWidth = Math.max(1.2, dpr * 0.9);
        ctx.beginPath();
        ctx.ellipse(base[0], base[1], cs2, cs2 * 0.42, 0, 0, 7);
        ctx.stroke();
        // pole: two-tone (light face + dark edge) for a cylindrical read
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(235,240,236,0.98)';
        ctx.lineWidth = ps * 1.6;
        ctx.beginPath(); ctx.moveTo(base[0], base[1]);
        ctx.lineTo(top[0], top[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(150,158,152,0.9)';
        ctx.lineWidth = ps * 0.7;
        ctx.beginPath(); ctx.moveTo(base[0], base[1]);
        ctx.lineTo(top[0], top[1]); ctx.stroke();
        // knob
        ctx.fillStyle = '#f4f7f4';
        ctx.beginPath();
        ctx.arc(top[0], top[1], ps * 1.5, 0, 7);
        ctx.fill();
        // pennant: red gradient with a subtle wave (two-segment trailing
        // edge), attached at the pole top
        // v1.3.2 (READABLE flag): same story — fs floored at 4 device px
        // read as the old triangle. Floor 13 CSS px (a pennant you can
        // actually see at arm's length) + white pole bold enough to read.
        const fs = Math.max(13 * (window.devicePixelRatio || 1),
          cam.f / top[2] * 0.09);
        const fw = fs * 1.45, fh = fs * 0.66;
        const wag = Math.sin(performance.now() / 900) * fs * 0.06;
        const fg = ctx.createLinearGradient(top[0], top[1],
          top[0] + fw, top[1] + fh);
        fg.addColorStop(0, '#e8564f');
        fg.addColorStop(1, '#c33a34');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        ctx.quadraticCurveTo(top[0] + fw * 0.55, top[1] + fh * 0.18 + wag,
          top[0] + fw, top[1] + fh * 0.52);
        ctx.quadraticCurveTo(top[0] + fw * 0.55, top[1] + fh * 0.62 + wag,
          top[0], top[1] + fh);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Front/Back (or Tee/Green) labels — drawn last, above everything.
    if (bpts) drawEdgeLabels(cam, bpts);
  }

  // Nearest in-mask cell to a screen point in 3D (for tap/long-press/hover).
  function pickCell3D(px, py) {
    const g = state.grid;
    if (!g || !state.mesh) return null;
    const cam = currentCam();
    const dpr = window.devicePixelRatio || 1;
    const r2max = (26 * dpr) * (26 * dpr);
    let best = null, bd = r2max;
    for (let y = 1; y < g.H - 1; y++)
      for (let x = 1; x < g.W - 1; x++) {
        const i = y * g.W + x;
        if (!state.mask[i] || !state.field.valid[i]) continue;
        const mx = (x + 0.5 - g.W / 2) * g.cellSizeM;
        const my = (g.H / 2 - y - 0.5) * g.cellSizeM;
        const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my));
        if (!p) continue;
        const d2 = (p[0] - px) * (p[0] - px) + (p[1] - py) * (p[1] - py);
        if (d2 < bd) { bd = d2; best = { i, mx, my }; }
      }
    return best;
  }

  /* ======================================================================
     4. INTERACTION
     ====================================================================== */
  let dragging = false, lastPt = null, pinchDist = 0;
  let activePtrs = 0;   // v-fix: suppress pan-anchor updates during pinch setup
  const tip = document.getElementById('gm-tip');

  function eventPos(ev) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr];
  }

  canvas.addEventListener('pointerdown', (ev) => {
    activePtrs++;
    // A second finger landing means a pinch is starting — drop the pan
    // anchor NOW so finger 2's pointermove can't teleport the view.
    if (activePtrs > 1) { dragging = false; lastPt = null; cancelLongPress(); return; }
    dragging = true; lastPt = eventPos(ev);
    canvas.setPointerCapture(ev.pointerId);
    // Long-press (500ms, no drag) moves the pin to the pressed spot.
    const [px0, py0] = lastPt;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!dragging || Math.hypot(lastPt[0] - px0, lastPt[1] - py0) > 8) return;
      const s = (state.viewMode === '3d' || state.viewMode === 'hole')
        ? pickCell3D(px0, py0)
        : sampleAtScreen(px0, py0);
      // In hole view the pin may only move within the highlighted green zone.
      const zoneOK = state.viewMode !== 'hole' ||
        (state.datasets.hole && state.datasets.hole.zoneMask &&
         (() => {
           const dsH = state.datasets.hole;
           if (!dsH || !dsH.grid) return false;
           const [gox, goy] = dsH.gOff;
           void gox; void goy;
           // s.mx/s.my are corridor-local already (pin storage below does
           // s.mx - gox to convert to green-local) — do NOT re-add gOff here.
           const ix = Math.round(s.mx / dsH.eg.cellSizeM + dsH.eg.W / 2);
           const iy = Math.round(dsH.eg.H / 2 -
             s.my / dsH.eg.cellSizeM);
           return ix >= 0 && iy >= 0 && ix < dsH.eg.W && iy < dsH.eg.H &&
             dsH.zoneMask[iy * dsH.eg.W + ix] === 1;
         })());
      if (s && zoneOK && state.mask && state.mask[s.i] &&
          state.field && state.field.valid[s.i]) {
        if (state.viewMode === 'hole') {
          // Convert corridor-local metres back to green-local for storage.
          const [gox, goy] = state.datasets.hole.gOff;
          state.pin = [s.mx - gox, s.my - goy];
        } else {
          state.pin = [s.mx, s.my];
        }
        dragging = false; lastPt = null;
        setStatus('Pin moved — long-press again anywhere inside the green');
        render();
      } else if (s && !zoneOK) {
        setStatus('Pin stays inside the highlighted green zone');
      }
    }, 500);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [px, py] = eventPos(ev);
    // v-fix: never feed the pan path while a two-finger pinch is live.
    if (dragging && lastPt && ptrs.size < 2) {
      cancelLongPress();
      const dx = px - lastPt[0], dy = py - lastPt[1];
      if (state.viewMode === '3d' || state.viewMode === 'hole') {
        // orbit: yaw free, pitch clamped 22..70° (v-fix: min raised from 10 —
        // below ~20° the camera looks edge-on through the bowl and the far
        // skirt interior shows through as a hollow shell).
        // Drag DOWN tilts camera DOWN; drag RIGHT rotates view naturally.
        state.v3.yaw = (state.v3.yaw + dx * 0.35) % 360;
        state.v3.pitch = Math.max(22, Math.min(70, state.v3.pitch + dy * 0.25));
      } else {
        state.view.ox += dx;
        state.view.oy += dy;
      }
      lastPt = [px, py];
      render();
      tip.style.display = 'none';
      return;
    }
    if (state.viewMode === '3d' || state.viewMode === 'hole') {
      tip.style.display = 'none'; return;
    }
    updateTooltip(px, py, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerup', (ev) => {
    activePtrs = Math.max(0, activePtrs - 1);
    const wasDrag = dragging && lastPt &&
      (Math.abs(eventPos(ev)[0] - lastPt[0]) > 4 ||
       Math.abs(eventPos(ev)[1] - lastPt[1]) > 4);
    dragging = false; lastPt = null;
    cancelLongPress();
    if (!wasDrag && activePtrs === 0) handleTap(eventPos(ev), ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointercancel', (ev) => {
    activePtrs = Math.max(0, activePtrs - 1);
    dragging = false; lastPt = null;
    cancelLongPress();
  });

  /* v3 UNIFIED PINCH — pointer-events only (touch events were unreliable on
     iOS Safari: setPointerCapture routes moves away from touch handlers).
     Tracks both active pointers by id; zoom = ratio against gesture start. */
  const ptrs = new Map();          // pointerId -> [x, y]
  let pinchStartDist = 0;
  let pinchStartDist3D = 0;
  let pinchStartScale2D = 0;       // v-fix: 2D anchor — no compounding

  canvas.addEventListener('pointerdown', (ev) => {
    ptrs.set(ev.pointerId, eventPos(ev));
    if (ptrs.size === 2) {
      // pinch begins: cancel pan/long-press, capture references
      dragging = false; lastPt = null; clearTimeout(longPressTimer);
      const pts = [...ptrs.values()];
      pinchStartDist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      pinchStartDist3D =
        (state.viewMode === '3d' || state.viewMode === 'hole')
          ? state.v3.dist : 0;
      pinchStartScale2D = state.viewMode === '2d' ? state.view.scale : 0;
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.set(ev.pointerId, eventPos(ev));
    if (ptrs.size === 2 && pinchStartDist > 0) {
      ev.preventDefault();
      const pts = [...ptrs.values()];
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const k = d / pinchStartDist;
      if (state.viewMode === '3d' || state.viewMode === 'hole') {
        state.v3.dist = Math.max(25,
          Math.min(state.viewMode === 'hole' ? 600 : 180,
            pinchStartDist3D / k));
        render();   // v2-fix: paint NOW — the rAF scheduler was dropping this
      } else {
        // 2D: absolute zoom from gesture start about the midpoint
        // (v-fix: was compounding k against current scale each event)
        const cx = (pts[0][0] + pts[1][0]) / 2, cy = (pts[0][1] + pts[1][1]) / 2;
        const base = state.baseScale || (state.baseScale = state.view.scale);
        const ns = Math.max(base * 0.3, Math.min(base * 8,
                       pinchStartScale2D * k));
        const applied = ns / state.view.scale;
        state.view.ox = cx + (state.view.ox - cx) * applied;
        state.view.oy = cy + (state.view.oy - cy) * applied;
        state.view.scale = ns;
        render();
      }
    }
  });
  const ptrEnd = (ev) => {
    ptrs.delete(ev.pointerId);
    if (ptrs.size < 2) { pinchStartDist = 0; pinchStartDist3D = 0; }
    // Pinch ended with one finger still DOWN: re-seed the pan/orbit anchor
    // to that finger's current position so the continuing drag starts from
    // where the finger is — no jump (same class of bug as the first-pinch
    // teleport). Only on a clean lift, not pointercancel.
    if (!ev.cancelled && ptrs.size === 1 && ev.type === 'pointerup') {
      const [x, y] = [...ptrs.values()][0];
      lastPt = [x, y];
      dragging = true;
      clearTimeout(longPressTimer);
    }
  };
  canvas.addEventListener('pointerup', ptrEnd);
  canvas.addEventListener('pointercancel', ptrEnd);

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (state.viewMode === '3d' || state.viewMode === 'hole') {
      state.v3.dist = Math.max(25,
        Math.min(state.viewMode === 'hole' ? 600 : 180,
          state.v3.dist * (ev.deltaY < 0 ? 0.9 : 1 / 0.9)));
      render();
      return;
    }
    const [px, py] = eventPos(ev);
    const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(px, py, k);
  }, { passive: false });

  function zoomAt(px, py, k) {
    const base = state.baseScale || (state.baseScale = state.view.scale);
    const ns = Math.max(base * 0.3, Math.min(base * 8,
                   state.view.scale * k));
    const applied = ns / state.view.scale;
    state.view.ox = px + (state.view.ox - px) * applied;
    state.view.oy = py + (state.view.oy - py) * applied;
    state.view.scale = ns;
    render();
  }

  function sampleAtScreen(px, py) {
    const [mx, my] = fromScreen(px, py);
    const g = state.grid;
    if (!g) return null;
    const ix = Math.round(mx / g.cellSizeM + g.W / 2);
    const iy = Math.round(g.H / 2 - my / g.cellSizeM);
    if (ix < 0 || iy < 0 || ix >= g.W || iy >= g.H) return null;
    return { ix, iy, i: iy * g.W + ix, mx, my };
  }

  // Shared tooltip content: slope/fall + precise bilinear elevation in ft
  // relative to the green centre. v1.1.3 prettify: two-line hierarchy —
  // big slope number + fall direction, elevation as a dim sub-line (the
  // raw bearing degrees were golfer-noise; the compass label carries it).
  function tipReadout(s) {
    const pct = GreenMapCore.slopePctAt(state.field, s.i);
    const brg = GreenMapCore.fallBearingDeg(state.field.gx[s.i],
      state.field.gy[s.i]);
    let elevTxt = '';
    const egLike = state.active === 'hole'
      ? (state.datasets.hole && state.datasets.hole.eg) : state.grid;
    const z = egLike ? GreenMapCore.sampleElevLocalM(egLike, s.mx, s.my) : null;
    if (z != null && state.greenZ != null) {
      const ft = (z - state.greenZ) * 3.28084;
      elevTxt = `<div class="tip-sub">${ft >= 0 ? '+' : '−'}${Math.abs(ft).toFixed(1)} ft vs green centre</div>`;
    }
    return `<div class="tip-big">Slope ${pct.toFixed(1)}%` +
      `<span> · falls ${GreenMapCore.bearingLabel(brg)}</span></div>${elevTxt}`;
  }

  function updateTooltip(px, py, clientX, clientY) {
    if (!state.field) return;
    const s = sampleAtScreen(px, py);
    if (!s || !state.mask[s.i] || !state.field.valid[s.i]) {
      tip.style.display = 'none'; return;
    }
    tip.innerHTML = tipReadout(s);
    tip.style.display = 'block';
    tip.style.left = (clientX + 14) + 'px';
    tip.style.top = (clientY + 14) + 'px';
  }

  // Tap: 1st tap sets ball (if putt mode armed), else shows tooltip anchor.
  // In 3D, a tap always shows the slope/fall tooltip at the picked quad.
  function handleTap([px, py], clientX = null, clientY = null) {
    const s = (state.viewMode === '3d' || state.viewMode === 'hole')
      ? pickCell3D(px, py)
      : sampleAtScreen(px, py);
    if (!s || !state.mask[s.i] || !state.field.valid[s.i]) return;
    if (state.viewMode === '3d' || state.viewMode === 'hole') {
      tip.innerHTML = tipReadout(s);
      tip.style.display = 'block';
      tip.style.left = ((clientX ?? px) + 14) + 'px';
      tip.style.top = ((clientY ?? py) + 14) + 'px';
      setTimeout(() => { tip.style.display = 'none'; }, 2600);
    }
    const [mx, my] = state.viewMode === '3d'
      ? [s.mx, s.my]
      : fromScreen(px, py);
    if (armBallNext && state.active === 'green') {
      state.ball = [mx, my];
      state.showPutt = true;
      armBallNext = false;
      setStatus('Putt preview ON — the ball button now removes it');
      if (window.__syncBallBtn) window.__syncBallBtn();   // v1.4.0
    }
    render();
  }
  let armBallNext = false;
  let longPressTimer = null;

  function cancelLongPress() { clearTimeout(longPressTimer); }

  function setStatus(msg) { document.getElementById('gm-status').textContent = msg; }

  /* ======================================================================
     5. CHROME WIRING
     ====================================================================== */
  const LEGEND_TEXT = {
    slope: { title: 'Slope %', labels: ['0%', '5%', '10%+'] },
    elev:  { title: 'Elevation', labels: ['low', '', 'high'] }
  };
  function updateLegend() {
    // v1.4.0: title also reflects 2D vs 3D ramp ("3D" uses the rainbow).
    const cfg = LEGEND_TEXT[state.mode] || LEGEND_TEXT.slope;
    const title = state.viewMode !== '2d'
      ? cfg.title + ' · 3D' : cfg.title;
    document.getElementById('gm-legend-title').textContent = title;
    const spans = document.querySelectorAll('#gm-ramplabels span');
    spans.forEach((el, k) => { el.textContent = cfg.labels[k] || ''; });
    // Paint the ramp bar from the active color function so it never drifts.
    // 3D/hole views use the classic topo rainbow; 2D keeps the legacy ramp.
    const el = document.getElementById('gm-rampbar');
    if (!el || !window.GreenMapCore) return;
    const elevFn = state.viewMode === '2d'
      ? GreenMapCore.elevationColor : GreenMapCore.elevationColorRainbow;
    const stops = [];
    for (let p = 0; p <= 1.0001; p += 0.04)
      stops.push(`rgb(${elevFn(p).join(',')}) ${(p * 100).toFixed(0)}%`);
    for (let p = 0; p <= 13; p += 0.25)
      stops.push(`rgb(${GreenMapCore.slopeColor(p).join(',')}) ${((p / 13) * 100).toFixed(1)}%`);
    el.style.background = state.mode === 'elev'
      ? `linear-gradient(to right, ${stops.slice(0, 26).join(',')})`
      : `linear-gradient(to right, ${stops.slice(26).join(',')})`;
  }

  function wireChrome() {
    // v1.1.7: preset dropdown REMOVED — the tool is app-integrated and loads
    // the green passed by the Play tab (or the app's own saved default).
    // Test presets deleted with it (James: no prototype chrome).

    document.querySelectorAll('.gm-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gm-layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.layer = btn.dataset.layer;
        render();
      });
    });
    document.querySelector(`.gm-layer-btn[data-layer="both"]`).classList.add('active');

    // 2D | 3D | Hole view toggle — keeps pin/ball/mode state; just re-renders.
    function frameCameraForView(v) {
      if (v === 'hole' && state.datasets.hole && !state.datasets.hole.failed) {
        fitHoleView();
      } else if (v === '3d') {
        state.v3.yaw = 0; state.v3.pitch = 35; state.v3.dist = 62;
      }
    }
    function setViewModeInternal(v) {
      state.viewMode = v === 'hole' ? 'hole' : (v === '3d' ? '3d' : '2d');
      document.querySelectorAll('.gm-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === state.viewMode));
      document.getElementById('gm-exag-wrap').style.display =
        state.viewMode === '2d' ? 'none' : 'inline-flex';
      // v1.4.3 (controls stay visible — James's rule): the layer group is
      // wanted in EVERY view; v1.4.0 hid it in 3D/Hole and he read that
      // as "no buttons for shading or arrows". Always shown.
      const lg = document.getElementById('gm-layer-group');
      if (lg) lg.style.display = '';
      if (state.viewMode === 'hole') {
        const h = state.datasets.hole;
        if (h && !h.failed && h.mesh) {
          activateDataset('hole');
          frameCameraForView('hole');
          setStatus('Whole-hole 3D — drag = orbit · pinch/scroll = zoom · ' +
            'green highlighted, blue flag = tee');
        } else if (h && h.failed) {
          // Graceful fallback: green-only 3D with an inline explanation.
          state.viewMode = '3d';
          document.querySelectorAll('.gm-view-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.view === '3d'));
          setStatus(h.msg);
        } else {
          // Corridor still fetching — visible loading state + auto-land when
          // loadCorridor completes (it re-renders into hole view).
          // v-fix: was unconditional below, overwriting the ready-status set
          // by the success branch above every time Hole was tapped.
          setStatus('Preparing hole flyover…');
        }
        render();
      } else {
        if (state.active !== 'green') {
          activateDataset('green');
          buildHeatImage();
          fitView();               // back to green frame
        }
        frameCameraForView(state.viewMode);
      }
      updateLegend();            // ramp follows view mode (rainbow in 3D)
      render();
    }
    function setViewMode(v) {
      setViewModeInternal(v);
      if (state.viewMode === '3d')
        setStatus('3D green view — drag = orbit · pinch/scroll = zoom · tap = readout');
      else if (state.viewMode === '2d') setStatus('2D map');
    }
    document.querySelectorAll('.gm-view-btn').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });

    // Vertical exaggeration slider (3D only).
    // v1.3.2 (smooth exag): 'input' fired buildScene per tick — a full mesh
    // rebuild + arrow rebuild + satellite resample per slider step = the
    // jerky, "not smooth" drag. Now: the slider updates a live preview
    // height offset (cheap render-only) and the FULL rebuild is debounced
    // 140 ms after the last tick.
    let exagDebounce = null;
    const exagEl = document.getElementById('gm-exag');
    exagEl.addEventListener('input', () => {
      state.v3.exag = parseFloat(exagEl.value);
      document.getElementById('gm-exag-val').textContent =
        state.v3.exag + '×';
      buildScene();
      if (state.viewMode === '3d' || state.viewMode === 'hole') render();
      clearTimeout(exagDebounce);
      exagDebounce = setTimeout(() => {
        buildScene();
        render();
      }, 140);
    });

    // v1.4.0: Slope/Elev as a segmented BUTTON group (was a dropdown —
    // hidden state; James: buttons must "make sense"). Same state.mode.
    document.querySelectorAll('.gm-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode === 'elev' ? 'elev' : 'slope';
        document.querySelectorAll('.gm-mode-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
        buildHeatImage();
        if (state.viewMode !== '2d') buildScene();   // recolor 3D/hole mesh too
        updateLegend();
        render();
        setStatus(state.mode === 'elev' ? 'Elevation ramp — low=blue → high=red'
                                        : 'Slope mode — flat=sage → steep=red');
      });
    });
    updateLegend();

    // Stimpmeter selector for the physics putt preview (8 / 10 / 12,
    // persisted in localStorage). v1.4.0: visible ONLY while a ball is
    // placed — the chip is meaningless otherwise (edge case from the plan).
    const stimpEl = document.getElementById('gm-stimp');
    const syncStimpVis = () => {
      if (stimpEl) stimpEl.style.display =
        state.ball && state.showPutt ? '' : 'none';
    };
    if (stimpEl) {
      stimpEl.value = String(state.stimp);
      stimpEl.addEventListener('change', () => {
        state.stimp = parseInt(stimpEl.value, 10) || 10;
        try { localStorage.setItem('gm-stimp', String(state.stimp)); } catch (e) {}
        render();
        setStatus(`Putt preview: Stimpmeter ${state.stimp}`);
      });
    }

    // v1.4.0: ONE ball button that toggles Drop ↔ Remove (the plan's
    // "one way to do the thing" — no separate Clear ball button).
    const ballBtn = document.getElementById('gm-ball');
    const syncBallBtn = () => {
      ballBtn.textContent = state.ball ? 'Remove ball' : 'Drop ball';
      syncStimpVis();
    };
    ballBtn.addEventListener('click', () => {
      if (state.ball) {
        state.ball = null; state.showPutt = false; armBallNext = false;
        setStatus('');
        render(); syncBallBtn();
      } else {
        armBallNext = true;
        setStatus('Tap a spot on the green to drop the ball…');
      }
    });
    window.__syncBallBtn = syncBallBtn;   // drop-tap handler calls this
    document.getElementById('gm-recenter').addEventListener('click', () => {
      if (state.viewMode === 'hole') {
        frameCameraForView('hole');
      } else if (state.viewMode === '3d') {
        state.v3.yaw = 0; state.v3.pitch = 35; state.v3.dist = 62;
      } else fitView();
      render(); setStatus('View reset');
    });
  }

  /* ======================================================================
     5c. LOCATION TRUST — prove which green loaded; adjust it if wrong.
     ====================================================================== */
  // Header readout: coordinates + where they came from. The OSM polygon
  // check is the REAL proof: if Overpass finds a mapped green at these
  // coords, say so; if we fell back to the ellipse, SAY SO — that is the
  // "am I looking at the right green" tell.
  function setLocLabel(polySource) {
    const el = document.getElementById('gm-loc');
    if (!el) return;
    const la = state.lat.toFixed(5), ln = state.lng.toFixed(5);
    const src = polySource === 'osm'
      ? '✓ real green outline (OSM)'
      : polySource === 'traced'
        ? '✓ your traced outline'
        : polySource === 'ellipse'
          ? '⚠ approx outline — trace it via Check location'
          : '…';
    el.textContent = `${la}, ${ln} · ${src}`;
    // v1.2.5 (source choice): when BOTH a trace and an OSM polygon match,
    // the badge invites switching — one tap cycles the outline source with
    // a full reload (no fake partial re-render). The preferred order is
    // traced first (ground truth); this only adds the option to compare.
    if (polySource === 'traced' && state.__altOsm) {
      el.textContent += ' · tap to switch to OSM';
      el.style.cursor = 'pointer';
      el.onclick = () => {
        const qs2 = new URLSearchParams(location.search);
        qs2.set('src', 'osm');
        location.replace('?r=' + Date.now() + '&' + qs2.toString());
      };
    } else if (polySource === 'osm' && state.__altTrace) {
      el.textContent += ' · tap to switch to your trace';
      el.style.cursor = 'pointer';
      el.onclick = () => {
        const qs2 = new URLSearchParams(location.search);
        qs2.set('src', 'traced');
        location.replace('?r=' + Date.now() + '&' + qs2.toString());
      };
    } else {
      el.style.cursor = '';
      el.onclick = null;
    }
  }

  function wireLocationTools() {
    // ‹ Back — returns to the app tab that launched us (postMessage for
    // same-origin app shells; location.assign otherwise; plain history.back
    // as the last resort). Hidden when we were opened cold (no referrer).
    const back = document.getElementById('gm-back');
    if (back) {
      const hasHistory = typeof window.history !== 'undefined' &&
        Number.isFinite(window.history.length);
      if (document.referrer || (hasHistory && window.history.length > 1)) {
        back.style.display = '';
        back.addEventListener('click', () => {
          try { window.close(); } catch (e) {}
          // v1.3.1 (no tab pile-up): greenmap only ever replaces itself in
          // this tab (loadGreen reloads + Check-location launches are all
          // same-page), so ONE step back = the app. history.length counts
          // the whole tab's past, not this page's — old logic backed out
          // through every prior green and made Back feel broken.
          if (hasHistory && window.history.length > 1) window.history.back();
          else location.replace('./index.html');
        });
      }
    }

    // Edit loc / Check location — handled by greenedit.js (map-based
    // verify + move; no coordinate typing). Nothing to wire here.
    const btn = document.getElementById('gm-editloc');
    void btn;
  }

  window.addEventListener('resize', () => { fitView(); render(); });

  /* ======================================================================
     6. BOOT
     ====================================================================== */
  wireChrome();
  wireLocationTools();
  loadGreen();
})();
