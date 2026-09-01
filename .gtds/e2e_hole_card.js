/* e2e_hole_card.js — v1.15.2 update: THE NUMBER box is gone; the number
   lives inside tapped plan rows. Run: node .gtds/e2e_hole_card.js */
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
  const mapped = i !== 7;
  const yards = 340 + (i % 5) * 20;
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
  { id: 'local:t', name: 'Card Test GC', teeName: 'Red',
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
    const body = window.document.getElementById('prepStratBody');
    check('A. single hole card visible', card && !card.hidden);
    check('B. THE NUMBER box is gone',
      !window.document.getElementById('prepNumBlock') &&
      !body.querySelector('.prep-num-inline'));
    const planRows = [...body.querySelectorAll('button.prep-plan-shot')];
    check('C. plan rows present', planRows.length >= 1);

    // 2. tap first plan shot → number appears inside it
    planRows[0].click();
    setTimeout(() => {
      const row0 = [...body.querySelectorAll('button.prep-plan-shot')][0];
      const inline = row0 && row0.querySelector(':scope > .prep-num-inline');
      check('D. number expanded inside tapped shot', !!inline);
      const main = window.document.getElementById('prepRecMain');
      check('E. number populated', !!main && /yd/.test(main.textContent),
        main && main.textContent);

      // 3. unmapped hole 7 → honest state, no number UI
      const rows2 = window.document.querySelectorAll('.plan-hole-row');
      rows2[6].click();
      setTimeout(() => {
        const txt = window.document.getElementById('prepStratBody').textContent || '';
        check('F. unmapped hole honest message', txt.includes("isn't mapped"));
        check('G. no number UI on unmapped',
          !window.document.querySelector('#prepStratBody .prep-num-inline'));
        // 4. back to mapped hole — flow still works
        const rows3 = window.document.querySelectorAll('.plan-hole-row');
        rows3[4].click();
        setTimeout(() => {
          const body3 = window.document.getElementById('prepStratBody');
          check('H. returning to mapped hole restores plan rows',
            body3.querySelectorAll('button.prep-plan-shot').length >= 1);
          console.log(fails ? `${fails} FAILURE(S)` : 'E2E HOLE CARD PASSED');
          process.exit(fails ? 1 : 0);
        }, 350);
      }, 350);
    }, 350);
  }, 350);
}, 800);
