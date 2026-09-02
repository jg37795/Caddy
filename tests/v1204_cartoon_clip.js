/* ==========================================================================
   tests/v1204_cartoon_clip.js — Prep cartoon: this-hole + in-play hazards
   --------------------------------------------------------------------------
   Guards the v1.20.4 clip/assignment model James approved:

     1. Water/bunkers assign by path-to-polygon distance (not centroid).
     2. Fairway/rough/tees are exclusive (nearest; path-through always keeps).
     3. Cartoon actually draws bunker polygons.
     4. Camera keeps the hole dominant; unused far water clips at the frame.
     5. Greenside fallback dots past the card number still draw.

   Run: node tests/v1204_cartoon_clip.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const LAT0 = 41.5931;
const LNG0 = -93.8831;
const latPerYd = 0.9144 / 111320;
const lngPerYd = 0.9144 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const ll = (northYd, eastYd) => ({
  lat: LAT0 + northYd * latPerYd,
  lng: LNG0 + eastYd * lngPerYd,
});
const geom = (pts) => pts.map((p) => ({ lat: p.lat, lon: p.lng }));
const closed = (pts) => geom(pts.concat([pts[0]]));
const rect = (n0, e0, nSize, eSize) => closed([
  ll(n0, e0),
  ll(n0, e0 + eSize),
  ll(n0 - nSize, e0 + eSize),
  ll(n0 - nSize, e0),
]);

const dom = new JSDOM(html, {
  url: `https://caddy.local/index.html?e2e=1&e2eLat=${LAT0}&e2eLng=${LNG0}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
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

window.fetch = async (url) => {
  const u = String(url);
  const jsonBody = (obj) => {
    const t = JSON.stringify(obj);
    return { ok: true, text: async () => t, json: async () => obj };
  };
  if (u.includes('photon')) {
    return jsonBody({
      features: [{
        properties: {
          osm_type: 'W', osm_id: 777, name: 'Clip Test GC',
          osm_key: 'leisure', osm_value: 'golf_course',
        },
        geometry: { coordinates: [LNG0, LAT0] },
      }],
    });
  }
  if (u.includes('overpass')) {
    const q = decodeURIComponent(u);
    if (!q.includes('area(')) throw new Error('radius must not be called');
    return jsonBody({
      elements: [
        // Hole 1: due south 350 yd, east=0
        { type: 'way', id: 10, tags: { golf: 'hole', ref: '1' },
          geometry: geom([ll(0, 0), ll(-175, 0), ll(-350, 0)]) },
        // Hole 2: parallel, 40 yd east
        { type: 'way', id: 20, tags: { golf: 'hole', ref: '2' },
          geometry: geom([ll(0, 40), ll(-175, 40), ll(-350, 40)]) },
        // Hole 3: far away, short, for greenside-dot fallback
        { type: 'way', id: 30, tags: { golf: 'hole', ref: '3' },
          geometry: geom([ll(0, 400), ll(-75, 400), ll(-150, 400)]) },

        // Hole 1 turf — path runs through it
        { type: 'way', id: 11, tags: { golf: 'fairway' },
          geometry: rect(10, -15, 370, 30) },
        // Neighbour turf around hole 2 (centroid ~40 yd from hole 1)
        { type: 'way', id: 21, tags: { golf: 'fairway' },
          geometry: rect(10, 25, 370, 30) },

        // Wide water LEFT of hole 1: shoreline 20 yd off, centroid ~120 yd off
        { type: 'way', id: 16, tags: { natural: 'water' },
          geometry: rect(-200, -220, 140, 200) },

        // Shared bunker between 1 and 2 (~20 yd from both paths)
        { type: 'way', id: 12, tags: { golf: 'bunker' },
          geometry: rect(-190, 12, 20, 16) },
        // FOREIGN bunker: 60 yd right of hole 1's path, outside hole 1's
        // turf/green — assigned by the 90 yd corridor but NOT on hole 1.
        { type: 'way', id: 13, tags: { golf: 'bunker' },
          geometry: rect(-120, 60, 16, 16) },

        // Greenside POINT bunker past hole 3's green (no polygon on hole 3)
        { type: 'node', id: 31, tags: { golf: 'bunker' },
          lat: ll(-160, 408).lat, lon: ll(-160, 408).lng },

        { type: 'way', id: 15, tags: { golf: 'green' },
          geometry: rect(-340, -10, 20, 20) },
        { type: 'way', id: 25, tags: { golf: 'green' },
          geometry: rect(-340, 30, 20, 20) },
        { type: 'way', id: 35, tags: { golf: 'green' },
          geometry: rect(-140, 390, 20, 20) },
      ],
    });
  }
  throw new Error('offline: ' + u.slice(0, 60));
};
global.fetch = window.fetch;

window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); }
};

function profiles() {
  try {
    return JSON.parse(window.localStorage.getItem('caddy:courseProfiles:v1') || '[]');
  } catch { return []; }
}
function course() {
  return profiles().find((p) => p.name === 'Clip Test GC');
}
function svg() {
  return window.document.querySelector('.prep-holemap');
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const input = window.document.getElementById('planCourseSearch');
  input.value = 'Clip Test GC';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(900);
  const row = window.document.querySelector('.prep-search-row');
  check('search returned Clip Test GC', !!row);
  if (row) row.click();
  await wait(1400);
  const save = window.document.getElementById('planSaveCourseBtn');
  if (save && !save.hidden) save.click();
  await wait(250);
  const sel = window.document.getElementById('planCourseSelect');
  const opt = [...(sel.options || [])].find((o) =>
    String(o.textContent || '').includes('Clip Test GC'));
  check('saved course in picker', !!opt);
  if (opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new window.Event('change'));
  }
  await wait(250);

  const c = course();
  check('course saved', !!c);
  const h1 = c && c.holes && c.holes[0];
  const h2 = c && c.holes && c.holes[1];
  const h3 = c && c.holes && c.holes[2];
  const S1 = (h1 && h1.shapes) || {};
  const S2 = (h2 && h2.shapes) || {};
  const S3 = (h3 && h3.shapes) || {};

  check('1. donut/wide water assigned to hole 1 (shoreline 20 yd, centroid 120 yd)',
    Array.isArray(S1.water) && S1.water.length >= 1,
    `water rings: ${(S1.water || []).length}`);

  const h1Fw = (S1.fairways || []).length;
  const h2Fw = (S2.fairways || []).length;
  check('2. neighbour grass is exclusive (each hole keeps its own fairway, not the other)',
    h1Fw === 1 && h2Fw === 1,
    `h1 fairways=${h1Fw} h2 fairways=${h2Fw}`);

  check('3. shared bunker still ASSIGNED to hole 1 and hole 2 (90 yd in-play)',
    (S1.bunkers || []).length >= 1 && (S2.bunkers || []).length >= 1,
    `h1 bunkers=${(S1.bunkers || []).length} h2=${(S2.bunkers || []).length}`);

  check('3b. hole 3 has no bunker polygon (point-only greenside)',
    !(S3.bunkers && S3.bunkers.length),
    `h3 bunkers=${(S3.bunkers || []).length}`);

  const rows = [...window.document.querySelectorAll('.plan-hole-row')];
  const row1 = rows.find((r) => r.dataset.hole === '1');
  check('hole 1 row present', !!row1);
  if (row1) row1.click();
  await wait(80);

  const svg1 = svg();
  check('4. cartoon draws bunker polygon (not only water)',
    !!(svg1 && svg1.querySelector('path.prep-hm-shape.bunker')),
    svg1 ? `paths=${[...svg1.querySelectorAll('path')].map((p) => p.getAttribute('class')).join('|')}` : 'no svg');
  check('4b. cartoon draws the in-play water',
    !!(svg1 && svg1.querySelector('path.prep-hm-shape.water')));
  check('4c. bunker dots skipped when a bunker polygon was drawn',
    !!(svg1 && !svg1.querySelector('ellipse.prep-hm-hz.bunker')));

  const tee = svg1 && svg1.querySelector('circle.prep-hm-tee');
  const flag = svg1 && svg1.querySelector('path.prep-hm-flag');
  const teeX = tee ? Number(tee.getAttribute('cx')) : NaN;
  let flagX = NaN;
  if (flag) {
    const d = flag.getAttribute('d') || '';
    const m = /M\s+(-?[\d.]+)/.exec(d);
    if (m) flagX = Number(m[1]);
  }
  const span = flagX - teeX;
  check('5. camera ignores far water (hole fills the card; pond does not pick zoom)',
    Number.isFinite(span) && span > 200,
    `span=${Number.isFinite(span) ? span.toFixed(1) : 'na'} teeX=${teeX} flagX=${flagX}`);
  check('5b. hole still reads left→right (tee left of flag, span > 80)',
    Number.isFinite(span) && span > 80,
    `teeX=${teeX} flagX=${flagX} span=${span}`);
  check('4c. water is clipped to the hole footprint (clipPath on the cartoon)',
    !!(svg1 && svg1.querySelector('clipPath')),
    svg1 ? 'no clipPath' : 'no svg');
  const bunkerD1 = ((svg1 && svg1.querySelector('path.prep-hm-shape.bunker')) ||
    { getAttribute: () => '' }).getAttribute('d') || '';
  const bunkerM1 = (bunkerD1.match(/\bM\b/g) || []).length;
  check('4d. foreign bunker (other hole) does not render on hole 1',
    bunkerM1 === 1,
    `bunker M count=${bunkerM1}`);

  const row3 = rows.find((r) => r.dataset.hole === '3');
  if (row3) row3.click();
  await wait(250);
  const svg3 = svg();
  const hz3 = (h3 && h3.hazards) || [];
  check('6a. hole 3 stored a greenside bunker point',
    hz3.some((hz) => hz && hz.type === 'bunker'),
    JSON.stringify(hz3).slice(0, 180));
  check('6b. hole 3 did not inherit hole 1 water',
    !(S3.water && S3.water.length),
    `h3 water=${(S3.water || []).length} fairways=${(S3.fairways || []).length}`);
  const svg3cls = svg3
    ? [...svg3.querySelectorAll('path,ellipse,circle')].map((p) => p.getAttribute('class')).join('|')
    : 'no svg';
  check('6. greenside bunker past the card number still draws as a fallback ellipse',
    !!(svg3 && svg3.querySelector('ellipse.prep-hm-hz.bunker')),
    svg3cls);

  if (fails) {
    console.log(`${fails} FAILURE(S)`);
    process.exit(1);
  }
  console.log('v1.20.4 CARTOON CLIP PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL - harness threw', e && e.stack || e);
  process.exit(1);
});
