'use strict';
/* tests/v1230_outline_model.js — v1.23.0 outline-model regressions
   ---------------------------------------------------------------------------
   1. OutlineStore unit contract (pure, headless): put/get nearest-within-100m,
      saveOsm/saveAuto chosen rules, useThis lock, setChosen no-ops,
      chosenRing fallback order.
   2. loadGreen ladder (source regex + jsdom boot with stubbed
      OutlineStore/CaddyElev/fetch): osm-only → osm; auto saved → switchable;
      no store + detect fail → honest card + NO 48-pt ellipse anywhere;
      pinlat/pinlng → flag at that point.
   3. Dock: #gm-src-osm/#gm-src-auto in their OWN row; disabled class when
      the store lacks the source; Arrows toggle exists; Both/Shading/Arrows
      trio absent from the HTML.
   4. greenedit: #gelUseOutline enabled-when-preview, useThis writes store.
   5. holeSat: chosen-ring preference + source chip.
   6. greenlink: pinlat/pinlng appended.
   Run: node tests/v1230_outline_model.js
   --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const storeSrc = fs.readFileSync(path.join(ROOT, 'outlineStore.js'), 'utf8');
const gmSrc = fs.readFileSync(path.join(ROOT, 'greenmap.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'greenmap.html'), 'utf8');
const editSrc = fs.readFileSync(path.join(ROOT, 'greenedit.js'), 'utf8');
const satSrc = fs.readFileSync(path.join(ROOT, 'holeSat.js'), 'utf8');
const linkSrc = fs.readFileSync(path.join(ROOT, 'greenlink.js'), 'utf8');
const prepSrc = fs.readFileSync(path.join(ROOT, 'prep.js'), 'utf8');

let fails = 0;
const check = (n, c, d = '') => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d); }
};

/* ---- 0. The ellipse is DEAD (grep assertions) --------------------------- */
check('no 48-point ellipse fallback polygon in greenmap.js',
  !/SPAN_M \* 0\.36/.test(gmSrc) &&
  !/for \(let a = 0; a < 48; a\+\+\)/.test(gmSrc),
  'synthetic circle remnant found');
check("no polySource 'ellipse' strings in greenmap.js",
  !/'ellipse'/.test(gmSrc) && !/=== 'ellipse'/.test(gmSrc),
  "polySource 'ellipse' remnant");
check("no 'traced' source remnants in greenmap.js",
  !/tracedHit/.test(gmSrc) && !/__altTrace/.test(gmSrc) &&
  !/srcPref === 'traced'/.test(gmSrc),
  'traced remnants');
check('index.html loads outlineStore.js before prep.js',
  (() => {
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const tag = idx.indexOf('<script src="./outlineStore.js">');
    const prep = idx.indexOf('<script defer src="./prep.js">');
    return tag !== -1 && prep !== -1 && tag < prep;
  })(),
  'load order');

