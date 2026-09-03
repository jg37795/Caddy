/* ==========================================================================
   greenedit.js — Verify/Edit green location (map-based, no coordinates)
   --------------------------------------------------------------------------
   James's rule: the tool must integrate like a product. 'Edit loc' opens a
   full-screen mini-map:
     • centre crosshair = where the tool will sample
     • the REAL OSM green outline(s) drawn around it (Overpass, 60 m radius)
       — see the actual greens before you commit
     • tap the map to move the sample point; 'Load this green' re-boots the
       tool at the crosshair
     • satellite tiles so it's recognisable on the ground
   No coordinates typed anywhere. Self-contained; deletes cleanly.
   ========================================================================== */

(() => {
  'use strict';

  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  let sheet = null;

  function bootValues() {
    // Read the SAME params the tool booted from (document reflects state).
    const qs = new URLSearchParams(location.search);
    return {
      lat: parseFloat(qs.get('lat')) || 41.91314,
      lng: parseFloat(qs.get('lng')) || -93.60971,
      tee: (Number.isFinite(parseFloat(qs.get('teelat'))) &&
            Number.isFinite(parseFloat(qs.get('teelng'))))
        ? { lat: parseFloat(qs.get('teelat')), lng: parseFloat(qs.get('teelng')) }
        : null,
    };
  }

  function overpassQ(lat, lng, radius) {
    // v1.2.5: greens + hole lines (for "which hole is this?" labels).
    return `[out:json][timeout:15];(way["golf"="green"](around:${radius},${lat},${lng});way["golf"="hole"](around:${radius},${lat},${lng}););out geom;`;
  }

  function openEditor() {
    if (sheet) return;
    const boot = bootValues();

    sheet = document.createElement('div');
    sheet.id = 'gm-editloc-sheet';
    sheet.innerHTML =
      '<div class="gel-head">' +
      '  <button class="gel-btn" id="gelCancel">‹ Cancel</button>' +
      '  <div class="gel-title">Verify green location</div>' +
      '  <button class="gel-btn" id="gelTee">Move tee</button>' +
      '  <button class="gel-btn" id="gelLoad">Load this green</button>' +
      '</div>' +
      '<div class="gel-outline-row" id="gelOutlineRow">' +
      '  <button class="gel-btn" id="gelAutoOutline" aria-pressed="false">Auto outline</button>' +
      '  <button class="gel-btn" id="gelOsmOutline" aria-pressed="false">OSM outline</button>' +
      '  <button class="gel-btn" id="gelUseOutline" aria-disabled="true" ' +
      '    title="Keep the previewed outline for this green">Use this outline</button>' +
      '</div>' +
      '<div class="gel-map" id="gelMap"></div>' +
      '<div class="gel-hint">Tap to move the sample point · green outlines are the real mapped greens (OSM)</div>';

    document.body.appendChild(sheet);

    // v-fix(gel-dead-buttons): the sheet must be in the DOM AND laid out
    // before L.map measures it — created in the same tick, Leaflet got a
    // 0x0 container (controls dead, taps dead). Invalidate after layout.
    requestAnimationFrame(() => {
      const m = window.__gelMap;
      if (m) m.invalidateSize();
    });

    const map = L.map('gelMap', {
      zoomControl: false,
      attributionControl: false,   // hidden while testing (James)
      maxZoom: 21,                 // v1.3.2: 19 capped the zoom hard on
                                   // iPhone (tiles upscale past 19 — fine)
      minZoom: 15,
    }).setView(
      [boot.lat, boot.lng], 17);
    window.__gelMap = map;
    L.tileLayer(TILES, { attribution: '', maxZoom: 21,
      maxNativeZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Crosshair = sample point (draggable marker + centre tick).
    const pin = L.marker([boot.lat, boot.lng], {
      draggable: true,
      icon: L.divIcon({ className: 'gel-pin',
        html: '<div class="gel-pin-dot"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(map);

    // v1.12.0 (editable tee — James: "allow the user to edit the tee just
    // like we allow when a round is active"): the tee is now a movable
    // marker with a two-tap contract identical to Round's Set tee:
    //   "Move tee" arms tee mode → tap the map to place it → tapping the
    //   tee itself removes it. "Load this green" re-boots with BOTH the
    //   green AND the tee. Persisted to the course profile (per hole) so
    //   Prep, Round and hole view all agree.
    let teeLL = boot.tee;          // current tee (null = not set)
    let teeMode = false;           // armed by "Move tee"
    // v1.21.9 re-scope (James): Auto / OSM outline preview on Check
    // location. One at a time; tapping the map re-anchors at the pin.
    // Preview only — Load this green still re-boots greenmap's ladder.
    // v1.23.0: "Use this outline" SAVES the previewed ring into the
    // OutlineStore (chosen + locked); high-bar auto detects auto-save.
    let gelOutlineMode = null;     // null | 'auto' | 'osm'
    let gelOutlineLayer = null;
    let gelOutlineHint = '';
    let gelOutlineGen = 0;
    let gelPreviewRingLL = null;   // the ring on screen, [[lat,lng],...]
    const OS = window.OutlineStore || null;
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
    const hintEl = () => sheet.querySelector('.gel-hint');
    const sampleHint = (ll) =>
      `Sample point: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} — tap the map to move it, then “Load this green”`;
    const syncOutlineBtns = () => {
      const autoBtn = sheet.querySelector('#gelAutoOutline');
      const osmBtn = sheet.querySelector('#gelOsmOutline');
      const useBtn = sheet.querySelector('#gelUseOutline');
      if (autoBtn) {
        const on = gelOutlineMode === 'auto';
        autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        autoBtn.classList.toggle('gel-active', on);
      }
      if (osmBtn) {
        const on = gelOutlineMode === 'osm';
        osmBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        osmBtn.classList.toggle('gel-active', on);
      }
      // v1.23.0: "Use this outline" is enabled ONLY while a preview ring
      // is on screen (Auto or OSM — whichever mode produced it).
      if (useBtn) {
        const on = !!(gelOutlineMode && gelPreviewRingLL);
        useBtn.setAttribute('aria-disabled', on ? 'false' : 'true');
        useBtn.classList.toggle('gel-active', false);
        useBtn.classList.toggle('gel-disabled', !on);
      }
    };
    const setOutlineHint = (text) => {
      gelOutlineHint = text || '';
      if (teeMode) return;
      const el = hintEl();
      if (!el) return;
      el.textContent = gelOutlineHint || sampleHint(pin.getLatLng());
    };
    const drawPreviewRing = (ll, color) => {
      if (!ll || ll.length < 3) return;
      if (gelOutlineLayer) { map.removeLayer(gelOutlineLayer); gelOutlineLayer = null; }
      gelOutlineLayer = L.polygon(ll, {
        color, weight: 3, fillOpacity: 0, interactive: false,
      }).addTo(map);
      gelPreviewRingLL = ll;
      syncOutlineBtns();
    };
    const fetchNearestOsm = async (lat, lng) => {
      const res = await fetch(OVERPASS + '?data=' +
        encodeURIComponent(overpassQ(lat, lng, 120)));
      if (!res.ok) throw new Error('overpass ' + res.status);
      const data = await res.json();
      let best = null, bestD = Infinity;
      for (const el of (data.elements || [])) {
        if (!el || !el.tags || el.tags.golf !== 'green') continue;
        if (!el.geometry || !el.geometry.length) continue;
        let cLat = 0, cLng = 0;
        for (const p of el.geometry) { cLat += p.lat; cLng += p.lon; }
        cLat /= el.geometry.length; cLng /= el.geometry.length;
        const d = Math.hypot(
          (cLat - lat) * 111320,
          (cLng - lng) * 111320 * Math.cos(lat * Math.PI / 180));
        if (d < bestD) { bestD = d; best = el; }
      }
      if (!best || bestD > 120) return null;
      return {
        ll: best.geometry.map((g) => [g.lat, g.lon]),
        distM: bestD,
      };
    };
    const detectAutoAt = async (lat, lng) => {
      if (!(window.GreenDetect && typeof window.GreenDetect.detect === 'function')) {
        try { await loadScriptOnce('./green-detect.js'); } catch (e) { /* offline */ }
      }
      if (!(window.GreenDetect && typeof window.GreenDetect.detect === 'function'))
        return { fail: 'no-detect' };
      if (!(window.CaddyElev && typeof window.CaddyElev.fetchElevGrid === 'function'))
        return { fail: 'no-elev' };
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
      // v1.23.0: the auto-SAVE gate needs the in-mask cell count too
      // (high bar = conf ≥ 0.75 AND ≥ 30 cells). Count here while the
      // grid is in scope — point-in-polygon over the 64² sample grid.
      let cells = 0;
      {
        const P = detectRes.poly;
        const inPoly = (x, y) => {
          let inside = false;
          for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const xi = P[i][0], yi = P[i][1];
            const xj = P[j][0], yj = P[j][1];
            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          }
          return inside;
        };
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            if (Number.isFinite(g2[y * W + x]) &&
                inPoly((x + 0.5 - W / 2) * cs, (H / 2 - y - 0.5) * cs)) cells++;
      }
      return { ll, conf: detectRes.confidence, cells };
    };
    const runAutoAt = async (ll) => {
      const gen = ++gelOutlineGen;
      setOutlineHint('Outline: Auto (detecting…)');
      let res = null;
      try { res = await detectAutoAt(ll.lat, ll.lng); }
      catch (e) { res = { fail: 'err' }; }
      if (gen !== gelOutlineGen) return;
      if (!res || res.fail || !res.ll) {
        // Below 0.6 → honest failure, keep the previous outline.
        const why = res && res.fail === 'low-conf'
          ? 'not confident here — try OSM or another point'
          : 'could not detect here — try OSM or another point';
        setOutlineHint('Outline: Auto (' + why + ')');
        return;
      }
      drawPreviewRing(res.ll, '#ffd166');
      // v1.23.0 AUTO-SAVE RULES: conf ≥ 0.75 AND ≥ 30 cells → saveAuto
      // (chosen unless the green is locked). 0.6..0.75 (or a too-small
      // mask) → preview only, never saved.
      if (res.conf >= 0.75 && (res.cells || 0) >= 30) {
        if (OS) OS.saveAuto(ll.lat, ll.lng, res.ll, res.conf);
        let locked = false;
        if (OS && OS.get) {
          const r = OS.get(ll.lat, ll.lng);
          locked = !!(r && r.locked);
        }
        setOutlineHint(locked
          ? 'Outline saved (Auto) — existing outline locked; Use this outline to replace it'
          : 'Outline: Auto (saved — verify)');
      } else {
        setOutlineHint('Low confidence — not saved. Use this outline to keep it.');
      }
    };
    const runOsmAt = async (ll) => {
      const gen = ++gelOutlineGen;
      setOutlineHint('Outline: OSM (fetching…)');
      let hit = null;
      try { hit = await fetchNearestOsm(ll.lat, ll.lng); }
      catch (e) { hit = null; }
      if (gen !== gelOutlineGen) return;
      if (!hit || !hit.ll) {
        setOutlineHint('Outline: OSM (no mapped green near this point)');
        return;
      }
      drawPreviewRing(hit.ll, '#7dff9b');
      setOutlineHint('Outline: OSM (mapped green ' + Math.round(hit.distM) + ' m away)');
    };
    const clearOutline = () => {
      gelOutlineMode = null;
      gelOutlineHint = '';
      gelOutlineGen++;
      gelPreviewRingLL = null;
      if (gelOutlineLayer) { map.removeLayer(gelOutlineLayer); gelOutlineLayer = null; }
      syncOutlineBtns();
      if (!teeMode) {
        const el = hintEl();
        if (el) el.textContent = sampleHint(pin.getLatLng());
      }
    };
    // v1.23.0: "Use this outline" — keep the ring on screen as THE outline
    // for this green: written into the store under the current mode, chosen
    // and locked (replaces anything, including an earlier lock).
    const useOutlineNow = () => {
      if (!gelOutlineMode || !gelPreviewRingLL) return;
      const llPin = pin.getLatLng();
      if (OS) OS.useThis(llPin.lat, llPin.lng, gelOutlineMode,
        gelPreviewRingLL);
      setOutlineHint(gelOutlineMode === 'osm'
        ? 'Outline saved (OSM)'
        : 'Outline saved (Auto) — locked');
      gelPreviewRingLL = null;
      syncOutlineBtns();
    };
    window.__gelOutline = {
      get mode() { return gelOutlineMode; },
      get hint() { return (hintEl() && hintEl().textContent) || gelOutlineHint; },
      // v1.23.0: testable seam — what "Use this outline" would write.
      get ring() { return gelPreviewRingLL; },
      get useEnabled() {
        return !!(gelOutlineMode && gelPreviewRingLL);
      },
    };
    // v1.14.0 (R6-D5): teeMarker must be REBINDABLE. It was `const`, so
    // setTee removed the old marker but the freshly created one was never
    // tracked — every "Move tee" placement stacked ANOTHER marker on the
    // map (only the last stayed draggable/removable). One factory, one
    // `let` slot: boot and setTee are the only creators and both assign.
    const makeTeeMarker = (ll) => L.marker([ll.lat, ll.lng], {
      draggable: true,
      icon: L.divIcon({ className: 'gel-tee',
        html: '<div class="gel-tee-dot"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7] }),
    });
    let teeMarker = teeLL ? makeTeeMarker(teeLL).addTo(map) : null;
    const syncTeeUI = () => {
      const btn = sheet.querySelector('#gelTee');
      if (!btn) return;
      btn.classList.toggle('gel-armed', teeMode);
      btn.textContent = teeMode ? 'Cancel tee' : (teeLL ? 'Move tee' : 'Set tee');
      const readout2 = sheet.querySelector('.gel-hint');
      if (readout2) {
        readout2.textContent = teeMode
          ? (teeLL ? 'Tap the map to move the tee — or tap the tee to remove it'
                   : 'Tap your tee box on the map')
          : (gelOutlineHint || sampleHint(pin.getLatLng()));
      }
    };
    const setTee = (ll) => {
      teeLL = ll;
      // v1.14.0 (R6-D5): ALWAYS tear down the tracked marker and rebuild
      // exactly one. The old code removed `teeMarker` (never reassigned —
      // const) and created an untracked replacement, so placements stacked.
      if (teeMarker) { map.removeLayer(teeMarker); teeMarker = null; }
      if (ll) {
        teeMarker = makeTeeMarker(ll).addTo(map);
        teeMarker.on('click', () => {
          // Two-tap remove: tapping the tee itself while armed removes it.
          if (teeMode) {
            setTee(null);
            teeMode = false;
            syncTeeUI();
          }
        }).on('dragend', (ev) => { teeLL = ev.target.getLatLng(); });
      }
      teeMode = false;
      syncTeeUI();
    };
    const teeBtn = sheet.querySelector('#gelTee');
    if (teeBtn) {
      teeBtn.addEventListener('click', () => {
        teeMode = !teeMode;
        syncTeeUI();
      });
      // v1.13.0: deep-link from Prep's hole brief ("Tee" button) — the
      // editor opens with tee mode already armed. One less tap; the hint
      // line explains what to do.
      if (new URLSearchParams(location.search).get('armtee') === '1') {
        teeMode = true;
      }
    }

    // Live crosshair readout.
    const readout = sheet.querySelector('.gel-hint');
    const setReadout = (ll) => {
      if (teeMode) return;
      if (gelOutlineHint) {
        readout.textContent = gelOutlineHint;
        return;
      }
      readout.textContent = sampleHint(ll);
    };
    setReadout(pin.getLatLng());
    // v1.13.0: armtee deep-link re-syncs the UI once readout exists.
    if (teeMode) syncTeeUI();
    const autoBtn = sheet.querySelector('#gelAutoOutline');
    const osmBtn = sheet.querySelector('#gelOsmOutline');
    if (autoBtn) autoBtn.addEventListener('click', () => {
      if (gelOutlineMode === 'auto') { clearOutline(); return; }
      gelOutlineMode = 'auto';
      syncOutlineBtns();
      runAutoAt(pin.getLatLng());
    });
    if (osmBtn) osmBtn.addEventListener('click', () => {
      if (gelOutlineMode === 'osm') { clearOutline(); return; }
      gelOutlineMode = 'osm';
      syncOutlineBtns();
      runOsmAt(pin.getLatLng());
    });
    // v1.23.0: keep the previewed ring as THE outline (store: chosen+locked).
    const useBtn = sheet.querySelector('#gelUseOutline');
    if (useBtn) useBtn.addEventListener('click', useOutlineNow);
    map.on('click', (e) => {
      // v1.12.0 (tee mode): in tee mode a map tap PLACES the tee
      // (disarming), exactly like Round's Set-tee flow.
      if (teeMode) {
        setTee({ lat: e.latlng.lat, lng: e.latlng.lng });
        return;
      }
      pin.setLatLng(e.latlng);
      if (gelOutlineMode === 'auto') runAutoAt(e.latlng);
      else if (gelOutlineMode === 'osm') runOsmAt(e.latlng);
      else setReadout(e.latlng);
    });
    pin.on('dragend', (e) => {
      const ll = e.target.getLatLng();
      if (gelOutlineMode === 'auto') runAutoAt(ll);
      else if (gelOutlineMode === 'osm') runOsmAt(ll);
      else setReadout(ll);
    });
    pin.on('drag', (e) => {
      if (gelOutlineMode) return;
      setReadout(e.target.getLatLng());
    });

    // Real OSM greens around the boot point (60 m) — drawn so James can SEE
    // which green is which. v1.2.5: each green gets a HOLE label (H3, H7…)
    // derived from the nearest golf=hole way's ref/tag, so multi-green
    // courses are navigable at a glance.
    const holeLabelFor = (lat, lng, holeIndex) => {
      // holeIndex: parallel array of hole ways fetched alongside greens.
      const h = holeIndex.nearest(lat, lng);
      return h ? 'H' + h.ref : null;
    };
    fetch(OVERPASS + '?data=' + encodeURIComponent(overpassQ(boot.lat, boot.lng, 60)))
      .then((r) => r.json())
      .then((data) => {
        const els = (data.elements || []).filter((e) => e.geometry);
        // Build a hole index from ways tagged golf=hole (same bbox query).
        // v1.3.1: distance to the nearest SEGMENT of the hole line (not the
        // first node) — Sugar Creek's holes 1 and 8 share a boundary area
        // and first-node distance picked the wrong one ("hole8 vs hole1").
        const segDist = (lat, lng, a, b) => {
          const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
          const px = lng, py = lat;
          const dx = bx - ax, dy = by - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          // scale lng by cos(lat) so the geometry is ~metre-ish
          const k = Math.cos(lat * Math.PI / 180);
          const ex = (ax + t * dx - px) * 111320 * k;
          const ey = (ay + t * dy - py) * 111320;
          return Math.hypot(ex, ey);
        };
        const holes = els.filter((e) => e.tags && e.tags.golf === 'hole');
        const holeIndex = {
          nearest(lat, lng) {
            let best = null, bestD = Infinity;
            for (const h of holes) {
              for (let i = 0; i < h.geometry.length - 1; i++) {
                const d = segDist(lat, lng, h.geometry[i], h.geometry[i + 1]);
                if (d < bestD) {
                  bestD = d;
                  best = h.tags.ref || h.tags.name || null;
                }
              }
            }
            return best ? { ref: best } : null;
          },
        };
        els.forEach((el) => {
          const ll = el.geometry.map((g) => [g.lat, g.lon]);
          if (ll.length < 3) return;
          const isHole = el.tags && el.tags.golf === 'hole';
          L.polygon(ll, {
            color: isHole ? 'rgba(255,255,255,0.5)' : '#7dff9b',
            weight: isHole ? 1.5 : 2,
            fillOpacity: isHole ? 0.04 : 0.18,
            dashArray: isHole ? '3 6' : null,
          }).addTo(map);
          if (!isHole) {
            // Green: centroid label = nearest hole's ref.
            let clat = 0, clng = 0;
            ll.forEach(([a, b]) => { clat += a; clng += b; });
            clat /= ll.length; clng /= ll.length;
            const lbl = holeLabelFor(clat, clng, holeIndex);
            L.marker([clat, clng], {
              interactive: false,
              icon: L.divIcon({ className: 'gel-holetag',
                html: '<div class="gel-holetag-pill">' + (lbl || 'green') +
                  '</div>', iconSize: null }),
            }).addTo(map);
          }
        });
        const greens = els.filter((e) =>
          e.tags && e.tags.golf === 'green').length;
        if (!greens && !gelOutlineMode && !teeMode) {
          readout.textContent =
            'No mapped greens within 60 m — the tool will approximate. Use Auto outline or OSM outline, or tap where the green is and “Load this green”.';
        }
      })
      .catch(() => { /* offline: map still works for manual placement */ });

    sheet.querySelector('#gelCancel').addEventListener('click', () => {
      map.remove();
      sheet.remove();
      sheet = null;
    });

    sheet.querySelector('#gelLoad').addEventListener('click', () => {
      const ll = pin.getLatLng();
      const qs2 = new URLSearchParams(location.search);
      qs2.set('lat', ll.lat.toFixed(6));
      qs2.set('lng', ll.lng.toFixed(6));
      // v1.12.0 (editable tee): "Load this green" carries BOTH — the tee
      // the player placed (or its removal), and it persists into the
      // course profile for this hole so Prep/Round/hole-view agree.
      if (teeLL) {
        qs2.set('teelat', teeLL.lat.toFixed(6));
        qs2.set('teelng', teeLL.lng.toFixed(6));
      } else {
        qs2.delete('teelat'); qs2.delete('teelng');
      }
      const courseId = qs2.get('course');
      if (courseId) {
        try {
          const profiles = JSON.parse(
            localStorage.getItem('caddy:courseProfiles:v1') || '[]');
          const idx = profiles.findIndex((c) => c && c.id === courseId);
          // hole number comes from ?hole= when Prep launched it
          const holeNum = parseInt(qs2.get('hole'), 10);
          if (idx >= 0 && holeNum >= 1 && holeNum <= 18 &&
              Array.isArray(profiles[idx].holes) && profiles[idx].holes[holeNum - 1]) {
            if (teeLL) {
              profiles[idx].holes[holeNum - 1].teePoint =
                { lat: teeLL.lat, lng: teeLL.lng };
              profiles[idx].holes[holeNum - 1].teeSource = 'manual';
            } else {
              profiles[idx].holes[holeNum - 1].teeSource = 'default';
            }
            profiles[idx].updatedAt = Date.now();
            localStorage.setItem('caddy:courseProfiles:v1',
              JSON.stringify(profiles));
          }
        } catch (e) { /* best-effort persist */ }
      }
      location.replace('?r=' + Date.now() + '&' + qs2.toString());   // full re-boot at the new green
    });
  }

  function mount() {
    const btn = document.getElementById('gm-editloc');
    if (!btn) return;
    btn.textContent = 'Check location';
    btn.addEventListener('click', openEditor);
    // v1.14.0 (R6-D6): Prep's "Tee" shortcut (greenmap.html?…&armtee=1)
    // landed on the 3D green with tee mode pre-armed but NO editor
    // visible — armtee only set a flag that mattered once the sheet was
    // already open, and nothing opened it. Now: ?armtee=1 opens the
    // editor automatically, exactly once, then the param is stripped via
    // history.replaceState so a manual refresh (or a later "Check
    // location" tap) never re-triggers the auto-open. Double rAF = the
    // sheet's map container is laid out before Leaflet measures it (same
    // contract as the invalidateSize rAF in openEditor — a 0x0 container
    // makes the map dead).
    if (new URLSearchParams(location.search).get('armtee') === '1') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        openEditor();
        try {
          const u = new URL(location.href);
          u.searchParams.delete('armtee');
          history.replaceState(null, '', u.toString());
        } catch (e) { /* file:// or privacy mode — worst case a refresh
                          re-arms the editor; harmless */ }
      }));
    }
    // v1.23.0: &armdetect=1 — the honest card / greyed dock Auto button
    // deep-link. Opens the editor AND immediately runs Auto detect at the
    // pin (same double-rAF + replaceState contract as armtee).
    if (new URLSearchParams(location.search).get('armdetect') === '1') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        openEditor();
        try {
          const u = new URL(location.href);
          u.searchParams.delete('armdetect');
          history.replaceState(null, '', u.toString());
        } catch (e) { /* harmless: worst case a refresh re-arms */ }
        const autoBtn0 = document.getElementById('gelAutoOutline');
        if (autoBtn0) autoBtn0.click();
      }));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
