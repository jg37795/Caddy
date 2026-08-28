/* ==========================================================================
   greenlink.js — Play-tab → 3D Green launch (additive, read-only)
   --------------------------------------------------------------------------
   One control: a "3D Green" pill beside the wind pill on the Play map.
   Tapping it opens greenmap.html pointed at the CURRENT hole's green:
     • green/tee coords come from the live round session in localStorage
       (`caddy:roundSession` — course.holes[N].greenCenter / teePoint),
       which app.js publishes; this file never writes app state.
     • Falls back to the persisted per-hole green marker state (the same
       session object carries them after app.js hydrates the hole).
     • No known green → honest toast, no launch (no fake data rule).
   greenmap.html accepts ?lat&lng&teelat&teelng (v1.1.4) and renders the
   3D slope drum + makeable putt line for that green.
   ========================================================================== */

(() => {
  'use strict';
  if (window.__rxGreenLink) return; // idempotent
  window.__rxGreenLink = true;

  const SESSION_KEY = 'caddy:roundSession';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  // Resolve the current hole's green/tee from the live session. Returns
  // { lat, lng, tee } or null. Priority: explicit hole record → casual
  // session green fields → null.
  function currentGreen() {
    const rs = loadJSON(SESSION_KEY, null);
    if (!rs || typeof rs !== 'object') return null;
    const holeNum = Math.min(18, Math.max(1,
      Math.round(num(rs.hole || rs.currentHole, 1))));
    const course = rs.course;
    const hole = course && Array.isArray(course.holes)
      ? course.holes[holeNum - 1] : null;
    const g = hole && hole.greenCenter &&
      Number.isFinite(Number(hole.greenCenter.lat)) &&
      Number.isFinite(Number(hole.greenCenter.lng))
      ? { lat: Number(hole.greenCenter.lat), lng: Number(hole.greenCenter.lng) }
      : null;
    if (!g) return null;
    const t = hole && hole.teePoint &&
      Number.isFinite(Number(hole.teePoint.lat)) &&
      Number.isFinite(Number(hole.teePoint.lng))
      ? { lat: Number(hole.teePoint.lat), lng: Number(hole.teePoint.lng) }
      : null;
    return { lat: g.lat, lng: g.lng, tee: t, hole: holeNum };
  }

  function pill() {
    let p = document.getElementById('green3dPill');
    if (p) return p;
    p = document.createElement('button');
    p.id = 'green3dPill';
    p.className = 'green3d-pill glass';
    p.setAttribute('aria-label', 'Open 3D green view for this hole');
    p.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">' +
      '<path d="M3 17c3-2.6 6-2.6 9 0s6 2.6 9 0" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 14V5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 4.2l4.2 2.3L12 8.8z" fill="currentColor"/></svg>' +
      '<span>3D Green</span>';
    p.addEventListener('click', () => {
      const g = currentGreen();
      if (!g) {
        // Reuse the range layer's toast if present, else alert-free no-op.
        const t = document.querySelector('.rx-toast');
        if (t && window.__rxRangePremium) {
          t.textContent = 'No green marked for this hole yet — mark the green on the map first.';
          t.classList.add('show');
          setTimeout(() => t.classList.remove('show'), 2600);
        }
        return;
      }
      let url = 'greenmap.html?lat=' + g.lat.toFixed(6) +
        '&lng=' + g.lng.toFixed(6);
      if (g.tee) url += '&teelat=' + g.tee.lat.toFixed(6) +
        '&teelng=' + g.tee.lng.toFixed(6);
      window.open(url, '_blank');
    });
    return p;
  }

  function mount() {
    // Beside the wind pill inside the Play tab's top-right column.
    const host = document.querySelector('.top-right-row2');
    if (!host) return;
    const p = pill();
    if (p.parentElement !== host) host.appendChild(p);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
