/* ==========================================================================
   tests/v1213_holesat.js — Satellite sheet is THIS HOLE ONLY (James)
   --------------------------------------------------------------------------
     1. Neighbour features do NOT render: only this hole's assigned
        shapes (hole.shapes) + its own green ring/path paint.
     2. The thick green ribbon (weight 26/30) under the shot line is GONE.
     3. Leaflet zoom has no artificial cap (minZoom not set above default).
     4. The live Overpass "context" fetch for neighbour greens/holes is
        gone (that was the second source of other-hole features).

   Run: node tests/v1213_holesat.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const LAT0 = 41.778;
const LNG0 = -93.782;
const latPerYd = 0.9144 / 111320;
const lngPerYd = 0.9144 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const ll = (n, e) => ({ lat: LAT0 + n * latPerYd, lng: LNG0 + e * lngPerYd });
const geom = (pts) => pts.map((p) => ({ lat: p.lat, lon: p.lng }));
const closed = (pts) => geom(pts.concat([pts[0]]));
const rect = (n0, e0, nS, eS) => closed([
  ll(n0, e0), ll(n0, e0 + eS), ll(n0 - nS, e0 + eS), ll(n0 - nS, e0),
]);
// stored-shape rings keep {lat, lng} (what prep.js's math expects)
const rectN = (n0, e0, nS, eS) => ([
  ll(n0, e0), ll(n0, e0 + eS), ll(n0 - nS, e0 + eS), ll(n0 - nS, e0), ll(n0, e0),
]);

let leafletCalls = [];
function fakeLayer(kind, opts) {
  return {
    __kind: kind, __opts: opts || {},
    __ll: (opts && opts.ll) || null,
    addTo() { leafletCalls.push([kind, this.__opts]); return this; },
    on() { return this; },
  };
}
const FAKE_L = {
  control: {
    zoom: () => ({ addTo: () => {} }),
    scale: () => ({ addTo: () => {} }),
    layers: () => ({ addTo: () => {} }),
    attribution: () => ({ addTo: () => {} }),
  },
  DomEvent: new Proxy({}, { get: () => () => {} }),
  DomUtil: new Proxy({}, { get: () => () => '' }),
  layerGroup: (children) => {
    const g = fakeLayer('group');
    g.__children = children;
    return g;
  },
  circle: (ll, o) => fakeLayer('circle', { ll, o }),
  latLngBounds: (arr) => ({
    extend() { return this; },
    pad: () => ({ getNorth: () => 0, getSouth: () => 0,
      getEast: () => 0, getWest: () => 0 }),
    isValid: () => true,
  }),
  map: (id, opts) => {
    leafletCalls.push(['map', opts || {}]);
    return {
      setView() { return this; },
      addLayer() { return this; },
      removeLayer() { return this; },
      hasLayer: () => false,
      getPane: () => ({ style: {} }),
      createPane: () => ({ style: {} }),
      getBounds: () => ({ pad: () => ({}) }),
      on() { return this; },
      off() { return this; },
      fitBounds() { return this; },
      invalidateSize() { return this; },
      remove() { return this; },
      __opts: opts || {},
    };
  },
  tileLayer: () => fakeLayer('tile'),
  polyline: (ll, o) => fakeLayer('polyline', Object.assign({ __ll: ll }, o)),
  polygon: (ll, o) => fakeLayer('polygon', Object.assign({ __ll: ll }, o)),
  circleMarker: (ll, o) => fakeLayer('circle', Object.assign({ __ll: ll }, o)),
  marker: (ll, o) => fakeLayer('marker', Object.assign({ __ll: ll }, o)),
  divIcon: (o) => o,
};

const dom = new JSDOM(html, {
  url: `https://caddy.local/index.html?e2e=1&e2eLat=${LAT0}&e2eLng=${LNG0}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
window.L = FAKE_L;
global.L = FAKE_L;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.SVGElement = window.SVGElement;
global.Element = window.Element;
global.Node = window.Node;
global.MutationObserver = window.MutationObserver;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {};
global.confirm = () => false;
global.crypto = window.crypto || require('crypto').webcrypto;
if (!window.crypto) window.crypto = global.crypto;

window.L = global.L = window.L || window.L;
window.fetch = async (url) => {
  const u = String(url);
  const jsonBody = (obj) => ({
    ok: true, text: async () => JSON.stringify(obj), json: async () => obj,
  });
  if (u.includes('overpass')) {
    // LIVE context query — if the sheet still fires it, this returns
    // neighbour features that must NOT be drawn.
    return jsonBody({
      elements: [
        { type: 'way', tags: { golf: 'green' },
          geometry: [ { lat: LAT0 - 30 * latPerYd, lon: LNG0 - 30 * lngPerYd },
            { lat: LAT0 - 31 * latPerYd, lon: LNG0 - 31 * lngPerYd },
            { lat: LAT0 - 29 * latPerYd, lon: LNG0 - 29 * lngPerYd } ] },
        { type: 'way', tags: { golf: 'hole' },
          geometry: [ { lat: LAT0 - 30 * latPerYd, lon: LNG0 - 30 * lngPerYd },
            { lat: LAT0 - 31 * latPerYd, lon: LNG0 - 31 * lngPerYd } ] },
      ],
    });
  }
  throw new Error('offline: ' + u.slice(0, 50));
};
global.fetch = window.fetch;

// v1.21.4: seed the course BEFORE app.js boots (state.courseProfiles
// loads at boot; later localStorage writes are invisible to it).
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([{
  id: 'test-course', name: 'Sat Test GC', holesCount: 9,
  teeName: 'Regular tees', source: 'manual', updatedAt: Date.now(),
  holes: Array.from({ length: 9 }, (_, i) => ({
    number: i + 1, par: 4, yards: 387, source: 'manual',
    pathPts: [ll(0, 0), ll(-190, 4), ll(-380, 0)],
    greenRingPts: rect(-392, -10, 18, 20),
    teePoint: ll(0, 0), greenCenter: ll(-390, 0),
    shapes: {
      fairways: [rectN(8, -14, 396, 28)],
      rough: [rectN(14, -26, 408, 52)],
      water: [
        rectN(-160, 5, 40, 40),    // ON hole: cross 5..45, strip clips it
        rectN(-320, -120, 30, 30), // FOREIGN: cross -150..-120
      ],
      tees: [rectN(6, -8, 12, 16)],
      bunkers: [rectN(-100, 30, 12, 14)],
    },
    hazards: [
      { type: 'bunker', lat: ll(-100, -10).lat, lng: ll(-100, -10).lng },
      { type: 'water', lat: ll(-200, -60).lat, lng: ll(-200, -60).lng },
    ],
  })),
}]));

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'), 'utf-8'));

let captured = null;
let satOpenCalls = 0;
const realOpen = window.PrepHoleSat.open;
window.PrepHoleSat.open = (o) => { satOpenCalls++; captured = o; };

let fails = 0;
const check = (n, c, d) => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const holeData = {
    par: 4, yards: 387,
    pathPts: [ll(0, 0), ll(-190, 4), ll(-380, 0)],
    greenRingPts: rect(-392, -10, 18, 20),
    teePoint: ll(0, 0),
    greenCenter: ll(-390, 0),
    shapes: {
      fairways: [rect(8, -14, 396, 28)],
      rough: [rect(14, -26, 408, 52)],
      water: [rect(-160, -90, 60, 80)],
      tees: [rect(6, -8, 12, 16)],
      bunkers: [rect(-100, 30, 12, 14)],
    },
    hazards: [{ type: 'bunker', lat: ll(-100, 34).lat, lng: ll(-100, 34).lng }],
  };
  leafletCalls = [];
  window.PrepHoleSat.open = realOpen;   // real sheet for the layer checks
  window.PrepHoleSat.open({
    greenLatLng: ll(-390, 0),
    courseId: 'test-course',
    hole: 1,
    holeData,
    teeLL: ll(0, 0),
  });
  await wait(120);
  // close the real sheet so the later stubbed open isn't guarded out
  const doneBtn = window.document.getElementById('pshDone');
  if (doneBtn) doneBtn.click();
  await wait(50);

  const mapCall = leafletCalls.find((c) => c[0] === 'map');
  check('sheet opens with a map', !!mapCall);
  check('3. no artificial zoom cap on the satellite map',
    mapCall && mapCall[1] && (mapCall[1].minZoom == null ||
      mapCall[1].minZoom <= 2),
    `map opts minZoom=${mapCall && mapCall[1] && mapCall[1].minZoom}`);

  const polys = leafletCalls.filter((c) => c[0] === 'polygon');
  const lines = leafletCalls.filter((c) => c[0] === 'polyline');
  // thick ribbon detection: ANY polyline/polygon stroke with weight >= 20
  // (the old dark halo 30 + green band 26 pair)
  const thick = [...lines, ...polys].filter((c) => {
    const o = c[1] || {};
    return (o.weight || 0) >= 20;
  });
  check('2. the thick green fairway ribbon is gone (no weight>=20 strokes)',
    thick.length === 0,
    `thick=${thick.map((c) => JSON.stringify(c[1])).join('|')}`);

  // Neighbour features: the live Overpass context (30 yd away) must NOT
  // produce layers. Fetch is stubbed to return them; if the sheet still
  // renders context, a polygon/line at exactly those coords appears.
  await wait(150);
  const neighbourLat = LAT0 - 30 * latPerYd;
  const usesNeighbour = [...polys, ...lines].some((c) => {
    const arg = c[1] && c[1].__ll;
    if (!Array.isArray(arg) || !arg.length) return false;
    return Math.abs(arg[0][0] - neighbourLat) < 1e-12;
  });
  check('1. neighbour hole/green context does NOT render (this hole only)',
    !usesNeighbour,
    'found a layer at the neighbour fixture coords');

  // This hole's own shapes DO render
  const ownFairway = polys.some((c) => {
    const arg = c[1] && c[1].__ll;
    return Array.isArray(arg) && arg.length >= 3 &&
      Math.abs(arg[0][0] - rect(8, -14, 396, 28)[0].lat) < 1e-12;
  });
  check('1b. this hole\'s own fairway polygon renders',
    ownFairway);

  // v1.21.4: the PAYLOAD the caller hands the sheet is filtered to the
  // cartoon's gates. Drive the real prep pipeline: seed the course,
  // select it, bind hole 1, tap the cartoon.
  leafletCalls = [];
  window.PrepHoleSat.open = (o) => { satOpenCalls++; captured = o; };
window.localStorage.setItem('caddy:onboarded', '1');
  // Rebind through the real prep pipeline: select the course, bind hole 1.
  const selEl = window.document.getElementById('planCourseSelect');
  if (selEl) {
    const opt = [...selEl.options].find((o) =>
      String(o.textContent || '').includes('Sat Test GC'));
    if (opt) {
      selEl.value = opt.value;
      selEl.dispatchEvent(new window.Event('change'));
    }
  }
  await wait(300);
  const rowsAfter = [...window.document.querySelectorAll('.plan-hole-row')];
  const rowEl = rowsAfter.find((r) => r.dataset.hole === '1');
  if (rowEl) rowEl.click();
  await wait(500);
  captured = null;
  const tapEl = window.document.getElementById('prepHoleMapTap');
  if (tapEl) {
    tapEl.dispatchEvent(new window.MouseEvent('click', {
      bubbles: true, cancelable: true,
    }));
  }
  await wait(250);
  check('4. sat payload water = only rings on this hole (foreign ring dropped)',
    captured && captured.holeData && Array.isArray(captured.holeData.shapes.water) &&
      captured.holeData.shapes.water.length === 1,
    `open=${satOpenCalls} ` + (captured && captured.holeData
      ? `water=${(captured.holeData.shapes.water || []).length}`
      : 'no capture'));
  check('5. sat payload hazards = only strip points (off-strip water point dropped)',
    captured && captured.holeData && captured.holeData.hazards.length === 1 &&
      captured.holeData.hazards[0].type === 'bunker',
    captured && captured.holeData
      ? `hazards=${captured.holeData.hazards.length}` : 'no capture');

  if (fails) {
    console.log(`${fails} FAILURE(S)`);
    process.exit(1);
  }
  console.log('v1.21.3 HOLESAT PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL - harness threw', e && e.stack || e);
  process.exit(1);
});
