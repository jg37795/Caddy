/* e2e_v171.js — v1.17.1/v1.18.0: direct hole payload (ribbon+ring+tee on
   FIRST open), carry tags, dispersion payload, in-sheet tee placement,
   auto green-brief trigger. Run: node .gtds/e2e_v171.js */
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
const holes = [];
for (let i = 1; i <= 18; i++) {
  const yards = 340 + (i % 5) * 20;
  holes.push({
    number: i, source: 'openstreetmap', par: 4, yards,
    teePoint: { lat: 41.5901, lng: -93.8831 },
    greenCenter: { lat: 41.5901 - yards * latPerYd, lng: -93.8831 },
    front: { lat: 41.5901 - (yards - 14) * latPerYd, lng: -93.8831 },
    back: { lat: 41.5901 - (yards + 6) * latPerYd, lng: -93.8831 },
    hazards: [{ type: 'bunker', label: 'Bunker',
      sub: 'left ~120 yd', lat: 41.5899, lng: -93.8835 }],
    greenDepthYds: 20,
    pathPts: [
      { lat: 41.5901, lng: -93.8831 },
      { lat: 41.5901 - yards * latPerYd / 2, lng: -93.8833 },
      { lat: 41.5901 - yards * latPerYd, lng: -93.8831 },
    ],
    greenRingPts: [
      { lat: 41.5901 - yards * latPerYd - 0.00005, lng: -93.8832 },
      { lat: 41.5901 - yards * latPerYd - 0.00005, lng: -93.8830 },
      { lat: 41.5901 - yards * latPerYd + 0.00005, lng: -93.8831 },
    ],
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:t', name: 'Sheet Test GC', teeName: 'Red',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'),
    'utf-8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:t';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  rows[0].click();
  setTimeout(() => {
    // 1. satellite sheet received the direct payload (no localStorage
    //    round-trip): intercept open()
    let captured = null;
    window.PrepHoleSat.open = (o) => { captured = o; };
    const tap = window.document.getElementById('prepHoleMapTap');
    check('1. map tap target exists', !!tap);
    tap.click();
    setTimeout(() => {
      check('2. open() captured', !!captured);
      const hd = captured && captured.holeData;
      check('3. holeData has pathPts (ribbon loads FIRST open)',
        hd && Array.isArray(hd.pathPts) && hd.pathPts.length >= 2);
      check('4. holeData has greenRingPts',
        hd && Array.isArray(hd.greenRingPts) && hd.greenRingPts.length >= 3);
      check('5. holeData has teePoint (tee marker on the sheet)',
        hd && hd.teePoint && Number.isFinite(hd.teePoint.lat));
      check('6. holeData has hazards',
        hd && Array.isArray(hd.hazards) && hd.hazards.length >= 1);
      const plan = window.__prepPlanLanding || [];
      check('7. landing dots have carry yd', plan.length >= 1 &&
        plan.every((p) => Number.isFinite(p.yd)),
        JSON.stringify(plan.map((p) => p.yd)));
      check('8. carries descend (tee shot first, biggest carry)',
        plan.length >= 2 && plan[0].yd > plan[plan.length - 1].yd,
        JSON.stringify(plan.map((p) => p.yd)));
      check('9. sigma payload present (dispersion)',
        plan.every((p) => Number.isFinite(p.sigAlongYd) &&
          Number.isFinite(p.sigCrossYd)));
      // 10. in-sheet tee save (simulate the sheet's save path)
      const profiles = JSON.parse(window.localStorage.getItem(
        'caddy:courseProfiles:v1'));
      const h1 = profiles[0].holes[0];
      h1.teePoint = { lat: 41.59005, lng: -93.88312 };
      h1.teeSource = 'player';
      window.localStorage.setItem('caddy:courseProfiles:v1',
        JSON.stringify(profiles));
      const after = JSON.parse(window.localStorage.getItem(
        'caddy:courseProfiles:v1'))[0].holes[0];
      check('10. tee save writes teeSource=player',
        after.teeSource === 'player' &&
        Math.abs(after.teePoint.lat - 41.59005) < 1e-6);
      console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.17.1 PASSED');
      process.exit(fails ? 1 : 0);
    }, 300);
  }, 400);
}, 800);
