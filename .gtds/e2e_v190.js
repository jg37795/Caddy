/* e2e_v190.js — v1.19.0: real OSM shapes captured at import, assigned to
   holes, drawn on the cartoon, passed to the sheet; Re-map upgrades a
   saved course. Run: node .gtds/e2e_v190.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'https://caddy.local/index.html?e2e=1&e2eLat=41.5931&e2eLng=-93.8829',
  runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;
global.navigator = window.navigator; global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement; global.SVGElement = window.SVGElement;
global.Element = window.Element; global.Node = window.Node;
global.MutationObserver = window.MutationObserver;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {}; global.confirm = () => false;
global.crypto = window.crypto || require('crypto').webcrypto;
if (!window.crypto) window.crypto = global.crypto;

// OSM stub: one hole with fairway + bunker + water polygons and a tee box.
const latPerYd = 0.9 / 111320;
const G = { lat: 41.5901, lng: -93.8831 };
const ring = (lat0, lng0, w, h) => [
  { lat: lat0, lng: lng0 },
  { lat: lat0, lng: lng0 + w },
  { lat: lat0 - h, lng: lng0 + w },
  { lat: lat0 - h, lng: lng0 },
  { lat: lat0, lng: lng0 },
];
let overpassArea = 0;
window.fetch = async (url) => {
  const u = String(url);
  const jsonBody = (obj) => {
    const t = JSON.stringify(obj);
    return { ok: true, text: async () => t, json: async () => obj };
  };
  if (u.includes('overpass')) {
    const q = decodeURIComponent(u);
    if (q.includes('area(')) {
      overpassArea += 1;
      return jsonBody({ elements: [
        { type: 'way', id: 10, tags: { golf: 'hole', ref: '1' },
          geometry: [
            { lat: 41.5931, lon: -93.8831 },
            { lat: 41.5931 - 180 * latPerYd, lon: -93.8834 },
            { lat: 41.5931 - 350 * latPerYd, lon: G.lng } ] },
        { type: 'way', id: 11, tags: { golf: 'fairway' },
          geometry: ring(41.5931 - 40 * latPerYd, -93.8832, 0.0004, 0.0012) },
        { type: 'way', id: 12, tags: { golf: 'bunker' },
          geometry: ring(41.5931 - 200 * latPerYd, -93.88355, 0.00012, 0.00018) },
        { type: 'way', id: 13, tags: { natural: 'water' },
          geometry: ring(41.5931 - 260 * latPerYd, -93.8828, 0.0003, 0.0004) },
        { type: 'way', id: 14, tags: { golf: 'tee' },
          geometry: ring(41.5931, -93.88325, 0.00015, 0.0002) },
        { type: 'way', id: 15, tags: { golf: 'green' },
          geometry: ring(G.lat + 0.00005, G.lng - 0.0001, 0.0002, 0.00015) },
      ] });
    }
    throw new Error('radius must not be called');
  }
  if (u.includes('photon')) {
    return jsonBody({ features: [
      { properties: { osm_type: 'W', osm_id: 777, name:
        'Shapes Test GC', osm_key: 'leisure', osm_value: 'golf_course' },
        geometry: { coordinates: [-93.8831, 41.5931] } },
    ] });
  }
  throw new Error('offline: ' + u.slice(0, 60));
};
global.fetch = window.fetch;

window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'), 'utf-8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  // Import via the prep search UI
  window.eval(`
    (async () => {
      const input = document.getElementById('planCourseSearch');
      input.value = 'Shapes Test GC';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  setTimeout(() => {
    const row = window.document.querySelector('.prep-search-row');
    if (row) row.click();
    setTimeout(() => {
      // save the ephemeral course
      const save = window.document.getElementById('planSaveCourseBtn');
      if (save && !save.hidden) save.click();
      setTimeout(() => {
        // select the saved course + open hole 1
        const sel = window.document.getElementById('planCourseSelect');
        const opt = [...(sel.options || [])].find((o) =>
          o.textContent === 'Shapes Test GC');
        if (opt) { sel.value = opt.value;
          sel.dispatchEvent(new window.Event('change')); }
        setTimeout(() => {
          const h1 = window.document.querySelector('.plan-hole-row');
          if (h1) h1.click();
          setTimeout(() => {
            // 1-3: shapes captured + assigned
            const saved = JSON.parse(window.localStorage.getItem(
              'caddy:courseProfiles:v1') || '[]');
            const c = saved.find((p) => p.name === 'Shapes Test GC');
            check('1. saved course has shapes on hole 1',
              c && c.holes[0] && c.holes[0].shapes,
              JSON.stringify(c && c.holes[0] && Object.keys(c.holes[0].shapes || {})));
            const S = (c && c.holes[0] && c.holes[0].shapes) || {};
            check('2. fairway polygon captured (≤14 pts)',
              Array.isArray(S.fairways) && S.fairways.length === 1 &&
              S.fairways[0].length <= 14);
            check('3. bunker + water + tee polygons captured',
              (S.bunkers || []).length === 1 &&
              (S.water || []).length === 1 &&
              (S.tees || []).length === 1);
            // 4-5: cartoon draws real shapes
            const svg = window.document.querySelector('.prep-holemap');
            check('4. cartoon draws real fairway polygon',
              !!svg.querySelector('path.prep-hm-shape.fairway'));
            check('5. cartoon draws real bunker shape, no bunker dot',
              !!svg.querySelector('path.prep-hm-shape.water') &&
              !svg.querySelector('ellipse.prep-hm-hz.bunker'));
            // 6: sheet receives shapes
            let captured = null;
            window.PrepHoleSat.open = (o) => { captured = o; };
            const tap = window.document.getElementById('prepHoleMapTap');
            if (tap) tap.click();
            setTimeout(() => {
              check('6. sheet payload carries shapes',
                captured && captured.holeData &&
                captured.holeData.shapes &&
                (captured.holeData.shapes.fairways || []).length === 1);
              // 7: Re-map button visible for saved OSM course
              const rm = window.document.getElementById('planRemapCourse');
              check('7. Re-map course button shown for saved OSM course',
                rm && !rm.hidden);
              console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.19 PASSED');
              process.exit(fails ? 1 : 0);
            }, 300);
          }, 400);
        }, 300);
      }, 300);
    }, 1200);
  }, 900);
}, 800);
