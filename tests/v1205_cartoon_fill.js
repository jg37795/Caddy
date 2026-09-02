/* ==========================================================================
   tests/v1205_cartoon_fill.js — Prep cartoon: solid pond, hole fills card,
   2-point OSM holes are real (James screenshots, Jester Park Executive).
   --------------------------------------------------------------------------
     1. Duplicate water (way + opposite-wound relation of the SAME pond)
        assigns as ONE ring — even-odd fill no longer cancels to an outline.
     2. Camera: tee→green fills the card width (no 110 yd height floor
        shrinking a 164 yd par 3 to half the viewBox).
     3. A 2-point OSM hole way still stores pathPts and draws real OSM
        polygons — not the generic sausage band.

   Run: node tests/v1205_cartoon_fill.js
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
const rectRev = (n0, e0, nSize, eSize) => closed([
  ll(n0, e0),
  ll(n0 - nSize, e0),
  ll(n0 - nSize, e0 + eSize),
  ll(n0, e0 + eSize),
]);

const NAME = 'Fill Test GC';
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
          osm_type: 'R', osm_id: 888, name: NAME,
          osm_key: 'leisure', osm_value: 'golf_course',
        },
        geometry: { coordinates: [LNG0, LAT0] },
      }],
    });
  }
  if (u.includes('overpass')) {
    const q = decodeURIComponent(u);
    if (!q.includes('area(')) throw new Error('radius must not be called');
    // Hole 1: 164 yd dogleg (3 pts) — Jester exec hole 1 analogue.
    // Pond LEFT of the hole, ~20 yd off the line, ~90 yd across.
    // Mapped TWICE: a way AND a relation of the same ring, opposite winding
    // (the even-odd cancel that left only a blue outline).
    const pondWay = rect(-40, -110, 90, 90);
    const pondRelOuter = rectRev(-40, -110, 90, 90);
    return jsonBody({
      elements: [
        { type: 'way', id: 10, tags: { golf: 'hole', ref: '1' },
          geometry: geom([ll(0, 0), ll(-80, 20), ll(-164, 0)]) },
        // Hole 3: 2-point OSM way (Jester exec hole 3) + real fairway.
        { type: 'way', id: 30, tags: { golf: 'hole', ref: '3' },
          geometry: geom([ll(0, 400), ll(-143, 400)]) },

        { type: 'way', id: 11, tags: { golf: 'fairway' },
          geometry: rect(8, -12, 180, 28) },
        { type: 'way', id: 31, tags: { golf: 'fairway' },
          geometry: rect(8, 388, 160, 24) },

        { type: 'way', id: 16, tags: { natural: 'water' },
          geometry: pondWay },
        { type: 'relation', id: 115195, tags: { golf: 'lateral_water_hazard' },
          members: [{ role: 'outer', geometry: pondRelOuter }] },

        { type: 'way', id: 15, tags: { golf: 'green' },
          geometry: rect(-154, -10, 18, 20) },
        { type: 'way', id: 35, tags: { golf: 'green' },
          geometry: rect(-133, 390, 18, 20) },
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function course() {
  try {
    const arr = JSON.parse(window.localStorage.getItem('caddy:courseProfiles:v1') || '[]');
    return arr.find((p) => p.name === NAME);
  } catch { return null; }
}
function svg() { return window.document.querySelector('.prep-holemap'); }

(async () => {
  const input = window.document.getElementById('planCourseSearch');
  input.value = NAME;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(900);
  const row = window.document.querySelector('.prep-search-row');
  check('search returned ' + NAME, !!row);
  if (row) row.click();
  await wait(1400);
  const save = window.document.getElementById('planSaveCourseBtn');
  if (save && !save.hidden) save.click();
  await wait(250);
  const sel = window.document.getElementById('planCourseSelect');
  const opt = [...(sel.options || [])].find((o) =>
    String(o.textContent || '').includes(NAME));
  check('saved course in picker', !!opt);
  if (opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new window.Event('change'));
  }
  await wait(250);

  const c = course();
  check('course saved', !!c);
  const h1 = c && c.holes && c.holes[0];
  const h3 = c && c.holes && c.holes[2];
  const S1 = (h1 && h1.shapes) || {};
  const S3 = (h3 && h3.shapes) || {};

  check('1. duplicate pond (way+relation) assigns as ONE water ring',
    Array.isArray(S1.water) && S1.water.length === 1,
    `water rings=${(S1.water || []).length}`);

  check('2. 2-point OSM hole 3 still stores pathPts',
    Array.isArray(h3 && h3.pathPts) && h3.pathPts.length === 2,
    h3 ? `pathPts=${h3.pathPts && h3.pathPts.length}` : 'no hole 3');
  check('2b. hole 3 got its OSM fairway (not dropped with the 2-pt path)',
    Array.isArray(S3.fairways) && S3.fairways.length >= 1,
    `fairways=${(S3.fairways || []).length}`);

  const rows = [...window.document.querySelectorAll('.plan-hole-row')];
  const row1 = rows.find((r) => r.dataset.hole === '1');
  check('hole 1 row', !!row1);
  if (row1) row1.click();
  await wait(250);

  const svg1 = svg();
  const waterPath = svg1 && svg1.querySelector('path.prep-hm-shape.water');
  const waterD = waterPath ? (waterPath.getAttribute('d') || '') : '';
  const mCount = (waterD.match(/\bM\b/g) || []).length;
  check('3. cartoon water is a single filled ring (not even-odd outline)',
    mCount === 1,
    `M count=${mCount} d=${waterD.slice(0, 80)}`);

  const tee = svg1 && svg1.querySelector('circle.prep-hm-tee');
  const flag = svg1 && svg1.querySelector('path.prep-hm-flag');
  const teeX = tee ? Number(tee.getAttribute('cx')) : NaN;
  let flagX = NaN;
  if (flag) {
    const m = /M\s+(-?[\d.]+)/.exec(flag.getAttribute('d') || '');
    if (m) flagX = Number(m[1]);
  }
  const span = flagX - teeX;
  check('4. hole 1 fills the card (tee→green span > 240 px, not the 110-yd floor)',
    Number.isFinite(span) && span > 240,
    `span=${Number.isFinite(span) ? span.toFixed(1) : 'na'} teeX=${teeX} flagX=${flagX}`);

  const row3 = rows.find((r) => r.dataset.hole === '3');
  if (row3) row3.click();
  await wait(250);
  const svg3 = svg();
  check('5. hole 3 draws OSM fairway polygon, not the generic band',
    !!(svg3 && svg3.querySelector('path.prep-hm-shape.fairway')) &&
      !(svg3 && svg3.querySelector('path.prep-hm-fairway')),
    svg3
      ? [...svg3.querySelectorAll('path')].map((p) => p.getAttribute('class')).join('|')
      : 'no svg');

  if (fails) {
    console.log(`${fails} FAILURE(S)`);
    process.exit(1);
  }
  console.log('v1.20.5 CARTOON FILL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL - harness threw', e && e.stack || e);
  process.exit(1);
});
