/* e2e_v181.js — v1.18.1: honest-unmapped for area-scoped courses (no
   neighbour import), honest message on both Prep + Round paths.
   Overpass is stubbed at the network boundary. Run: node .gtds/e2e_v181.js */
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
// v1.18.1 E2E: the prep search needs location before it queries — stub
// geolocation at Jester Park BEFORE app.js evaluates.
window.navigator.geolocation = {
  getCurrentPosition: (ok) => ok({
    coords: { latitude: 41.5931, longitude: -93.8829, accuracy: 12 },
  }),
  watchPosition: (ok) => { ok({ coords: { latitude: 41.5931,
    longitude: -93.8829, accuracy: 12 } }); return 1; },
  clearWatch: () => {},
};

// Overpass stub at the network layer: the AREA query for the executive
// returns ZERO golf=hole ways (unmapped); the RADIUS query (which would
// vacuum the neighbour) must NEVER be reached for area-scoped courses.
let radiusCalled = 0;
window.fetch = async (url) => {
  const u = String(url);
  if (window.__e2eLogFetch) console.log('   fetch:', u.slice(0, 110));
  const jsonBody = (obj) => {
    const t = JSON.stringify(obj);
    return { ok: true, text: async () => t, json: async () => obj };
  };
  if (u.includes('overpass')) {
    const q = decodeURIComponent(u);
    if (q.includes('area(')) {
      // executive course area exists but has no holes
      return jsonBody({ elements: [
        // only a clubhouse-ish node, NO golf=hole
        { type: 'node', id: 1, lat: 41.59, lon: -93.88,
          tags: { golf: 'tee' } },
      ] });
    }
    radiusCalled += 1;
    return jsonBody({ elements: [
      // neighbour's full 18 would land here
      { type: 'way', id: 99, tags: { golf: 'hole', ref: '1' },
        geometry: [{ lat: 41.59, lon: -93.88 },
                   { lat: 41.591, lon: -93.881 }] },
    ] });
  }
  if (u.includes('photon')) {
    return jsonBody({ features: [
      { properties: { osm_type: 'W', osm_id: 555, name:
        'Jester Park Executive Course', osm_key: 'leisure',
        osm_value: 'golf_course' },
        geometry: { coordinates: [-93.88, 41.59] } },
    ] });
  }
  throw new Error('offline: ' + u.slice(0, 60));
};
global.fetch = window.fetch;

window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

window.__e2eLogFetch = true;
setTimeout(async () => {
  // Drive the REAL user path: prep search → result row → import. The
  // import pipeline is inside the app IIFE; the UI is the contract.
  window.eval(`
    (async () => {
      const input = document.getElementById('planCourseSearch');
      input.value = 'Jester Park Executive Course';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  setTimeout(() => {
    const row = window.document.querySelector('.prep-search-row');
    if (row) row.click();
    setTimeout(() => {
      const resEl = window.document.getElementById('planCourseSearchResults') || {};
      console.log('   debug: results html:', (resEl.innerHTML||'(none)').slice(0,140));
      const status = (window.document.querySelector(
        '.prep-search-status') || {}).textContent || '';
      check('1. executive course → honest unmapped message',
        /isn't mapped in OpenStreetMap yet/.test(status),
        status.slice(0, 90));
      check('2. message names the executive (not the 18-hole course)',
        /Executive/.test(status), status.slice(0, 90));
      check('3. radius fallback NOT used for area courses',
        radiusCalled === 0, `radius calls: ${radiusCalled}`);
      console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.18.1 PASSED');
      process.exit(fails ? 1 : 0);
    }, 2500);
  }, 900);
}, 800);
