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
      // v1.16.1: Move tee + 3D Green live HERE (James) — the card's
      // buttons are gone; the sheet is where hole actions happen.
      '<div class="psh-actions">' +
      `  <button class="psh-act" id="pshMoveTee">✛ Move tee</button>` +
      `  <button class="psh-act psh-act-primary" id="psh3d">⛳ 3D Green</button>` +
      '</div>' +
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
    // Fairway ribbon: the same simplified path the cartoon uses.
    // v1.17.0 premium pass: halo underlay (dark rim makes the green pop
    // off the satellite imagery, Play-tab style).
    if (Array.isArray(hole.pathPts) && hole.pathPts.length >= 2) {
      const ll = hole.pathPts.map((p) => [p.lat, p.lng]);
      // dark halo rim
      L.polyline(ll, {
        color: 'rgba(6, 12, 9, 0.55)', weight: 30,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(map);
      // soft wide body
      L.polyline(ll, {
        color: 'rgba(46, 186, 108, 0.38)', weight: 26,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(map);
      // crisp centre line
      L.polyline(ll, {
        color: 'rgba(140, 240, 175, 0.9)', weight: 2.5,
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
    // v1.17.0 premium pass: white halo + a club/yardage label beside each
    // dot so the map reads without the card.
    try {
      const plan = window.__prepPlanLanding || [];
      plan.forEach((p) => {
        if (!p || !Number.isFinite(p.lat)) return;
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

    // v1.17.0 (James: "the buttons kick me out and break the prep tab"):
    // the old handlers did location.replace on the PREP page (the sheet
    // lives in index.html, not greenmap.html) — that reloaded Prep with
    // green-tool params and broke the tab. Both actions now navigate to
    // greenmap.html explicitly, carrying lat/lng/tee/course/hole, exactly
    // like the old card buttons did (which worked).
    sheet.querySelector('#pshMoveTee').addEventListener('click', () => {
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
      u.set('armtee', '1');
      location.assign('greenmap.html?' + u.toString());
    });
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
      u.set('view', '3d');
      location.assign('greenmap.html?' + u.toString());
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
