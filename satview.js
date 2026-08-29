/* ==========================================================================
   satview.js — Satellite-textured hole view (v1.3.0, the Google Earth look)
   --------------------------------------------------------------------------
   Fetches Esri World_Imagery tiles for the corridor bbox, composites them
   into an offscreen mosaic canvas, and provides per-quad colour sampling so
   render3D can paint the corridor mesh with REAL imagery instead of the
   muted fairway tone. Green zone keeps a slope-tint overlay mix so the
   slope data stays readable on top of the photo.

   Public API (window.CaddySat):
     .load(bbox, opts) -> Promise<state>
         bbox = [wLng, sLat, eLng, nLat]
         state: { ready, fail, canvas, w, h }
     .makeSampler(state, bbox) -> (lon, lat) => [r,g,b] | null

   Tile budget: zoom chosen so the bbox fits in ≤ 6×6 = 36 tiles. Any
   single tile failure degrades to the gap-fill tone; <60% success ⇒
   fail=true and the caller keeps topo colours.
   ========================================================================== */

(() => {
  'use strict';

  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const MAX_TILES_PER_SIDE = 6;
  const CONCURRENCY = 6;
  const TILE = 256;

  const lng2tx = (lng, z) => (lng + 180) / 360 * Math.pow(2, z);
  const lat2ty = (lat, z) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 *
      Math.pow(2, z);
  };

  function pickZoom(bbox) {
    const [w, s, e, n] = bbox;
    for (let z = 19; z >= 10; z--) {
      const tx0 = lng2tx(w, z), tx1 = lng2tx(e, z);
      const ty0 = lat2ty(n, z), ty1 = lat2ty(s, z);
      const nx = Math.ceil(tx1) - Math.floor(tx0);
      const ny = Math.ceil(ty1) - Math.floor(ty0);
      if (nx <= MAX_TILES_PER_SIDE && ny <= MAX_TILES_PER_SIDE)
        return { z, nx, ny, tx0: Math.floor(tx0), ty0: Math.floor(ty0) };
    }
    return { z: 10, nx: 2, ny: 1, tx0: Math.floor(lng2tx(bbox[0], 10)),
      ty0: Math.floor(lat2ty(bbox[3], 10)) };
  }

  function load(bbox) {
    return new Promise((resolve) => {
      const { z, nx, ny, tx0, ty0 } = pickZoom(bbox);
      const [w, s, e, n] = bbox;
      const txW = lng2tx(w, z), tyN = lat2ty(n, z);
      const mosaicW = Math.round((lng2tx(e, z) - txW) * TILE);
      const mosaicH = Math.round((lat2ty(s, z) - tyN) * TILE);
      if (mosaicW < 8 || mosaicH < 8) {
        resolve({ ready: false, fail: true, canvas: null, w: 0, h: 0 });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = mosaicW; canvas.height = mosaicH;
      const cx = canvas.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#3a4a3c';
      cx.fillRect(0, 0, mosaicW, mosaicH);

      const jobs = [];
      for (let ty = ty0; ty < ty0 + ny; ty++)
        for (let tx = tx0; tx < tx0 + nx; tx++)
          jobs.push({ tx, ty });
      const total = jobs.length;
      let done = 0, ok = 0;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        const good = ok >= total * 0.6;
        resolve({ ready: good, fail: !good, canvas, w: mosaicW, h: mosaicH });
      };

      const next = () => {
        const job = jobs.shift();
        if (!job) return;
        const url = TILES
          .replace('{z}', z).replace('{x}', job.tx).replace('{y}', job.ty);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const to = setTimeout(() => { try { img.src = ''; } catch (e) {} },
          12000);
        img.onload = () => {
          clearTimeout(to);
          const dx = Math.round((lng2tx(job.tx / Math.pow(2, z) * 360 - 180, z) - txW) * TILE);
          const dy = Math.round((lat2ty(tileLat(job.ty, z), z) - tyN) * TILE);
          try { cx.drawImage(img, dx, dy); ok++; } catch (e) { /* taint */ }
          done++; if (done >= total) finish(); else next();
        };
        img.onerror = () => { clearTimeout(to); done++; next(); };
        // v-fix(sat-browser) v1.4.1: THE device bug — the Node path feeds
        // the Image a Buffer (node-canvas requirement), but `Buffer` does
        // not exist in a browser, so every tile threw, the 60% gate tripped
        // and James's phone always fell back to topo colours. Browser path:
        // assign the URL directly (Esri sends ACAO:*; crossOrigin is set).
        if (typeof Buffer !== 'undefined') {
          fetch(url).then(r => {
            if (!r.ok) throw 0;
            return r.arrayBuffer();
          }).then(buf => { img.src = Buffer.from(buf); })
            .catch(() => { done++; next(); });
        } else {
          img.src = url;
        }
      };
      for (let i = 0; i < Math.min(CONCURRENCY, total); i++) next();
      if (!total) finish();
      setTimeout(finish, 15000 + total / CONCURRENCY * 12000);
    });
  }

  // tile y-index → latitude of its northern edge (for mosaic placement).
  function tileLat(ty, z) {
    const n = Math.pow(2, z);
    const y = ty / n;
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  }

  function makeSampler(state, bbox) {
    const [w, s, e, n] = bbox;
    const pxX = state.w / (e - w);
    const pxY = state.h / (n - s);
    const cx2 = state.canvas.getContext('2d', { willReadFrequently: true });
    let cache = null;
    return (lon, lat) => {
      const x = Math.floor((lon - w) * pxX);
      const y = Math.floor((n - lat) * pxY);
      if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
      if (!cache || cache.x !== x || cache.y !== y) {
        const d = cx2.getImageData(x, y, 1, 1).data;
        cache = { x, y, rgb: [d[0], d[1], d[2]] };
      }
      return cache.rgb;
    };
  }

  window.CaddySat = { load, makeSampler };
})();
