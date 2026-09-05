'use strict';
/* Synthetic offline terrain only: exercise the real, unmodified GreenMapCore
   and GreenBriefCore. Run: node tests/green_brief_correctness.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ROOT = path.join(__dirname, '..');
const CENTER = { lat: 40, lng: -100 };
const TEE = { lat: 39.998, lng: -100 };
const NOW = 1800000000000; // fixed synthetic clock
const BRIEF_KEY = 'caddy:greenBrief:v1';
function plane(east = 0, south = 0) {
  const N = 64, grid = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    grid[y * N + x] = 100 + east * (x - N / 2) + south * (y - N / 2);
  return { grid, W: N, H: N, cellSizeM: 1, validMask: new Uint8Array(N * N).fill(1) };
}
function ringAt(xy, center = CENTER) {
  const mLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  return xy.map(([x, y]) => [center.lat + y / 111320, center.lng + x / mLng]);
}
const objects = ring => ring.map(([lat, lng]) => ({ lat, lng }));
const plain = value => JSON.parse(JSON.stringify(value));
function boot(eg = plane()) {
  const data = new Map();
  const clock = { now: NOW };
  const context = vm.createContext({
    console, Date: class extends Date { static now() { return clock.now; } },
    localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: key => data.delete(key),
    },
    CaddyElev: { fetchElevGrid: async () => eg },
  });
  context.window = context;
  for (const file of ['greenmap.js', 'greenBriefCore.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return { w: context, core: context.GreenBriefCore, clock, data };
}

for (const [name, east, south, fall, high] of [
  ['rises south, falls NORTH', 0, 0.02, 0, 180],
  ['rises north, falls SOUTH (north high side is valid zero)', 0, -0.02, 180, 0],
  ['rises east, falls WEST', 0.02, 0, 270, 90],
  ['rises west, falls EAST', -0.02, 0, 90, 270],
]) {
  test(`SYNTHETIC plane ${name}: brief agrees with physical compass directions`, async () => {
    const eg = plane(east, south);
    const { w, core } = boot(eg);
    const field = w.GreenMapCore.computeGradientField(eg.grid, 64, 64, 1, i => !!eg.validMask[i]);
    const pin = 32 * 64 + 32;
    assert.equal(Math.round(w.GreenMapCore.fallBearingDeg(field.gx[pin], field.gy[pin])), fall);
    const brief = await core.build({ centerLL: CENTER, teeLL: TEE });
    assert.ok(brief);
    assert.equal(brief.landing.atPin.dirDeg, fall, 'downhill must not invert the raster north/south axis');
    assert.equal(brief.highSideDirDeg, high, 'high side is opposite downhill, including bearing zero');
    assert.ok(brief.zones.every(z => z.dirDeg === fall));
  });
}

test('tuple and object rings give identical in-green probes and masked simulations', async () => {
  const { w, core } = boot(plane(0.02, 0));
  const xy = [[-4, -6], [4, -6], [4, 6], [-4, 6]];
  const ring = ringAt(xy);
  const sim = w.GreenMapCore.simPuttPath;
  let trace = [];
  w.GreenMapCore.simPuttPath = (...args) => {
    trace.push({ ball: plain(args[0]), mask: args[6] });
    return sim(...args);
  };
  const a = await core.build({ centerLL: CENTER, teeLL: TEE, polyLL: objects(ring) });
  const aTrace = trace; trace = [];
  const b = await core.build({ centerLL: CENTER, teeLL: TEE, polyLL: ring });
  assert.ok(a && b);
  assert.deepEqual(trace.map(t => t.ball), aTrace.map(t => t.ball), 'tuple ring must not fall back to an 18 m radius');
  assert.deepEqual(plain(a.zones), plain(b.zones));
  for (const t of [...aTrace, ...trace]) {
    assert.ok(w.GreenMapCore.pointInPoly(t.ball[0], t.ball[1], xy), 'probe must be inside the real green');
    assert.ok(t.mask && t.mask.length === 64 * 64, 'putt simulation must receive the green polygon mask');
    assert.ok(t.mask.some(v => !v), 'the mask must exclude surrounding terrain');
  }
});

test('unusable elevation or geometry returns null without persisting fabricated zero-break advice', async () => {
  const goodRing = ringAt([[-4, -6], [4, -6], [4, 6], [-4, 6]]);
  const cases = [
    ['all no-data', () => { const eg = plane(); eg.validMask.fill(0); return eg; }],
    ['all NaN without a mask', () => { const eg = plane(); eg.grid.fill(NaN); eg.validMask = null; return eg; }],
    ['pin is no-data', () => { const eg = plane(); eg.validMask[32 * 64 + 32] = 0; return eg; }],
    ['pin gradient has an invalid diagonal', () => { const eg = plane(); eg.grid[31 * 64 + 31] = NaN; return eg; }],
    ['missing dimensions', () => ({ grid: new Float32Array(16) })],
    ['zero cell size', () => ({ ...plane(), cellSizeM: 0 })],
    ['short grid', () => ({ ...plane(), grid: new Float32Array(10) })],
  ];
  for (const [name, makeGrid] of cases) {
    const { core, data } = boot(makeGrid());
    const before = JSON.stringify({ unrelated: { sentinel: true } });
    data.set(BRIEF_KEY, before);
    assert.equal(await core.build({ centerLL: CENTER, teeLL: TEE, polyLL: goodRing }), null, name);
    assert.equal(data.get(BRIEF_KEY), before, `${name} must not replace saved data`);
  }
  for (const [name, polyLL] of [
    ['invalid vertex', [[40, -100], [NaN, -100], [40.001, -100.001]]],
    ['empty supplied ring', []],
    ['zero-area ring', ringAt([[0, -5], [0, 0], [0, 5]])],
    ['pin outside ring', ringAt([[2, -5], [8, -5], [8, 5], [2, 5]])],
    ['no usable front probe', ringAt([[-4, -0.05], [4, -0.05], [4, 5], [-4, 5]])],
  ]) {
    const { core, data } = boot(plane(0.02, 0));
    assert.equal(await core.build({ centerLL: CENTER, teeLL: TEE, polyLL }), null, name);
    assert.equal(data.has(BRIEF_KEY), false, name);
  }
});

test('nonfinite simulation results are unavailable, not zero inches of break', async () => {
  const { w, core, data } = boot(plane(0.02, 0));
  w.GreenMapCore.simPuttPath = () => ({ breakIn: NaN, stopped: 'dead', pts: [[0, -2], [0, 0]] });
  assert.equal(await core.build({ centerLL: CENTER, teeLL: TEE }), null);
  assert.equal(data.has(BRIEF_KEY), false);
});

test('a flat green has no invented compass high side', async () => {
  const { core } = boot(plane());
  const brief = await core.build({ centerLL: CENTER });
  assert.ok(brief);
  assert.equal(brief.slopePct, 0);
  assert.equal(brief.highSideDirDeg, null);
  assert.equal(brief.landing.atPin.dirDeg, null);
});

test('radius-only compatibility stays within the requested footprint', async () => {
  const eg = plane();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (Math.hypot(x - 32, y - 32) > 8) eg.grid[y * 64 + x] += 0.02 * (x - 32);
  }
  const { w, core } = boot(eg);
  const sim = w.GreenMapCore.simPuttPath;
  w.GreenMapCore.simPuttPath = (...args) => {
    assert.ok(args[6] && args[6].some(v => !v), 'even the radius fallback must not simulate the padded raster');
    return sim(...args);
  };
  const brief = await core.build({ centerLL: CENTER, radiusM: 4 });
  assert.ok(brief);
  assert.equal(brief.slopePct, 0);
});

test('brief cache expires, rejects old automatic math and verifies exact owner coordinates', async () => {
  const { core, clock, data } = boot(plane(0.02, 0));
  const opts = { centerLL: CENTER, teeLL: TEE, polyLL: ringAt([[-4, -6], [4, -6], [4, 6], [-4, 6]]), stimp: 10 };
  const brief = await core.build(opts);
  assert.ok(core.briefFor(CENTER), 'exact-center API remains usable');
  clock.now = NOW + 31 * 24 * 3600 * 1000;
  assert.equal(core.briefFor(CENTER), null, 'old brief cannot display indefinitely');
  clock.now = NOW - 1;
  assert.equal(core.briefFor(CENTER), null, 'future timestamps are not fresh');
  clock.now = NOW;
  const old = { ...plain(brief) }; delete old.calcRevision;
  data.set(BRIEF_KEY, JSON.stringify({ [core.keyFor(CENTER.lat, CENTER.lng)]: old }));
  assert.equal(core.briefFor(CENTER), null, 'known-bad prep-auto format is invalid even when recently saved');
  const neighbour = { lat: CENTER.lat + 4 / 111320, lng: CENTER.lng };
  data.set(BRIEF_KEY, JSON.stringify({ [core.keyFor(neighbour.lat, neighbour.lng)]: plain(brief) }));
  assert.equal(core.briefFor(neighbour), null, 'a matching storage key cannot override different owner coordinates');
});

test('cache identity tracks stimp, tee, radius and normalized ring when supplied', async () => {
  const { core } = boot(plane(0.02, 0));
  const polyLL = ringAt([[-4, -6], [4, -6], [4, 6], [-4, 6]]);
  const options = { teeLL: TEE, polyLL, radiusM: 18, stimp: 10 };
  await core.build({ centerLL: CENTER, ...options });
  assert.ok(core.briefFor(CENTER, { ...options, polyLL: objects(polyLL) }), 'same tuple/object ring is the same configuration');
  assert.equal(core.briefFor(CENTER, { ...options, stimp: 12 }), null, 'different speed must be rebuilt');
  assert.equal(core.briefFor(CENTER, { ...options, teeLL: { lat: 40, lng: -100.002 } }), null, 'tee edit changes approach-relative break');
  assert.equal(core.briefFor(CENTER, { ...options, radiusM: 20 }), null, 'different sampling envelope invalidates old results');
  const changedRing = ringAt([[-4, -1.2], [4, -1.2], [4, 6], [-4, 6]]);
  assert.equal(core.briefFor(CENTER, { ...options, polyLL: changedRing }), null, 'chosen-outline change invalidates the brief');
});

test('two greens in one old four-decimal bucket keep separate brief records', async () => {
  const { core, data } = boot(plane(0.02, 0));
  const other = { lat: CENTER.lat + 4 / 111320, lng: CENTER.lng };
  await core.build({ centerLL: CENTER });
  await core.build({ centerLL: other });
  assert.equal(Object.keys(JSON.parse(data.get(BRIEF_KEY))).length, 2);
  assert.equal(core.briefFor(CENTER).lat, CENTER.lat);
  assert.equal(core.briefFor(other).lat, other.lat);
});

test('malformed storage is nonfatal and fresh legacy 3D briefs require known inputs for configuration matching', async () => {
  const { core, data } = boot(plane(0.02, 0));
  for (const raw of ['null', '[]', '42', '{invalid']) {
    data.set(BRIEF_KEY, raw);
    assert.equal(core.briefFor(CENTER), null, raw);
    assert.ok(await core.build({ centerLL: CENTER }), `rebuild replaces unusable store ${raw}`);
  }
  const brief = plain(await core.build({ centerLL: CENTER }));
  delete brief.source; delete brief.calcRevision; delete brief.inputs;
  data.set(BRIEF_KEY, JSON.stringify(brief));
  assert.ok(core.briefFor(CENTER), 'fresh exact-center legacy 3D schema remains readable');
  assert.equal(core.briefFor(CENTER, { stimp: 12 }), null, 'known legacy stimp must still match');
  assert.equal(core.briefFor(CENTER, { teeLL: TEE }), null, 'legacy unknown tee is not evidence for this approach');
});

test('flat mapped green excludes sloping surrounding terrain from its mean slope', async () => {
  const eg = plane();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const east = x - 32, north = 32 - y;
    if (Math.abs(east) > 6 || Math.abs(north) > 6) eg.grid[y * 64 + x] += 0.02 * east;
  }
  const { core } = boot(eg);
  const brief = await core.build({ centerLL: CENTER, teeLL: TEE,
    polyLL: ringAt([[-4, -4], [4, -4], [4, 4], [-4, 4]]) });
  assert.ok(brief);
  assert.equal(brief.slopePct, 0, 'surrounding fairway slope is not the putting surface slope');
});

test('concave and pin-near-edge rings never start a probe outside the green', async () => {
  for (const xy of [
    [[-4, -1.2], [4, -1.2], [4, 6], [-4, 6]],
    [[-6, -6], [6, -6], [6, 6], [2, 6], [2, 1], [-2, 1], [-2, 6], [-6, 6]],
  ]) {
    const { w, core } = boot(plane(0.02, 0));
    const sim = w.GreenMapCore.simPuttPath;
    const starts = [];
    w.GreenMapCore.simPuttPath = (...args) => { starts.push(args[0]); return sim(...args); };
    const brief = await core.build({ centerLL: CENTER, teeLL: TEE, polyLL: ringAt(xy) });
    assert.ok(brief);
    assert.equal(starts.length, 3);
    for (const [x, y] of starts)
      assert.ok(w.GreenMapCore.pointInPoly(x, y, xy), `outside probe ${x},${y}`);
  }
});
