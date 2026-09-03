'use strict';
/* tests/v1219_satellite_outline.js — James v1.21.9 field-report regressions
   (1) canvas bitmap == stage box * dpr after fitView
   (2) holeSat Auto/OSM toggle buttons paint overlay rings
   (3) eventPos → pickCell3D round-trip (flag/drop-ball tap accuracy)
   (4) greenmap Hole view gets outline toggles
   Run: node tests/v1219_satellite_outline.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const gmSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.css'), 'utf8');
const satSrc = fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'), 'utf8');

let fails = 0;
const check = (n, c, d = '') => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d); }
};

/* ---- static wiring ---------------------------------------------------- */
check('fitView sizes canvas from the stage box, not innerHeight',
  /function canvasBoxSize/.test(gmSrc) &&
  /function sizeCanvas/.test(gmSrc) &&
  /stage\.getBoundingClientRect/.test(gmSrc) &&
  !/canvas\.width = innerWidth \* dpr/.test(gmSrc),
  'still assigning innerWidth/innerHeight to the bitmap');

check('syncTopInset re-sizes canvas when the inset changes',
  /function syncTopInset/.test(gmSrc) &&
  /sizeCanvas\(\)/.test(gmSrc.slice(gmSrc.indexOf('function syncTopInset'),
    gmSrc.indexOf('function syncTopInset') + 900)));

check('Hole view Auto/OSM overlay buttons exist in HTML',
  /id="gm-hole-auto-outline"/.test(htmlSrc) &&
  /id="gm-hole-osm-outline"/.test(htmlSrc) &&
  />Auto outline</.test(htmlSrc) &&
  />OSM outline</.test(htmlSrc));

check('3D Auto/OSM source buttons remain (not moved away)',
  /id="gm-auto-outline"/.test(htmlSrc) &&
  /id="gm-osm-outline"/.test(htmlSrc));

check('Hole overlay stroke uses OSM #7dff9b and Auto #ffd166',
  /strokeOv\(state\.overlays\.osmPoly, '#7dff9b'\)/.test(gmSrc) &&
  /strokeOv\(state\.overlays\.autoPoly, '#ffd166'\)/.test(gmSrc));

check('118px stage fallback is still first-paint only',
  /--gm-top-inset, calc\(var\(--safe-top, 0px\) \+ 118px\)/.test(cssSrc));

check('holeSat builds Auto/OSM toggle buttons',
  /id="pshAutoOutline"/.test(satSrc) &&
  /id="pshOsmOutline"/.test(satSrc) &&
  /id="pshOutlineChip"/.test(satSrc));

