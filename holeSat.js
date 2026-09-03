/* ==========================================================================
   holeSat.js — Tap-the-hole-map satellite sheet (Prep)
   --------------------------------------------------------------------------
   v1.16.0 (James: "tap the hole map would bring up a satellite view of
   the hole, kind of like check location, but it would look similar to
   the play tab").

   A full-screen sheet with a satellite Leaflet map centred on the hole,
   styled like the Play tab (dark glass header, colored overlays):
     • the real OSM hole path (green ribbon, like the Prep cartoon)
     • landing dots per plan club (bag colors)
     • the green outline (bright green fill)
     • hazards (bunker tan / water blue markers)
     • tee marker + flag
   Header: ‹ Done + title "Hole N — satellite". Tap anywhere to close
   via Done (no editing — this is read-only reconnaissance).

   Boot: window.PrepHoleSat.open({ courseId, hole }) from prep.js.
   Self-contained; deletes cleanly.
   ========================================================================== */

(() => {
  'use strict';

  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const OUTLINE_KEY = 'caddy:greenOutline:v1';

  let sheet = null;
  let teeArmed = false;   // v1.17.1: two-tap tee placement state
  let teeMarker = null;   // the current tee marker layer
  let lastFocus = null;   // v1.21.6: restore focus on close

  function bootValues(opts) {
    return {
      lat: opts.greenLatLng ? opts.greenLatLng.lat : null,
      lng: opts.greenLatLng ? opts.greenLatLng.lng : null,
      courseId: opts.courseId || null,
      hole: opts.hole || null,
    };
  }

  // v1.17.1: the caller passes holeData directly; the localStorage
  // re-read is gone (it was the flaky first-tap/second-tap source).

  function openEditor(opts) {
    if (sheet) return;
    const boot = bootValues(opts);
    if (boot.lat == null) return;
    // v1.17.1 (James: first tap dots-only, second tap ribbon): the sheet
    // no longer re-reads the course from localStorage by id — the caller
    // passes the hole's real geometry. Direct payload, always.
    const hole = opts.holeData || {};
    boot.courseId = opts.courseId || null;
    boot.hole = opts.hole || null;
    // v1.21.6: the tee marker/3D-Green link follows any in-session tee move —
    // a second open of the sheet must not act on the caller's stale snapshot.
    if (hole.teePoint) {
      try {
        const profiles = JSON.parse(
          localStorage.getItem('caddy:courseProfiles:v1') || '[]');
        const c = profiles.find((p) => p && p.id === boot.courseId);
        const h = c && Array.isArray(c.holes) ? c.holes[boot.hole - 1] : null;
        if (h && h.teePoint && Number.isFinite(h.teePoint.lat)) {
          hole.teePoint = h.teePoint;
        }
        // v1.21.7 (Grok F9 follow-through): same freshness for the green
        // ring — a remap that landed a better outline must win over the
        // caller's snapshot on every sheet open.
        if (h && Array.isArray(h.greenRingPts) && h.greenRingPts.length >= 3) {
          hole.greenRingPts = h.greenRingPts;
        }
      } catch (e) { /* best-effort fresh tee */ }
    }

    sheet = document.createElement('div');
    sheet.id = 'prep-sat-sheet';
    // v1.21.6: real dialog semantics — modal, labeled, Escape closes,
    // focus moves in on open and back to the cartoon on close.
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label',
      `Hole ${boot.hole || ''} satellite view`);
    // v1.17.0 premium pass: a stats strip under the header (distance /
    // par / elevation), halo ribbon, labeled landing dots, styled pills.
    const meta = [];
    if (hole.par) meta.push(`Par ${hole.par}`);
    if (hole.yards) meta.push(`${Math.round(hole.yards)} yd`);
    sheet.innerHTML =
      '<div class="psh-head">' +
      '  <button class="psh-btn" id="pshDone">‹ Done</button>' +
      `  <div class="psh-title">Hole ${boot.hole || '—'} — satellite</div>` +
      '  <span class="psh-btn psh-spacer"></span>' +
      '</div>' +
      (meta.length
        ? `<div class="psh-stats">${meta.map((m) =>
            `<span>${m}</span>`).join('<i>·</i>')}</div>` : '') +
      '<div class="psh-map" id="pshMap"></div>' +
      // v1.17.1: tap-to-place tee banner (hidden until Move tee armed).
      '<div class="psh-tee-banner" id="pshTeeBanner" role="status" aria-live="polite" hidden>Tap your tee box on the map · <button type="button" class="psh-tee-cancel" id="pshTeeCancel">Cancel</button></div>' +
      // v1.16.1: Move tee + 3D Green live HERE (James) — the card's
      // buttons are gone; the sheet is where hole actions happen.
      // v1.17.1: Move tee = in-sheet two-tap placement (no navigation);
      // 3D Green keeps its (working) deep-link.
      '<div class="psh-actions">' +
      `  <button class="psh-act" id="pshMoveTee" aria-pressed="false">✛ Move tee</button>` +
      `  <button class="psh-act psh-act-primary" id="psh3d">⛳ 3D Green</button>` +
      '</div>' +
      // v1.21.9: Auto / OSM outline overlays on the satellite sheet so
      // James can see (and compare) both rings on the imagery.
      '<div class="psh-actions" id="pshOutlineRow">' +
      '  <button class="psh-act" id="pshAutoOutline" aria-pressed="false">Auto outline</button>' +
      '  <button class="psh-act" id="pshOsmOutline" aria-pressed="false">OSM outline</button>' +
      '  <span id="pshOutlineChip" style="flex:none;align-self:center;font-size:11px;font-weight:800;color:#9db3a6;white-space:nowrap">outline: stored</span>' +
      '</div>' +
      '<div class="psh-tee-banner" id="pshOutlineBanner" role="status" aria-live="polite" hidden></div>' +
      '<div class="psh-hint">Your hole on the ground — fairway ribbon, landing spots, green & hazards (OSM)</div>';

    document.body.appendChild(sheet);
    lastFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const pshDoneBtn = sheet.querySelector('#pshDone');
    if (pshDoneBtn) pshDoneBtn.focus();
    sheet.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeSheet();
    });

    // Same layout contract as greenedit: the sheet must be in the DOM AND
    // laid out before L.map measures it (0x0 container = dead map).
    requestAnimationFrame(() => {
      const m = window.__pshMap;
      if (m) m.invalidateSize();
    });

    const map = L.map('pshMap', {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 21,
    }).setView([boot.lat, boot.lng], 17);
    window.__pshMap = map;
    L.tileLayer(TILES, { attribution: '', maxZoom: 21 })
      .addTo(map);

    // v1.16.1/v1.17.0 (James: "the hole doesn't center when I open that
    // satellite view"): the original fit ran while the map container was
    // still 0-height → fitBounds computed a degenerate viewport. Fit
    // AFTER layout settles (double rAF), from the hole's full geometry.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = L.latLngBounds([]);
      let any = false;
      (Array.isArray(hole.pathPts) ? hole.pathPts : []).forEach((p) => {
        if (Number.isFinite(p.lat)) { b.extend([p.lat, p.lng]); any = true; }
      });
      if (hole.greenCenter && Number.isFinite(hole.greenCenter.lat)) {
        b.extend([hole.greenCenter.lat, hole.greenCenter.lng]); any = true;
      }
      if (hole.teePoint && Number.isFinite(hole.teePoint.lat)) {
        b.extend([hole.teePoint.lat, hole.teePoint.lng]); any = true;
      }
      if (any) map.fitBounds(b, { padding: [56, 56] });
      map.invalidateSize();
    }));

    const dpr = window.devicePixelRatio || 1;

    // --- overlays from the STORED course (instant, offline-friendly) ---
    // v1.19.0 (James: draw OSM's real shapes here too): fairway/rough/
    // water/tee polygons first (under the ribbon), then the ribbon.
    {
      const S = hole.shapes || {};
      const poly = (rings, style) => {
        (Array.isArray(rings) ? rings : []).forEach((ring) => {
          if (!Array.isArray(ring) || ring.length < 3) return;
          L.polygon(ring.map((p) => [p.lat, p.lng]), style).addTo(map);
        });
      };
      poly(S.rough, { color: 'rgba(0,0,0,0)', weight: 0,
        fillColor: 'rgba(38,66,48,0.35)', fillOpacity: 1,
        interactive: false });
      poly(S.fairways, { color: 'rgba(122,232,160,0.35)', weight: 1,
        fillColor: 'rgba(64,152,99,0.42)', fillOpacity: 1,
        interactive: false });
      poly(S.water, { color: 'rgba(126,200,255,0.5)', weight: 1,
        fillColor: 'rgba(58,143,212,0.45)', fillOpacity: 1,
        interactive: false });
      poly(S.tees, { color: 'rgba(200,240,205,0.4)', weight: 1,
        fillColor: 'rgba(130,190,140,0.4)', fillOpacity: 1,
        interactive: false });
      // real bunker outlines
      poly(S.bunkers, { color: 'rgba(255,209,102,0.75)', weight: 1.2,
        fillColor: 'rgba(196,138,18,0.55)', fillOpacity: 1,
        interactive: false });
    }
    // Fairway band: REMOVED (v1.21.3, James: "get rid of the thick green
    // band that's on the shot lines"). The hole's real fairway/rough
    // polygons above + the thin centre line below carry the shape.
    if (false) {
      void 0;
    }

    // Green outline: stored ring or the local traced outline.
    let ring = Array.isArray(hole.greenRingPts)
      ? hole.greenRingPts.map((p) => [p.lat, p.lng]) : null;
    if (!ring) {
      try {
        const store = JSON.parse(
          localStorage.getItem(OUTLINE_KEY) || '{}');
        // v1.21.7 (Grok F9): trace store contract is {lat,lng,vertices} —
        // keyed at 3 decimals (~111 m cells). The old lookup demanded a
        // 4-decimal "lat,lng" key and a .pts field, so a trace James drew
        // NEVER appeared on the sheet. Reuse greenmap's 100 m nearest scan.
        let best = null, bestD = Infinity;
        for (const k of Object.keys(store)) {
          const o = store[k];
          if (!o || !Array.isArray(o.vertices) || o.vertices.length < 3)
            continue;
          const d = Math.hypot(
            (o.lat - boot.lat) * 111320,
            (o.lng - boot.lng) * 111320 * Math.cos(boot.lat * Math.PI / 180));
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best && bestD < 100) ring = best.vertices;
      } catch (e) { /* no traced outline */ }
    }
    if (ring && ring.length >= 3) {
      L.polygon(ring, {
        color: '#7dff9b', weight: 2, fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
      // v1.18.0: green tint from the (auto-built) green brief — the high
      // side half is brighter, the feed side dimmed. Read via briefFor
      // (sync); if the brief isn't built yet the ring stays neutral and
      // the invisible pipeline fills it in for next time.
      try {
        const brief = typeof window.GreenBriefCore !== 'undefined'
          ? window.GreenBriefCore.briefFor({ lat: boot.lat, lng: boot.lng })
          : null;
        if (brief && Array.isArray(brief.zones) &&
            Number.isFinite(brief.zones[1] && brief.zones[1].breakIn)) {
          const brg = Number.isFinite(brief.highSideDirDeg)
            ? brief.highSideDirDeg
            : (Number.isFinite(brief.zones[1].dirDeg)
              ? (brief.zones[1].dirDeg + 180) % 360 : null);
          if (Number.isFinite(brg)) {
            // split the ring into the high half vs feed half relative to
            // the green centre and draw two tinted polygons.
            const cx = boot.lng, cy = boot.lat;
            const hi = [], lo = [];
            ring.forEach((pt) => {
              const de = (pt[1] - cx) * 111320 * Math.cos(cy * Math.PI / 180);
              const dn = (pt[0] - cy) * 111320;
              const ang = (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
              const rel = ((ang - brg) + 360) % 360;
              (rel <= 180 ? hi : lo).push(pt);
            });
            if (hi.length >= 3) L.polygon(hi, {
              color: 'rgba(125,255,155,0.0)', weight: 0,
              fillColor: 'rgba(125,255,155,0.28)', interactive: false,
            }).addTo(map);
            if (lo.length >= 3) L.polygon(lo, {
              color: 'rgba(125,255,155,0.0)', weight: 0,
              fillColor: 'rgba(125,255,155,0.08)', interactive: false,
            }).addTo(map);
          }
        }
      } catch (e) { /* tint is garnish */ }
    }

      // v1.17.1: tee marker tracked so Move-tee can move it in place.
      if (hole.teePoint) {
        teeMarker = L.circleMarker([hole.teePoint.lat, hole.teePoint.lng], {
          radius: 6, color: '#fff', weight: 2,
          fillColor: '#fff', fillOpacity: 0.9, interactive: false,
        }).addTo(map);
      }
    if (hole.greenCenter) {
      L.marker([hole.greenCenter.lat, hole.greenCenter.lng], {
        interactive: false,
        icon: L.divIcon({ className: 'psh-flag',
          html: '<div class="psh-flag-pill">⚑</div>', iconSize: null }),
      }).addTo(map);
    }

    // Hazards stored per hole (bunker tan / water blue).
    (Array.isArray(hole.hazards) ? hole.hazards : []).forEach((hz) => {
      if (!hz || !Number.isFinite(hz.lat)) return;
      L.circleMarker([hz.lat, hz.lng], {
        radius: 5,
        color: hz.type === 'water' ? '#7ec8ff' : '#ffd166',
        weight: 1.5,
        fillColor: hz.type === 'water' ? '#3a8fd4' : '#c48a12',
        fillOpacity: 0.85, interactive: false,
      }).addTo(map);
    });

    // Landing dots from the live plan (bag-colored, matching the cartoon).
    // v1.17.0 premium pass: white halo + a club/yardage label beside each
    // dot so the map reads without the card.
    // v1.18.0: DISPERSION ELLIPSES — 1σ along/cross per club (shot-log
    // posterior or prior), rotated to the shot bearing, in the club's
    // color. Plus the target LINE tying tee → landings → green.
    try {
      const plan = window.__prepPlanLanding || [];
      // target line: tee → each landing → green centre
      const lineLL = [];
      if (hole.teePoint) lineLL.push([hole.teePoint.lat, hole.teePoint.lng]);
      plan.forEach((p) => {
        if (p && Number.isFinite(p.lat)) lineLL.push([p.lat, p.lng]);
      });
      if (hole.greenCenter) {
        lineLL.push([hole.greenCenter.lat, hole.greenCenter.lng]);
      }
      if (lineLL.length >= 2) {
        L.polyline(lineLL, {
          color: 'rgba(255,255,255,0.55)', weight: 2, dashArray: '2 7',
          interactive: false,
        }).addTo(map);
      }
      plan.forEach((p) => {
        if (!p || !Number.isFinite(p.lat)) return;
        // dispersion ellipse first (under the dot)
        if (Number.isFinite(p.sigAlongYd) && p.sigAlongYd > 1 &&
            Number.isFinite(p.bearingDeg)) {
          const aM = p.sigAlongYd * 0.9144;
          const bM = Math.max(2, Number.isFinite(p.sigCrossYd)
            ? p.sigCrossYd : p.sigAlongYd * 0.55) * 0.9144;
          const sinB = Math.sin(p.bearingDeg * Math.PI / 180);
          const cosB = Math.cos(p.bearingDeg * Math.PI / 180);
          const pts = [];
          for (let t = 0; t < 48; t++) {
            const th = 2 * Math.PI * t / 48;
            const a = Math.cos(th) * aM, b = Math.sin(th) * bM;
            const e = a * sinB - b * cosB;
            const n = a * cosB + b * sinB;
            pts.push([
              p.lat + n / 111320,
              p.lng + e / (111320 * Math.cos(p.lat * Math.PI / 180)),
            ]);
          }
          L.polygon(pts, {
            color: p.hex || '#5ea8ff', weight: 1.6, opacity: 0.9,
            fillColor: p.hex || '#5ea8ff', fillOpacity: 0.13,
            interactive: false,
          }).addTo(map);
        }
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color: 'rgba(255,255,255,0.95)', weight: 2,
          fillColor: p.hex || '#5ea8ff', fillOpacity: 0.95,
          interactive: false,
        }).addTo(map);
        if (p.label) {
          L.marker([p.lat, p.lng], {
            interactive: false,
            icon: L.divIcon({ className: 'psh-land-tag',
              html: `<div class="psh-land-pill">${p.label}${p.yd ? ` · ${p.yd} yd` : ''}</div>`,
              iconSize: null }),
          }).addTo(map);
        }
      });
    } catch (e) { /* plan dots are garnish */ }

    // v1.21.3 (James: "I don't want the other hole features"): the live
    // Overpass context fetch (neighbouring greens + hole lines) is GONE.
    // The sheet draws ONLY this hole's stored payload: its assigned
    // shapes, path, green, tee, hazards, landing dots.

    // v1.21.9: Auto / OSM outline overlays on the satellite imagery.
    // Stored ring stays default-visible; these two extra layers toggle.
    const ov = { osmOn: false, autoOn: false, osmLayer: null, autoLayer: null };
    const showBanner = (html, ms) => {
      const bar = document.getElementById('pshOutlineBanner');
      if (!bar) return;
      bar.innerHTML = html;
      bar.hidden = false;
      if (ms) setTimeout(() => { if (bar.innerHTML === html) bar.hidden = true; }, ms);
    };
    const syncChip = () => {
      const chip = document.getElementById('pshOutlineChip');
      if (!chip) return;
      const bits = ['stored'];
      if (ov.osmOn) bits.push('OSM');
      if (ov.autoOn) bits.push('Auto');
      chip.textContent = 'outline: ' + bits.join(' + ');
      chip.style.color = (ov.osmOn && ov.autoOn) ? '#ffd166' : '#9db3a6';
      const autoBtn = document.getElementById('pshAutoOutline');
      const osmBtn = document.getElementById('pshOsmOutline');
      if (autoBtn) {
        autoBtn.setAttribute('aria-pressed', ov.autoOn ? 'true' : 'false');
        autoBtn.classList.toggle('armed', ov.autoOn);
      }
      if (osmBtn) {
        osmBtn.setAttribute('aria-pressed', ov.osmOn ? 'true' : 'false');
        osmBtn.classList.toggle('armed', ov.osmOn);
      }
      if (ov.osmOn && ov.autoOn) {
        showBanner('<span class="psh-tee-ok">OSM #7dff9b · Auto #ffd166</span>');
      }
    };
    const drawRing = (ll, color) => {
      if (!ll || ll.length < 3) return null;
      return L.polygon(ll, {
        color, weight: 2.6, fillOpacity: 0, interactive: false,
        className: color === '#ffd166' ? 'psh-ov-auto' : 'psh-ov-osm',
      }).addTo(map);
    };
    const loadScriptOnce = (src) => new Promise((resolve, reject) => {
      if (typeof document === 'undefined') { resolve(); return; }
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load ' + src));
      document.head.appendChild(s);
    });
    const fetchOsmRing = async () => {
      const lat = boot.lat, lng = boot.lng;
      const q = `[out:json][timeout:15];(way["golf"="green"](around:120,${lat},${lng}););out geom;`;
      const res = await fetch(
        'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('overpass ' + res.status);
      const data = await res.json();
      let best = null, bestD = Infinity;
      for (const el of (data.elements || [])) {
        if (!el || !el.geometry || !el.geometry.length) continue;
        let cLat = 0, cLng = 0;
        for (const p of el.geometry) { cLat += p.lat; cLng += p.lon; }
        cLat /= el.geometry.length; cLng /= el.geometry.length;
        const d = Math.hypot(
          (cLat - lat) * 111320,
          (cLng - lng) * 111320 * Math.cos(lat * Math.PI / 180));
        if (d < bestD) { bestD = d; best = el; }
      }
      if (!best || bestD > 120) return null;
      return best.geometry.map((g) => [g.lat, g.lon]);
    };
    const detectAutoRing = async () => {
      if (!(window.GreenDetect && typeof window.GreenDetect.detect === 'function')) {
        try { await loadScriptOnce('./green-detect.js'); } catch (e) { /* offline */ }
      }
      if (!(window.GreenDetect && typeof window.GreenDetect.detect === 'function'))
        return { fail: 'no-detect' };
      if (!(window.CaddyElev && typeof window.CaddyElev.fetchElevGrid === 'function'))
        return { fail: 'no-elev' };
      const lat = boot.lat, lng = boot.lng;
      const spanM = 90, N = 64;
      const halfLat = (spanM / 2) / 111320;
      const halfLng = (spanM / 2) / (111320 * Math.cos(lat * Math.PI / 180));
      const bbox = [lng - halfLng, lat - halfLat, lng + halfLng, lat + halfLat];
      const elev = await window.CaddyElev.fetchElevGrid(bbox, N);
      if (!elev || !elev.grid) return { fail: 'no-grid' };
      const g2 = elev.grid, W = elev.W, H = elev.H, cs = elev.cellSizeM;
      const N2 = W * H;
      const idx2 = (x, y) => y * W + x;
      const val2 = (x, y) => (x >= 0 && y >= 0 && x < W && y < H &&
        Number.isFinite(g2[idx2(x, y)])) ? g2[idx2(x, y)] : null;
      const sl2 = new Float64Array(N2).fill(NaN);
      const s32 = new Float64Array(N2).fill(NaN);
      const t52 = new Float64Array(N2).fill(NaN);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = idx2(x, y);
          const zc = val2(x, y); if (zc === null) continue;
          const zx1 = val2(x + 1, y), zx0 = val2(x - 1, y);
          const zy1 = val2(x, y + 1), zy0 = val2(x, y - 1);
          if (zx1 !== null && zx0 !== null && zy1 !== null && zy0 !== null)
            sl2[i] = Math.hypot(zx1 - zx0, zy1 - zy0) / (2 * cs) * 100;
          let sA = 0, nA = 0, vA = [];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const v = val2(x + dx, y + dy);
              if (v !== null) { sA += v; nA++; vA.push(v); }
            }
          if (nA >= 5) {
            const m = sA / nA;
            s32[i] = Math.sqrt(vA.reduce((a, v) => a + (v - m) * (v - m), 0) / nA);
          }
          let nB = 0, vB = [];
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const sv = sl2[idx2(Math.min(W - 1, Math.max(0, x + dx)),
                Math.min(H - 1, Math.max(0, y + dy)))];
              if (Number.isFinite(sv)) { nB++; vB.push(sv); }
            }
          if (nB >= 12) {
            const m = vB.reduce((a, v) => a + v, 0) / nB;
            t52[i] = Math.sqrt(vB.reduce((a, v) => a + (v - m) * (v - m), 0) / nB);
          }
        }
      const detectRes = window.GreenDetect.detect({
        grid: {
          W, H, cellSizeM: cs, z: g2, slope: sl2, smooth3: s32, tex5: t52,
          exg: new Float64Array(N2).fill(NaN),
          bright: new Float64Array(N2).fill(NaN)
        },
        satSample: () => null
      });
      if (!detectRes || detectRes.confidence < 0.6 || !detectRes.poly)
        return { fail: 'low-conf', conf: detectRes && detectRes.confidence };
      const mLat = 111320;
      const mLng = 111320 * Math.cos(lat * Math.PI / 180);
      const ll = detectRes.poly.map(([mx, my]) => [
        lat + my / mLat, lng + mx / mLng
      ]);
      return { ll, conf: detectRes.confidence };
    };

    const autoBtn = sheet.querySelector('#pshAutoOutline');
    if (autoBtn) autoBtn.addEventListener('click', async () => {
      if (ov.autoOn) {
        if (ov.autoLayer) { map.removeLayer(ov.autoLayer); ov.autoLayer = null; }
        ov.autoOn = false;
        syncChip();
        return;
      }
      showBanner('Detecting Auto outline…');
      let res = null;
      try { res = await detectAutoRing(); }
      catch (e) { res = { fail: 'err' }; }
      if (!res || res.fail || !res.ll) {
        showBanner(
          '<span class="psh-tee-warn">Auto outline not confident here — try OSM</span>',
          3200);
        return;
      }
      ov.autoLayer = drawRing(res.ll, '#ffd166');
      ov.autoOn = true;
      syncChip();
    });
    const osmBtn = sheet.querySelector('#pshOsmOutline');
    if (osmBtn) osmBtn.addEventListener('click', async () => {
      if (ov.osmOn) {
        if (ov.osmLayer) { map.removeLayer(ov.osmLayer); ov.osmLayer = null; }
        ov.osmOn = false;
        syncChip();
        return;
      }
      showBanner('Fetching OSM outline…');
      let ll = null;
      try { ll = await fetchOsmRing(); }
      catch (e) { ll = null; }
      if (!ll) {
        showBanner(
          '<span class="psh-tee-warn">No OSM green near this pin</span>', 3200);
        return;
      }
      ov.osmLayer = drawRing(ll, '#7dff9b');
      ov.osmOn = true;
      syncChip();
    });
    window.__pshOutline = ov;

    function closeSheet() {
      map.remove();
      sheet.remove();
      sheet = null;
      window.__pshMap = null;
      if (lastFocus) { try { lastFocus.focus(); } catch { } }
      lastFocus = null;
    }
    sheet.querySelector('#pshDone').addEventListener('click', closeSheet);

    // v1.17.1 (James: "the move tee button kicks me out… opens the verify
    // green location screen… back takes me to the 3d green"): Move tee no
    // longer navigates at all — tap-to-place ON THE SHEET, two-tap
    // contract (same as Round/greenedit): arm → tap the map → the tee
    // marker moves there and saves to the course profile. Cancel link in
    // the banner. Saving goes through the same per-course profile the
    // editor used, so Prep/cartoon/numbers pick it up on the next bind.
    sheet.querySelector('#pshMoveTee').addEventListener('click', () => {
      if (teeArmed) { disarmTee(); return; }
      teeArmed = true;
      const bar = document.getElementById('pshTeeBanner');
      if (bar) bar.hidden = false;
      sheet.querySelector('#pshMoveTee').classList.add('armed');
      sheet.querySelector('#pshMoveTee').setAttribute('aria-pressed', 'true');
    });
    sheet.querySelector('#pshTeeCancel').addEventListener('click',
      disarmTee);

    // v1.17.1: 3D Green keeps its deep-link (the 3D tool is a separate
    // page; this worked before and James only flagged the TEE flow).
    // v1.21.6: navigation goes through a testable seam; jsdom Location is
    // frozen, so the harness can swap this instead of location.assign.
    sheet.querySelector('#psh3d').addEventListener('click', () => {
      const u = new URLSearchParams();
      if (boot.lat != null) {
        u.set('lat', boot.lat.toFixed(6));
        u.set('lng', boot.lng.toFixed(6));
      }
      if (hole.teePoint) {
        u.set('teelat', hole.teePoint.lat.toFixed(6));
        u.set('teelng', hole.teePoint.lng.toFixed(6));
      }
      if (boot.courseId) u.set('course', boot.courseId);
      if (boot.hole) u.set('hole', String(boot.hole));
      const target = 'greenmap.html?' + u.toString();
      if (typeof window.__pshNavigate === 'function') window.__pshNavigate(target);
      else location.assign(target);
    });

    map.on('click', (e) => {
      if (!teeArmed) return;
      const lat = e.latlng.lat, lng = e.latlng.lng;
      disarmTee();
      // move the marker immediately
      if (teeMarker) { map.removeLayer(teeMarker); teeMarker = null; }
      teeMarker = L.circleMarker([lat, lng], {
        radius: 6, color: '#fff', weight: 2,
        fillColor: '#fff', fillOpacity: 0.9, interactive: false,
      }).addTo(map);
      // Persist through app.js so its in-memory course and localStorage stay
      // identical. Direct localStorage-only writes reopen stale geometry until
      // the whole app reloads. v1.21.6: failures are HONEST — no "Tee saved"
      // banner when nothing persisted.
      let saved = null;
      try {
        const saveHole = window.CaddyPrep &&
          window.CaddyPrep.updateSavedCourseHole;
        saved = typeof saveHole === 'function'
          ? saveHole(boot.courseId, boot.hole, {
              teePoint: { lat, lng },
              teeSource: 'manual',
            })
          : null;
      } catch (err) { saved = null; }
      const done = document.getElementById('pshTeeBanner');
      if (done) {
        if (saved) {
          let live = false;
          try {
            live = typeof window.__prepRebind === 'function' &&
              window.__prepRebind(boot.hole, { teePoint: { lat, lng } });
          } catch (e2) { live = false; }
          done.innerHTML =
            `<span class="psh-tee-ok">✓ Tee saved${live ? ' — Prep updated' : ''}</span>`;
        } else {
          done.innerHTML =
            '<span class="psh-tee-warn">Tee not saved — save this course first, then move the tee</span>';
        }
        done.hidden = false;
        setTimeout(() => { done.hidden = true; }, 3200);
      }
    });
  }

  function disarmTee() {
    teeArmed = false;
    if (!sheet) return;
    const bar = document.getElementById('pshTeeBanner');
    if (bar) bar.hidden = true;
    const btn = sheet.querySelector('#pshMoveTee');
    if (btn) btn.classList.remove('armed');
    if (btn) btn.setAttribute('aria-pressed', 'false');
  }

  function mount() {
    // Prep calls window.PrepHoleSat.open(...) on map tap; nothing to
    // auto-mount (the cartoon is the tap target).
  }

  window.PrepHoleSat = { open: openEditor };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