/* ---- 1. OutlineStore unit contract -------------------------------------- */
{
  // Fresh sandbox per assertion group: private localStorage map.
  const sandbox = () => {
    const m = new Map();
    global.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
    global.window = {};
    delete require.cache[require.resolve(path.join(ROOT, 'outlineStore.js'))];
    require(path.join(ROOT, 'outlineStore.js'));
    return global.window.OutlineStore;
  };
  const ring = (lat, lng) =>
    [[lat, lng], [lat + 0.0002, lng], [lat + 0.0001, lng + 0.0002]];

  check('store keyFor is 3-decimal lat,lng', sandbox().keyFor(41.91314, -93.60971) ===
    '41.913,-93.610');

  {
    const S = sandbox();
    const r1 = ring(41.9, -93.6);
    S.saveOsm(41.9, -93.6, r1, 12);
    // Nearest-within-100m: 0.0004° lat ≈ 44 m — same green, different pin.
    const got = S.get(41.9004, -93.6);
    check('get resolves NEAREST record within 100 m (44 m offset)', !!got &&
      Array.isArray(got.osmRing) && got.osmRing.length === 3);
    check('get refuses beyond 100 m (0.003° ≈ 334 m)',
      S.get(41.903, -93.6) === null);
    check('saveOsm sets chosen=osm when unset',
      S.get(41.9, -93.6).chosen === 'osm');
  }
  {
    const S = sandbox();
    S.saveOsm(41.9, -93.6, ring(41.9, -93.6), 12);
    S.saveAuto(41.9, -93.6, ring(41.9001, -93.6), 0.8);
    const rec = S.get(41.9, -93.6);
    check('saveAuto flips chosen to auto when not locked',
      rec.chosen === 'auto' && rec.autoConf === 0.8);
    check('saveAuto stores the ring even when chosen stays osm after lock',
      Array.isArray(rec.autoRing));
  }
  {
    const S = sandbox();
    S.saveOsm(41.9, -93.6, ring(41.9, -93.6), 12);
    S.useThis(41.9, -93.6, 'auto', ring(41.9001, -93.6));
    const rec = S.get(41.9, -93.6);
    check('useThis locks + flips chosen', rec.chosen === 'auto' &&
      rec.locked === true);
    // saveAuto on a LOCKED record keeps the ring but never steals chosen.
    // useThis('auto') already left chosen='auto', so lock a DIFFERENT
    // source first to prove the flip is what got blocked.
    const S2 = sandbox();
    S2.useThis(41.9, -93.6, 'osm', ring(41.9, -93.6));
    S2.saveAuto(41.9, -93.6, ring(41.9002, -93.6), 0.9);
    check('saveAuto honours locked (chosen unchanged, ring updated)',
      S2.get(41.9, -93.6).chosen === 'osm' &&
      S2.get(41.9, -93.6).locked === true &&
      Array.isArray(S2.get(41.9, -93.6).autoRing));
  }
  {
    const S = sandbox();
    S.useThis(41.9, -93.6, 'osm', ring(41.9, -93.6));
    S.saveAuto(41.9, -93.6, ring(41.9001, -93.6), 0.8);
    check('locked osm choice survives saveAuto',
      S.get(41.9, -93.6).chosen === 'osm');
  }
  {
    const S = sandbox();
    S.saveAuto(41.9, -93.6, ring(41.9, -93.6), 0.8);
    check('setChosen is a no-op for a missing ring',
      S.setChosen(41.9, -93.6, 'osm').chosen === 'auto');
    check('setChosen switches when the ring exists', (() => {
      S.saveOsm(41.9, -93.6, ring(41.9001, -93.6), 5);
      return S.setChosen(41.9, -93.6, 'osm').chosen === 'osm';
    })());
  }
  {
    const S = sandbox();
    check('chosenRing null on empty store', S.chosenRing(41.9, -93.6) === null);
    S.saveAuto(41.9, -93.6, ring(41.9, -93.6), 0.8);
    check('chosenRing falls back to auto when no osm',
      S.chosenRing(41.9, -93.6).source === 'auto');
    S.saveOsm(41.9, -93.6, ring(41.9001, -93.6), 5);
    check('saveOsm does not steal an existing chosen (still auto)',
      S.chosenRing(41.9, -93.6).source === 'auto');
    S.setChosen(41.9, -93.6, 'osm');
    check('chosenRing honours chosen=osm',
      S.chosenRing(41.9, -93.6).source === 'osm');
    check('has() reports per-source presence',
      S.has(41.9, -93.6, 'osm') && S.has(41.9, -93.6, 'auto'));
    check('has() false for missing source',
      S.has(41.903, -93.6, 'osm') === false);
  }
  delete global.localStorage;
  delete global.window;
}

/* ---- 2. Dock HTML -------------------------------------------------------- */
check('dock has a dedicated source row (own .gm-dock-row)',
  /id="gm-src-row"[^>]*class="gm-dock-row"|class="gm-dock-row"[^>]*id="gm-src-row"/
    .test(htmlSrc));
check('#gm-src-osm and #gm-src-auto exist with radio semantics',
  /id="gm-src-osm"/.test(htmlSrc) && /id="gm-src-auto"/.test(htmlSrc) &&
  /role="radiogroup"/.test(htmlSrc));
check('Both/Shading/Arrows trio is GONE from the HTML',
  !/gm-layer-btn/.test(htmlSrc) && !/id="gm-layer-group"/.test(htmlSrc) &&
  !/>Both</.test(htmlSrc) && !/>Shading</.test(htmlSrc));
