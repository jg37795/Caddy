/* ==========================================================================
   greenBriefCore.js — headless green-brief builder for Prep
   --------------------------------------------------------------------------
   v1.18.0 (James: "why do I have to open the 3D green for Prep to know
   the green?"): runs the FULL 3D-Green pipeline invisibly:
     USGS fetch → gradient field → putt sim (3 zones) → brief JSON
   and saves it in the SAME format/schema greenmap.js saves, so every
   consumer (advice box, approach favor, green tint) lights up without
   the user ever opening the tool.

   Depends (loaded before this file):
     window.CaddyElev        — fetchElevGrid / greenModel
     window.GreenMapCore     — computeGradientField / simPuttPath
   Public:
     window.GreenBriefCore.build({ teeLL, centerLL, radiusM, polyLL, stimp })
       -> Promise<brief|null>   (also persists to localStorage)
     window.GreenBriefCore.briefFor(centerLL)  -> brief|null (sync read)
   Caching: one fetch per green (elev LRU covers repeats; brief JSON is
   the same key greenmap writes: 'caddy:greenBrief:v1').
   ========================================================================== */

(() => {
  'use strict';

  const BRIEF_KEY = 'caddy:greenBrief:v1';
  const CALC_REVISION = 2; // v1 auto briefs used wrong directions/unmasked terrain
  const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
  let restoreEpoch = 0;
  if (typeof window.addEventListener === 'function')
    window.addEventListener('caddy:data-restored', () => { restoreEpoch++; });
  const M_LAT = 111320;
  const mLngAt = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
  const validLL = p => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;

  // OutlineStore uses [lat,lng]; mapped holes use {lat,lng}. Decode once
  // so extents, masks and (below) cache identity all use the same geometry.
  function normalizeRing(polyLL) {
    if (!Array.isArray(polyLL) || polyLL.length < 3) return null;
    const ring = polyLL.map(p => Array.isArray(p) ? [p[0], p[1]]
      : [p && p.lat, p && p.lng]);
    return ring.every(([lat, lng]) => validLL({ lat, lng })) ? ring : null;
  }

  function readBriefs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BRIEF_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      // The 3D tool also wrote a single object before the shared map schema.
      return validLL(parsed) ? { [keyFor(parsed.lat, parsed.lng)]: parsed } : parsed;
    } catch (e) { return {}; }
  }

  function keyFor(lat, lng) {
    return `${lat.toFixed(6)},${lng.toFixed(6)}`;
  }

  function inputsFor({ teeLL = null, polyLL = null, radiusM = 18 } = {}) {
    return { teeLL: teeLL == null ? null : { lat: teeLL.lat, lng: teeLL.lng },
      polyLL: normalizeRing(polyLL), radiusM };
  }

  function requestKey(options) {
    if (!options || !validLL(options.centerLL)) return null;
    return JSON.stringify([keyFor(options.centerLL.lat, options.centerLL.lng),
      options.stimp === undefined ? 10 : options.stimp, inputsFor(options)]);
  }

  function matchesBrief(brief, centerLL, options = {}) {
    if (!validLL(centerLL) || !validLL(brief) ||
        keyFor(brief.lat, brief.lng) !== keyFor(centerLL.lat, centerLL.lng)) return false;
    const age = Date.now() - brief.savedAt;
    if (!Number.isFinite(brief.savedAt) || age < 0 || age >= MAX_AGE_MS) return false;
    if (brief.source === 'prep-auto' && brief.calcRevision !== CALC_REVISION) return false;
    const atPin = brief.landing && brief.landing.atPin;
    if (!atPin || !Number.isFinite(atPin.breakIn) ||
        !Array.isArray(brief.zones) || !brief.zones.some(z => z && z.id === 'middle' &&
          Number.isFinite(z.breakIn))) return false;
    if (options.stimp !== undefined && brief.stimp !== options.stimp) return false;
    // A caller without tee/ring information can still do an exact-centre
    // read. When known, those inputs must match; a legacy 3D brief without
    // provenance cannot certify the current approach or chosen outline.
    const expected = inputsFor(options);
    for (const name of ['teeLL', 'polyLL', 'radiusM']) {
      if (!Object.prototype.hasOwnProperty.call(options, name)) continue;
      if (name === 'polyLL' && options.polyLL != null && !expected.polyLL) return false;
      if (!brief.inputs || JSON.stringify(brief.inputs[name]) !== JSON.stringify(expected[name]))
        return false;
    }
    return true;
  }

  function briefFor(centerLL, options = {}) {
    let best = null;
    // Read old map keys too, but only exact owner coordinates; never the
    // nearest brief. Checking the record avoids old rounding-key collisions.
    for (const brief of Object.values(readBriefs())) {
      if (matchesBrief(brief, centerLL, options) && (!best || brief.savedAt > best.savedAt))
        best = brief;
    }
    return best;
  }

  function persist(brief) {
    try {
      const all = readBriefs();
      all[keyFor(brief.lat, brief.lng)] = brief;
      localStorage.setItem(BRIEF_KEY, JSON.stringify(all));
    } catch (e) { /* private mode — non-fatal */ }
  }

  /* Build the brief from scratch (fetch + sim). Mirrors greenmap.js
     persistGreenBrief() field-for-field: {lat, lng, savedAt, stimp,
     landing:{atPin:{breakIn,dirDeg,paceClass}}, zones:[{id,breakIn,dirDeg}]}
     …plus our additions: slopePct, fallDirDeg, highSideDirDeg, source. */
  async function build({ teeLL, centerLL, radiusM = 18, polyLL = null,
    stimp = 10 } = {}) {
    const startedEpoch = restoreEpoch;
    if (!validLL(centerLL) || (teeLL != null && !validLL(teeLL)) ||
        !Number.isFinite(radiusM) || radiusM <= 0 ||
        !Number.isFinite(stimp) || stimp <= 0) return null;
    if (typeof CaddyElev === 'undefined' || typeof GreenMapCore ===
      'undefined') return null;

    // Small square envelope around the GREEN (radius + margin). ~45 m
    // across at 64×64 → ~0.7 m cells — plenty for slope + zone probes.
    const mLat = M_LAT;
    const mLng = mLngAt(centerLL.lat);
    if (mLng < 1) return null;
    const ring = normalizeRing(polyLL);
    if (polyLL != null && !ring) return null;
    const poly = ring && ring.map(([lat, lng]) => [
      (lng - centerLL.lng) * mLng, (lat - centerLL.lat) * mLat,
    ]);
    if (poly) {
      let area2 = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        area2 += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      if (Math.abs(area2) < 1e-6 || !GreenMapCore.pointInPoly(0, 0, poly)) return null;
    }
    const pad = Math.max(radiusM, ...(poly || []).map(([x, y]) =>
      Math.max(Math.abs(x), Math.abs(y)))) + 14;
    const bbox = [
      centerLL.lng - pad / mLng, centerLL.lat - pad / mLat,
      centerLL.lng + pad / mLng, centerLL.lat + pad / mLat,
    ];
    let eg = null;
    try {
      eg = await CaddyElev.fetchElevGrid(bbox, 64, null);
    } catch (e) { eg = null; }
    // A restore owns its new cache; a fetch started before it may not write
    // stale geometry back into the just-restored data.
    if (startedEpoch !== restoreEpoch) return null;
    if (!eg || !eg.grid || !Number.isInteger(eg.W) || !Number.isInteger(eg.H) ||
        eg.W < 3 || eg.H < 3 || !Number.isFinite(eg.cellSizeM) || eg.cellSizeM <= 0 ||
        eg.grid.length !== eg.W * eg.H ||
        (eg.validMask && eg.validMask.length !== eg.grid.length)) return null;

    // Centre the grid local frame on the green centre (same convention
    // as greenmap: +x east, +y north, centre cell = green centre).
    const validElev = i => Number.isFinite(eg.grid[i]) &&
      (!eg.validMask || !!eg.validMask[i]);
    const field = GreenMapCore.computeGradientField(
      eg.grid, eg.W, eg.H, eg.cellSizeM,
      validElev);
    // Horn needs all nine samples; the shared core checks the axial ones
    // only and substitutes zero for nonfinite derivatives. Do not turn a
    // LiDAR void in a diagonal neighbour into a confident flat-green brief.
    for (let i = 0; i < field.valid.length; i++) {
      if (field.valid[i] && (!validElev(i - eg.W - 1) || !validElev(i - eg.W + 1) ||
          !validElev(i + eg.W - 1) || !validElev(i + eg.W + 1))) field.valid[i] = 0;
    }
    const mask = poly ? GreenMapCore.polyMask(poly, eg.W, eg.H, eg.cellSizeM)
      : new Uint8Array(eg.W * eg.H);
    // Preserve the radius-only API, but limit it to that footprint rather
    // than the entire padded fetch. This is not a mapped outline.
    if (!poly) {
      for (let y = 0; y < eg.H; y++) for (let x = 0; x < eg.W; x++) {
        const mx = (x + 0.5 - eg.W / 2) * eg.cellSizeM;
        const my = (eg.H / 2 - y - 0.5) * eg.cellSizeM;
        if (Math.hypot(mx, my) <= radiusM) mask[y * eg.W + x] = 1;
      }
    }

    // Approach axis: from the tee toward the pin (green local +Y = away
    // from tee), matching persistGreenBrief's ux/uy.
    let ux = 0, uy = 1;
    if (teeLL && Number.isFinite(teeLL.lat) && Number.isFinite(teeLL.lng)) {
      const tx = (teeLL.lng - centerLL.lng) * mLng;
      const ty = (teeLL.lat - centerLL.lat) * mLat;
      const len = Math.hypot(tx, ty);
      if (len > 1) { ux = -tx / len; uy = -ty / len; }
    }

    // Front/back extent along the approach axis from the ring (or a
    // circle fallback).
    let frontExt = 0, backExt = 0;
    if (poly) {
      for (const [x, y] of poly) {
        const p = x * ux + y * uy;
        if (p > backExt) backExt = p;
        if (-p > frontExt) frontExt = -p;
      }
    }
    if (!poly) frontExt = backExt = radiusM;
    const inset = 2;
    const frontD = Math.max(0.6, frontExt - inset);
    const backD = Math.max(0.6, backExt - inset);

    const pin = [0, 0];
    const cellOk = (mx, my) => {
      if (poly && !GreenMapCore.pointInPoly(mx, my, poly)) return -1;
      if (!poly && Math.hypot(mx, my) > radiusM) return -1;
      const ix = Math.round(mx / eg.cellSizeM + eg.W / 2);
      const iy = Math.round(eg.H / 2 - my / eg.cellSizeM);
      if (ix < 0 || iy < 0 || ix >= eg.W || iy >= eg.H) return -1;
      const i = iy * eg.W + ix;
      return (field.valid[i] && mask[i]) ? i : -1;
    };
    if (cellOk(0, 0) < 0) return null;
    const probeOf = (along) => {
      let x = pin[0] + ux * along, y = pin[1] + uy * along;
      if (cellOk(x, y) >= 0) return [x, y];
      for (let t = 0.85; Math.abs(along) * t >= 0.3; t *= 0.7) {
        const sx = pin[0] + ux * along * t;
        const sy = pin[1] + uy * along * t;
        if (cellOk(sx, sy) >= 0) return [sx, sy];
      }
      return null;
    };
    const fallAt = (atM) => {
      // direction of fall at a cell, expressed as compass bearing
      const i = cellOk(atM[0], atM[1]);
      if (i < 0) return null;
      const gx = field.gx[i], gy = field.gy[i];
      const g = Math.hypot(gx, gy);
      if (g < 1e-6) return null;
      // The field is still in raster coordinates (gx east, gy south).
      // fallBearingDeg converts that to downhill compass bearings itself.
      return Math.round(GreenMapCore.fallBearingDeg(gx, gy)) % 360;
    };
    const summarize = (ballM) => {
      if (!ballM) return null;
      const r = GreenMapCore.simPuttPath(
        ballM, pin, field, eg.W, eg.H, eg.cellSizeM, mask, { stimp });
      if (!r || !Number.isFinite(r.breakIn) || !Array.isArray(r.pts) ||
          r.pts.length < 2 || !r.pts.every(p => p.every(Number.isFinite))) return null;
      return {
        breakIn: Math.round(r.breakIn * 10) / 10,
        dirDeg: fallAt(ballM),
        stopped: r.stopped,
      };
    };

    const front = summarize(probeOf(-frontD));
    const midBall = probeOf(-Math.min(2, frontD));
    const middle = summarize(midBall);
    const back = summarize(probeOf(backD));
    if (!front || !middle || !back) return null;

    let paceClass = 'true';
    if (stimp >= 12) paceClass = 'firm';
    else if (stimp <= 8) paceClass = 'soft';
    if (middle.stopped === 'edge' || back.stopped === 'edge')
      paceClass = 'firm';
    else if (middle.stopped === 'dead' && front.stopped === 'dead')
      paceClass = 'soft';

    const pinDir = fallAt(pin);
    const brief = {
      lat: centerLL.lat,
      lng: centerLL.lng,
      savedAt: Date.now(),
      stimp,
      calcRevision: CALC_REVISION,
      inputs: inputsFor({ teeLL, polyLL: ring, radiusM }),
      landing: { atPin: { breakIn: middle.breakIn, dirDeg: pinDir,
        paceClass } },
      zones: [
        { id: 'front', breakIn: front.breakIn, dirDeg: front.dirDeg },
        { id: 'middle', breakIn: middle.breakIn, dirDeg: middle.dirDeg },
        { id: 'back', breakIn: back.breakIn, dirDeg: back.dirDeg },
      ],
      // additions beyond the 3D-tool schema:
      slopePct: (() => {
        // Mean slope on the putting surface, not the fetch's padded square.
        let sum = 0, n = 0;
        for (let i = 0; i < field.valid.length; i++) {
          if (!field.valid[i] || (mask && !mask[i])) continue;
          sum += Math.hypot(field.gx[i], field.gy[i]) * 100;
          n++;
        }
        return n ? Math.round((sum / n) * 10) / 10 : null;
      })(),
      highSideDirDeg: pinDir == null ? null : (pinDir + 180) % 360,
      source: 'prep-auto',
    };
    persist(brief);
    return brief;
  }

  window.GreenBriefCore = { build, briefFor, keyFor, matchesBrief, requestKey,
    CALC_REVISION, MAX_AGE_MS };
})();
