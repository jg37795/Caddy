/* e2e_v152.js — v1.15.2: number UI lives inside the selected shot row;
   lie/shape toggles work from the injected rows. Run: node .gtds/e2e_v152.js */
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
const yards = 382;
const pathPts = [
  { lat: 41.5901, lng: -93.8831 },
  { lat: 41.5901 - yards * latPerYd, lng: -93.8831 },
];
const holes = Array.from({ length: 18 }, (_, i) => i === 0 ? {
  number: 1, source: 'openstreetmap', par: 4, yards,
  teePoint: pathPts[0],
  greenCenter: pathPts[1],
  front: { lat: pathPts[1].lat + 14 * latPerYd, lng: pathPts[1].lng },
  back: { lat: pathPts[1].lat - 6 * latPerYd, lng: pathPts[1].lng },
  hazards: [], pathPts,
} : { number: i + 1, source: 'manual', par: 4 });
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:t', name: 'Num Test GC', teeName: 'Red',
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
  rows[0].click();
  setTimeout(() => {
    const body = window.document.getElementById('prepStratBody');
    const planRows = [...body.querySelectorAll('button.prep-plan-shot')];
    check('1. plan rows are buttons', planRows.length >= 2);
    // 2) no shot selected → NO number UI anywhere (the box is gone)
    check('2. number UI absent until a shot is tapped',
      !body.querySelector('.prep-num-inline') &&
      !window.document.getElementById('prepNumberFallback'));
    // Tap shot 0 → number UI injected INSIDE that row
    planRows[0].click();
    setTimeout(() => {
      const row0 = body.querySelectorAll('button.prep-plan-shot')[0];
      const inline = row0.querySelector(':scope > .prep-num-inline');
      check('3. number UI injected into tapped row', !!inline);
      const main = window.document.getElementById('prepRecMain');
      check('4. big number populated', !!main && /\d/.test(main.textContent),
        main && main.textContent);
      // 5. lie toggle inside the row works
      const lie = row0.querySelector('.prep-lie-chip[data-lie="rough"]');
      check('5. lie chips injected', !!lie);
      if (lie) {
        lie.click();
        setTimeout(() => {
          const lie2 = window.document.querySelector(
            '#prepStratBody .prep-lie-chip[data-lie="rough"]');
          check('6. lie tap selects (active class)',
            lie2 && lie2.classList.contains('active'),
            lie2 ? `active=${lie2.classList.contains('active')}` : 'chip missing');
          // 7. tap another row → number MOVES (no duplicates)
          // v1.15.2: re-query rows after each rebuild (renderStrategy
          // recreates the DOM; old references detach — same lesson as
          // the v1.10 nudge E2E).
          const rows = [...body.querySelectorAll('button.prep-plan-shot')];
          rows[1].click();
          setTimeout(() => {
            const inlines = body.querySelectorAll('.prep-num-inline');
            check('8. number UI moved (exactly one instance)',
              inlines.length === 1);
            const rowsNow = [...body.querySelectorAll('button.prep-plan-shot')];
            check('9. now inside row 1',
              !!rowsNow[1].querySelector(':scope > .prep-num-inline'));
            // 10. tap again deselects → number UI gone entirely
            const rows2 = [...body.querySelectorAll('button.prep-plan-shot')];
            rows2[1].click();
            setTimeout(() => {
              const inl = body.querySelectorAll('.prep-num-inline').length;
              const fbEl = window.document.getElementById('prepNumberFallback');
              check('10. deselect removes the number UI (box is gone)',
                inl === 0 && !fbEl);
              console.log(fails ? `${fails} FAILURE(S)` : 'E2E v1.15.2 PASSED');
              process.exit(fails ? 1 : 0);
            }, 300);
          }, 300);
        }, 300);
      }
    }, 300);
  }, 400);
}, 800);
