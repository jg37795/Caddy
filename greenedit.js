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
  const ATTR = 'Tiles © Esri';

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
    return `[out:json][timeout:15];(way["golf"="green"](around:${radius},${lat},${lng}););out geom;`;
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
      '  <button class="gel-btn gel-primary" id="gelLoad">Load this green</button>' +
      '</div>' +
      '<div class="gel-map" id="gelMap"></div>' +
      '<div class="gel-hint">Tap to move the sample point · green outlines are the real mapped greens (OSM)</div>';

    document.body.appendChild(sheet);

    const map = L.map('gelMap', { zoomControl: false }).setView(
      [boot.lat, boot.lng], 17);
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Crosshair = sample point (draggable marker + centre tick).
    const pin = L.marker([boot.lat, boot.lng], {
      draggable: true,
      icon: L.divIcon({ className: 'gel-pin',
        html: '<div class="gel-pin-dot"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(map);

    // Tee hint (if the hole has one) — context, not editable here.
    if (boot.tee) {
      L.marker([boot.tee.lat, boot.tee.lng], {
        icon: L.divIcon({ className: 'gel-tee',
          html: '<div class="gel-tee-dot"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7] }),
      }).addTo(map).bindTooltip('Tee');
    }

    // Live crosshair readout.
    const readout = sheet.querySelector('.gel-hint');
    const setReadout = (ll) => {
      readout.textContent =
        `Sample point: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} — tap the map to move it, then “Load this green”`;
    };
    setReadout(boot.lat, boot.lng);
    map.on('click', (e) => { pin.setLatLng(e.latlng); setReadout(e.latlng); });
    pin.on('drag', (e) => setReadout(e.target.getLatLng()));

    // Real OSM greens around the boot point (60 m) — drawn so James can SEE
    // which green is which.
    fetch(OVERPASS + '?data=' + encodeURIComponent(overpassQ(boot.lat, boot.lng, 60)))
      .then((r) => r.json())
      .then((data) => {
        const els = (data.elements || []).filter((e) => e.geometry);
        els.forEach((el) => {
          const ll = el.geometry.map((g) => [g.lat, g.lon]);
          if (ll.length < 3) return;
          L.polygon(ll, {
            color: '#7dff9b', weight: 2, fillOpacity: 0.18,
          }).addTo(map);
        });
        if (!els.length) {
          readout.textContent =
            'No mapped greens within 60 m — the tool will approximate. Tap any green you can see and “Load this green”.';
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
      if (!qs2.get('teelat')) { /* keep any existing tee params */ }
      location.search = qs2.toString();   // full re-boot at the new green
    });
  }

  function mount() {
    const btn = document.getElementById('gm-editloc');
    if (!btn) return;
    btn.textContent = 'Check location';
    btn.addEventListener('click', openEditor);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
