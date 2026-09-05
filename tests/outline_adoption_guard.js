'use strict';
// Reviewer scenario: Check location relocates the pin while course/hole and
// the profile's original greenRingPts are retained. The profile ring belongs
// to the ORIGINAL green; it must not be adopted (and cached) at the new pin,
// and the correct OSM lookup must still run.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const original = { lat: 40, lng: -100 };
const moved = { lat: 40.0012, lng: -100 }; // ~133 m, a different green
function ring(g, r) {
  const lat = r / 111320, lng = r / (111320 * Math.cos(g.lat * Math.PI / 180));
  return [[g.lat - lat, g.lng - lng], [g.lat - lat, g.lng + lng],
    [g.lat + lat, g.lng + lng], [g.lat + lat, g.lng - lng]];
}
async function boot({ pin, seedStore, fetchImpl }) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'greenmap.html'), 'utf8'), {
    url: 'https://caddy.test/Caddy/greenmap.html?lat=' + pin.lat +
      '&lng=' + pin.lng + '&course=c1&hole=1',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  try {
    w.AbortController = AbortController;
    w.HTMLCanvasElement.prototype.getContext = () =>
      new Proxy({ createImageData: (W2, H2) => ({ data: new Uint8ClampedArray(W2 * H2 * 4) }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }) },
      { get(t, p) { return p in t ? t[p] : () => {}; }, set(t, p, v) { t[p] = v; return true; } });
    let osmCalls = 0;
    w.fetch = async (url) => {
      if (String(url).includes('overpass')) { osmCalls++; return fetchImpl(); }
      throw new Error('offline fixture');
    };
    w.CaddyElev = { fetchElevGrid: async (bbox) => ({
      grid: new Float32Array(64 * 64).fill(100), W: 64, H: 64,
      cellSizeM: 0.625, validMask: null, bbox }) };
    w.GreenDetect = { detect: () => null };
    if (seedStore) w.localStorage.setItem('caddy:greenOutlines:v2', JSON.stringify(seedStore));
    w.localStorage.setItem('caddy:courseProfiles:v1', JSON.stringify([{
      id: 'c1', holes: [{ greenRingPts: ring(original, 5) }] }]));
    w.eval(fs.readFileSync(path.join(root, 'outlineStore.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(root, 'greenmap.js'), 'utf8'));
    const deadline = Date.now() + 9000;
    while (!w.__gmState?.polySource && Date.now() < deadline) await new Promise(r => setTimeout(r, 40));
    const stored = JSON.parse(w.localStorage.getItem('caddy:greenOutlines:v2') || '{}');
    const result = { polySource: w.__gmState?.polySource ?? null, stored, osmCalls: () => osmCalls };
    dom.window.close();
    return result;
  } catch (e) { dom.window.close(); throw e; }
}
const polygonReply = (g) => ({
  ok: true, status: 200, json: async () => ({
    elements: [{ geometry: ring(g, 6).map(([la, ln]) => ({ lat: la, lon: ln })) }] }),
});
test('relocated pin: profile ring is not cached at the new pin; correct lookup runs', async () => {
  const h = await boot({
    pin: moved,
    seedStore: { [original.lat.toFixed(6) + ',' + original.lng.toFixed(6)]: {
      lat: original.lat, lng: original.lng, chosen: 'osm', locked: true, osmRing: ring(original, 5) } },
    fetchImpl: () => polygonReply(moved),
  });
  assert.equal(h.polySource, 'osm', 'the fetched ring for the moved green must be used');
  const movedKey = moved.lat.toFixed(6) + ',' + moved.lng.toFixed(6);
  assert.ok(h.stored[movedKey], 'the fetched outline is stored for the moved green');
  assert.deepEqual(h.stored[movedKey].osmRing, ring(moved, 6),
    'stored ring must be the looked-up green, never the relocated profile ring');
  assert.ok(h.osmCalls() >= 1, 'adoption must not shadow the OSM lookup');
});
test('same-green fine-tuning keeps offline adoption of the profile ring', async () => {
  // 1.5 m offset: still inside the 5 m profile ring.
  const near = { lat: original.lat + 1.5 / 111320, lng: original.lng };
  const h = await boot({ pin: near, seedStore: null,
    fetchImpl: () => { throw new Error('offline fixture'); } });
  assert.equal(h.polySource, 'osm', 'a pin on the same green still adopts the saved ring');
  const stored = Object.values(h.stored)[0];
  assert.deepEqual(stored.osmRing, ring(original, 5));
});
