/* ==========================================================================
   caddy-elev.js — Green Maps: USGS 3DEP 1m elevation pipeline
   --------------------------------------------------------------------------
   Pure add-on service. Exposes window.CaddyElev; NEVER mutates app state,
   never runs at startup (all fetches lazy + cancellable). Falls silently
   unavailable on any failure (one console.warn max per failure class).

   Public API:
     CaddyElev.fetchElevGrid(bbox, size, signal) -> Promise<ElevGrid|null>
         bbox = [w, s, e, n]; ElevGrid = {grid:Float32Array, W, H,
                 cellSizeM, validMask:Uint8Array, bbox}
     CaddyElev.greenModel(elevGrid, centerLL, radiusM)
         -> {fallDirDeg, meanSlopePct, highSideDirDeg, confidence} | null
     CaddyElev.elevDeltaFt(elevGrid, teeLL, greenLL) -> Number|null
     CaddyElev.greenMap({teeLL, centerLL, radiusM}, signal)
         -> Promise<{slope, deltaFt, approx}|null>   // full convenience path
     CaddyElev.cancelAll()
   ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     0. CONSTANTS
     ====================================================================== */
  const ENDPOINT =
    'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
  const FETCH_TIMEOUT_MS = 15000;
  const LS_PREFIX = 'caddy.elev.';
  const LS_INDEX = 'caddy.elev.__lru';
  const CACHE_CAP_BYTES = 2 * 1024 * 1024; // ~2MB total LRU cap
  const FT_PER_M = 3.280839895;
  // Plausible elevation band for a LiDAR cell (meters). Anything outside is
  // nodata / garbage from padded or misaligned tiles.
  const Z_MIN = -100;
  const Z_MAX = 9000;

  let warnedOnce = false;
  const warn1 = (msg, err) => {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn('[CaddyElev]', msg, err || '');
    }
  };

  /* ======================================================================
     1. MINIMAL GeoTIFF PARSER
     ------------------------------------------------------------------------
     Handles the quirks observed against the live 3DEP exportImage endpoint:
       · classic stripped layout (tags 273/278/279), possibly multi-strip
       · tiled layout (tags 322/323/324/325) — the endpoint pads a small
         request into 128×128 float32 tiles, so most of the buffer is
         padding that must be cropped away
       · SamplesPerPixel 1 OR 2 (chunky/pixel-interleaved bands)
       · nodata cells (0.0 pads, GDAL_NODATA value) and occasional
         misaligned/garbage rows → validated into validMask instead of
         being trusted
     No external libraries. Little-endian (II\0* / classic TIFF only —
     which is all this service emits).
     ====================================================================== */

  function parseGeoTIFF(buffer) {
    try {
      const d = new DataView(buffer);
      if (buffer.byteLength < 8) return null;
      const magic = d.getUint16(0, true);
      if (magic !== 0x4949) return null; // 'II' little-endian only
      if (d.getUint16(2, true) !== 42) return null;

      const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
      const ifdOff = d.getUint32(4, true);
      const nEntries = d.getUint16(ifdOff, true);
      const tags = {}; // tag -> array of values

      for (let i = 0; i < nEntries; i++) {
        const e = ifdOff + 2 + i * 12;
        if (e + 12 > buffer.byteLength) return null;
        const tag = d.getUint16(e, true);
        const typ = d.getUint16(e + 2, true);
        const cnt = d.getUint32(e + 4, true);
        const ts = TYPE_SIZE[typ] || 1;
        const vb = ts * cnt;
        let base = e + 8;
        if (vb > 4) base = d.getUint32(e + 8, true);
        if (base + vb > buffer.byteLength) return null;
        const vals = [];
        for (let k = 0; k < cnt; k++) {
          switch (typ) {
            case 1: case 2: case 6: case 7: vals.push(d.getUint8(base + k * ts)); break;
            case 3: vals.push(d.getUint16(base + k * 2, true)); break;
            case 4: vals.push(d.getUint32(base + k * 4, true)); break;
            case 5: { const n = d.getUint32(base + k * 8, true); const dd = d.getUint32(base + k * 8 + 4, true); vals.push(dd ? n / dd : 0); break; }
            case 11: vals.push(d.getFloat32(base + k * 4, true)); break;
            case 12: vals.push(d.getFloat64(base + k * 8, true)); break;
            default: return null;
          }
        }
        tags[tag] = vals;
      }

      const W = tags[256] ? tags[256][0] : 0;
      const H = tags[257] ? tags[257][0] : 0;
      if (!W || !H) return null;
      let spp = tags[277] ? tags[277][0] : 1;
      if (!Number.isFinite(spp) || spp < 1) spp = 1;
      if (spp > 4) return null; // not an image we understand
      const bits = tags[258] ? tags[258][0] : 32;
      if (bits !== 32 && bits !== 64) return null; // F32/D64 only
      const bytesPerSample = bits === 32 ? 4 : 8;
      const sampleFormat = tags[339] ? tags[339][0] : 3; // 3 = IEEE float
      if (sampleFormat !== 3 && sampleFormat !== undefined) return null;

      // Assemble raw sample values in row-major chunky order.
      let raw; // Float64Array of length W*H*spp (band-interleaved)
      if (tags[324] && tags[325]) {
        // ---- tiled ----
        const tw = tags[322] ? tags[322][0] : 0;
        const th = tags[323] ? tags[323][0] : 0;
        if (!tw || !th) return null;
        const offsets = tags[324];
        const counts = tags[325];
        raw = new Float64Array(W * H * spp);
        const tilesAcross = Math.ceil(W / tw);
        for (let t = 0; t < offsets.length && t < counts.length; t++) {
          const off = offsets[t], cnt = counts[t];
          if (!off || !cnt || off + cnt > buffer.byteLength) continue;
          const tx = (t % tilesAcross) * tw;
          const ty = Math.floor(t / tilesAcross) * th;
          for (let r = 0; r < th; r++) {
            const gy = ty + r;
            if (gy >= H) break;
            for (let c = 0; c < tw; c++) {
              const gx = tx + c;
              if (gx >= W) break;
              const src = off + (r * tw + c) * spp * bytesPerSample;
              for (let b = 0; b < spp; b++) {
                const v = bytesPerSample === 4
                  ? d.getFloat32(src + b * 4, true)
                  : d.getFloat64(src + b * 8, true);
                raw[(gy * W + gx) * spp + b] = v;
              }
            }
          }
        }
      } else if (tags[273] && tags[279]) {
        // ---- stripped (possibly multi-strip) ----
        const offsets = tags[273];
        const counts = tags[279];
        const rowsPerStrip = tags[278] ? tags[278][0] : H;
        const rowBytes = W * spp * bytesPerSample;
        raw = new Float64Array(W * H * spp);
        for (let s = 0; s < offsets.length && s < counts.length; s++) {
          const off = offsets[s], cnt = counts[s];
          if (!off || off + cnt > buffer.byteLength) continue;
          const startRow = s * rowsPerStrip;
          const availRows = Math.min(rowsPerStrip, Math.floor(cnt / rowBytes));
          for (let r = 0; r < availRows; r++) {
            const gy = startRow + r;
            if (gy >= H) break;
            for (let gx = 0; gx < W; gx++) {
              for (let b = 0; b < spp; b++) {
                const src = off + (r * rowBytes) + gx * spp * bytesPerSample + b * bytesPerSample;
                raw[(gy * W + gx) * spp + b] = bytesPerSample === 4
                  ? d.getFloat32(src, true)
                  : d.getFloat64(src, true);
              }
            }
          }
        }
      } else {
        return null;
      }

      // De-interleave band 0 and validate each cell.
      const grid = new Float32Array(W * H);
      const validMask = new Uint8Array(W * H);
      let valid = 0;
      for (let i = 0; i < W * H; i++) {
        const v = raw[i * spp];
        if (Number.isFinite(v) && v > Z_MIN && v < Z_MAX && !(spp === 1 && v === 0)) {
          grid[i] = v;
          validMask[i] = 1;
          valid++;
        } else {
          grid[i] = NaN;
        }
      }
      // A grid that is nearly all-invalid is useless — treat as no data.
      if (valid < W * H * 0.05) return null;

      // Reject misaligned/garbage rows: a row whose median deviates more
      // than 15 m from the global median (of valid cells) is suspect.
      const medians = [];
      for (let i = 0; i < W * H; i++) if (validMask[i]) medians.push(grid[i]);
      if (!medians.length) return null;
      medians.sort((a, b) => a - b);
      const globalMed = medians[Math.floor(medians.length / 2)];
      for (let r = 0; r < H; r++) {
        const rowVals = [];
        for (let c = 0; c < W; c++) if (validMask[r * W + c]) rowVals.push(grid[r * W + c]);
        if (rowVals.length < 3) continue;
        rowVals.sort((a, b) => a - b);
        const rm = rowVals[Math.floor(rowVals.length / 2)];
        if (Math.abs(rm - globalMed) > 15) {
          for (let c = 0; c < W; c++) { validMask[r * W + c] = 0; grid[r * W + c] = NaN; }
        }
      }

      return { grid, W, H, validMask };
    } catch (err) {
      warn1('TIFF parse failed', err);
      return null;
    }
  }

  /* ======================================================================
     2. CACHE — memory + localStorage LRU (~2MB cap, courses are static)
     ====================================================================== */
  const memCache = new Map(); // key -> ElevGrid

  function cacheKey(bbox, size) {
    const q = (n) => Math.round(n * 1e6) / 1e6; // ~0.1m rounding
    return `${q(bbox[0])},${q(bbox[1])},${q(bbox[2])},${q(bbox[3])}#${size}`;
  }

  function lruIndex() {
    try {
      const raw = localStorage.getItem(LS_INDEX);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  const LS_IDX_MAX = 512; // metadata-only rows; big enough to always cover the byte cap

  function lruSaveIndex(idx) {
    try {
      const trimmed = idx.slice(-LS_IDX_MAX);
      // Hard safety: anything dropped off the front loses its payload too.
      for (let i = 0; i < idx.length - trimmed.length; i++) {
        try { localStorage.removeItem(LS_PREFIX + idx[i].k); } catch { }
      }
      localStorage.setItem(LS_INDEX, JSON.stringify(trimmed));
    } catch { }
  }

  function f32ToB64(f32) {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let bin = '';
    const CH = 8192;
    for (let i = 0; i < u8.length; i += CH) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return btoa(bin);
  }

  function b64ToF32(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);
  }

  function cachePutLS(key, eg) {
    let entry;
    try {
      entry = JSON.stringify({
        w: eg.W, h: eg.H, cs: eg.cellSizeM, bb: eg.bbox,
        g: f32ToB64(eg.grid), m: f32ToB64(Uint8Array.from(eg.validMask)),
      });
    } catch { return; }
    if (entry.length > CACHE_CAP_BYTES / 2) return; // never one giant entry
    try {
      // LRU evict until under cap.
      let idx = lruIndex().filter((k) => k.k !== key);
      idx.push({ k: key, s: entry.length, t: Date.now() });
      const sizes = () => idx.reduce((a, x) => a + x.s, 0);
      while (sizes() + entry.length > CACHE_CAP_BYTES && idx.length) {
        const victim = idx.shift();
        try { localStorage.removeItem(LS_PREFIX + victim.k); } catch { }
      }
      localStorage.setItem(LS_PREFIX + key, entry);
      lruSaveIndex(idx);
    } catch { /* quota — cache simply stays memory-only */ }
  }

  function cacheGetLS(key) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.g || !o.w) return null;
      const grid = b64ToF32(o.g);
      const vm = new Uint8Array(b64ToF32(o.m).buffer.slice(0, o.w * o.h));
      return {
        grid, W: o.w, H: o.h, cellSizeM: o.cs, bbox: o.bb,
        validMask: vm,
      };
    } catch { return null; }
  }

  function cacheTouch(key) {
    const idx = lruIndex();
    const hit = idx.find((x) => x.k === key);
    if (hit) { hit.t = Date.now(); idx.sort((a, b) => a.t - b.t); lruSaveIndex(idx); }
  }

  /* ======================================================================
     3. FETCH — two-step href flow, timeout, retry-once, cancellable
     ====================================================================== */

  async function fetchWithTimeout(url, ms, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const relay = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      signal.addEventListener('abort', relay, { once: true });
    }
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relay);
    }
  }

  /**
   * fetchElevGrid([w,s,e,n], size[, signal]) -> Promise<ElevGrid|null>
   * ElevGrid = {grid, W, H, cellSizeM, validMask, bbox}
   * Resolves null (never rejects) when coverage/data is unavailable.
   */
  async function fetchElevGrid(bbox, size, signal) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const [w, s, e, n] = bbox;
    if (!(e > w && n > s)) return null;
    const sz = Math.max(4, Math.min(size || 32, 128));

    // Cell-size sanity: refuse absurdly stretched requests (>200 m/cell).
    const midLatRad = ((s + n) / 2) * (Math.PI / 180);
    const spanXM = (e - w) * 111320 * Math.cos(midLatRad);
    const spanYM = (n - s) * 110540;
    const cellEstM = Math.max(spanXM, spanYM) / sz;
    if (cellEstM > 200) return null;

    const key = cacheKey(bbox, sz);
    if (memCache.has(key)) { cacheTouch(key); return memCache.get(key); }
    const ls = cacheGetLS(key);
    if (ls) { memCache.set(key, ls); cacheTouch(key); return ls; }

    const step1Url =
      `${ENDPOINT}?f=json&bbox=${w},${s},${e},${n}&bboxSR=4326&imageSR=4326` +
      `&size=${sz},${sz}&format=tiff&pixelType=F32`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r1 = await fetchWithTimeout(step1Url, FETCH_TIMEOUT_MS, signal);
        const meta = await r1.json();
        if (!meta || !meta.href) throw new Error('no href' + (meta && meta.error ? ' (' + JSON.stringify(meta.error).slice(0, 120) + ')' : ''));
        const r2 = await fetchWithTimeout(meta.href, FETCH_TIMEOUT_MS, signal);
        const buf = await r2.arrayBuffer();
        const parsed = parseGeoTIFF(buf);
        if (!parsed) throw new Error('parse failed');
        const cellX = (e - w) / parsed.W;                       // deg
        const cellY = (n - s) / parsed.H;                       // deg
        const cellSizeM = ((cellX * 111320 * Math.cos(midLatRad)) +
          (cellY * 110540)) / 2;
        const eg = {
          grid: parsed.grid, W: parsed.W, H: parsed.H,
          cellSizeM, validMask: parsed.validMask, bbox: [w, s, e, n],
        };
        memCache.set(key, eg);
        cachePutLS(key, eg);
        return eg;
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
        // v-fix: the _ags_*.tif href is a TEMPORARY export (~60-90s life).
        // A 400 here usually means the link expired before step 2 ran
        // (slow mobile connection). Retrying the SAME href never works —
        // loop back to step 1 to mint a fresh export instead.
        if (attempt === 2) { warn1('elevation fetch unavailable', err.message || err); return null; }
      }
    }
    return null;
  }

  /* ======================================================================
     4. GEOMETRY HELPERS
     ====================================================================== */

  function metersPerDegLat() { return 110540; }
  function metersPerDegLon(latDeg) { return 111320 * Math.cos(latDeg * Math.PI / 180); }

  function gridCellFor(eg, lat, lng) {
    const [w, s, e, n] = eg.bbox;
    const fx = ((lng - w) / (e - w)) * eg.W - 0.5;
    const fy = ((lat - s) / (n - s)) * eg.H - 0.5;
    return { cx: Math.round(fx), cy: Math.round(fy) };
  }

  /** Median z over a k×k neighborhood (default 5×5), skipping invalid. */
  function sampleMedianZ(eg, lat, lng, k) {
    const half = Math.floor((k || 5) / 2);
    const { cx, cy } = gridCellFor(eg, lat, lng);
    const vals = [];
    for (let dy = -half; dy <= half; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= eg.H) continue;
      for (let dx = -half; dx <= half; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= eg.W) continue;
        if (eg.validMask[y * eg.W + x]) vals.push(eg.grid[y * eg.W + x]);
      }
    }
    if (vals.length < 5) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  }

  /**
   * Crop the grid to cells within radiusM of center, then compute Horn-style
   * gradients with median-filtered robustness.
   */
  function greenModelFromGrid(eg, centerLL, radiusM) {
    if (!eg || !centerLL || !Number.isFinite(centerLL.lat)) return null;
    const r = radiusM && radiusM > 3 ? radiusM : 13;
    const { cx, cy } = gridCellFor(eg, centerLL.lat, centerLL.lng);
    const radCells = Math.max(2, Math.ceil(r / eg.cellSizeM) + 1);
    const mLon = metersPerDegLon(centerLL.lat);

    const zs = []; // {x, y, z} in local meters relative to center cell
    for (let dy = -radCells; dy <= radCells; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= eg.H) continue;
      for (let dx = -radCells; dx <= radCells; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= eg.W) continue;
        if (!eg.validMask[y * eg.W + x]) continue;
        zs.push({
          xm: dx * eg.cellSizeM,
          ym: dy * eg.cellSizeM,
          z: eg.grid[y * eg.W + x],
        });
      }
    }
    if (zs.length < 9) return null;

    // Global median z for outlier rejection.
    const sortedZ = zs.map((p) => p.z).sort((a, b) => a - b);
    const medZ = sortedZ[Math.floor(sortedZ.length / 2)];

    // Horn gradient on interior points whose 4-neighbors are present & sane.
    const lookup = new Map(zs.map((p) => [Math.round(p.xm) + ':' + Math.round(p.ym), p]));
    const grads = [];
    for (const p of zs) {
      if (Math.abs(p.z - medZ) > 8) continue; // outlier cell (garbage/artifact)
      const l = lookup.get(Math.round(p.xm - eg.cellSizeM) + ':' + Math.round(p.ym));
      const rr = lookup.get(Math.round(p.xm + eg.cellSizeM) + ':' + Math.round(p.ym));
      const tt = lookup.get(Math.round(p.xm) + ':' + Math.round(p.ym - eg.cellSizeM));
      const bb = lookup.get(Math.round(p.xm) + ':' + Math.round(p.ym + eg.cellSizeM));
      if (!l || !rr || !tt || !bb) continue;
      if ([l.z, rr.z, tt.z, bb.z].some((z) => Math.abs(z - medZ) > 8)) continue;
      // Horn weights: (zR − zL)/2d etc. Screen y grows downward/south here
      // because ym increases southward in grid space; convert so +ym = south.
      const gx = (rr.z - l.z) / (2 * eg.cellSizeM);           // east-positive
      const gy = -(bb.z - tt.z) / (2 * eg.cellSizeM);         // north-positive
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      grads.push({ gx, gy });
    }
    if (grads.length < 6) return null;

    // Robust tilt model: component-wise medians resist artifact rows far
    // better than means or circular averaging.
    const gxSorted = grads.map((g) => g.gx).sort((a, b) => a - b);
    const gySorted = grads.map((g) => g.gy).sort((a, b) => a - b);
    const mgx = gxSorted[Math.floor(gxSorted.length / 2)];
    const mgy = gySorted[Math.floor(gySorted.length / 2)];
    const mag = Math.hypot(mgx, mgy);
    if (!Number.isFinite(mag)) return null;
    const meanSlopePct = mag * 100;
    if (meanSlopePct > 60) return null; // implausible for a putting surface

    // Fall line = downhill direction of steepest descent. Convert the
    // math angle atan2(north, east) to a COMPASS bearing: compass = 90 − θ.
    const fallDirDeg = norm360(90 - (Math.atan2(-mgy, -mgx) * 180) / Math.PI);

    // Confidence: valid-cell fraction + gradient agreement (low MAD).
    const validFrac = zs.length / Math.max(1, (2 * radCells + 1) ** 2);
    let madSum = 0;
    for (const g of grads) madSum += Math.abs(Math.atan2(g.gy, g.gx) - Math.atan2(mgy, mgx));
    const dirAgreement = 1 - Math.min(1, (madSum / grads.length) / Math.PI);
    const slopeVar = (() => {
      const mags = grads.map((g) => Math.hypot(g.gx, g.gy)).sort((a, b) => a - b);
      const mm = mags[Math.floor(mags.length / 2)];
      const dev = mags.reduce((a, m) => a + Math.abs(m - mm), 0) / mags.length;
      return mm > 0 ? dev / mm : 1;
    })();
    const confidence = Math.max(0, Math.min(1,
      validFrac * 0.45 + dirAgreement * 0.35 + (1 - Math.min(1, slopeVar)) * 0.2));

    return {
      fallDirDeg,
      meanSlopePct,
      highSideDirDeg: norm360(fallDirDeg + 180),
      confidence,
      validFrac,
    };
  }

  function norm360(d) { return ((d % 360) + 360) % 360; }

  /* ======================================================================
     5. HIGH-LEVEL API
     ====================================================================== */

  /** Build a bbox around a point spanning spanM meters, clamped to earth. */
  function bboxAround(lat, lng, spanM) {
    const dLat = (spanM / 2) / metersPerDegLat();
    const dLng = (spanM / 2) / metersPerDegLon(lat);
    return [
      Math.max(-180, lng - dLng),
      Math.max(-85, lat - dLat),
      Math.min(180, lng + dLng),
      Math.min(85, lat + dLat),
    ];
  }

  /**
   * greenMap({teeLL, centerLL, radiusM}, signal) -> Promise<
   *   {slope:{fallDirDeg,meanSlopePct,highSideDirDeg,confidence},
   *    deltaFt:Number, approx:Boolean}|null>
   *
   * One grid covers the green (slope + green-side delta sample); the tee is
   * sampled from the same grid when inside it, else a second tiny request.
   */
  async function greenMap(opts, signal) {
    try {
      const centerLL = opts && opts.centerLL;
      if (!centerLL || !Number.isFinite(centerLL.lat) || !Number.isFinite(centerLL.lng)) return null;
      const radius = opts.radiusM && opts.radiusM > 3 ? opts.radiusM : 13;
      const teeLL = opts.teeLL &&
        Number.isFinite(opts.teeLL.lat) && Number.isFinite(opts.teeLL.lng)
        ? opts.teeLL : null;

      // Grid spans green + margin; widen to include the tee when close.
      const span = Math.max(radius * 4, 60);
      let bbox;
      if (teeLL) {
        const dLat = Math.abs(teeLL.lat - centerLL.lat);
        const dLng = Math.abs(teeLL.lng - centerLL.lng);
        const distM = Math.hypot(dLat * metersPerDegLat(), dLng * metersPerDegLon(centerLL.lat));
        if (distM <= span * 0.35) {
          bbox = [
            Math.min(centerLL.lng, teeLL.lng) - 0.0002,
            Math.min(centerLL.lat, teeLL.lat) - 0.0002,
            Math.max(centerLL.lng, teeLL.lng) + 0.0002,
            Math.max(centerLL.lat, teeLL.lat) + 0.0002,
          ];
        } else {
          bbox = bboxAround(centerLL.lat, centerLL.lng, span);
        }
      } else {
        bbox = bboxAround(centerLL.lat, centerLL.lng, span);
      }
      const size = 48;
      const eg = await fetchElevGrid(bbox, size, signal);
      if (!eg) return null;

      const slope = greenModelFromGrid(eg, centerLL, radius);
      const greenZ = sampleMedianZ(eg, centerLL.lat, centerLL.lng, 5);
      let teeZ = teeLL ? sampleMedianZ(eg, teeLL.lat, teeLL.lng, 5) : null;

      // Tee outside the main grid → separate small request.
      if (teeLL && teeZ == null) {
        const teg = await fetchElevGrid(bboxAround(teeLL.lat, teeLL.lng, 30), 12, signal);
        if (teg) teeZ = sampleMedianZ(teg, teeLL.lat, teeLL.lng, 5);
      }

      const deltaFt = greenZ != null && teeZ != null
        ? (greenZ - teeZ) * FT_PER_M : null;
      if (slope == null && deltaFt == null) return null;

      return {
        slope,
        deltaFt: deltaFt != null && Math.abs(deltaFt) < 400 ? deltaFt : null,
        approx: !slope || slope.confidence < 0.45,
      };
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      warn1('greenMap failed', err);
      return null;
    }
  }

  function cancelAll() { /* AbortSignals are owned by callers; noop hook */ }

  /* ======================================================================
     6. EXPORT — window.CaddyElev (+ Node export for headless tests)
     ====================================================================== */
  const CaddyElev = {
    v: 1,
    parseGeoTIFF,
    fetchElevGrid,
    greenModelFromGrid,
    sampleMedianZ,
    greenMap,
    bboxAround,
    cancelAll,
  };
  if (typeof window !== 'undefined') window.CaddyElev = CaddyElev;
  else if (typeof module !== 'undefined' && module.exports) module.exports = CaddyElev;
})();
