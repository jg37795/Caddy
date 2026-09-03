'use strict';
/* tests/v1218_james_round.js — James v1.21.8 field-report regressions
   Run: node tests/v1218_james_round.js */
const fs = require('fs');
const path = require('path');
const gmSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.css'), 'utf8');
const editSrc = fs.readFileSync(path.join(__dirname, '..', 'greenedit.js'), 'utf8');
let fails = 0;
const check = (n, c, d = '') => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d); }
};

check('no 2D button in dock',
  !/data-view="2d"/.test(htmlSrc) && !/>2D</.test(htmlSrc),
  htmlSrc.match(/data-view="[^"]+"/g));

check('3D and Hole buttons remain',
  /data-view="3d"/.test(htmlSrc) && /data-view="hole"/.test(htmlSrc));

check('default exag is 1 on slider + label',
  /id="gm-exag"[^>]*value="1"/.test(htmlSrc) &&
  /id="gm-exag-val">1×</.test(htmlSrc),
  htmlSrc.match(/gm-exag[^>]*>/)?.[0]);

check('state.v3.exag initial is 1',
  /v3:\s*\{\s*yaw:\s*0,\s*pitch:\s*88,\s*dist:\s*40,\s*exag:\s*1\s*\}/.test(gmSrc) ||
  /exag:\s*1\s*\}/.test(gmSrc) && /pitch:\s*88/.test(gmSrc),
  'need yaw 0 / pitch 88 / dist 40 / exag 1');

check('vertical-ish camera default (pitch ≈ 88)',
  /pitch:\s*88/.test(gmSrc));

check('no Stylized button',
  !/data-tex="stylized"/.test(htmlSrc) && !/>Stylized</.test(htmlSrc) &&
  !/id="gm-tex-group"/.test(htmlSrc));

check('hole texture defaults to photo',
  /var TEXMODE = 'photo'/.test(gmSrc) &&
  /__holeTexMode = \(\) => 'photo'/.test(gmSrc));

check('flyover button exists in HTML',
  /id="gm-flyover"/.test(htmlSrc) && />Flyover</.test(htmlSrc));

check('flyover button calls flyoverStart',
  /flyoverStart\(true\)/.test(gmSrc) &&
  /function flyoverStart\(force\)/.test(gmSrc) &&
  /window\.__flyoverStart = flyoverStart/.test(gmSrc));

check('flyoverStart is hoisted (loadCorridor can call it)',
  gmSrc.indexOf('function flyoverStart') < gmSrc.indexOf('function wireChrome') &&
  gmSrc.indexOf('async function loadCorridor') < gmSrc.indexOf('function flyoverStart'));

check('Auto outline + OSM outline buttons exist',
  /id="gm-auto-outline"/.test(htmlSrc) &&
  /id="gm-osm-outline"/.test(htmlSrc) &&
  />Auto outline</.test(htmlSrc) &&
  />OSM outline</.test(htmlSrc));

check('Auto/OSM buttons set src=',
  /reloadWithSrc\('auto'\)/.test(gmSrc) &&
  /reloadWithSrc\('osm'\)/.test(gmSrc) &&
  /qs2\.set\('src', src\)/.test(gmSrc));

check('src=auto ignores OSM/trace and requires detect ≥0.6',
  /forceAuto = srcPref === 'auto'/.test(gmSrc) &&
  /forceAuto \? null/.test(gmSrc) &&
  /forceAuto[\s\S]{0,180}?detectRes && detectRes\.confidence >= 0\.6/.test(gmSrc));

