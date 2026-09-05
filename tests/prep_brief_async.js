'use strict';
/* Synthetic offline holes/terrain, real Prep renderer and core. The test-only
   seam exposes private functions without changing production function bodies.
   Run: node tests/prep_brief_async.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const NOW = 1800000000000;
const BRIEF_KEY = 'caddy:greenBrief:v1';
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));
function hole(number = 1, lat = 40, courseId = 'SYNTHETIC-COURSE') {
  const center = { lat, lng: -100 };
  const tee = { lat: lat - 150 / 111320, lng: -100 };
  const mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const greenRingPts = [[-4, -6], [4, -6], [4, 6], [-4, 6]].map(([x, y]) =>
    ({ lat: lat + y / 111320, lng: -100 + x / mLng }));
  return { number, courseId, greenLatLng: center, teeLatLng: tee, greenRingPts,
    par: 3, yards: 164, bearing: 0, pathPts: [tee, center], hazards: [], shapes: {},
    green: { front: 158, center: 164, back: 170, depth: 12 } };
}
function plane() {
  const N = 64, grid = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y * N + x] = 100 + 0.02 * (x - N / 2);
  return { grid, W: N, H: N, cellSizeM: 1, validMask: new Uint8Array(N * N).fill(1) };
}
function boot() {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM('<!doctype html><div id="prepStudio"></div>', {
    url: 'https://synthetic-prep.invalid/Caddy/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.Date.now = () => NOW;
  w.fetch = async () => { throw new Error('network forbidden in synthetic test'); };
  w.requestAnimationFrame = () => 0;
  w.addEventListener('error', e => errors.push(e.error || e.message));
  w.CaddyPrep = { haptic() {}, locLat: () => 40, clubs: () => [], clubSequence: () => null,
    holeInfo: () => null };
  w.CaddyElev = { fetchElevGrid: async () => plane(), greenMap: async () => null };
  for (const file of ['greenmap.js', 'outlineStore.js', 'greenBriefCore.js'])
    w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'prep.js'), 'utf8');
  const end = src.lastIndexOf('})();');
  assert.ok(end > 0);
  w.eval(src.slice(0, end) + `
    window.__briefTest = { readGreenBrief, runGreenBriefAuto, bindHole, recomputeNow,
      getBound: () => boundHole, getCond: () => cond, getShot: () => shot,
      getInFlight: () => _briefInFlight };
  ` + src.slice(end));
  return { w, prep: w.__briefTest, errors, close: () => w.close() };
}
async function saveBrief(w, h, extra = {}) {
  return w.GreenBriefCore.build({ centerLL: h.greenLatLng, teeLL: h.teeLatLng,
    polyLL: h.greenRingPts, radiusM: 18, stimp: 10, ...extra });
}
function delayedElevation(w) {
  const calls = [];
  w.CaddyElev.fetchElevGrid = bbox => new Promise((resolve, reject) => {
    calls.push({ bbox, resolve: (eg = plane()) => resolve(eg), reject });
  });
  return calls;
}
function select(w, prep, h) {
  w.CaddyPrep.holeInfo = () => h;
  prep.bindHole(h.number);
  prep.recomputeNow();
}
const advice = w => w.document.querySelector('.prep-strat-advice').textContent;

test('auto build honors gm-stimp and reuses only an exactly matching cache', async () => {
  const { w, prep, close } = boot();
  try {
    const h = hole();
    w.localStorage.setItem('gm-stimp', '12');
    await prep.runGreenBriefAuto(h); await prep.getInFlight();
    assert.equal(prep.readGreenBrief(h).stimp, 12);
    let builds = 0;
    const build = w.GreenBriefCore.build;
    w.GreenBriefCore.build = options => { builds++; return build(options); };
    await prep.runGreenBriefAuto(h); await prep.getInFlight();
    assert.equal(builds, 0, 'fresh same geometry/speed requires no fetch');
    w.localStorage.setItem('gm-stimp', '8');
    await prep.runGreenBriefAuto(h); await prep.getInFlight();
    assert.equal(builds, 1, 'changing green speed rebuilds even within 30 days');
    assert.equal(prep.readGreenBrief(h).stimp, 8);
  } finally { close(); }
});

test('opening a hole builds its brief without requiring a satellite/3D tap', async () => {
  const { w, prep, close } = boot();
  try {
    const calls = delayedElevation(w);
    select(w, prep, hole());
    await tick();
    assert.equal(calls.length, 1, 'hole binding must start the invisible pipeline');
    assert.doesNotMatch(advice(w), /green feeds/i);
    calls[0].resolve(); await tick();
    assert.match(advice(w), /green feeds left/i, 'same-hole completion updates the existing prose');
  } finally { close(); }
});

test('distinct greens may build concurrently; duplicate requests share one build and late old-hole completion does not repaint', async () => {
  const { w, prep, close } = boot();
  try {
    const calls = delayedElevation(w);
    const a = hole(1, 40), b = hole(1, 40.001, 'SYNTHETIC-OTHER-COURSE');
    select(w, prep, a); prep.runGreenBriefAuto(a); prep.runGreenBriefAuto(a);
    select(w, prep, b); prep.runGreenBriefAuto(b); prep.runGreenBriefAuto(b);
    await tick();
    assert.equal(calls.length, 2, 'one global in-flight flag must not lose the newer green');
    assert.equal(prep.readGreenBrief(b), null);
    await tick(150); // settle pre-existing bind/recompute timers
    const body = w.document.getElementById('prepStratBody');
    const before = body.innerHTML;
    let mutations = 0;
    const observer = new w.MutationObserver(list => { mutations += list.length; });
    observer.observe(body, { childList: true, subtree: true, characterData: true });
    calls[0].resolve(); await tick();
    assert.equal(body.innerHTML, before, 'same hole number in a different course is not the same UI target');
    assert.equal(mutations, 0, 'old-hole completion must not rebuild the current card');
    calls[1].resolve(); await tick();
    assert.match(advice(w), /green feeds left/i);
    assert.ok(prep.readGreenBrief(a) && prep.readGreenBrief(b));
    assert.ok(mutations > 0, 'current-hole completion refreshes the visible advice');
    observer.disconnect();
  } finally { close(); }
});

test('same-green tee edit during a fetch queues only the latest inputs before refreshing', async () => {
  const { w, prep, close } = boot();
  try {
    const calls = delayedElevation(w), h = hole();
    select(w, prep, h); prep.runGreenBriefAuto(h); await tick();
    const firstTee = { ...h.teeLatLng };
    h.teeLatLng = { lat: 40, lng: -100.002 };
    prep.runGreenBriefAuto(h); prep.runGreenBriefAuto(h);
    assert.equal(calls.length, 1, 'serialize revisions of one green so late writes cannot win');
    calls[0].resolve(); await tick();
    assert.equal(calls.length, 2, 'newest tee must be retried after the older build');
    const stale = w.GreenBriefCore.briefFor(h.greenLatLng);
    assert.deepEqual(plain(stale.inputs.teeLL), firstTee, 'in-flight input snapshot cannot mutate under Move tee');
    assert.equal(prep.readGreenBrief(h), null, 'old tee result must never masquerade as the new configuration');
    calls[1].resolve(); await tick();
    assert.deepEqual(plain(prep.readGreenBrief(h).inputs.teeLL), plain(h.teeLatLng));
    assert.equal(calls.length, 2, 'completion does not start an infinite rebuild loop');
  } finally { close(); }
});

test('failed builds release their slot, do not spin, and a later request retries', async () => {
  const { w, prep, close } = boot();
  try {
    const calls = delayedElevation(w), a = hole(1, 40), b = hole(2, 40.001);
    select(w, prep, a); prep.runGreenBriefAuto(a);
    select(w, prep, b); prep.runGreenBriefAuto(b); await tick();
    assert.equal(calls.length, 2);
    calls[0].reject(new Error('SYNTHETIC USGS outage'));
    calls[1].resolve(null); await tick();
    assert.equal(calls.length, 2, 'failure should not busy-loop retries');
    assert.doesNotMatch(advice(w), /green feeds/i);
    prep.runGreenBriefAuto(b); await tick();
    assert.equal(calls.length, 3);
    calls[2].resolve(); await tick();
    assert.ok(prep.readGreenBrief(b));
    assert.match(advice(w), /green feeds left/i);
  } finally { close(); }
});

test('Move tee rebind triggers a rebuild and changed settings during fetch are retried', async () => {
  const { w, prep, close } = boot();
  try {
    const h = hole();
    await saveBrief(w, h);
    select(w, prep, h);
    const calls = delayedElevation(w);
    assert.equal(w.__prepRebind(h.number, { teePoint: { lat: 40, lng: -100.002 } }), true);
    await tick();
    assert.equal(calls.length, 1, 'Move tee must schedule a correctly oriented replacement brief');
    w.localStorage.setItem('gm-stimp', '12');
    calls[0].resolve(); await tick();
    assert.equal(calls.length, 2, 'completion rechecks settings without requiring another click');
    assert.equal(prep.readGreenBrief(h), null);
    calls[1].resolve(); await tick();
    assert.equal(prep.readGreenBrief(h).stimp, 12);
    assert.deepEqual(plain(prep.readGreenBrief(h).inputs.teeLL), plain(h.teeLatLng));
  } finally { close(); }
});

test('backup restore reloads Prep settings and invalidates pre-restore pending brief writes', async () => {
  const { w, prep, errors, close } = boot();
  try {
    const h = hole(), calls = delayedElevation(w);
    select(w, prep, h); await tick();
    assert.equal(calls.length, 1);
    const cond = { windMph: 3, windFromDeg: 10, tempF: 55, altFt: 700, elevFt: 0, surface: 'soft' };
    const shot = { greenPoint: 'back', lie: 'sand', shape: 'fade' };
    w.localStorage.setItem('caddy.prep.cond', JSON.stringify(cond));
    w.localStorage.setItem('caddy.prep.shot', JSON.stringify(shot));
    w.localStorage.setItem('gm-stimp', '8');
    const restoredStore = JSON.stringify({ 'unrelated-restored-key': { sentinel: true } });
    w.localStorage.setItem(BRIEF_KEY, restoredStore);
    w.dispatchEvent(new w.CustomEvent('caddy:data-restored'));
    await tick();
    assert.deepEqual(plain(prep.getCond()), cond, 'restored storage must replace the old condition snapshot');
    assert.deepEqual(plain(prep.getShot()), shot);
    assert.equal(prep.getBound(), null, 'an old venue snapshot must not survive backup replacement');
    calls[0].resolve(); await tick();
    assert.equal(w.localStorage.getItem(BRIEF_KEY), restoredStore, 'pre-restore fetch cannot overwrite restored cache');
    assert.equal(prep.getInFlight(), null);
    select(w, prep, h); await tick();
    assert.equal(calls.length, 2, 'restored Prep can build again instead of keeping an old in-flight lock');
    calls[1].resolve(); await tick();
    assert.equal(prep.readGreenBrief(h).stimp, 8);
    assert.match(advice(w), /green feeds left/i);
    // A restore that omits Prep keys must return to defaults, not the live
    // objects mutated by the previous session/restore.
    prep.getCond().tempF = 99;
    prep.getShot().shape = 'draw';
    w.localStorage.removeItem('caddy.prep.cond');
    w.localStorage.removeItem('caddy.prep.shot');
    w.dispatchEvent(new w.CustomEvent('caddy:data-restored')); await tick();
    assert.equal(prep.getCond().tempF, 70);
    assert.equal(prep.getShot().shape, 'straight');
    prep.getShot().shape = 'fade';
    w.dispatchEvent(new w.CustomEvent('caddy:data-restored')); await tick();
    assert.equal(prep.getShot().shape, 'straight', 'restoring absent keys must not mutate defaults');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

for (const reason of ['expired', 'neighbour', 'old-auto', 'stimp', 'tee', 'ring']) {
  test(`Prep never displays a ${reason} brief as current-hole advice`, async () => {
    const { w, prep, errors, close } = boot();
    try {
      const h = hole();
      const brief = plain(await saveBrief(w, h));
      assert.ok(brief);
      if (reason === 'expired') brief.savedAt = 1;
      if (reason === 'neighbour') brief.lat += 30 / 111320;
      if (reason === 'old-auto') delete brief.calcRevision;
      if (reason === 'stimp') w.localStorage.setItem('gm-stimp', '12');
      if (reason === 'tee') h.teeLatLng = { lat: 40, lng: -100.002 };
      if (reason === 'ring') {
        const shifted = h.greenRingPts.map(p => [p.lat + 1 / 111320, p.lng]);
        w.OutlineStore.useThis(h.greenLatLng.lat, h.greenLatLng.lng, 'osm', shifted);
      }
      w.localStorage.setItem(BRIEF_KEY, JSON.stringify({ [w.GreenBriefCore.keyFor(brief.lat, brief.lng)]: brief }));
      assert.equal(prep.readGreenBrief(h), null);
      // Binding/painting a rejected brief must keep the prose slope-free.
      w.CaddyElev.fetchElevGrid = async () => null;
      w.CaddyPrep.holeInfo = () => h;
      prep.bindHole(h.number); prep.recomputeNow();
      assert.doesNotMatch(w.document.querySelector('.prep-strat-advice').textContent, /green feeds/i);
      assert.deepEqual(errors, []);
    } finally { close(); }
  });
}

test('Prep reads a fresh exact-owner brief and the chosen tuple ring matches its object geometry', async () => {
  const { w, prep, close } = boot();
  try {
    const h = hole();
    const brief = await saveBrief(w, h);
    w.OutlineStore.useThis(h.greenLatLng.lat, h.greenLatLng.lng, 'osm',
      h.greenRingPts.map(p => [p.lat, p.lng]));
    assert.equal(prep.readGreenBrief(h).savedAt, brief.savedAt);
    w.localStorage.setItem(BRIEF_KEY, 'null');
    assert.equal(prep.readGreenBrief(h), null);
    w.localStorage.setItem(BRIEF_KEY, '{bad');
    assert.equal(prep.readGreenBrief(h), null);
  } finally { close(); }
});
