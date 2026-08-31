/* e2e_v110.js — v1.10.0 E2E: real-shape hole map + tee-set switcher +
   yards nudge. Extends e2e_hole_card.js. Run: node .gtds/e2e_v110.js */
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

const holes = [];
for (let i = 1; i <= 18; i++) {
  const mapped = i !== 7;
  const yards = 340 + (i % 5) * 20;
  const latPerYd = 0.9 / 111320;
  // A dogleg: path bends 40 yd right at 60% out (real-shape test).
  const doglegs = i % 3 === 0;
  const mkPath = () => {
    const a = { lat: 41.5901, lng: -93.8831 };
    const b = { lat: 41.5901 - yards * latPerYd, lng: -93.8831 };
    if (!doglegs) return [a,
      { lat: (a.lat + b.lat) / 2, lng: a.lng },
      b];
    const mid = { lat: a.lat - yards * latPerYd * 0.6, lng: a.lng };
    return [a, mid,
      { lat: mid.lat, lng: mid.lng + 40 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180)) },
      b];
  };
  holes.push({
    number: i, source: mapped ? 'openstreetmap' : 'manual',
    par: 4, yards: mapped ? yards : undefined,
    teePoint: mapped ? { lat: 41.5901, lng: -93.8831 } : undefined,
    greenCenter: mapped
      ? { lat: 41.5901 - yards * latPerYd, lng: -93.8831 } : undefined,
    front: mapped
      ? { lat: 41.5901 - (yards - 14) * latPerYd, lng: -93.8831 } : undefined,
    back: mapped
      ? { lat: 41.5901 - (yards + 6) * latPerYd, lng: -93.8831 } : undefined,
    hazards: [], greenDepthYds: mapped ? 20 : undefined,
    // v1.10 geometry (as if imported by the new importer):
    pathPts: mapped ? (() => {
      const p = mkPath();
      // simplify to 28 — already small
      return p;
    })() : undefined,
    greenRingPts: mapped ? (() => {
      // small hexagonal ring around greenCenter (~10 yd radius)
      const c = { lat: 41.5901 - yards * latPerYd, lng: -93.8831 };
      const rLat = 10 * 0.9 / 111320;
      const rLng = 10 * 0.9 / (111320 * Math.cos(41.59 * Math.PI / 180));
      return [0, 60, 120, 180, 240, 300].map((d) => ({
        lat: c.lat + rLat * Math.sin(d * Math.PI / 180),
        lng: c.lng + rLng * Math.cos(d * Math.PI / 180),
      }));
    })() : undefined,
  });
}
const course = {
  id: 'local:t', name: 'Shape Test GC', teeName: 'Red',
  source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
  updatedAt: Date.now(), holesCount: 18, holes,
  // Two tee sets: Red (the usual wrong default) and Blue (+40 yd).
  teeSets: holes.reduce((acc, h) => {
    if (h.source !== 'openstreetmap') return acc;
    for (const [name, dy] of [['Red', 0], ['Blue', 40]]) {
      const set = acc.find((s) => s.name === name) ||
        (acc.push({ name, holes: {} }), acc.find((s) => s.name === name));
      set.holes[h.number] = {
        lat: h.teePoint.lat,
        lng: h.teePoint.lng,
        yards: h.yards + dy,
      };
    }
    return acc;
  }, []),
  activeTeeSet: 'Red',
};
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([course]));
window.localStorage.setItem('caddy:onboarded', '1');
window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:t';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');

  // Hole 3 = dogleg, mapped, with pathPts
  rows[2].click();
  setTimeout(() => {
    const body = window.document.getElementById('prepStratBody');
    const svg = body.querySelector('svg.prep-holemap');
    check('1. hole card shown', !!svg);
    // REAL SHAPE: fairway drawn as a stroked path with the dogleg
    const fw = svg.querySelector('path.prep-hm-fairway');
    check('2. fairway is a real stroked path', !!fw && (fw.getAttribute('d') || '').startsWith('M'));
    const pathD = fw ? fw.getAttribute('d') : '';
    check('3. dogleg visible (path bends, not straight)', fw && (() => {
      // parse points; the mid cross should deviate from the straight line
      const pts = pathD.replace(/M|L/g, ' ').trim().split(/\s+/)
        .map(Number).filter((_, i) => i % 2 === 1);
      if (pts.length < 4) return false;
      const xs = pathD.replace(/M|L/g, ' ').trim().split(/\s+/)
        .map(Number).filter((_, i) => i % 2 === 0);
      // straight line from first to last: compare y at midpoint x
      const x0 = xs[0], x1 = xs[xs.length - 1];
      const y0 = pts[0], y1 = pts[pts.length - 1];
      const midIdx = Math.floor(xs.length / 2);
      const linY = y0 + (y1 - y0) * ((xs[midIdx] - x0) / (x1 - x0));
      return Math.abs(pts[midIdx] - linY) > 4;
    })());
    // green drawn as real outline
    const gf = svg.querySelector('path.prep-hm-greenfill');
    check('4. green drawn as real outline', !!gf);
    // tee chips present with Red active
    const chips = [...body.querySelectorAll('.prep-tee-chip')];
    check('5. tee chips rendered (Red+Blue)',
      chips.length === 2 && chips.some(c => c.classList.contains('active') &&
        c.dataset.tee === 'Red'));
    // nudge stepper present
    check('6. nudge stepper present', !!body.querySelector('.prep-tee-nudge'));

    // SWITCH TO BLUE
    const blue = chips.find(c => c.dataset.tee === 'Blue');
    blue.click();
    setTimeout(() => {
      const body2 = window.document.getElementById('prepStratBody');
      const chips2 = [...body2.querySelectorAll('.prep-tee-chip')];
      const blue2 = chips2.find(c => c.dataset.tee === 'Blue');
      check('7. Blue now active', blue2 && blue2.classList.contains('active'));
      const meta = body2.querySelector('.prep-strat-meta').textContent;
      const yardsBlue = 340 + (3 % 5) * 20 + 40;
      check('8. meta shows Blue yardage', meta.includes(String(yardsBlue)), meta);
      // persisted (Round agrees)
      const stored = JSON.parse(
        window.localStorage.getItem('caddy:courseProfiles:v1'))[0];
      check('9. tee choice persisted to course', stored.activeTeeSet === 'Blue');

      // NUDGE +15 — re-query the button after each click: renderStrategy
      // re-renders prepStratBody on every nudge, so old buttons detach
      // (real taps always hit the live button).
      const nudgeYardsAfter = () => {
        const b = window.document.getElementById('prepStratBody');
        return b.querySelector('.prep-tee-nudge .prep-step-val').textContent;
      };
      const metaAfter = () =>
        window.document.getElementById('prepStratBody')
          .querySelector('.prep-strat-meta').textContent;
      for (let k = 0; k < 3; k++) {
        const btn = window.document.getElementById('prepStratBody')
          .querySelector('.prep-tee-nudge [data-nd="5"]');
        btn.click();
      }
      setTimeout(() => {
        check('10. nudge shows +15', nudgeYardsAfter().includes('+15'), nudgeYardsAfter());
        const meta3 = metaAfter();
        check('11. meta includes nudge (+15 on Blue)', meta3.includes(String(yardsBlue + 15)), meta3);
        // persisted nudge
        const nud = JSON.parse(window.localStorage.getItem('caddy.prep.teeNudge') || '{}');
        check('12. nudge persisted per course', nud['local:t'] === 15, JSON.stringify(nud));
        console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.10 PASSED');
        process.exit(fails ? 1 : 0);
      }, 500);
    }, 400);
  }, 400);
}, 800);