check('single #gm-arrows toggle exists (aria-pressed, default on)',
  /id="gm-arrows"[^>]*aria-pressed="true"/.test(htmlSrc));
check('hole-view overlay toggle buttons are GONE',
  !/gm-hole-auto-outline/.test(htmlSrc) && !/gm-hole-osm-outline/.test(htmlSrc));
check('hole-view source chip exists', /id="gm-outline-chip"/.test(htmlSrc));
check('honest-card detect button exists in the loading card',
  /id="gm-load-detect"/.test(htmlSrc));

/* ---- 3. Ladder wiring (source regex) ------------------------------------ */
check('loadGreen guards on window.OutlineStore (headless-safe)',
  /window\.OutlineStore \|\| null/.test(gmSrc));
check('course greenRingPts is adopted as the OSM identity via saveOsm',
  /saveOsm\(state\.lat, state\.lng,/.test(gmSrc) &&
  /savedRingLL/.test(gmSrc));
check('?src= is a switch command through OutlineStore.setChosen',
  /osm\.setChosen\(state\.lat, state\.lng, srcPref\)/.test(gmSrc));
check('OSM fetch rung saves its hit (saveOsm on hit)',
  /osm\.saveOsm\(state\.lat, state\.lng, chosenRingLL,/.test(gmSrc));
check('one-attempt auto-detect runs at the HIGH bar (0.75 AND >=30 cells)',
  /detectRes\.confidence >= 0\.75/.test(gmSrc) && /detCells >= 30/.test(gmSrc));
check('high-bar detect auto-saves via saveAuto',
  /osm\.saveAuto\(state\.lat, state\.lng,/.test(gmSrc));
check('tiny mask fails the rung (no demotion)',
  /cells < 30/.test(gmSrc) && /rung failed \(tiny mask\)/.test(gmSrc));
check('honest card copy present', /isn't mapped yet/.test(gmSrc) &&
  /Open Check location to place the pin and detect the outline/.test(gmSrc));
check('honest card routes to greenedit with &armdetect=1',
  /qs2\.set\('armdetect', '1'\)/.test(gmSrc));
check("polySource 'none' when nothing mapped", /polySource = 'none'/.test(gmSrc));
check('status names the source',
  /Outline: Auto \(detected — verify\)/.test(gmSrc) &&
  /Outline: OSM/.test(gmSrc) && /m from pin/.test(gmSrc));
check('loc badge keeps coords + appends source text, no tap-to-switch',
  /function setLocLabel/.test(gmSrc) && !/tap to switch/.test(gmSrc));
check('arrows gate is arrowsOn (and shading always draws)',
  /if \(state\.arrowsOn && !state\.__exagPreview\) \{/.test(gmSrc) &&
  !/state\.layer\b/.test(gmSrc));
check('dock-copy comment no longer claims 3D always draws both layers trio',
  !/Both \/ Shading \/ Arrows toggles/.test(gmSrc));
check('?pinlat/&pinlng drive the flag marker',
  /qs\.get\('pinlat'\)/.test(gmSrc) && /qs\.get\('pinlng'\)/.test(gmSrc) &&
  /pinOverride/.test(gmSrc));
check('putt solver pin = flag when inside the mask, else green centre',
  /function puttPin\(\)/.test(gmSrc) &&
  (gmSrc.match(/solvePutt\(\s*state\.ball, puttPin\(\)/g) || []).length === 2);
check('hole view draws ONE chosen ring (colour by source)',
  /state\.holeOutline/.test(gmSrc) &&
  /'#ffd166' : '#7dff9b'/.test(gmSrc) &&
  !/state\.overlays/.test(gmSrc));
check('source buttons sync: disabled class when the store lacks the source',
  /function syncSourceButtons/.test(gmSrc) &&
  /gm-btn-disabled/.test(gmSrc) &&
  /aria-disabled/.test(gmSrc));
check('dock source tap = setChosen + ?src= reload',
  /wireSrcBtn\('gm-src-osm', 'osm'\)/.test(gmSrc) &&
  /wireSrcBtn\('gm-src-auto', 'auto'\)/.test(gmSrc) &&
  /OutlineStore\.setChosen\(state\.lat, state\.lng, src\)/.test(gmSrc));
check('greyed Auto tap navigates to armdetect; greyed OSM tap just says so',
  /No auto outline yet — open Check location to detect it/.test(gmSrc) &&
  /No OSM green mapped here/.test(gmSrc));

/* ---- 4. greenedit ------------------------------------------------------- */
check('#gelUseOutline exists in the outline row',
  /id="gelUseOutline"/.test(editSrc));
check('Use-this is enabled ONLY while a preview ring is on screen',
  /gelPreviewRingLL/.test(editSrc) &&
  /get useEnabled\(\)/.test(editSrc));
check('useThis writes the store (chosen + locked)',
  /OS\.useThis\(llPin\.lat, llPin\.lng, gelOutlineMode,\s*gelPreviewRingLL\)/
    .test(editSrc));
check('confirm hints: "Outline saved (OSM)" / "Outline saved (Auto) — locked"',
  /'Outline saved \(OSM\)'/.test(editSrc) &&
  /'Outline saved \(Auto\) — locked'/.test(editSrc));
check('high-bar greenedit auto-save (0.75 AND 30 cells)',
  /res\.conf >= 0\.75 && \(res\.cells \|\| 0\) >= 30/.test(editSrc) &&
  /OS\.saveAuto\(ll\.lat, ll\.lng, res\.ll, res\.conf\)/.test(editSrc));
check('mid-bar (0.6..0.75) previews but does NOT save, with the honest hint',
  /Low confidence — not saved\. Use this outline to keep it\./.test(editSrc));
check('locked hint names the replace path',
  /existing outline locked; Use this outline to replace it/.test(editSrc));
check('&armdetect=1 opens the editor and runs Auto detect at the pin',
  /get\('armdetect'\) === '1'/.test(editSrc) &&
  /autoBtn0\.click\(\)/.test(editSrc));

/* ---- 5. holeSat + greenlink + prep -------------------------------------- */
check('holeSat prefers OutlineStore.chosenRing (headless-guarded)',
  /window\.OutlineStore && typeof window\.OutlineStore\.chosenRing/.test(satSrc));
check('holeSat shows a source chip (OSM/AUTO) when a ring is drawn',
  /id="pshSrcChip"/.test(satSrc) && /ringSrc === 'auto' \? 'AUTO' : 'OSM'/
    .test(satSrc));
check('holeSat keeps Move tee + 3D Green, still NO outline controls',
  !/id="pshAutoOutline"/.test(satSrc) && !/id="pshOsmOutline"/.test(satSrc));
check('greenlink appends &pinlat/&pinlng from the marked green',
  /pinlat=/.test(linkSrc) && /pinlng=/.test(linkSrc) &&
  /g\.pin\.lat\.toFixed\(6\)/.test(linkSrc));
check('prep.js reads the chosen ring for the cartoon and the brief',
  (prepSrc.match(/window\.OutlineStore\.chosenRing/g) || []).length >= 2);

/* ---- 6. jsdom boot: osm-only → osm chosen; pin at ?pinlat --------------- */
(async () => {
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    console.log('  ok  - (jsdom unavailable — skipping boot sims)');
    finish();
    return;
  }

  const LAT0 = 41.778, LNG0 = -93.782;
  function el(id) {
    return {
      id, textContent: '', innerHTML: '', style: {}, hidden: false,
      value: '1', dataset: {}, _attrs: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, appendChild() {},
      setAttribute(k, v) { this._attrs[k] = String(v); },
      removeAttribute(k) { delete this._attrs[k]; },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      getContext: () => ({
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, stroke() {}, arc() {}, ellipse() {},
        quadraticCurveTo() {}, bezierCurveTo() {}, save() {}, restore() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createImageData: (w, h) =>
          ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {}, setLineDash() {}, drawImage() {},
        fillText() {}, strokeText() {},
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high', lineJoin: '', lineCap: ''
      }),
      getBoundingClientRect: () =>
        ({ left: 0, top: 0, width: 400, height: 400, bottom: 80 })
    };
  }
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
  function bootGm(urlSearch, store) {
    const handlers = {};
    const els = {};
    const ids = ['gm-canvas','gm-status','gm-exag-wrap','gm-exag',
      'gm-exag-val','gm-ball','gm-recenter','gm-legend-title','gm-rampbar',
      'gm-ramplabels','gm-tip','gm-quality','gm-stimp','gm-loc','gm-loading',
      'gm-load-status','gm-load-detect','gm-back','gm-editloc','gm-flyover',
      'gm-src-osm','gm-src-auto','gm-arrows','gm-outline-chip','gm-topstack'];
    ids.forEach((id) => { els[id] = el(id); });
    els['gm-canvas'].width = 400; els['gm-canvas'].height = 400;
    const prev = {
      window: global.window, document: global.document,
      location: global.location, fetch: global.fetch,
      localStorage: global.localStorage,
    };
    global.window = {
      devicePixelRatio: 2, addEventListener() {},
      CaddyElev: { fetchElevGrid: async (bbox, size) => {
        const [w, s, e, n] = bbox;
        const lat = (s + n) / 2, lng = (w + e) / 2;
        const spanM = Math.max(
          (e - w) * 111320 * Math.cos(lat * Math.PI / 180),
          (n - s) * 110540);
        return synthEg(spanM, Math.min(size, 64), lat, lng);
      } },
      OutlineStore: store,
    };
    global.document = {
      getElementById: (id) => els[id] || (els[id] = el(id)),
      querySelectorAll: (sel) => {
        if (sel === '.gm-view-btn')
          return ['3d', 'hole'].map((v) => {
            const e = el('view-' + v); e.dataset.view = v; return e; });
        if (sel === '.gm-mode-btn')
          return ['slope', 'elev'].map((v) => {
            const e = el('mode-' + v); e.dataset.mode = v; return e; });
        if (sel === '#gm-ramplabels span') return [el('s0'), el('s1'), el('s2')];
        return [];
      },
      querySelector: () => null,
      createElement: () => el('created'),
      addEventListener() {},
      documentElement: { style: { setProperty() {}, getPropertyValue: () => '' } }
    };
    global.location = { search: urlSearch };
    global.localStorage = (() => {
      const m = new Map();
      return { getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k) };
    })();
    global.fetch = async () => { throw new Error('offline'); };
    global.innerWidth = 800; global.innerHeight = 600;
    global.requestAnimationFrame = (f) => setImmediate(f);
    global.performance = { now: () => Date.now() };
    global.window.GreenDetect = { detect: () => null };
    delete require.cache[require.resolve(path.join(ROOT, 'greenmap.js'))];
    require(path.join(ROOT, 'greenmap.js'));
    return { els, handlers, prev };
  }
  const restore = (prev) => {
    global.window = prev.window; global.document = prev.document;
    global.location = prev.location; global.fetch = prev.fetch;
    global.localStorage = prev.localStorage;
  };
  const mkStore = (recs) => {
    const m = Object.assign({}, recs);
    const nearest = (lat, lng) => {
      let best = null, bd = Infinity;
      for (const k of Object.keys(m)) {
        const o = m[k];
        const d = Math.hypot((o.lat - lat) * 111320,
          (o.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180));
        if (d < bd) { bd = d; best = o; }
      }
      return bd <= 100 ? best : null;
    };
    return {
      get: (lat, lng) => nearest(lat, lng) || null,
      has: (lat, lng, s) => {
        const r = nearest(lat, lng);
        return !!(r && Array.isArray(s === 'osm' ? r.osmRing : r.autoRing));
      },
      setChosen: (lat, lng, s) => {
        const r = nearest(lat, lng);
        if (r && Array.isArray(s === 'osm' ? r.osmRing : r.autoRing))
          r.chosen = s;
        return r;
      },
      chosenRing: (lat, lng) => {
        const r = nearest(lat, lng);
        if (!r) return null;
        if (r.chosen === 'osm' && r.osmRing)
          return { source: 'osm', ring: r.osmRing };
        if (r.chosen === 'auto' && r.autoRing)
          return { source: 'auto', ring: r.autoRing };
        if (r.osmRing) return { source: 'osm', ring: r.osmRing };
        if (r.autoRing) return { source: 'auto', ring: r.autoRing };
        return null;
      },
      saveOsm: (lat, lng, ring, distM) => {
        const r = nearest(lat, lng) || { lat, lng };
        r.osmRing = ring; r.osmDistM = distM;
        if (!r.chosen && !r.locked) r.chosen = 'osm';
        m[`${lat.toFixed(3)},${lng.toFixed(3)}`] = r;
        return r;
      },
      saveAuto: (lat, lng, ring, conf) => {
        const r = nearest(lat, lng) || { lat, lng };
        r.autoRing = ring; r.autoConf = conf;
        if (!r.locked) r.chosen = 'auto';
        m[`${lat.toFixed(3)},${lng.toFixed(3)}`] = r;
        return r;
      },
    };
  };

  const ringA = [[LAT0, LNG0], [LAT0 + 0.0003, LNG0],
    [LAT0 + 0.00015, LNG0 + 0.0003]];

  // (a) osm-only store → chosen 'osm', flag at centre, chip hidden in 3D.
  await new Promise((resolve) => {
    const store = mkStore({
      [`${LAT0.toFixed(3)},${LNG0.toFixed(3)}`]: {
        lat: LAT0, lng: LNG0, osmRing: ringA, osmDistM: 7, chosen: 'osm' },
    });
    const { els, prev } = bootGm(`?lat=${LAT0}&lng=${LNG0}`, store);
    setTimeout(() => {
      try {
        const st = global.window.__gmState;
        check('boot (osm-only): outline chosen from the store',
          st && st.polySource === 'osm');
        check('boot (osm-only): pin at green centre (no pinlat)',
          st && Array.isArray(st.pin) && st.pin[0] === 0 && st.pin[1] === 0);
        check('boot (osm-only): status names OSM',
          /Outline: OSM/.test(els['gm-status'].textContent),
          els['gm-status'].textContent);
        check('boot (osm-only): arrows toggle default ON (aria-pressed)',
          els['gm-arrows'].getAttribute &&
          els['gm-arrows'].getAttribute('aria-pressed') === 'true');
      } catch (e) { fails++; console.error('FAIL - osm boot', e.stack); }
      restore(prev);
      resolve();
    }, 1400);
  });

  // (b) auto saved → switchable; ?src=auto chooses it; flag at ?pinlat.
  await new Promise((resolve) => {
    const store = mkStore({
      [`${LAT0.toFixed(3)},${LNG0.toFixed(3)}`]: {
        lat: LAT0, lng: LNG0, osmRing: ringA, osmDistM: 7,
        autoRing: ringA, autoConf: 0.8, chosen: 'osm' },
    });
    const { els, prev } = bootGm(
      `?lat=${LAT0}&lng=${LNG0}&src=auto&pinlat=${LAT0 + 0.0001}` +
      `&pinlng=${LNG0 + 0.0001}`, store);
    setTimeout(() => {
      try {
        const st = global.window.__gmState;
        check('?src=auto switches the chosen source', st.polySource === 'auto');
        check('?pinlat/&pinlng move the FLAG off the centre',
          Math.abs(st.pin[0]) > 0.5 && Math.abs(st.pin[1]) > 0.5,
          JSON.stringify(st.pin));
        check('status names Auto with the verify warning',
          /Outline: Auto \(detected — verify\)/.test(els['gm-status'].textContent),
          els['gm-status'].textContent);
      } catch (e) { fails++; console.error('FAIL - auto boot', e.stack); }
      restore(prev);
      resolve();
    }, 1400);
  });

  // (c) NO store + detect fail → honest card, no fallback polygon.
  await new Promise((resolve) => {
    const { els, prev } = bootGm(`?lat=${LAT0}&lng=${LNG0}`, null);
    setTimeout(() => {
      try {
        const st = global.window.__gmState;
        check('no store + detect fail: polySource none', st.polySource === 'none');
        check('honest card title shown',
          /isn't mapped yet/.test(els['gm-loading'].textContent) ||
          /isn't mapped yet/.test(els['gm-status'].textContent),
          els['gm-status'].textContent);
        check('honest card offers the detect path',
          els['gm-load-detect'] && els['gm-load-detect'].hidden === false);
        check('no polygon rendered',
          st.polyLocal === null && st.mask === null);
      } catch (e) { fails++; console.error('FAIL - honest boot', e.stack); }
      restore(prev);
      resolve();
    }, 1400);
  });

  finish();
})().catch((e) => {
  fails++;
  console.error('FAIL - harness threw', e && e.stack || e);
  finish();
});

function finish() {
  if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
  console.log('v1.23.0 OUTLINE MODEL PASSED');
  process.exit(0);
}
