/* ==========================================================================
   greenmap.js — standalone Arccos-style green slope map prototype
   --------------------------------------------------------------------------
   NOT linked from the Caddy app. Loaded only by greenmap.html.

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
     Stops at: pin (<0.30 m) | dead (speed <0.15 m/s) | edge (left mask).
     Returns { pts, stopped, breakIn } — breakIn is the max perpendicular
     deviation from the straight ball→pin line in INCHES, signed
     (positive = breaks to the RIGHT of the ball→pin direction). */
  GreenMapCore.simPuttPath = function (ballM, pinM, field, W, H, cellSizeM,
                                       mask, opts) {
    const o = opts || {};
    const stimp = Number.isFinite(o.stimp) ? o.stimp : 10;
    const dt = o.dt || 0.02;
    const GRAV = 9.81;
    const K_FLAT_AT_10 = 0.4;           // stimp 10 ⇒ k ≈ 0.4 m/s²
    const V_DEAD = 0.15;                // ball "dies" below this speed
    const PIN_R = 0.30;                 // holed within 30 cm
    const MAX_S = 4000;                 // hard step cap (~80 s)

    // Faster greens (higher Stimpmeter) roll with LESS friction.
    const k = K_FLAT_AT_10 * 10 / Math.max(1, stimp);
    let dx = pinM[0] - ballM[0], dy = pinM[1] - ballM[1];
    const d = Math.hypot(dx, dy);
    if (d < PIN_R)
      return { pts: [ballM.slice(), pinM.slice()], stopped: 'pin', breakIn: 0 };
    const v0 = Math.sqrt(2 * k * d);
    let theta = Math.atan2(dy, dx);
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
      // Gravity accelerates DOWN-slope: a = −g·∇h, perp component here.
      const aLat = -GRAV * gradPerp;
      theta += (aLat / Math.max(v, 1e-6)) * dt;
      // Friction: constant deceleration along the direction of travel.
      v = Math.max(0, v - k * dt);
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
        break;
      }
      if (v < V_DEAD) { stopped = 'dead'; break; }
    }
    devSign = maxDev >= 0 ? 1 : -1;
    return {
      pts, stopped,
      breakIn: devSign * Math.abs(maxDev) * 39.3701   // metres → inches
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
        if (O.polyLocalM && O.polyLocalM.length > 2 &&
            (!c00 || !c10 || !c01 || !c11 ||
             !mask[c00[1]] || !mask[c10[1]] ||
             !mask[c01[1]] || !mask[c11[1]])) {
          const SUB = 6;
          const buildSubs = (SUBL) => {
            const out = [];
            for (let sy = 0; sy < SUBL; sy++)
            for (let sx = 0; sx < SUBL; sx++) {
              const sxa = cxm(x + sx / SUBL), sxb = cxm(x + (sx + 1) / SUBL);
              const sya = cym(y + sy / SUBL), syb = cym(y + (sy + 1) / SUBL);
              const scx = (sxa + sxb) / 2, scy = (sya + syb) / 2;
              // v-fix(corner-tight): keep only sub-quads FULLY inside the
              // ring (centre AND all four corners). Centre-only testing let
              // corners poke past the rim by up to ~0.15 m — lone hanging
              // cells past the wall (James's screenshot). Anything dropped
              // here reveals the wall behind the rim, never background.
              if (!GreenMapCore.pointInPoly(scx, scy, O.polyLocalM) ||
                  !GreenMapCore.pointInPoly(sxa, sya, O.polyLocalM) ||
                  !GreenMapCore.pointInPoly(sxb, sya, O.polyLocalM) ||
                  !GreenMapCore.pointInPoly(sxb, syb, O.polyLocalM) ||
                  !GreenMapCore.pointInPoly(sxa, syb, O.polyLocalM)) continue;
              // Bilinear elevation sampled at EACH SUB-CORNER's own (fx,fy).
              // v-fix(rim-continuous): the old code flattened every sub-quad
              // to its centre height, so adjacent sub-quads met their shared
              // edge at DIFFERENT heights (z at fx=0.083 vs fx=0.25) — on a
              // steep gradient the rim was a staircase of alternating ledges:
              // the sawtooth at the red-to-grey junction that survived every
              // ring fix. Corner-exact sampling makes neighbours share
              // bit-identical edge heights, continuous across cells too
              // (a cell-edge sub-corner equals the neighbour's f(c00)-based
              // value by the same bilinear formula).
              const zAt = (fx, fy) => {
                const tz = f(c00)[0] + (f(c10)[0] - f(c00)[0]) * fx;
                const bz = f(c01)[0] + (f(c11)[0] - f(c01)[0]) * fx;
                return (tz + (bz - tz) * fy - zmin) * exag;
              };
              out.push({
                v: [[sxa, sya, zAt(sx / SUBL, sy / SUBL)],
                    [sxb, sya, zAt((sx + 1) / SUBL, sy / SUBL)],
                    [sxb, syb, zAt((sx + 1) / SUBL, (sy + 1) / SUBL)],
                    [sxa, syb, zAt(sx / SUBL, (sy + 1) / SUBL)]],
                col: col.map(Math.round), vc: corners, n });
            }
            return out;
          };
          // v-fix(sliver-depth): a boundary sliver so thin that NO 6×6
          // sub-centre lands inside the ring used to keep the WHOLE cell —
          // its far corners poked past the wall top as lone hanging tabs.
          // Ladder 6→12→24→48: the widest cell that still fails all levels
          // has <0.65 m/48 ≈ 1.3 cm of inside-ring width, so keeping finer
          // levels bounds the trim slack (drawn-edge → ring gap) to ~0.65 cm
          // — sub-pixel at every real zoom. A cell that fails ALL levels is
          // a degenerate sliver: DROP it — the wall stands behind the ring,
          // so a drop reveals wall, never background (standing invariant).
          let subs = null;
          for (const L of [6, 12, 24, 48]) {
            const s = buildSubs(L);
            if (s.length) { subs = s; break; }
          }
          if (subs) { quads.push(...subs); continue; }
          continue;   // degenerate sliver: drop (wall behind, never background)
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
      q.vc.forEach((p, c) => { vcol.set(p, k * 12 + c * 3); });
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
  const PRESETS = [
    // Real OSM-mapped green (golf=green way) with strong 3DEP LiDAR relief
    // (5.3m over 40m) — verified by coordinator. Old default was a flat field.
    { name: 'Test green — real OSM green, hilly', lat: 41.91314, lng: -93.60971 },
    { name: 'Test green 2 — same complex', lat: 41.91391, lng: -93.60242 },
    { name: 'Ankeny — Timber Ridge area', lat: 41.9547, lng: -93.7308 }
  ];
  const SPAN_M = 40;         // bbox side, metres
  const GRID_N = 64;         // cells per side

  const qs = new URLSearchParams(
    (typeof location !== 'undefined' && location.search) || '');
  const state = {
    lat: parseFloat(qs.get('lat')) || PRESETS[0].lat,
    lng: parseFloat(qs.get('lng')) || PRESETS[0].lng,
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
    state.mesh = ds.mesh; state.meshArrows = ds.arrows || [];
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
      const el = data.elements && data.elements[0];
      if (!el || !el.geometry) return null;
      return el.geometry.map(g => [g.lon, g.lat]);
    } catch (e) {
      console.warn('[greenmap] no OSM green polygon:', e.message);
      return null;
    }
  }

  async function loadGreen() {
    const status = document.getElementById('gm-status');
    status.textContent = 'Fetching USGS 3DEP elevation…';
    const halfLat = (SPAN_M / 2) / 111320;
    const halfLng = (SPAN_M / 2) / (111320 * Math.cos(state.lat * Math.PI / 180));
    const bbox = [state.lng - halfLng, state.lat - halfLat,
                  state.lng + halfLng, state.lat + halfLat];

    let elev = null;
    try {
      elev = await window.CaddyElev.fetchElevGrid(bbox, GRID_N);
    } catch (e) {
      console.error('[greenmap]', e);
    }

    const polyLL = await fetchGreenPolygon(state.lat, state.lng);

    if (!elev || !elev.grid) {
      status.textContent = 'No 3DEP data here — try another location.';
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
    if (!polyLL) {
      const rM = SPAN_M * 0.36;
      const poly = [];
      for (let a = 0; a < 48; a++) {
        const th = a / 48 * Math.PI * 2;
        poly.push([Math.cos(th) * rM, Math.sin(th) * rM]);
      }
      state.polyLocal = poly;
      state.polySource = 'ellipse';
    }
    let mask = null;
    if (polyLL) {
      const polyLocal = polyLL.map(([lon, la]) => [
        (lon - state.lng) * 111320 * Math.cos(state.lat * Math.PI / 180),
        (la - state.lat) * 111320
      ]);
      state.polyLocal = polyLocal;
      state.polySource = 'osm';
      mask = GreenMapCore.polyMask(polyLocal, elev.W, elev.H, elev.cellSizeM);
    } else {
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
    status.textContent = `${state.polySource === 'ellipse'
      ? 'ellipse fallback' : 'OSM green shape'} · ` +
      `${(sumS / Math.max(1, nValid)).toFixed(1)}% mean slope`;
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
      // If the user is already waiting in Hole view, land them on it now.
      if (state.viewMode === 'hole' && state.active !== 'hole') {
        activateDataset('hole');
        applyHoleFraming(ds);
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
          const t = Math.max(-1, Math.min(1,
            (zMid - (lo + hi) / 2) / Math.max(0.5, hi - lo)));
          const k = 1 + t * 0.10;
          return [110 * k, 130 * k, 106 * k].map(Math.round);
        }
      });
    if (ds.mesh) ds.mesh.gridRef = state.meshGrid;
    // Downhill arrows over the corridor (sparse — bigger step than 2D).
    const arr = [];
    const step = 5;
    for (let y = 1; y < ds.eg.H - 1; y += step)
      for (let x = 1; x < ds.eg.W - 1; x += step) {
        const i = y * ds.eg.W + x;
        if (!ds.mask[i] || !ds.field.valid[i]) continue;
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
      const step = 3;                       // subsample every 3rd cell
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
    const hs = Math.max(2.6, state.view.scale * 0.055);
    ctx.lineCap = 'round';
    // shaft: dark halo underneath, light stroke on top — legible on any fill
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(12,18,15,0.85)';
    ctx.lineWidth = Math.max(3.0, state.view.scale * 0.05);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246,251,247,0.95)';
    ctx.lineWidth = Math.max(1.4, state.view.scale * 0.022);
    ctx.stroke();
    // head: dark halo triangle slightly larger, then light on top
    const drawHead = (size, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(ang - 0.42), y2 - size * Math.sin(ang - 0.42));
      ctx.lineTo(x2 - size * Math.cos(ang + 0.42), y2 - size * Math.sin(ang + 0.42));
      ctx.closePath(); ctx.fill();
    };
    drawHead(hs * 1.45, 'rgba(12,18,15,0.85)');
    drawHead(hs, 'rgba(246,251,247,0.95)');
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
    // Physics preview: GreenMapCore.simPuttPath roll model (friction ∝
    // stimp, lateral gravity from the slope field). Dashed white + ball dot.
    const g = state.grid;
    if (!state.field) return;
    const { pts, stopped, breakIn } = GreenMapCore.simPuttPath(
      state.ball, state.pin, state.field, g.W, g.H, g.cellSizeM, state.mask,
      { stimp: state.stimp });
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1.5, state.view.scale * 0.035);
    ctx.setLineDash([state.view.scale * 0.18, state.view.scale * 0.12]);
    ctx.beginPath();
    pts.forEach((p, k) => {
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
    if (stopped === 'edge')
      setStatus('Preview: ball leaves the green before reaching the pin');
    else if (stopped === 'dead')
      setStatus('Preview: ball dies short of the pin');
    else if (stopped === 'pin' && Math.abs(breakIn) >= 0.5)
      setStatus(`Break: ~${Math.abs(breakIn).toFixed(0)} in ` +
        (breakIn > 0 ? 'right' : 'left'));
    else if (stopped === 'pin') setStatus('Preview: dead-straight putt holds its line');
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
    if (isHole) { buildHoleScene(); state.mesh = ds.mesh;
      state.meshArrows = ds.arrows || []; return; }
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
      state.v3.exag, state.mode, { smooth: true, ao: true, aoRadius: aoR,
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
    // Downhill arrows on the surface. v2: sparse & bold like 18Birdies —
    // ~every 8th refined cell (≈40 arrows), uniform bold styling, not fuzz.
    const arr = [];
    const step = 8;
    for (let y = 4; y < g.H - 1; y += step)
      for (let x = 4; x < g.W - 1; x += step) {
        const i = y * g.W + x;
        if (!state.mask[i] || !state.field.valid[i]) continue;
        const gxv = state.field.gx[i], gyv = state.field.gy[i];
        const mag = Math.hypot(gxv, gyv);
        if (mag < 1e-5) continue;
        arr.push({
          mx: (x + 0.5 - g.W / 2) * g.cellSizeM,
          my: (g.H / 2 - y - 0.5) * g.cellSizeM,
          dxm: -gxv / mag, dym: gyv / mag,
          lenM: 1.6,                       // uniform length — clean flow field
          slopePct: mag * 100
        });
      }
    state.meshArrows = arr;
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
    const z = (a) => Number.isFinite(a) ? a : 0;
    const h = z(g.grid[y0 * g.W + x0]) * (1 - tx) * (1 - ty) +
              z(g.grid[y0 * g.W + x1]) * tx * (1 - ty) +
              z(g.grid[y1 * g.W + x0]) * (1 - tx) * ty +
              z(g.grid[y1 * g.W + x1]) * tx * ty;
    return (h - M.zmin) * state.v3.exag;
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

  // Thin semi-transparent iso-lines at fixed elevation intervals
  // (marching-squares along the live grid), projected onto the surface.
  function drawContours3D(cam) {
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

  // Solid gray side walls extruding the green boundary down to the base
  // plane (z=0 pre-exaggeration) — gives the model physical thickness.
  function drawSkirt(cam, bpts) {
    const exag = state.v3.exag, M = state.mesh;
    // v-fix(skirt-grow): wall tops on the polygon GROWN OUT to the ONE-RING
    // (+0.25 m) — the exact ring the fine mask and sub-quad trim test
    // against. Previously the skirt used cellSize*0.25 ≈ 0.156 m (a
    // metres-vs-quarter-cell slip): the surface still reached ~9 cm past
    // the wall-top line, and on a steep FALLING rim that outer band hung
    // in space — serrated background-through teeth at glancing angles and
    // pale tabs past the silhouette from above (James's 8× shots, 20:51).
    // One ring, in one unit: 0.25 METRES everywhere.
    const sPts = growPolyLocal(bpts, RING_M);
    const zAt = ([mx, my]) =>
      Number.isFinite(surfZ3(mx, my)) ? surfZ3(mx, my) :
      ((sampleElevRaw(mx, my) - M.zmin) * exag || 0);
    const quads = GreenMapCore.buildSkirtQuads(sPts, zAt, 0);
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
      // Outward horizontal normal: edge perpendicular per winding.
      const ex = q.v[1][0] - q.v[0][0], ey = q.v[1][1] - q.v[0][1];
      const l = Math.hypot(ex, ey) || 1;
      let nx = polyCCW ? ey / l : -ey / l;
      let ny = polyCCW ? -ex / l : ex / l;
      const mx = (q.v[0][0] + q.v[1][0]) / 2,
            my = (q.v[0][1] + q.v[1][1]) / 2;
      if (nx * (camPos[0] - mx) + ny * (camPos[1] - my) <= 0) {
        // v-fix(near-inner-wall): a BACK face on the NEAR half still draws.
        // At concave rim sections the outward normal points away from the
        // camera, so the wall was culled exactly where the corner-tight
        // sub-quad trim drops overhanging slivers — the slit showed the
        // near cliff rows from outside (orange dashes) and the far side
        // through the gaps (probe A/B: persists with arrows off, seals at
        // 1× ⇒ displacement-scaled see-through, not paint). Far-side back
        // faces stay culled (v1.0.95's "pieces rendering when not facing
        // me" must not return).
        if (mx * camPos[0] + my * camPos[1] <= 0)
          continue;                                  // far back face — skip
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
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,46,43,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
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
      if (dsH && !dsH.failed && state.teeLL) {
        const mLat = 110540;
        const mLng = 111320 * Math.cos(dsH.centerLL[1] * Math.PI / 180);
        label('Tee', (state.teeLL.lng - dsH.centerLL[0]) * mLng,
                      (state.teeLL.lat - dsH.centerLL[1]) * mLat);
      }
      if (bpts && bpts.length) {
        let sx = 0, sy = 0;
        for (const p of bpts) { sx += p[0]; sy += p[1]; }
        label('Green', sx / bpts.length, sy / bpts.length);
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
    cam.oy = canvas.height * (state.viewMode === 'hole' ? 0.62 : 0.56);
    return cam;
  }

  // Shared hole-view framing: corridor fills ~80% of viewport width given
  // cam.f ⇒ dist ≈ span·0.9, clamped to a sensible range.
  function applyHoleFraming(ds) {
    const span = (ds && ds.spanM) || HOLE_SPAN_CAP_M;
    state.v3.yaw = 0;
    state.v3.pitch = 26;
    state.v3.dist = Math.max(120, Math.min(400, span * 0.9));
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
        if (bpts && state.viewMode !== 'hole') drawGridFloor(cam, bpts);
    // v-fix(curtain-removed): the v1.0.92 unculled rim curtain was a backstop
    // for the wall-top slit that the v1.0.94 ONE-RING alignment closed for
    // good. Unculled, it drew on BOTH sides — its top ring crested above the
    // stepped surface edge on the FAR side (gray teeth that "render away when
    // I face them"). Removed: the wall pass + one-ring alignment seal the rim
    // without it (verified on real OSM+LiDAR data at multiple angles).

    // Project all quad corners once; painter sort by mean depth (far first).
    // v-fix(seethrough2): NO backface culling on the top surface. The bowl's
    // near/far rims tilt their normals away from the camera at normal orbit
    // pitches, so culled rim quads left holes and the skirt's inner walls
    // showed through ("clear/see-through green" + black jagged rim spikes).
    // Painter far→near ordering already hides undersides correctly.
    const n = M.count;
    const sx = new Float32Array(n * 4), sy = new Float32Array(n * 4);
    const dep = new Float32Array(n), order = new Int32Array(n);
    let visible = new Uint8Array(n);
    let nVis = 0;
    for (let q = 0; q < n; q++) {
      const o0 = q * 12;
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
      // v-fix(skirt-winding + skirt-grow): match drawSkirt exactly — walls on
      // the ONE-RING (RING_M metres, the same constant as everything else),
      // culled by winding-based outward normals. Was cellSize*0.25 ≈ 0.156 m.
      const sQuads = GreenMapCore.buildSkirtQuads(
        growPolyLocal(bpts, RING_M),
        ([mx, my]) =>
          Number.isFinite(surfZ3(mx, my)) ? surfZ3(mx, my) :
          ((sampleElevRaw(mx, my) - M.zmin) * state.v3.exag || 0), 0);
      let area2 = 0;
      const gPts = growPolyLocal(bpts, RING_M);
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
      const midCol = `rgb(${M.col[q * 3] | 0},${M.col[q * 3 + 1] | 0},${M.col[q * 3 + 2] | 0})`;
      if (state.layer === 'arrows') {
        fill = 'rgb(24,32,27)';   // near-background green-black
      } else if (M.vcol) {
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
      ctx.strokeStyle = midCol;   // same-colour stroke hides seams
      // v-fix(seam-cover): at grazing angles (steep 8×-exaggerated cliffs
      // seen edge-on) consecutive quad rows leave hairline AA seams that a
      // 1-device-px stroke can't cover — background sliced through as
      // horizontal slits. Same-colour stroke at ~0.6 CSS px seals them with
      // no visible thickening.
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.6);
      ctx.fill(); ctx.stroke();
    }
    void visible;

    // 18Birdies dressing: contour iso-lines on the surface…
    drawContours3D(cam);
    // v-fix(skirt-underlay): skirt painted BEFORE the surface as well — any
    // sub-pixel gap between the surface rim and the wall tops shows gray wall
    // instead of black background (kills the jagged rim spikes). The after
    // pass below keeps near walls correctly overlaying the base.
    if (bpts && state.viewMode !== 'hole') {
      drawSkirt(cam, bpts);
      drawGridFloor(cam, bpts);   // re-cover floor lines smeared by underlay
    }

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
      const LIP = 1.1 * (window.devicePixelRatio || 1);
      ctx.strokeStyle = 'rgba(158,168,162,0.9)';
      ctx.lineWidth = LIP;
      // v-fix(lip-on-walltop): trace the ONE-RING (the actual wall-top edge),
      // not the bare polygon. v1.0.96 grew this by cellSize*0.25 ≈ 0.156 m
      // while the surface mask/trim used 0.25 m — the lip sat ~9 cm INSIDE
      // the surface edge, so the outer band of surface hung past the lip
      // (lone hanging pixels from above, micro gaps at the rim).
      const lipPts = growPolyLocal(state.polyLocal, RING_M);
      let prev = null;
      let firstVis = null;
      for (const [mx, my] of lipPts) {
        const p = GreenMapCore.projectPt(cam, mx, my, surfZ3(mx, my) + 0.06);
        const hidden = !p || (dressingOcclusion &&
          dressingOcclusion(p[0], p[1], p[2]));
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
    }

    // Surface break arrows (downhill), drawn on top of the mesh.
    // v2 fix: arrows show in 'both' and 'arrows' modes; 'shading' hides them.
    if (state.layer !== 'shading') {
      const dpr = window.devicePixelRatio || 1;
    ctx.lineCap = 'round';
    for (const a of state.meshArrows) {
      const z = surfZ3(a.mx, a.my);
      const x1m = a.mx - a.dxm * a.lenM / 2, y1m = a.my - a.dym * a.lenM / 2;
      const x2m = a.mx + a.dxm * a.lenM / 2, y2m = a.my + a.dym * a.lenM / 2;
      const p1 = GreenMapCore.projectPt(cam, x1m, y1m, surfZ3(x1m, y1m));
      const p2 = GreenMapCore.projectPt(cam, x2m, y2m, surfZ3(x2m, y2m));
      // v-fix(arrow-silhouette): arrows are occlusion-tested but nothing
      // stops a rim arrow from projecting past the SURFACE EDGE into the
      // background — nothing is rasterized there, so the depth test always
      // passes and the arrow tip/tail drew as pale specks hanging off the
      // silhouette (honest glancing-angle harness, .rimreal8, Front-left
      // rim). Gate every arrow sample (mid + both ends) inside the boundary
      // ring INSET 0.15 m so tips land on real drawn surface, never the
      // trimmed margin.
      if (!p1 || !p2) continue;
      if (state.active === 'green' &&
          state.polyLocal && state.polyLocal.length > 2) {
        if (arrowRingSrc !== state.polyLocal) {
          arrowRingSrc = state.polyLocal;
          arrowRing = growPolyLocal(state.polyLocal, -0.15);
        }
        if (!GreenMapCore.pointInPoly(a.mx, a.my, arrowRing) ||
            !GreenMapCore.pointInPoly(x1m, y1m, arrowRing) ||
            !GreenMapCore.pointInPoly(x2m, y2m, arrowRing)) continue;
      }
      // v-fix(dressing-z): drop arrows hidden behind the surface — test the
      // midpoint AND both endpoints so a partially-hidden arrow (tail behind
      // a rim, tip in front) can't streak across the near face.
      const zMid = surfZ3(a.mx, a.my);
      const pMid = GreenMapCore.projectPt(cam, a.mx, a.my, zMid);
      const occ = (p) => dressingOcclusion && dressingOcclusion(p[0], p[1], p[2]);
      if ((pMid && occ(pMid)) || occ(p1) || occ(p2)) continue;
      const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      const hs = Math.max(2.6, cam.f / p2[2] * 0.05);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
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
        ctx.moveTo(p2[0], p2[1]);
        ctx.lineTo(p2[0] - size * Math.cos(ang - 0.42),
                   p2[1] - size * Math.sin(ang - 0.42));
        ctx.lineTo(p2[0] - size * Math.cos(ang + 0.42),
                   p2[1] - size * Math.sin(ang + 0.42));
        ctx.closePath(); ctx.fill();
      };
      head(hs * 1.55, 'rgba(12,18,15,0.9)');
      head(hs * 1.02, 'rgba(255,255,255,0.98)');
    }
    }

    // Putt line projected onto the surface (green view only).
    if (state.active === 'green' &&
        state.showPutt && state.ball && state.pin && state.field) {
      const g = state.grid;
      const { pts } = GreenMapCore.simPuttPath(
        state.ball, state.pin, state.field, g.W, g.H, g.cellSizeM,
        state.mask, { stimp: state.stimp });
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      let started = false;
      pts.forEach(([mx, my]) => {
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
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, dpr * 1.0);
        ctx.beginPath(); ctx.moveTo(base[0], base[1]);
        ctx.lineTo(top[0], top[1]); ctx.stroke();
        const fs = Math.max(4, cam.f / top[2] * 0.09);
        ctx.fillStyle = '#e04444';
        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        ctx.lineTo(top[0] + fs, top[1] + fs * 0.28);
        ctx.lineTo(top[0], top[1] + fs * 0.56);
        ctx.closePath(); ctx.fill();
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
  // relative to the green centre.
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
      elevTxt = ` · ${ft >= 0 ? '+' : '−'}${Math.abs(ft).toFixed(1)} ft`;
    }
    return `<b>Slope ${pct.toFixed(1)}%</b> · falls ` +
      `${GreenMapCore.bearingLabel(brg)} (${brg.toFixed(0)}°)${elevTxt}`;
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
      setStatus('Putt preview ON (naive) — tap "Clear ball" to remove');
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
    const cfg = LEGEND_TEXT[state.mode] || LEGEND_TEXT.slope;
    document.getElementById('gm-legend-title').textContent = cfg.title;
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
    const sel = document.getElementById('gm-preset');
    PRESETS.forEach((p, idx) => {
      const o = document.createElement('option');
      o.value = idx; o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      const p = PRESETS[sel.value];
      location.search = `?lat=${p.lat}&lng=${p.lng}`;
    });

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
        applyHoleFraming(state.datasets.hole);
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

    // Vertical exaggeration slider (3D only) — rebuild mesh, not per frame.
    const exagEl = document.getElementById('gm-exag');
    exagEl.addEventListener('input', () => {
      state.v3.exag = parseFloat(exagEl.value);
      document.getElementById('gm-exag-val').textContent =
        state.v3.exag + '×';
      buildScene();
      if (state.viewMode === '3d' || state.viewMode === 'hole') render();
    });

    document.getElementById('gm-mode').addEventListener('change', (ev) => {
      state.mode = ev.target.value === 'elev' ? 'elev' : 'slope';
      buildHeatImage();
      if (state.viewMode !== '2d') buildScene();   // v-fix: recolor 3D/hole mesh too
      updateLegend();
      render();
      setStatus(state.mode === 'elev' ? 'Elevation ramp — low=blue → high=red'
                                      : 'Slope mode — flat=sage → steep=red');
    });
    updateLegend();

    // Stimpmeter selector for the physics putt preview (8 / 10 / 12,
    // persisted in localStorage).
    const stimpEl = document.getElementById('gm-stimp');
    if (stimpEl) {
      stimpEl.value = String(state.stimp);
      stimpEl.addEventListener('change', () => {
        state.stimp = parseInt(stimpEl.value, 10) || 10;
        try { localStorage.setItem('gm-stimp', String(state.stimp)); } catch (e) {}
        render();
        setStatus(`Putt preview: Stimpmeter ${state.stimp}`);
      });
    }

    document.getElementById('gm-ball').addEventListener('click', () => {
      armBallNext = true;
      setStatus('Tap a spot on the green to drop the ball…');
    });
    document.getElementById('gm-clear-ball').addEventListener('click', () => {
      state.ball = null; state.showPutt = false; armBallNext = false;
      setStatus('');
      render();
    });
    document.getElementById('gm-recenter').addEventListener('click', () => {
      if (state.viewMode === 'hole') {
        frameCameraForView('hole');
      } else if (state.viewMode === '3d') {
        state.v3.yaw = 0; state.v3.pitch = 35; state.v3.dist = 62;
      } else fitView();
      render(); setStatus('View reset');
    });
  }

  window.addEventListener('resize', () => { fitView(); render(); });

  /* ======================================================================
     6. BOOT
     ====================================================================== */
  wireChrome();
  loadGreen();
})();
