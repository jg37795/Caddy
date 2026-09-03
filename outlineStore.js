/* ==========================================================================
   outlineStore.js — persistent per-green outline store (v1.23.0).
   --------------------------------------------------------------------------
   ONE active outline per green from a named source: 'osm' or 'auto'.
   Outlines are REMEMBERED per green here; the synthetic ellipse fallback is
   gone. Rings are [[lat,lng],...] arrays. All pure/sync so tests run headless.

   Storage: localStorage 'caddy:greenOutlines:v2' — a map of
   `${lat.toFixed(3)},${lng.toFixed(3)}` → record. Every WRITE is try/caught
   (quota / private mode = silent no-op); reads still work from memory.
   ========================================================================== */

(() => {
  'use strict';

  const KEY = 'caddy:greenOutlines:v2';
  const NEAR_M = 100;          // nearest-record scan radius (matches legacy store)
  const M_LAT = 111320;        // metres per degree latitude

  function mPerLng(lat) {
    return M_LAT * Math.cos((lat || 0) * Math.PI / 180);
  }

  function keyFor(lat, lng) {
    return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  }

  // Raw map read. Corrupt JSON / absent storage → empty map.
  function readAll() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return {};
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) { return {}; }
  }

  // Map write. try/caught: quota / private mode = silent no-op.
  function writeAll(map) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (e) { /* silent no-op */ }
  }

  function validRing(ring) {
    return Array.isArray(ring) && ring.length >= 3 &&
      ring.every((p) => Array.isArray(p) &&
        Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }

  // NEAREST record within 100 m — never first-hit (Grok F21 lesson).
  function get(lat, lng) {
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    const store = readAll();
    const mLng = mPerLng(la);
    let best = null, bestD = Infinity;
    for (const k of Object.keys(store)) {
      const o = store[k];
      if (!o || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) continue;
      const d = Math.hypot((o.lat - la) * M_LAT, (o.lng - ln) * mLng);
      if (d < bestD) { bestD = d; best = o; }
    }
    return bestD <= NEAR_M ? best : null;
  }

  function put(lat, lng, patch) {
    const store = readAll();
    const k = keyFor(lat, lng);
    const prev = store[k] || { lat: Number(lat), lng: Number(lng) };
    const next = Object.assign({}, prev, patch, {
      lat: Number(lat), lng: Number(lng),
      updatedAt: Date.now(),
    });
    store[k] = next;
    writeAll(store);
    return next;
  }

  // Surveyed OSM ring lands. Chosen only when nothing is chosen AND the
  // green isn't locked (a locked choice is the player's word, not ours).
  function saveOsm(lat, lng, ring, distM) {
    if (!validRing(ring)) return null;
    const rec = get(lat, lng) || {};
    const patch = { osmRing: ring.map((p) => [p[0], p[1]]), osmDistM: distM };
    if (!rec.chosen && !rec.locked) patch.chosen = 'osm';
    return put(lat, lng, patch);
  }

  // AUTO-SAVE path — only called at the high bar (conf ≥ 0.75 AND ≥ 30 cells).
  // Stores the ring data always; flips chosen unless the green is locked.
  function saveAuto(lat, lng, ring, conf) {
    if (!validRing(ring)) return null;
    const rec = get(lat, lng) || {};
    const patch = { autoRing: ring.map((p) => [p[0], p[1]]),
      autoConf: Number.isFinite(conf) ? conf : null };
    if (!rec.locked) patch.chosen = 'auto';
    return put(lat, lng, patch);
  }

  // Check location "Use this outline" — write the ring into the named slot,
  // make it THE outline and LOCK it against auto overwrites.
  function useThis(lat, lng, source, ring) {
    if (source !== 'osm' && source !== 'auto') return null;
    if (!validRing(ring)) return null;
    const patch = source === 'osm'
      ? { osmRing: ring.map((p) => [p[0], p[1]]) }
      : { autoRing: ring.map((p) => [p[0], p[1]]) };
    patch.chosen = source;
    patch.locked = true;
    return put(lat, lng, patch);
  }

  // Switch command (?src= / dock row). No-op unless that source's ring
  // actually exists in the record — never choose a phantom.
  function setChosen(lat, lng, source) {
    if (source !== 'osm' && source !== 'auto') return null;
    const rec = get(lat, lng);
    if (!rec) return null;
    const ring = source === 'osm' ? rec.osmRing : rec.autoRing;
    if (!validRing(ring)) return rec;      // no-op: ring missing
    return put(lat, lng, { chosen: source });
  }

  // The ONE active outline for this green. Honours an explicit chosen when
  // its ring exists, else falls back osm → auto. Null when neither exists.
  function chosenRing(lat, lng) {
    const rec = get(lat, lng);
    if (!rec) return null;
    if (rec.chosen === 'osm' && validRing(rec.osmRing))
      return { source: 'osm', ring: rec.osmRing };
    if (rec.chosen === 'auto' && validRing(rec.autoRing))
      return { source: 'auto', ring: rec.autoRing };
    if (validRing(rec.osmRing)) return { source: 'osm', ring: rec.osmRing };
    if (validRing(rec.autoRing)) return { source: 'auto', ring: rec.autoRing };
    return null;
  }

  function has(lat, lng, source) {
    const rec = get(lat, lng);
    if (!rec) return false;
    return validRing(source === 'osm' ? rec.osmRing : rec.autoRing);
  }

  window.OutlineStore = {
    KEY, keyFor, get, put, saveOsm, saveAuto, useThis, setChosen,
    chosenRing, has,
  };
})();
