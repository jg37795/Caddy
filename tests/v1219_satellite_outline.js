'use strict';
/* tests/v1219_satellite_outline.js — James v1.21.9 field-report regressions
   (1) canvas bitmap == stage box * dpr after fitView
   (2) holeSat Auto/OSM pills ABSENT (re-scoped to Check location)
   (3) eventPos → pickCell3D round-trip (flag/drop-ball tap accuracy)
   (4) greenmap Hole view gets outline toggles
   (5) Check location (greenedit) Auto/OSM: mutual exclusion, tap re-anchor
   Run: node tests/v1219_satellite_outline.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const gmSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.css'), 'utf8');
const satSrc = fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'), 'utf8');
const editSrc = fs.readFileSync(path.join(__dirname, '..', 'greenedit.js'), 'utf8');

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

check('holeSat no longer builds Auto/OSM pills (moved to Check location)',
  !/id="pshAutoOutline"/.test(satSrc) &&
  !/id="pshOsmOutline"/.test(satSrc) &&
  !/id="pshOutlineChip"/.test(satSrc) &&
  !/id="pshOutlineRow"/.test(satSrc) &&
  /id="pshMoveTee"/.test(satSrc) &&
  /id="psh3d"/.test(satSrc));

check('Check location editor has Auto/OSM outline buttons (second row)',
  /id="gelAutoOutline"/.test(editSrc) &&
  /id="gelOsmOutline"/.test(editSrc) &&
  /id="gelOutlineRow"/.test(editSrc) &&
  /gelOutlineMode/.test(editSrc));

check('Check location Load this green still re-boots at the sample point',
  /location\.replace\('\?r='/.test(editSrc) &&
  /qs2\.set\('lat'/.test(editSrc) &&
  /qs2\.set\('lng'/.test(editSrc));

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
    /* ---- (2) holeSat Auto/OSM pills are gone from the Prep sheet ------ */
    let prevWindow, prevDocument, prevL, prevFetch, prevHTMLElement, prevElement, prevNode, prevRAF;
    const snapshotGlobals = () => {
      prevWindow = global.window;
      prevDocument = global.document;
      prevL = global.L;
      prevFetch = global.fetch;
      prevHTMLElement = global.HTMLElement;
      prevElement = global.Element;
      prevNode = global.Node;
      prevRAF = global.requestAnimationFrame;
    };
    const restoreGlobals = () => {
      if (prevWindow) global.window = prevWindow;
      if (prevDocument) global.document = prevDocument;
      if (prevL !== undefined) global.L = prevL;
      if (prevFetch !== undefined) global.fetch = prevFetch;
      if (prevHTMLElement) global.HTMLElement = prevHTMLElement;
      if (prevElement) global.Element = prevElement;
      if (prevNode) global.Node = prevNode;
      if (prevRAF) global.requestAnimationFrame = prevRAF;
    };
    const makeFakeL = (leafletCalls, mapHandlers) => {
      function fakeLayer(kind, opts) {
        return {
          __kind: kind, __opts: opts || {},
          addTo() { leafletCalls.push([kind, this.__opts]); return this; },
          on() { return this; },
        };
      }
      return {
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
            on(ev, fn) {
              if (mapHandlers) {
                (mapHandlers[ev] = mapHandlers[ev] || []).push(fn);
              }
              return this;
            },
            fire(ev, payload) {
              if (mapHandlers && mapHandlers[ev])
                mapHandlers[ev].forEach((fn) => fn(payload));
            },
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
        marker: (ll, o) => {
          const latlng = Array.isArray(ll)
            ? { lat: ll[0], lng: ll[1] }
            : { lat: ll.lat, lng: ll.lng };
          const m = fakeLayer('marker', Object.assign({ __ll: ll }, o));
          m.getLatLng = () => latlng;
          m.setLatLng = (ll2) => {
            if (ll2 && ll2.lat != null) { latlng.lat = ll2.lat; latlng.lng = ll2.lng; }
            else if (Array.isArray(ll2)) { latlng.lat = ll2[0]; latlng.lng = ll2[1]; }
            return m;
          };
          const hs = {};
          m.on = (ev, fn) => { (hs[ev] = hs[ev] || []).push(fn); return m; };
          return m;
        },
        divIcon: (o) => o,
      };
    };
    try {
      const LAT0 = 41.778, LNG0 = -93.782;
      const leafletCalls = [];
      const FAKE_L = makeFakeL(leafletCalls, null);
      const html = '<html><body></body></html>';
      const dom = new JSDOM(html, { url: 'https://caddy.local/index.html', pretendToBeVisual: true });
      const { window } = dom;
      window.L = FAKE_L;
      snapshotGlobals();
      global.L = FAKE_L;
      global.window = window;
      global.document = window.document;
      global.HTMLElement = window.HTMLElement;
      global.Element = window.Element;
      global.Node = window.Node;
      global.requestAnimationFrame = (f) => setTimeout(f, 0);
      window.fetch = async () => { throw new Error('offline'); };
      global.fetch = window.fetch;
      eval(satSrc);
      check('PrepHoleSat mounted on the sheet window',
        !!(window.PrepHoleSat && typeof window.PrepHoleSat.open === 'function'));
      window.PrepHoleSat.open({
        greenLatLng: { lat: LAT0, lng: LNG0 },
        courseId: 'test-course',
        hole: 1,
        holeData: {
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
        },
        teeLL: { lat: LAT0, lng: LNG0 },
      });
      await new Promise((r) => setTimeout(r, 80));
      check('holeSat Auto outline button is ABSENT',
        !window.document.getElementById('pshAutoOutline'));
      check('holeSat OSM outline button is ABSENT',
        !window.document.getElementById('pshOsmOutline'));
      check('holeSat source chip is ABSENT',
        !window.document.getElementById('pshOutlineChip'));
      check('holeSat outline row is ABSENT',
        !window.document.getElementById('pshOutlineRow'));
      check('holeSat keeps Move tee + 3D Green',
        !!window.document.getElementById('pshMoveTee') &&
        !!window.document.getElementById('psh3d'));
    } catch (e) {
      fails++;
      console.error('FAIL - holeSat overlay harness', e.stack);
    } finally {
      restoreGlobals();
    }

    /* ---- (5) Check location Auto/OSM outline (greenedit) -------------- */
    try {
      const LAT0 = 41.778, LNG0 = -93.782;
      const LAT1 = LAT0 + 0.0004;
      const leafletCalls = [];
      const mapHandlers = {};
      const FAKE_L = makeFakeL(leafletCalls, mapHandlers);
      const html = '<html><body><button id="gm-editloc">Check location</button></body></html>';
      const dom = new JSDOM(html, {
        url: `https://caddy.local/greenmap.html?lat=${LAT0}&lng=${LNG0}`,
        pretendToBeVisual: true,
      });
      const { window } = dom;
      window.L = FAKE_L;
      snapshotGlobals();
      global.L = FAKE_L;
      global.window = window;
      global.document = window.document;
      global.HTMLElement = window.HTMLElement;
      global.Element = window.Element;
      global.Node = window.Node;
      global.requestAnimationFrame = (f) => setTimeout(f, 0);
      global.location = window.location;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('overpass')) {
          const m = decodeURIComponent(u).match(/around:\d+,([-\d.]+),([-\d.]+)/);
          const lat = m ? parseFloat(m[1]) : LAT0;
          const lng = m ? parseFloat(m[2]) : LNG0;
          const gLat = lat + 23 / 111320;
          return {
            ok: true,
            json: async () => ({
              elements: [{
                type: 'way', tags: { golf: 'green' },
                geometry: [
                  { lat: gLat, lon: lng },
                  { lat: gLat + 0.0002, lon: lng },
                  { lat: gLat + 0.0002, lon: lng + 0.0002 },
                  { lat: gLat, lon: lng + 0.0002 },
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
      window.CaddyElev = {
        fetchElevGrid: async () => {
          const N = 16, cs = 90 / N, grid = new Float32Array(N * N);
          for (let i = 0; i < N * N; i++) grid[i] = 100;
          return { grid, W: N, H: N, cellSizeM: cs };
        }
      };
      eval(editSrc);
      if (window.document.readyState === 'loading') {
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
      }
      const openBtn = window.document.getElementById('gm-editloc');
      check('Check location button is wired', !!openBtn);
      if (openBtn) openBtn.click();
      await new Promise((r) => setTimeout(r, 80));
      const auto = window.document.getElementById('gelAutoOutline');
      const osm = window.document.getElementById('gelOsmOutline');
      const hint = window.document.querySelector('.gel-hint');
      check('greenedit Auto outline button is in the sheet', !!auto);
      check('greenedit OSM outline button is in the sheet', !!osm);
      check('greenedit hint line exists', !!hint);

      if (osm) osm.click();
      await new Promise((r) => setTimeout(r, 80));
      const osmPolys = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#7dff9b' && c[1].weight === 3);
      check('OSM outline draws a #7dff9b weight-3 ring',
        osmPolys.length >= 1,
        `osm preview polys=${osmPolys.length}`);
      check('OSM button looks active (aria-pressed)',
        osm && osm.getAttribute('aria-pressed') === 'true');
      check('Auto button is not pressed while OSM is on',
        auto && auto.getAttribute('aria-pressed') === 'false');
      check('hint names OSM source with distance',
        !!(hint && /Outline: OSM \(mapped green \d+ m away\)/.test(hint.textContent)),
        hint && hint.textContent);

      const osmCountAfterClick = osmPolys.length;
      if (window.__gelMap && typeof window.__gelMap.fire === 'function') {
        window.__gelMap.fire('click', { latlng: { lat: LAT1, lng: LNG0 } });
      }
      await new Promise((r) => setTimeout(r, 80));
      const osmPolysAfterTap = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#7dff9b' && c[1].weight === 3);
      check('OSM tap re-fetches and draws a new ring at the tapped point',
        osmPolysAfterTap.length > osmCountAfterClick,
        `beforeTap=${osmCountAfterClick} afterTap=${osmPolysAfterTap.length}`);

      if (auto) auto.click();
      await new Promise((r) => setTimeout(r, 80));
      const autoPolys = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#ffd166' && c[1].weight === 3);
      check('Auto outline runs detect and draws a #ffd166 weight-3 ring',
        autoPolys.length >= 1,
        `auto preview polys=${autoPolys.length}`);
      check('Auto button looks active (aria-pressed); OSM is off',
        auto && auto.getAttribute('aria-pressed') === 'true' &&
        osm && osm.getAttribute('aria-pressed') === 'false');
      check('hint names Auto source',
        !!(hint && /Outline: Auto \(detected\)/.test(hint.textContent)),
        hint && hint.textContent);

      const autoCount = autoPolys.length;
      if (window.__gelMap && typeof window.__gelMap.fire === 'function') {
        window.__gelMap.fire('click', { latlng: { lat: LAT0, lng: LNG0 } });
      }
      await new Promise((r) => setTimeout(r, 80));
      const autoPolysAfterTap = leafletCalls.filter((c) =>
        c[0] === 'polygon' && c[1] && c[1].color === '#ffd166' && c[1].weight === 3);
      check('Auto tap re-runs detect at the tapped point',
        autoPolysAfterTap.length > autoCount,
        `beforeTap=${autoCount} afterTap=${autoPolysAfterTap.length}`);

      if (auto) auto.click();
      await new Promise((r) => setTimeout(r, 40));
      check('tapping the active Auto button turns it off',
        window.__gelOutline && window.__gelOutline.mode === null &&
        auto.getAttribute('aria-pressed') === 'false',
        window.__gelOutline && window.__gelOutline.mode);
    } catch (e) {
      fails++;
      console.error('FAIL - greenedit outline harness', e.stack);
    } finally {
      restoreGlobals();
    }

    if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
    console.log('v1.21.9 SATELLITE OUTLINE PASSED');
    process.exit(0);
  });
}