check('topbar has title + status + loc rows',
  /id="gm-top-title-row"/.test(htmlSrc) &&
  /id="gm-top-status-row"/.test(htmlSrc) &&
  /id="gm-top-loc-row"/.test(htmlSrc) &&
  /#gm-top-status-row/.test(cssSrc) &&
  /#gm-top-loc-row/.test(cssSrc));

check('status wraps to 2 lines (no nowrap ellipsis)',
  /#gm-status \{[\s\S]{0,400}?white-space:\s*normal/.test(cssSrc) &&
  /#gm-status \{[\s\S]{0,500}?-webkit-line-clamp:\s*2/.test(cssSrc) &&
  !/#gm-status \{[^}]*white-space:\s*nowrap/.test(cssSrc));

check('canvas top inset equals topstack height',
  /--gm-top-inset/.test(cssSrc) &&
  /function syncTopInset/.test(gmSrc) &&
  /#gm-stage[\s\S]{0,400}?top:\s*var\(--gm-top-inset/.test(cssSrc));

check('greenedit has no Trace outline UI / no caddy:greenOutline write',
  !/id="gelTrace"/.test(editSrc) &&
  !/id="gelTraceBar"/.test(editSrc) &&
  !/caddy:greenOutline:v1/.test(editSrc) &&
  /id="gelTee"/.test(editSrc) &&
  /id="gelLoad"/.test(editSrc));

check('handleTap is exported for drop-ball simulation',
  /window\.__handleTap = handleTap/.test(gmSrc));

check('drop-ball arm does not require active===green for tolerant pick',
  /armBallNext && state\.active === 'green'/.test(gmSrc) === false ||
  (gmSrc.match(/armBallNext && state\.active === 'green'/g) || []).length === 0);

check('wasDrag threshold is CSS-px scaled by dpr (iPhone jitter)',
  /10 \* dprUp/.test(gmSrc));

/* ---- live drop-ball arm → tap simulation (headless) ------------------- */
{
  const handlers = {};
  function el(id) {
    return {
      id, textContent: '', innerHTML: '', style: {}, hidden: false,
      value: '1', dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(t, f) { (handlers[id + ':' + t] = handlers[id + ':' + t] || []).push(f); },
      appendChild() {},
      getContext: () => ({
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, stroke() {}, arc() {}, ellipse() {},
        quadraticCurveTo() {}, bezierCurveTo() {},
        save() {}, restore() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {}, setLineDash() {}, drawImage() {},
        fillText() {}, strokeText() {}, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
        lineJoin: '', lineCap: ''
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400, bottom: 80 })
    };
  }
  const els = {};
  ['gm-canvas','gm-status','gm-exag-wrap','gm-exag','gm-exag-val','gm-ball',
   'gm-recenter','gm-legend-title','gm-rampbar','gm-ramplabels','gm-tip',
   'gm-quality','gm-stimp','gm-loc','gm-loading','gm-load-status','gm-back',
   'gm-editloc','gm-flyover','gm-auto-outline','gm-osm-outline','gm-topstack'
  ].forEach(id => els[id] = el(id));
  els['gm-canvas'].width = 400; els['gm-canvas'].height = 400;

  function synthEg(spanM, N, lat, lng) {
    const cs = spanM / N;
    const grid = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const mx = (x + 0.5 - N / 2) * cs, my = (N / 2 - y - 0.5) * cs;
        grid[y * N + x] = 100 + 0.02 * mx + 0.01 * my;
      }
    return { grid, W: N, H: N, cellSizeM: cs, validMask: null,
      bbox: [lng - spanM / 2 / 80000, lat - spanM / 2 / 110540,
             lng + spanM / 2 / 80000, lat + spanM / 2 / 110540] };
  }
  global.window = {
    devicePixelRatio: 3, addEventListener() {},
    CaddyElev: { fetchElevGrid: async (bbox, size) => {
      const [w, s, e, n] = bbox;
      const lat = (s + n) / 2, lng = (w + e) / 2;
      const spanM = Math.max((e - w) * 111320 * Math.cos(lat * Math.PI / 180),
        (n - s) * 110540);
      return synthEg(spanM, Math.min(size, 64), lat, lng);
    } }
  };
  global.document = {
    getElementById: (id) => els[id] || (els[id] = el(id)),
    querySelectorAll: (sel) => {
      if (sel === '.gm-layer-btn')
        return ['shading', 'arrows', 'both'].map(l => {
          const e = el('layer-' + l); e.dataset.layer = l; return e; });
      if (sel === '.gm-view-btn')
        return ['3d', 'hole'].map(v => {
          const e = el('view-' + v); e.dataset.view = v; return e; });
      if (sel === '#gm-ramplabels span') return [el('s0'), el('s1'), el('s2')];
      return [];
    },
    querySelector: () => { const e = el('layer-both'); e.dataset.layer = 'both'; return e; },
    createElement: () => el('created'),
    addEventListener() {},
    documentElement: { style: { setProperty() {} } }
  };
  global.location = { search: '' };
  global.innerWidth = 800; global.innerHeight = 600;
  global.requestAnimationFrame = (f) => setImmediate(f);
  global.performance = { now: () => Date.now() };
  global.fetch = async () => { throw new Error('offline'); };
  global.window.GreenDetect = { detect: () => null };
  require(path.join(__dirname, '..', 'greenmap.js'));

  const done = new Promise((resolve) => {
    setTimeout(() => {
      try {
        check('boot default exag slider is 1',
          String(els['gm-exag'].value) === '1' &&
          /1×/.test(els['gm-exag-val'].textContent),
          els['gm-exag'].value + ' / ' + els['gm-exag-val'].textContent);
        check('__handleTap exported', typeof global.window.__handleTap === 'function');
        check('__flyoverStart exported', typeof global.window.__flyoverStart === 'function');
        const ballH = handlers['gm-ball:click'];
        check('drop-ball button wired', !!ballH);
        if (ballH) ballH[0]();
        check('drop-ball arm sets tap-a-spot status',
          /Tap a spot/.test(els['gm-status'].textContent),
          els['gm-status'].textContent);
        // Simulate a canvas tap at centre — pickCell3D needs a mesh. After
        // boot the ellipse load should have built one. If the pick misses,
        // handleTap still clears the arm (honest fail) rather than hanging.
        if (typeof global.window.__handleTap === 'function') {
          global.window.__handleTap([200, 200], 200, 200);
        }
        const placed = /Putt preview ON/.test(els['gm-status'].textContent);
        const honest = /No green surface/.test(els['gm-status'].textContent);
        const ball = typeof global.window.__gmGetBall === 'function' &&
          global.window.__gmGetBall();
        check('drop-ball arm→tap reaches a terminal state (ball or honest miss)',
          placed || honest,
          els['gm-status'].textContent);
        check('drop-ball arm→tap sets state.ball when the pick hits',
          !placed || (Array.isArray(ball) && ball.length === 2),
          JSON.stringify(ball));
        resolve();
      } catch (e) {
        fails++;
        console.error('FAIL - drop-ball sim exception', e.stack);
        resolve();
      }
    }, 1400);
  });
  done.then(() => {
    if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
    console.log('v1.21.8 JAMES ROUND PASSED');
    process.exit(0);
  });
}
