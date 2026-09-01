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

  function bootValues(opts) {
    return {
      lat: opts.greenLatLng ? opts.greenLatLng.lat : null,
      lng: opts.greenLatLng ? opts.greenLatLng.lng : null,
      courseId: opts.courseId || null,
      hole: opts.hole || null,
    };
  }

  function courseHole(courseId, holeNum) {
    try {
      const profiles = JSON.parse(
        localStorage.getItem('caddy:courseProfiles:v1') || '[]');
      const c = profiles.find((p) => p && p.id === courseId);
      if (!c || !Array.isArray(c.holes)) return null;
      return c.holes[holeNum - 1] || null;
    } catch (e) { return null; }
  }

  function openEditor(opts) {
    if (sheet) return;
    const boot = bootValues(opts);
    if (boot.lat == null) return;
    const hole = courseHole(boot.courseId, boot.hole) || {};

    sheet = document.createElement('div');
    sheet.id = 'prep-sat-sheet';
    sheet.innerHTML =
      '<div class="psh-head">' +
      '  <button class="psh-btn" id="pshDone">‹ Done</button>' +
      `  <div class="psh-title">Hole ${boot.hole || '—'} — satellite</div>` +
      '  <span class="psh-btn psh-spacer"></span>' +
      '</div>' +
      '<div class="psh-map" id="pshMap"></div>' +
      '<div class="psh-hint">Your hole on the ground — fairway ribbon, landing spots, green &amp; hazards (OSM)</div>';

    document.body.appendChild(sheet);

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
      minZoom: 15,
    }).setView([boot.lat, boot.lng], 17);
    window.__pshMap = map;
    L.tileLayer(TILES, { attribution: '', maxZoom: 21 })
      .addTo(map);

    const dpr = window.devicePixelRatio || 1;

    // --- overlays from the STORED course (instant, offline-friendly) ---
    // Fairway ribbon: the same simplified path the cartoon uses.
    if (Array.isArray(hole.pathPts) && hole.pathPts.length >= 2) {
      const ll = hole.pathPts.map((p) => [p.lat, p.lng]);
      // soft wide underlay
      L.polyline(ll, {
        color: 'rgba(46, 186, 108, 0.30)', weight: 26,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(map);
      // crisp centre line
      L.polyline(ll, {
        color: 'rgba(122, 232, 160, 0.85)', weight: 2.5,
        interactive: false,
      }).addTo(map);
    }

    // Green outline: stored ring or the local traced outline.
    let ring = Array.isArray(hole.greenRingPts)
      ? hole.greenRingPts.map((p) => [p.lat, p.lng]) : null;
    if (!ring) {
      try {
        const store = JSON.parse(
          localStorage.getItem(OUTLINE_KEY) || '{}');
        const key = `${boot.lat.toFixed(4)},${boot.lng.toFixed(4)}`;
        const pts = store[key] && store[key].pts;
        if (Array.isArray(pts)) ring = pts;
      } catch (e) { /* no traced outline */ }
    }
    if (ring && ring.length >= 3) {
      L.polygon(ring, {
        color: '#7dff9b', weight: 2, fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
    }

    // Tee marker (white dot) + flag pole chip.
    if (hole.teePoint) {
      L.circleMarker([hole.teePoint.lat, hole.teePoint.lng], {
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
    try {
      const plan = window.__prepPlanLanding || [];
      plan.forEach((p) => {
        if (!p || !Number.isFinite(p.lat)) return;
        L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: 'rgba(10,14,12,0.9)', weight: 1.6,
          fillColor: p.hex || '#5ea8ff', fillOpacity: 0.95,
          interactive: false,
        }).addTo(map);
      });
    } catch (e) { /* plan dots are garnish */ }

    // Live OSM context: neighbouring greens + hole lines (like Check
    // location). Failure is silent — stored overlays carry the sheet.
    fetch(`${OVERPASS}?data=${encodeURIComponent(
      `[out:json][timeout:15];(way["golf"="green"](around:120,${boot.lat},${boot.lng});way["golf"="hole"](around:120,${boot.lat},${boot.lng}););out geom;`)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.elements) return;
        data.elements.forEach((el) => {
          if (!el.geometry || el.geometry.length < 2) return;
          const ll = el.geometry.map((g) => [g.lat, g.lon]);
          const isHole = el.tags && el.tags.golf === 'hole';
          if (isHole) {
            L.polyline(ll, {
              color: 'rgba(255,255,255,0.45)', weight: 1.5,
              dashArray: '3 6', interactive: false,
            }).addTo(map);
          } else if (ll.length >= 3) {
            L.polygon(ll, {
              color: '#7dff9b', weight: 1.5, fillOpacity: 0.12,
              interactive: false,
            }).addTo(map);
          }
        });
      })
      .catch(() => { /* offline: stored overlays only */ });

    sheet.querySelector('#pshDone').addEventListener('click', () => {
      map.remove();
      sheet.remove();
      sheet = null;
      window.__pshMap = null;
    });
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
