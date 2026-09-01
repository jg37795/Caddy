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
      '  <button class="gel-btn" id="gelTrace">Trace outline</button>' +
      '  <button class="gel-btn" id="gelTee">Move tee</button>' +
      '  <button class="gel-btn" id="gelLoad">Load this green</button>' +
      '</div>' +
      '<div class="gel-map" id="gelMap"></div>' +
      '<div class="gel-hint">Tap to move the sample point · green outlines are the real mapped greens (OSM)</div>' +
      '<div class="gel-tracebar" id="gelTraceBar" hidden>' +
      '  <span id="gelTraceCount">0 pts</span>' +
      '  <button class="gel-btn" id="gelTraceUndo">Undo</button>' +
      '  <button class="gel-btn gel-primary" id="gelTraceSave">Save &amp; load this outline</button>' +
      '</div>';

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
          : `Sample point: ${pin.getLatLng().lat.toFixed(5)}, ${pin.getLatLng().lng.toFixed(5)} — tap the map to move it, then “Load this green”`;
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
    // v-fix(trace-pin) v1.5.2 (Grok audit #10): `tracing` declared BEFORE
    // the click handler below so the trace-mode guard can see it.
    let tracing = false;
    const setReadout = (ll) => {
      readout.textContent =
        `Sample point: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} — tap the map to move it, then “Load this green”`;
    };
    setReadout(pin.getLatLng());
    // v1.13.0: armtee deep-link re-syncs the UI once readout exists.
    if (teeMode) syncTeeUI();
    // v-fix(trace-pin) v1.5.2 (Grok audit #10): in trace mode this handler
    // must not move the pin / overwrite the trace instruction. `tracing`
    // is declared below; the guard reads it lazily via the shared scope.
    map.on('click', (e) => {
      if (typeof tracing !== 'undefined' && tracing) return;
      // v1.12.0 (tee mode): in tee mode a map tap PLACES the tee
      // (disarming), exactly like Round's Set-tee flow.
      if (teeMode) {
        setTee({ lat: e.latlng.lat, lng: e.latlng.lng });
        return;
      }
      pin.setLatLng(e.latlng); setReadout(e.latlng);
    });
    pin.on('drag', (e) => setReadout(e.target.getLatLng()));

    /* ---- Outline tracing (unmapped greens — e.g. Westwood) --------------
       Tap points around the green on the satellite imagery once; the polygon
       is saved on this device and the green tool uses it instead of the
       ellipse approximation. */
    const OUTLINE_KEY = 'caddy:greenOutline:v1';
    let tracePts = [];
    let traceLine = null;
    let traceFill = null;
    let snapMarker = null;   // v1.3.1: pulsing first-point handle

    const traceBar = sheet.querySelector('#gelTraceBar');
    const traceCount = sheet.querySelector('#gelTraceCount');
    const btnTrace = sheet.querySelector('#gelTrace');

    const redrawTrace = () => {
      if (traceLine) { map.removeLayer(traceLine); traceLine = null; }
      if (traceFill) { map.removeLayer(traceFill); traceFill = null; }
      traceCount.textContent = tracePts.length + ' pts';
      if (!tracePts.length) return;
      if (tracePts.length >= 3) {
        traceFill = L.polygon(tracePts, {
          color: '#ffd166', weight: 2, fillOpacity: 0.12, dashArray: null,
        }).addTo(map);
      }
      // v1.2.5 (clean close): show the LIVE closing edge from the last point
      // back to the first as a distinct dashed segment, so the ring James
      // sees is exactly the ring he saves — no surprise tail on load.
      traceLine = L.polyline(tracePts.concat([tracePts[0]]), {
        color: '#ffd166', weight: 2, dashArray: '4 5',
      }).addTo(map);
    };

    // v1.2.5 (snap-close): a tap near the FIRST point (within 18 px)
    // finishes the ring instead of adding a cramped vertex — the natural
    // "close the loop" gesture. Verified distance in SCREEN space, not
    // metres, so it works at any zoom.
    // v1.3.1 (snap-close v2): 18 px was too tight on a 3× phone — James
    // could never hit it ("still doesn't snap, I keep adding points").
    // 34 px + a pulsing first-point handle so the target is VISIBLE.
    const SNAP_PX = 34;
    const screenDist = (a, b) => {
      const p1 = map.latLngToContainerPoint(a);
      const p2 = map.latLngToContainerPoint(b);
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    };

    btnTrace.addEventListener('click', () => {
      tracing = !tracing;
      btnTrace.classList.toggle('gel-active', tracing);
      traceBar.hidden = !tracing;
      if (!tracing && snapMarker) {
        map.removeLayer(snapMarker); snapMarker = null;   // v1.3.1
      }
      readout.textContent = tracing
        ? 'Trace mode — tap points AROUND the green edge; tap the pulsing ring to close.'
        : 'Tap to move the sample point.';
    });

    map.on('click', (e) => {
      if (!tracing) return;
      // v1.2.5 (snap-close): tapping near the first point (>=3 pts) closes
      // the ring — do NOT add the point.
      if (tracePts.length >= 3 &&
          screenDist(e.latlng, L.latLng(tracePts[0][0], tracePts[0][1]))
            < SNAP_PX) {
        readout.textContent =
          'Outline closed — “Save & load this outline” when it looks right.';
        return;
      }
      tracePts.push([e.latlng.lat, e.latlng.lng]);
      // v1.3.1: first-point handle appears once the ring can close (>=3
      // pts) — a pulsing gold circle marks the tap target; removes it when
      // tracing turns off.
      if (tracePts.length >= 3 && !snapMarker) {
        snapMarker = L.marker(tracePts[0], {
          interactive: false,
          icon: L.divIcon({ className: 'gel-snaphandle',
            html: '<div class="gel-snaphandle-ring"></div>',
            iconSize: [44, 44], iconAnchor: [22, 22] }),
        }).addTo(map);
      }
      redrawTrace();
    });

    sheet.querySelector('#gelTraceUndo').addEventListener('click', () => {
      tracePts.pop();
      redrawTrace();
    });

    sheet.querySelector('#gelTraceSave').addEventListener('click', () => {
      if (tracePts.length < 3) {
        readout.textContent = 'Need at least 3 points to outline a green.';
        return;
      }
      // Centroid of the traced ring (simple average — greens are small).
      let clat = 0, clng = 0;
      tracePts.forEach(([a, b]) => { clat += a; clng += b; });
      clat /= tracePts.length; clng /= tracePts.length;
      let store = {};
      try {
        store = JSON.parse(localStorage.getItem(OUTLINE_KEY) || '{}');
      } catch (err) { store = {}; }
      store[clat.toFixed(3) + ',' + clng.toFixed(3)] = {
        lat: clat, lng: clng,
        vertices: tracePts.map(([a, b]) => [a, b]),
        updatedAt: Date.now(),
      };
      try {
        localStorage.setItem(OUTLINE_KEY, JSON.stringify(store));
      } catch (err) { /* private mode — proceed anyway for this session */ }
      const qs2 = new URLSearchParams(location.search);
      qs2.set('lat', clat.toFixed(6));
      qs2.set('lng', clng.toFixed(6));
      location.replace('?r=' + Date.now() + '&' + qs2.toString());
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
        if (!greens) {
          readout.textContent =
            'No mapped greens within 60 m — the tool will approximate. Trace this green (“Trace outline”) or tap where it is and “Load this green”.';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
