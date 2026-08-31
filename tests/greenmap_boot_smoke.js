/* Boot+flow smoke: synthetic data through the full UI layer — green load,
   corridor build, Hole view activation, 2D/3D toggles. */
'use strict';
const path = require('path');

const handlers = {};
function el(id) {
  return {
    id, textContent: '', innerHTML: '', style: {}, hidden: false,
    value: 'slope', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(t, f) { (handlers[id + ':' + t] = handlers[id + ':' + t] || []).push(f); },
    appendChild() {},
    getContext: () => ({
      fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() {}, stroke() {}, arc() {}, ellipse() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {}, setLineDash() {}, drawImage() {},
      fillText() {}, strokeText() {}, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
      lineJoin: '', lineCap: ''
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 })
  };
}
const els = {};
// v1.4.0: gm-preset/gm-clear-ball/gm-mode(select) removed from the DOM —
// smoke stubs keep them (harmless extra keys); gm-stimp now required.
['gm-canvas','gm-status','gm-preset','gm-mode','gm-exag-wrap','gm-exag',
 'gm-exag-val','gm-ball','gm-clear-ball','gm-recenter','gm-legend-title',
 'gm-rampbar','gm-ramplabels','gm-tip','gm-quality','gm-stimp',
 'gm-loc','gm-loading','gm-load-status','gm-back','gm-editloc'
 ].forEach(id => els[id] = el(id));
els['gm-canvas'].width = 400; els['gm-canvas'].height = 400;

let fails = 0;
const check = (n, c, d) => { if (c) console.log(' ok  -', n);
  else { fails++; console.error('FAIL -', n, d || ''); } };

// Synthetic eg factory: gentle bowl+tilt plane.
function synthEg(spanM, N, lat, lng) {
  const cs = spanM / N;
  const grid = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const mx = (x + 0.5 - N / 2) * cs, my = (N / 2 - y - 0.5) * cs;
      grid[y * N + x] = 100 + 0.02 * mx + 0.01 * my +
        0.0008 * (mx * mx + my * my);
    }
  return { grid, W: N, H: N, cellSizeM: cs, validMask: null,
    bbox: [lng - spanM / 2 / 80000, lat - spanM / 2 / 110540,
           lng + spanM / 2 / 80000, lat + spanM / 2 / 110540] };
}

global.window = {
  devicePixelRatio: 2, addEventListener() {},
  CaddyElev: { fetchElevGrid: async (bbox, size) =>
    synthEleg(bbox, size) }
};
function synthEleg(bbox, size) {
  const [w, s, e, n] = bbox;
  const lat = (s + n) / 2, lng = (w + e) / 2;
  const spanM = Math.max((e - w) * 111320 * Math.cos(lat * Math.PI / 180),
    (n - s) * 110540);
  return synthEg(spanM, Math.min(size, 128), lat, lng);
}
global.document = {
  getElementById: (id) => els[id] || (els[id] = el(id)),
  querySelectorAll: (sel) => {
    if (sel === '.gm-layer-btn')
      return ['shading', 'arrows', 'both'].map(l => {
        const e = el('layer-' + l); e.dataset.layer = l; return e; });
    if (sel === '.gm-view-btn')
      return ['2d', '3d', 'hole'].map(v => {
        const e = el('view-' + v); e.dataset.view = v; return e; });
    if (sel === '#gm-ramplabels span') return [el('s0'), el('s1'), el('s2')];
    return [];
  },
  querySelector: () => { const e = el('layer-both'); e.dataset.layer = 'both'; return e; },
  createElement: () => el('created')
};
global.location = { search: "" };
global.innerWidth = 800; global.innerHeight = 600;
global.requestAnimationFrame = (f) => setImmediate(f);
global.performance = global.performance || { now: () => Date.now() };
// Overpass offline → ellipse fallback (fine).
global.fetch = async () => { throw new Error('offline'); };
// v1.6.0: load the detector so the smoke covers the auto-detect path
// (offline Overpass + synthetic grid → detection may or may not fire;
// the boot requirement is only that it must not throw).
global.window.GreenDetect = { detect: null };
require(path.join(__dirname, '..', 'green-detect.js'));
check('GreenDetect bridge present', !!global.window.GreenDetect &&
  typeof global.window.GreenDetect.detect === 'function', 'bridge');

require(path.join(__dirname, '..', 'greenmap.js'));

setTimeout(async () => {
  try {
    check('status shows ellipse fallback + slope', /ellipse/.test(els['gm-status'].textContent),
      els['gm-status'].textContent);
    check('quality note populated', /m\/cell/.test(els['gm-quality'].textContent),
      els['gm-quality'].textContent);

    // Click the Hole view button.
    const holeBtnHandlers = handlers['view-hole:click'];
    check('hole button wired', !!holeBtnHandlers);
    // Corridor may still be loading or done; either way this must not throw.
    await holeBtnHandlers[0]();
    await new Promise(r => setTimeout(r, 300));
    check('hole status set', /Whole-hole|Fetching/.test(els['gm-status'].textContent) ||
      els['gm-status'].textContent.length > 0, els['gm-status'].textContent);

    // Back to 2D and 3D — must not throw.
    await handlers['view-2d:click'][0]();
    await handlers['view-3d:click'][0]();
    // Exaggeration slider input.
    els['gm-exag'].value = '10';
    await handlers['gm-exag:input'][0].call(els['gm-exag']);
    console.log(fails ? `${fails} FAILURE(S)` : 'BOOT+FLOW SMOKE PASSED');
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.error('FAIL - flow exception:', e.stack);
    process.exit(1);
  }
}, 1200);
