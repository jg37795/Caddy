/* prep_tap_probe8.js — log WHICH element/attribute cycles forever. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const dom = new JSDOM(html, {
  url: 'https://caddy.local/index.html',
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
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = (f) => window.requestAnimationFrame(f);
global.alert = () => {};
global.confirm = () => false;
global.fetch = async () => { throw new Error('offline'); };
window.fetch = global.fetch;
if (!window.crypto) window.crypto = require('crypto').webcrypto;

let logged = 0;
const OrigMO = window.MutationObserver;
class LoggingMO extends OrigMO {
  constructor(fn) {
    super((list, obs) => {
      for (const m of list) {
        if (logged < 12) {
          logged++;
          const t = m.target;
          const sel = window.document.getElementById('planCourseSelect');
          const search = window.document.getElementById('planCourseSearch');
          console.log(`[mo ${logged}] target=${t.id || t.tagName} attr=${m.attributeName} ` +
            `hidden=${t.hidden} sel.value=${JSON.stringify(sel && sel.value)} ` +
            `search.value=${JSON.stringify(search && search.value)} ` +
            `detailHidden=${(window.document.getElementById('planDetailCard') || {}).hidden}`);
        }
      }
      fn(list, obs);
    });
  }
}
window.MutationObserver = LoggingMO;
global.MutationObserver = LoggingMO;

const holes = [];
for (let i = 1; i <= 18; i++) {
  holes.push({
    number: i, source: 'openstreetmap', par: 4, yards: 320 + i * 9,
    teePoint: { lat: 41.5901 + i * 0.0007, lng: -93.8831 + i * 0.0006 },
    greenCenter: { lat: 41.5901 + i * 0.0007 + 0.0052, lng: -93.8831 + i * 0.0006 + 0.0034 },
    front: 320 + i * 9 - 12, back: 320 + i * 9 + 12,
    hazards: [], greenDepthYds: 24,
  });
}
window.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([
  { id: 'local:test1', name: 'Freeze Test GC', teeName: 'Blue',
    source: 'openstreetmap', location: { lat: 41.593, lng: -93.882 },
    updatedAt: Date.now(), holesCount: 18, holes }]));
window.localStorage.setItem('caddy:onboarded', '1');

window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8'));

setTimeout(() => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf-8'));
  const sel = window.document.getElementById('planCourseSelect');
  sel.value = 'local:test1';
  sel.dispatchEvent(new window.Event('change'));
  const rows = window.document.querySelectorAll('.plan-hole-row');
  console.log('[probe8] tapping…');
  rows[4].click();
  console.log('[probe8] click returned');
  setTimeout(() => process.exit(0), 2000);
}, 800);

setTimeout(() => { console.log('[probe8] wedged'); process.exit(2); }, 7000);
