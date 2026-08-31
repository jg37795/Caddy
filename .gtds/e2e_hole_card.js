/* e2e_hole_card.js — jsdom E2E of the v1.9.0 single-card Prep flow.
   Correct fixture: front/back as lat/lng POINTS (planGreenInfo measures
   tee→point), realistic par-4 geometry. Run: node .gtds/e2e_hole_card.js */
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
  const mapped = i !== 7;                       // hole 7 = unmapped edge case
  const yards = 340 + (i % 5) * 20;             // 340–420, par 4
  const latPerYd = 0.9 / 111320;
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
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:t', name: 'Flow Test GC', teeName: 'Blue',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
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

  // 1. tap mapped hole 5
  rows[4].click();
  setTimeout(() => {
    const card = window.document.getElementById('prepStrategyCard');
    const tiles = [...window.document.querySelectorAll('.prep-carry-tile')];
    const numBlock = window.document.getElementById('prepNumBlock');
    check('A. single hole card visible', card && !card.hidden);
    check('B. tiles are buttons with data-point',
      tiles.length === 3 && tiles.every(t => t.tagName === 'BUTTON' && t.dataset.point),
      tiles.map(t => t.tagName + ':' + t.dataset.point).join(','));
    const mid = tiles.find(t => t.dataset.point === 'middle');
    check('C. middle chosen by default', mid && mid.classList.contains('chosen'));
    check('D. number visible', numBlock && !numBlock.hidden,
      window.document.getElementById('prepRecMain').textContent);

    // 2. tap FRONT tile → number re-solves
    const front = tiles.find(t => t.dataset.point === 'front');
    front.click();
    setTimeout(() => {
      const tiles2 = [...window.document.querySelectorAll('.prep-carry-tile')];
      const f2 = tiles2.find(t => t.dataset.point === 'front');
      const m2 = tiles2.find(t => t.dataset.point === 'middle');
      check('E. chosen moved to Front', f2 && f2.classList.contains('chosen') &&
        !m2.classList.contains('chosen'));
      const num1 = window.document.getElementById('prepRecMain').textContent;
      check('F. number updated', /yd/.test(num1), num1);

      // 3. unmapped hole 7 → honest state
      const rows2 = window.document.querySelectorAll('.plan-hole-row');
      rows2[6].click();
      setTimeout(() => {
        const body = window.document.getElementById('prepStratBody').textContent || '';
        const nb = window.document.getElementById('prepNumBlock');
        check('G. unmapped hole honest message', body.includes("isn't mapped"));
        check('H. number block hidden on unmapped', nb && nb.hidden);
        // 4. back to mapped hole — flow still works
        const rows3 = window.document.querySelectorAll('.plan-hole-row');
        rows3[4].click();
        setTimeout(() => {
          const nb2 = window.document.getElementById('prepNumBlock');
          check('I. returning to mapped hole restores number', nb2 && !nb2.hidden);
          console.log(fails ? `${fails} FAILURE(S)` : 'E2E HOLE CARD PASSED');
          process.exit(fails ? 1 : 0);
        }, 350);
      }, 350);
    }, 350);
  }, 350);
}, 800);
