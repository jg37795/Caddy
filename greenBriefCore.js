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
  const M_LAT = 111320;
  const mLngAt = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

  function readBriefs() {
    try {
      return JSON.parse(localStorage.getItem(BRIEF_KEY) || '{}');
    } catch (e) { return {}; }
  }

  function keyFor(lat, lng) {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  }

  function briefFor(centerLL) {
    if (!centerLL || !Number.isFinite(centerLL.lat)) return null;
    const b = readBriefs()[keyFor(centerLL.lat, centerLL.lng)] || null;
    return b;
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
    if (!centerLL || !Number.isFinite(centerLL.lat) ||
        !Number.isFinite(centerLL.lng)) return null;
    if (typeof CaddyElev === 'undefined' || typeof GreenMapCore ===
      'undefined') return null;

    // Small square envelope around the GREEN (radius + margin). ~45 m
    // across at 64×64 → ~0.7 m cells — plenty for slope + zone probes.
    const mLat = M_LAT;
    const mLng = mLngAt(centerLL.lat);
    const pad = (radiusM || 18) + 14;
    const bbox = [
      centerLL.lng - pad / mLng, centerLL.lat - pad / mLat,
      centerLL.lng + pad / mLng, centerLL.lat + pad / mLat,
    ];
    let eg = null;
    try {
      eg = await CaddyElev.fetchElevGrid(bbox, 64, null);
    } catch (e) { eg = null; }
    if (!eg || !eg.grid) return null;

    // Centre the grid local frame on the green centre (same convention
    // as greenmap: +x east, +y north, centre cell = green centre).
    const field = GreenMapCore.computeGradientField(
      eg.grid, eg.W, eg.H, eg.cellSizeM,
      (i) => !eg.validMask || !!eg.validMask[i]);

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
    if (polyLL && polyLL.length > 2) {
      // local xy of ring points (grid frame)
      const pts = polyLL.map((p) => [
        (p.lng - centerLL.lng) * mLng,
        (p.lat - centerLL.lat) * mLat,
      ]);
      for (const [x, y] of pts) {
        const p = x * ux + y * uy;
        if (p > backExt) backExt = p;
        if (-p > frontExt) frontExt = -p;
      }
    }
    const fallbackR = radiusM || 18;
    if (frontExt < 1) frontExt = fallbackR;
    if (backExt < 1) backExt = fallbackR;
    const inset = 2;
    const frontD = Math.max(0.6, frontExt - inset);
    const backD = Math.max(0.6, backExt - inset);

    const pin = [0, 0];
    const cellOk = (mx, my) => {
      const ix = Math.round(mx / eg.cellSizeM + eg.W / 2);
      const iy = Math.round(eg.H / 2 - my / eg.cellSizeM);
      if (ix < 0 || iy < 0 || ix >= eg.W || iy >= eg.H) return -1;
      const i = iy * eg.W + ix;
      return (field.valid[i]) ? i : -1;
    };
    const probeOf = (along) => {
      let x = pin[0] + ux * along, y = pin[1] + uy * along;
      if (cellOk(x, y) >= 0) return [x, y];
      for (let t = 0.85; t >= 0.12; t -= 0.15) {
        const sx = pin[0] + ux * along * t;
        const sy = pin[1] + uy * along * t;
        if (cellOk(sx, sy) >= 0) return [sx, sy];
      }
      return null;
    };
    const fallAt = (atM, deg) => {
      // direction of fall at a cell, expressed as compass bearing
      const i = cellOk(atM[0], atM[1]);
      if (i < 0) return deg || 0;
      const gx = field.gx[i], gy = field.gy[i];
      const g = Math.hypot(gx, gy);
      if (g < 1e-6) return deg || 0;
      // v1.21.7 (Grok F16): same sign convention as the 3D arrows —
      // GreenMapCore.fallBearingDeg (downhill in (east, north) = (-gx, +gy);
      // this file's grid frame has +y north, hence the +gy). The old
      // atan2(gx, gy) here was 180°-flipped from the 3D view.
      return Math.round(GreenMapCore.fallBearingDeg(gx, -gy));
    };
    const summarize = (ballM) => {
      if (!ballM) return { breakIn: 0, dirDeg: 0 };
      const r = GreenMapCore.simPuttPath(
        ballM, pin, field, eg.W, eg.H, eg.cellSizeM, null, { stimp });
      const br = Number.isFinite(r.breakIn) ? r.breakIn : 0;
      return {
        breakIn: Math.round(br * 10) / 10,
        dirDeg: fallAt(ballM, 0),
        stopped: r.stopped,
      };
    };

    const front = summarize(probeOf(-frontD));
    const midBall = probeOf(-Math.min(2, frontD));
    const middle = summarize(midBall);
    const back = summarize(probeOf(backD));

    let paceClass = 'true';
    if (stimp >= 12) paceClass = 'firm';
    else if (stimp <= 8) paceClass = 'soft';
    if (middle.stopped === 'edge' || back.stopped === 'edge')
      paceClass = 'firm';
    else if (middle.stopped === 'dead' && front.stopped === 'dead')
      paceClass = 'soft';

    const pinDir = fallAt(pin, middle.dirDeg);
    const brief = {
      lat: centerLL.lat,
      lng: centerLL.lng,
      savedAt: Date.now(),
      stimp,
      landing: { atPin: { breakIn: middle.breakIn, dirDeg: pinDir,
        paceClass } },
      zones: [
        { id: 'front', breakIn: front.breakIn, dirDeg: front.dirDeg },
        { id: 'middle', breakIn: middle.breakIn, dirDeg: middle.dirDeg },
        { id: 'back', breakIn: back.breakIn, dirDeg: back.dirDeg },
      ],
      // additions beyond the 3D-tool schema:
      slopePct: (() => {
        // mean slope over valid cells (same definition as slopePctAt)
        let sum = 0, n = 0;
        for (let i = 0; i < field.valid.length; i++) {
          if (!field.valid[i]) continue;
          sum += Math.hypot(field.gx[i], field.gy[i]) * 100;
          n++;
        }
        return n ? Math.round((sum / n) * 10) / 10 : null;
      })(),
      highSideDirDeg: fallAt(pin, 0) || null,
      source: 'prep-auto',
    };
    persist(brief);
    return brief;
  }

  window.GreenBriefCore = { build, briefFor, keyFor };
})();
