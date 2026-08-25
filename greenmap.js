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
    layer: 'both',           // shading | arrows | both
    mode: 'slope',           // slope | elev — color ramp mode
    view: { scale: null, ox: 0, oy: 0 },   // set after first render
    grid: null, field: null, mask: null, bbox: null,
    polyLocal: null,         // polygon in local metres (null = ellipse fallback)
    elevRange: [0, 1],       // min/max elevation inside mask (elev mode)
    pin: null,               // local metre coords of pin marker
    ball: null,              // local metre coords for putt preview
    showPutt: false
  };

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

    // Clip mask: real polygon if we got one (in local metres), else ellipse.
    let mask = null;
    if (polyLL) {
      const polyLocal = polyLL.map(([lon, la]) => [
        (lon - state.lng) * 111320 * Math.cos(state.lat * Math.PI / 180),
        (la - state.lat) * 111320
      ]);
      state.polyLocal = polyLocal;
      mask = GreenMapCore.polyMask(polyLocal, elev.W, elev.H, elev.cellSizeM);
    } else {
      mask = new Uint8Array(elev.W * elev.H);
      const rM = SPAN_M * 0.36;
      for (let y = 0; y < elev.H; y++)
        for (let x = 0; x < elev.W; x++) {
          const mx = (x + 0.5 - elev.W / 2) * elev.cellSizeM;
          const my = (elev.H / 2 - (y + 0.5)) * elev.cellSizeM;
          if ((mx * mx + my * my) / (rM * rM) <= 1) mask[y * elev.W + x] = 1;
        }
    }
    state.mask = mask;
    state.field = field;
    state.pin = [0, 0]; // pin at green centre

    let nValid = 0, nMasked = 0, maxS = 0, sumS = 0;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < mask.length; i++) {
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
    const t0 = performance.now();
    fitView();
    buildHeatImage(); // v-fix: was never invoked — heat canvas stayed transparent
    render();
    console.log('[greenmap] load', `mode=${state.mode}`,
      `polyVerts=${state.polyLocal ? state.polyLocal.length : 0}`,
      state.polyLocal ? '' : 'ellipse fallback',
      `renderMs=${(performance.now() - t0).toFixed(1)}`);
    console.log('[greenmap] grid', `${elev.W}x${elev.H}`,
      'cellSize(m)', elev.cellSizeM.toFixed(3),
      `valid ${(100 * nValid / mask.length).toFixed(0)}%`,
      `in-mask ${nMasked}`, `mean slope ${(sumS / Math.max(1, nValid)).toFixed(2)}%`,
      `max slope ${maxS.toFixed(1)}%`);
    status.textContent = `${state.polyLocal ? 'OSM green shape' : 'ellipse fallback'} · ` +
      `${(sumS / Math.max(1, nValid)).toFixed(1)}% mean slope`;
  }

  /* ======================================================================
     3. VIEW TRANSFORM + RENDERING
     ====================================================================== */
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

  function render() {
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
    // Naive preview: uses GreenMapCore.naivePuttPath (midpoint-sampled,
    // stops at pin or green edge). Drawn dashed white with a ball dot.
    const g = state.grid;
    if (!state.field) return;
    const { pts, stopped } = GreenMapCore.naivePuttPath(
      state.ball, state.pin, state.field, g.W, g.H, g.cellSizeM, state.mask);
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
      setStatus('Naive preview: ball line leaves the green before the pin');
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
     4. INTERACTION
     ====================================================================== */
  const tip = document.getElementById('gm-tip');
  let dragging = false, lastPt = null, pinchDist = 0;

  function eventPos(ev) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr];
  }

  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true; lastPt = eventPos(ev);
    canvas.setPointerCapture(ev.pointerId);
    // Long-press (500ms, no drag) moves the pin to the pressed spot.
    const [px0, py0] = lastPt;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!dragging || Math.hypot(lastPt[0] - px0, lastPt[1] - py0) > 8) return;
      const s = sampleAtScreen(px0, py0);
      if (s && state.mask && state.mask[s.i] &&
          state.field && state.field.valid[s.i]) {
        state.pin = [s.mx, s.my];
        dragging = false; lastPt = null;
        setStatus('Pin moved — long-press again anywhere inside the green');
        render();
      }
    }, 500);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [px, py] = eventPos(ev);
    if (dragging && lastPt) {
      cancelLongPress();
      state.view.ox += px - lastPt[0];
      state.view.oy += py - lastPt[1];
      lastPt = [px, py];
      render();
      tip.style.display = 'none';
      return;
    }
    updateTooltip(px, py, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerup', (ev) => {
    const wasDrag = dragging && lastPt &&
      (Math.abs(eventPos(ev)[0] - lastPt[0]) > 4 ||
       Math.abs(eventPos(ev)[1] - lastPt[1]) > 4);
    dragging = false; lastPt = null;
    cancelLongPress();
    if (!wasDrag) handleTap(eventPos(ev));
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [px, py] = eventPos(ev);
    const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(px, py, k);
  }, { passive: false });

  canvas.addEventListener('touchmove', (ev) => {
    if (ev.touches.length === 2) {
      ev.preventDefault();
      dragging = false; lastPt = null;   // pinch supersedes drag
      const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                           ev.touches[0].clientY - ev.touches[1].clientY);
      if (pinchDist) {
        const [cx, cy] = eventPos({ clientX: (ev.touches[0].clientX + ev.touches[1].clientX) / 2,
                                    clientY: (ev.touches[0].clientY + ev.touches[1].clientY) / 2 });
        zoomAt(cx, cy, d / pinchDist);
      }
      pinchDist = d;
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinchDist = 0; });

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

  function updateTooltip(px, py, clientX, clientY) {
    if (!state.field) return;
    const s = sampleAtScreen(px, py);
    if (!s || !state.mask[s.i] || !state.field.valid[s.i]) {
      tip.style.display = 'none'; return;
    }
    const pct = GreenMapCore.slopePctAt(state.field, s.i);
    const brg = GreenMapCore.fallBearingDeg(state.field.gx[s.i], state.field.gy[s.i]);
    tip.innerHTML = `<b>Slope ${pct.toFixed(1)}%</b> · falls ${GreenMapCore.bearingLabel(brg)} (${brg.toFixed(0)}°)`;
    tip.style.display = 'block';
    tip.style.left = (clientX + 14) + 'px';
    tip.style.top = (clientY + 14) + 'px';
  }

  // Tap: 1st tap sets ball (if putt mode armed), else shows tooltip anchor.
  function handleTap([px, py]) {
    const s = sampleAtScreen(px, py);
    if (!s || !state.mask[s.i] || !state.field.valid[s.i]) return;
    const [mx, my] = fromScreen(px, py);
    if (armBallNext) {
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
    const el = document.getElementById('gm-rampbar');
    if (!el || !window.GreenMapCore) return;
    const stops = [];
    for (let p = 0; p <= 1.0001; p += 0.04)
      stops.push(`rgb(${GreenMapCore.elevationColor(p).join(',')}) ${(p * 100).toFixed(0)}%`);
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

    document.getElementById('gm-mode').addEventListener('change', (ev) => {
      state.mode = ev.target.value === 'elev' ? 'elev' : 'slope';
      buildHeatImage();
      updateLegend();
      render();
      setStatus(state.mode === 'elev' ? 'Elevation ramp — low=blue → high=red'
                                      : 'Slope mode — flat=sage → steep=red');
    });
    updateLegend();

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
      fitView(); render(); setStatus('View reset');
    });
  }

  window.addEventListener('resize', () => { fitView(); render(); });

  /* ======================================================================
     6. BOOT
     ====================================================================== */
  wireChrome();
  loadGreen();
})();
