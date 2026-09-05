'use strict';
// Isolated OutlineStore behavior for the Check-location relocation scenario:
// ring distance decides identity, not raw coordinate noise. Reproduces the
// reviewer's probe (140 m relocation, retained course/hole) without app boot.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'outlineStore.js'), 'utf8');
const center = { lat: 40, lng: -100 };
const moved = { lat: 40.0012, lng: -100 }; // ~133 m, outside any 5 m ring
function ring(g, r) {
  const lat = r / 111320, lng = r / (111320 * Math.cos(g.lat * Math.PI / 180));
  return [[g.lat - lat, g.lng - lng], [g.lat - lat, g.lng + lng],
    [g.lat + lat, g.lng + lng], [g.lat + lat, g.lng - lng]];
}
function boot() {
  const storage = new Map();
  const sandbox = { window: {}, localStorage: { getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)) } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { store: sandbox.window.OutlineStore, storage };
}
test('locked record 133 m away does not resolve at the relocated pin', () => {
  const h = boot();
  h.store.saveOsm(center.lat, center.lng, ring(center, 5), 0);
  h.store.useThis(center.lat, center.lng, 'osm', ring(center, 5));
  assert.equal(h.store.get(moved.lat, moved.lng), null,
    'identity is the green polygon, not coordinate noise');
  assert.equal(h.store.chosenRing(moved.lat, moved.lng), null);
});
test('pin inside a retained record ring still resolves to that green', () => {
  const h = boot();
  const wide = ring(center, 30);
  h.store.useThis(center.lat, center.lng, 'osm', wide);
  const inside = { lat: center.lat + 8 / 111320, lng: center.lng };
  assert.equal(h.store.get(inside.lat, inside.lng).lat, center.lat);
});
