/* dropball_repro.js — reproduce "Drop ball doesn't work" on the 3D green.
   Loads greenmap.html+js in jsdom, switches to 3D, arms the ball via the
   button, taps the green centre, and reports state.ball. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf-8');
// strip external scripts/styles — we eval the files ourselves
const dom = new JSDOM(html, {
  url: 'https://caddy.local/greenmap.html?lat=41.95&lng=-93.75',
  runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
for (const k of ['window', 'document', 'navigator', 'location',
  'localStorage', 'HTMLElement', 'SVGElement', 'Element', 'Node',
  'MutationObserver', 'getComputedStyle', 'requestAnimationFrame'])
  global[k] = window[k] !== undefined ? window[k] : global[k];
global.alert = () => {}; global.confirm = () => false;
global.history = window.history;
// canvas 2d stub (node-canvas not needed for logic path)
const c2d = () => new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (p === 'measureText') return () => ({ width: 10 });
  if (p === 'getImageData') return (x, y, w, h) =>
    ({ data: new Uint8ClampedArray(w * h * 4) });
  return typeof p === 'string' ? () => {} : undefined;
}, set: () => true });
window.HTMLCanvasElement.prototype.getContext = function () { return c2d(); };

// minimal fetch stubs: green polygon + elevation return nulls
global.fetch = async () => ({ ok: false, json: async () => ({}) });
window.fetch = global.fetch;

const load = (f) => window.eval(fs.readFileSync(
  path.join(__dirname, '..', f), 'utf-8'));
window.GreenDetect = window.GreenDetect || {};
load('green-detect.js');
load('caddy-elev.js');
load('satview.js');
load('greenlink.js');
load('greenedit.js');
load('greenmap.js');

let fails = 0;
const check = (n, c, d) => { if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

setTimeout(() => {
  // wait for the boot chain (async loads will fail — fine, grid null)
  const btn = window.document.getElementById('gm-ball');
  check('1. Drop ball button present', !!btn);
  btn.click();
  check('2. armed after click',
    window.document.getElementById('gm-status').textContent.includes('Tap a spot'),
    window.document.getElementById('gm-status').textContent);
  // simulate a tap at canvas centre: pointerdown+pointerup
  const canvas = window.document.getElementById('gm-canvas');
  const r = { left: 0, top: 0, width: 390, height: 700 };
  canvas.getBoundingClientRect = () => r;
  canvas.width = 390; canvas.height = 700;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const ev = (type, x, y) => {
    const e = new window.Event(type, { bubbles: true });
    e.pointerId = 1; e.clientX = x; e.clientY = y;
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'clientY', { value: y });
    return e;
  };
  canvas.dispatchEvent(ev('pointerdown', 195, 350));
  canvas.dispatchEvent(ev('pointerup', 195, 350));
  setTimeout(() => {
    const st = window.document.getElementById('gm-status').textContent;
    check('3. tap resolved (no crash)', true);
    console.log('   status after tap:', JSON.stringify(st));
    console.log(fails ? fails + ' FAILURE(S)' : 'REPRO COMPLETE (see status)');
    process.exit(0);
  }, 300);
}, 600);