/* ---- (1) canvas bitmap == stage box * dpr ----------------------------- */
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
   'gm-editloc','gm-flyover','gm-auto-outline','gm-osm-outline','gm-topstack',
   'gm-hole-auto-outline','gm-hole-osm-outline','gm-outline-legend','gm-outline-group'
  ].forEach(id => els[id] = el(id));

  const DPR = 2;
  const VIEW_W = 440, VIEW_H = 956, INSET = 118;
  const stageRect = { left: 0, top: INSET, width: VIEW_W, height: VIEW_H - INSET,
    bottom: VIEW_H, right: VIEW_W };
  const stage = {
    getBoundingClientRect: () => stageRect,
    clientWidth: VIEW_W, clientHeight: VIEW_H - INSET
  };
  els['gm-canvas'].parentElement = stage;
  els['gm-canvas'].clientWidth = VIEW_W;
  els['gm-canvas'].clientHeight = VIEW_H - INSET;
  els['gm-canvas'].getBoundingClientRect = () => ({
    left: 0, top: INSET, width: VIEW_W, height: VIEW_H - INSET,
    bottom: VIEW_H, right: VIEW_W
  });
  els['gm-topstack'].getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: VIEW_W, height: INSET, bottom: INSET, right: VIEW_W });

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
    devicePixelRatio: DPR, addEventListener() {},
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
    documentElement: { style: { setProperty() {}, getPropertyValue: () => '' } }
  };
  global.location = { search: '' };
  global.innerWidth = VIEW_W; global.innerHeight = VIEW_H;
  global.requestAnimationFrame = (f) => setImmediate(f);
  global.performance = { now: () => Date.now() };
  global.fetch = async () => { throw new Error('offline'); };
  global.window.GreenDetect = { detect: () => null };
  require(path.join(__dirname, '..', 'greenmap.js'));

  const liveDone = new Promise((resolve) => {
    setTimeout(() => {
      try {
        check('__sizeCanvas / __fitView / __pickCell3D exported',
          typeof global.window.__sizeCanvas === 'function' &&
          typeof global.window.__fitView === 'function' &&
          typeof global.window.__pickCell3D === 'function');

        if (typeof global.window.__fitView === 'function') global.window.__fitView();
        const wantW = VIEW_W * DPR;
        const wantH = (VIEW_H - INSET) * DPR;
        check('canvas bitmap width == stage CSS width * dpr (440)',
          els['gm-canvas'].width === wantW,
          `got ${els['gm-canvas'].width} want ${wantW}`);
        check('canvas bitmap height == (956-118)*dpr',
          els['gm-canvas'].height === wantH,
          `got ${els['gm-canvas'].height} want ${wantH} (viewport was ${VIEW_H * DPR})`);

        // (4) Hole-view outline toggles are wired
        check('Hole Auto outline button is wired',
          !!(handlers['gm-hole-auto-outline:click']));
        check('Hole OSM outline button is wired',
          !!(handlers['gm-hole-osm-outline:click']));

        // (3) eventPos → pickCell3D round-trip
        const st = global.window.__gmState;
        const pick = global.window.__pickCell3D;
        const camFn = global.window.__currentCam;
        const surf = global.window.__surfZ3;
        check('state + currentCam + surfZ3 exported for pick round-trip',
          !!(st && pick && camFn && surf));
        if (st && pick && camFn && surf && st.grid && st.mesh) {
          const g = st.grid;
          // pick a known in-mask cell near centre
          let cell = null;
          for (let y = (g.H / 2) | 0; y < g.H - 1 && !cell; y++)
            for (let x = (g.W / 2) | 0; x < g.W - 1 && !cell; x++) {
              const i = y * g.W + x;
              if (st.mask && st.mask[i] && st.field && st.field.valid[i])
                cell = { i, x, y };
            }
          check('found an in-mask cell for the pick round-trip', !!cell);
          if (cell) {
            const mx = (cell.x + 0.5 - g.W / 2) * g.cellSizeM;
            const my = (g.H / 2 - cell.y - 0.5) * g.cellSizeM;
            const cam = camFn();
            const p = global.window.GreenMapCore.projectPt(cam, mx, my, surf(mx, my));
            check('known cell projects on-screen', !!(p && Number.isFinite(p[0])));
            if (p) {
              const hit = pick(p[0], p[1]);
              check('tap at projected cell picks THAT cell',
                !!(hit && hit.i === cell.i),
                hit ? `picked i=${hit.i} want i=${cell.i}` : 'pick missed');
            }
          }
        } else {
          check('pick round-trip skipped (no mesh yet)', false, 'grid/mesh missing after boot');
        }
        resolve();
      } catch (e) {
        fails++;
        console.error('FAIL - live sim exception', e.stack);
        resolve();
      }
    }, 1400);
  });

  liveDone.then(async () => {
    /* ---- (2) holeSat Auto/OSM toggle buttons paint overlay rings ------ */
    let prevWindow, prevDocument;
    try {
      const LAT0 = 41.778, LNG0 = -93.782;
      let leafletCalls = [];
      function fakeLayer(kind, opts) {
        return {
          __kind: kind, __opts: opts || {},
          addTo() { leafletCalls.push([kind, this.__opts]); return this; },
          on() { return this; },
        };
      }
      const FAKE_L = {
        control: { zoom: () => ({ addTo: () => {} }) },
        DomEvent: new Proxy({}, { get: () => () => {} }),
        DomUtil: new Proxy({}, { get: () => () => '' }),
        circle: (ll, o) => fakeLayer('circle', { ll, o }),
        latLngBounds: () => ({
          extend() { return this; },
          pad: () => ({ getNorth: () => 0, getSouth: () => 0,
            getEast: () => 0, getWest: () => 0 }),
          isValid: () => true,
        }),
        map: (id, opts) => {
          leafletCalls.push(['map', opts || {}]);
          return {
            setView() { return this; },
            addLayer() { return this; },
            removeLayer() { return this; },
            hasLayer: () => false,
            getPane: () => ({ style: {} }),
            createPane: () => ({ style: {} }),
            getBounds: () => ({ pad: () => ({}) }),
            on() { return this; },
            off() { return this; },
            fitBounds() { return this; },
            invalidateSize() { return this; },
            remove() { return this; },
          };
        },
        tileLayer: () => fakeLayer('tile'),
        polyline: (ll, o) => fakeLayer('polyline', Object.assign({ __ll: ll }, o)),
        polygon: (ll, o) => fakeLayer('polygon', Object.assign({ __ll: ll }, o)),
        circleMarker: (ll, o) => fakeLayer('circle', Object.assign({ __ll: ll }, o)),
        marker: (ll, o) => fakeLayer('marker', Object.assign({ __ll: ll }, o)),
        divIcon: (o) => o,
      };
      const html = '<html><body></body></html>';
      const dom = new JSDOM(html, { url: 'https://caddy.local/index.html', pretendToBeVisual: true });
      const { window } = dom;
      window.L = FAKE_L;
      global.L = FAKE_L;
      prevWindow = global.window;
      prevDocument = global.document;
      global.window = window;
      global.document = window.document;
      global.HTMLElement = window.HTMLElement;
      global.Element = window.Element;
      global.Node = window.Node;
      global.requestAnimationFrame = (f) => setTimeout(f, 0);
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('overpass')) {
          return {
            ok: true,
            json: async () => ({
              elements: [{
                type: 'way', tags: { golf: 'green' },
                geometry: [
                  { lat: LAT0, lon: LNG0 },
                  { lat: LAT0 + 0.0002, lon: LNG0 },
                  { lat: LAT0 + 0.0002, lon: LNG0 + 0.0002 },
                  { lat: LAT0, lon: LNG0 + 0.0002 },
                ]
              }]
            }),
            text: async () => '{}'
          };
        }
        throw new Error('offline: ' + u.slice(0, 50));
      };
      global.fetch = window.fetch;
      window.GreenDetect = {
        detect: () => ({
          confidence: 0.8,
          poly: [[-8, -8], [8, -8], [8, 8], [-8, 8]]
        })
      };
      global.window.GreenDetect = window.GreenDetect;
      window.CaddyElev = {
        fetchElevGrid: async () => {
          const N = 16, cs = 90 / N, grid = new Float32Array(N * N);
          for (let i = 0; i < N * N; i++) grid[i] = 100;
          return { grid, W: N, H: N, cellSizeM: cs };
        }
      };
      window.eval = undefined;
      eval(satSrc);
      check('PrepHoleSat mounted on the sheet window',
        !!(window.PrepHoleSat && typeof window.PrepHoleSat.open === 'function'));
      const holeData = {
        par: 4, yards: 387,
        pathPts: [{ lat: LAT0, lng: LNG0 }, { lat: LAT0 - 0.001, lng: LNG0 }],
        greenRingPts: [
          { lat: LAT0, lng: LNG0 }, { lat: LAT0, lng: LNG0 + 0.0001 },
          { lat: LAT0 - 0.0001, lng: LNG0 + 0.0001 }, { lat: LAT0, lng: LNG0 }
        ],
        teePoint: { lat: LAT0, lng: LNG0 },
        greenCenter: { lat: LAT0, lng: LNG0 },
        shapes: {},
        hazards: [],
      };
      leafletCalls = [];
      window.PrepHoleSat.open({
        greenLatLng: { lat: LAT0, lng: LNG0 },
        courseId: 'test-course',
        hole: 1,
        holeData,
        teeLL: { lat: LAT0, lng: LNG0 },
      });
      await new Promise((r) => setTimeout(r, 80));
      const auto = window.document.getElementById('pshAutoOutline');
      const osm = window.document.getElementById('pshOsmOutline');
      const chip = window.document.getElementById('pshOutlineChip');
      check('holeSat Auto outline button is in the sheet', !!auto);
      check('holeSat OSM outline button is in the sheet', !!osm);
      check('holeSat source chip is in the sheet', !!chip);
      const polysBefore = leafletCalls.filter((c) => c[0] === 'polygon').length;
      if (osm) osm.click();
      await new Promise((r) => setTimeout(r, 80));
      const osmPolys = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#7dff9b' && c[1].fillOpacity === 0);
      check('OSM toggle draws a #7dff9b overlay ring',
        osmPolys.length >= 1,
        `osm overlay polys=${osmPolys.length} total polys=${leafletCalls.filter(c=>c[0]==='polygon').length} before=${polysBefore}`);
      if (auto) auto.click();
      await new Promise((r) => setTimeout(r, 80));
      const autoPolys = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#ffd166');
      check('Auto toggle draws a #ffd166 overlay ring',
        autoPolys.length >= 1,
        `auto overlay polys=${autoPolys.length}`);
      // Toggle OSM off — layer is removed (removeLayer called; overlay count can stay in the call log)
      if (osm) osm.click();
      await new Promise((r) => setTimeout(r, 40));
      check('OSM toggle off clears ov.osmOn',
        window.__pshOutline && window.__pshOutline.osmOn === false,
        JSON.stringify(window.__pshOutline && { osmOn: window.__pshOutline.osmOn, autoOn: window.__pshOutline.autoOn }));
    } catch (e) {
      fails++;
      console.error('FAIL - holeSat overlay harness', e.stack);
    } finally {
      if (prevWindow) global.window = prevWindow;
      if (prevDocument) global.document = prevDocument;
    }

    if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
    console.log('v1.21.9 SATELLITE OUTLINE PASSED');
    process.exit(0);
  });
}
