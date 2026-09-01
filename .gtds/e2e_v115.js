/* e2e_v115.js — v1.15.0 regression: path-relative hazards + tee anchor
   migration + header back-nav + shot plan. Run: node .gtds/e2e_v115.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'https://caddy.local/index.html',
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
global.fetch = async () => { throw new Error('offline'); };
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

const latPerYd = 0.9 / 111320;
// Dogleg hole: path starts at the tee, bends 40yd right at 60% out.
// TEE (way start) at path[0]; the OLD buggy import anchored teePoint on
// a "women's tee node" 30yd LEFT of the way start — the migration must
// snap it back to the way end farthest from the green.
const wayStart = { lat: 41.5901, lng: -93.8831 };
const yards = 382;
const pathPts = [
  wayStart,
  { lat: wayStart.lat - yards * latPerYd * 0.6, lng: wayStart.lng },
  { lat: wayStart.lat - yards * latPerYd * 0.6,
    lng: wayStart.lng + 40 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180)) },
  { lat: wayStart.lat - yards * latPerYd, lng: wayStart.lng + 40 * 0.9 /
    (111320 * Math.cos(41.59 * Math.PI / 180)) },
];
const greenCenter = pathPts[pathPts.length - 1];
// women's tee node: 30 yd left of the way start
const womensTee = { lat: wayStart.lat,
  lng: wayStart.lng - 30 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180)) };
// bunker 120 yd along the path, 25 yd EAST of the path (east = LEFT of
// the southbound first leg — facing south, left hand points east)
const bunker = { lat: wayStart.lat - 120 * latPerYd,
  lng: wayStart.lng + 25 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180)) };

const hole = {
  number: 1, source: 'openstreetmap', par: 4, yards,
  teePoint: womensTee, teeSource: 'tee',          // the OLD bad anchor
  greenCenter,
  front: { lat: greenCenter.lat + 14 * latPerYd, lng: greenCenter.lng },
  back: { lat: greenCenter.lat - 6 * latPerYd, lng: greenCenter.lng },
  hazards: [{ type: 'bunker', lat: bunker.lat, lng: bunker.lng }],
  pathPts,
};
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:t', name: 'Dogleg Test GC', teeName: 'Red',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18,
    holes: Array.from({ length: 18 }, (_, i) =>
      i === 0 ? hole : { number: i + 1, source: 'manual', par: 4 }),
  }]));
window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  // 1) tee-anchor migration: normalizeCourse snaps the non-manual tee to
  //    the way end farthest from the green.
  const stored = JSON.parse(
    window.localStorage.getItem('caddy:courseProfiles:v1'));
  const migrated = window.CaddyNormalizeCourseForTest
    ? null : null; // normalizeCourse isn't exported; verify through UI path
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:t';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  check('1. hole row rendered', rows.length >= 1);
  rows[0].click();
  setTimeout(() => {
    const body = window.document.getElementById('prepStratBody');
    // 2) tee dot ON the path start: the map SVG's tee circle centre must
    //    be within a few px of the path's first drawn point.
    const svg = body.querySelector('svg.prep-holemap');
    check('2. real-shape map rendered', !!svg);
    const teeC = svg.querySelector('circle.prep-hm-tee');
    const fw = svg.querySelector('path.prep-hm-fairway');
    check('3. tee circle + fairway path present', !!teeC && !!fw);
    if (teeC && fw) {
      const d = fw.getAttribute('d');
      const m = /M\s+([\d.]+)\s+([\d.]+)/.exec(d);
      const dx = Math.abs(parseFloat(teeC.getAttribute('cx')) - parseFloat(m[1]));
      const dy = Math.abs(parseFloat(teeC.getAttribute('cy')) - parseFloat(m[2]));
      check('4. tee dot sits at the path start (<6px)', dx < 6 && dy < 6,
        `d=(${dx.toFixed(1)},${dy.toFixed(1)})`);
    }
    // 3) hazard text is path-relative and says LEFT (east of a southbound
    //    leg). Note: the "along" is walked distance (≈117 yd after
    //    snapping to path vertices) — regex tolerant on the exact figure.
    const hzText = body.textContent;
    check('5. hazard text path-relative (left, ~11x yd)',
      /left,\s*~1\d\d yd/.test(hzText),
      (hzText.match(/Bunker[^\n]*?yd off the tee/) || [''])[0]);
    // 4) bunker patch drawn on the TEXT's side: the text says "left";
    //    viewer-behind-tee means golfer-LEFT renders ABOVE the path.
    //    Parse the bunker ellipse cy and the path y near its cx.
    const bz = svg.querySelector('ellipse.prep-hm-hz.bunker');
    check('6. bunker ellipse on the map', !!bz);
    if (bz && fw) {
      const d = fw.getAttribute('d');
      const bx2 = parseFloat(bz.getAttribute('cx'));
      const by2 = parseFloat(bz.getAttribute('cy'));
      // path y at bx2: sample the path 'd' points, find the two
      // surrounding x's, lerp y. Points are flat [x0,y0,x1,y1,…].
      const nums = d.match(/-?[\d.]+/g).map(Number);
      let pyAt = null;
      for (let i = 0; i + 3 < nums.length; i += 2) {
        const ax = nums[i], ay = nums[i + 1];
        const bx3 = nums[i + 2], by3 = nums[i + 3];
        if (bx2 >= Math.min(ax, bx3) && bx2 <= Math.max(ax, bx3)) {
          const t = (bx2 - ax) / ((bx3 - ax) || 1e-9);
          pyAt = ay + (by3 - ay) * t;
          break;
        }
      }
      check('6b. bunker drawn on the text side (left=above path)',
        pyAt != null && by2 < pyAt,
        `bunker y ${by2 && by2.toFixed(1)} vs path y ${pyAt && pyAt.toFixed(1)}`);
    }
    // 5) shot plan lines exist (buttons)
    check('7. shot plan rows rendered',
      body.querySelectorAll('.prep-plan-shot').length >= 2);
    // v1.15.3: segments are BACK (bag-colored), dashed chord is GONE.
    check('7b. landing dots rendered (one per shot)',
      svg.querySelectorAll('circle.prep-hm-land').length >= 2);
    check('7c. club segments restored, bag-colored',
      svg.querySelectorAll('path.prep-hm-shot').length >= 2);
    check('7d. dashed chord removed',
      !svg.querySelector('line.prep-hm-chord'));
    // 6) All-holes button gone; header hole chip is the back nav
    check('8. All holes button removed',
      !body.querySelector('#prepBackHoles'));
    check('9. header hole chip is a back-nav button',
      window.document.getElementById('prepStratTitle').tagName === 'BUTTON' &&
      !!window.document.getElementById('prepStratTitleText'));
    // 7) Move tee button labelled properly
    check('10. Move tee button labelled', /Move tee/.test(body.innerHTML));
    console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.15 PASSED');
    process.exit(fails ? 1 : 0);
  }, 400);
}, 800);
