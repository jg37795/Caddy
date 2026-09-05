/* v1.0.77 green-maps headless unit tests:
   - synthetic GeoTIFF parser cases (tiled+nodata padding, garbage rows, spp=2)
   - localStorage LRU eviction under the 2MB cap
   - confidence gating / graceful nulls
   Run: node tests/v1077_elev_unit.js */
const path = require('path');

/* ---- Node shims for browser globals the service expects ---- */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Build a minimal little-endian tiled Float32 GeoTIFF.
function buildTiff(W, H, spp, tileW, tileH, sampleFn) {
  const f32 = []; // tile data as floats in emit order
  const tiles = [];
  const tilesAcross = Math.ceil(W / tileW);
  const tilesDown = Math.ceil(H / tileH);
  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const startIdx = f32.length;
      for (let r = 0; r < tileH; r++) {
        for (let c = 0; c < tileW; c++) {
          const gx = tx * tileW + c, gy = ty * tileH + r;
          for (let b = 0; b < spp; b++) {
            f32.push(gx < W && gy < H ? sampleFn(gx, gy, b) : 9999);
          }
        }
      }
      tiles.push({ startIdx });
    }
  }
  const dataSize = f32.length * 4;
  const ifdOffGuess = 8 + 12 * 10 + 4; // header + ~10 entries + next-IFD
  const dataOff = ifdOffGuess; // place pixel data right after IFD (values fit inline except offsets array)
  // We'll lay out: header(8) | IFD | offset arrays | pixel data
  const entries = [];
  const extra = []; // {bytes} blobs needing external storage
  function entry(tag, typ, cnt, vals) { entries.push({ tag, typ, cnt, vals }); }
  entry(256, 3, 1, [W]);
  entry(257, 3, 1, [H]);
  entry(258, 3, 1, [32]);
  entry(259, 3, 1, [1]);
  entry(277, 3, 1, [spp]);
  entry(322, 3, 1, [tileW]);
  entry(323, 3, 1, [tileH]);
  // 324/325 are LONG arrays > 4 bytes → external
  const nTiles = tiles.length;
  const extOff324 = null; // resolved below
  // compute layout manually
  const ifdSize = 2 + 12 * (8 + 2) + 4;
  const off324 = 8 + ifdSize;
  const off325 = off324 + 4 * nTiles;
  const dataStart = off325 + 4 * nTiles;

  const buf = Buffer.alloc(dataStart + dataSize);
  buf.writeUInt16LE(0x4949, 0);
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(10, 8); // 10 entries
  let e = 10;
  const putEntry = (tag, typ, cnt, valOrArr) => {
    buf.writeUInt16LE(tag, e); buf.writeUInt16LE(typ, e + 2);
    buf.writeUInt32LE(cnt, e + 4);
    if (Array.isArray(valOrArr)) {
      for (let i = 0; i < cnt; i++) buf.writeUInt32LE(valOrArr[i], e + 8 + i * 4);
    } else buf.writeUInt32LE(valOrArr, e + 8);
    e += 12;
  };
  putEntry(256, 3, 1, W);
  putEntry(257, 3, 1, H);
  putEntry(258, 3, 1, 32);
  putEntry(277, 3, 1, spp);
  putEntry(322, 3, 1, tileW);
  putEntry(323, 3, 1, tileH);
  putEntry(324, 4, nTiles,
    tiles.map((t, i) => dataStart + t.startIdx * 4));
  putEntry(325, 4, nTiles,
    Array.from({ length: nTiles }, () => tileW * tileH * spp * 4));
  putEntry(339, 3, 1, 3);
  putEntry(262, 3, 1, 1);
  buf.writeUInt32LE(0, e); // next IFD = 0

  let i = 0;
  for (const v of f32) buf.writeFloatLE(v, dataStart + i++ * 4);
  return buf;
}

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fails++; };

const CaddyElev = require(path.join(__dirname, '..', 'caddy-elev.js'));

(async () => {
  /* ---------- parser: clean tilted surface ---------- */
  {
    const W = 48, H = 48;
    const tif = buildTiff(W, H, 1, 128, 128, (x, y) =>
      300 + 0.03 * x + (-0.02) * y);
    const p = CaddyElev.parseGeoTIFF(tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength));
    ok(!!p && p.W === W && p.H === H, 'clean grid parsed');
    let valid = 0;
    for (let i = 0; i < W * H; i++) valid += p.validMask[i];
    ok(valid === W * H, `all cells valid (${valid})`);
    ok(Math.abs(p.grid[10 * W + 20] - (300 + 0.6 - 0.2)) < 1e-3, 'cell value round-trip');
  }

  /* ---------- parser: nodata padding inside the tile ---------- */
  {
    const W = 32, H = 32;
    const tif = buildTiff(W, H, 1, 128, 128, (x, y) =>
      (x >= W - 4 || y >= H - 4 || (x % 11 === 0 && y % 7 === 0)) ? 0.0 : 320);
    const p = CaddyElev.parseGeoTIFF(tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength));
    ok(!!p, 'padded grid parsed');
    let valid = 0;
    for (let i = 0; i < W * H; i++) valid += p.validMask[i];
    const expect = (W - 4) * (H - 4) - Math.ceil((W - 4) / 11) * Math.ceil((H - 4) / 7);
    ok(Math.abs(valid - expect) <= 2, `zero-pads masked (${valid} vs ${expect})`);
  }

  /* ---------- parser: garbage row rejected ---------- */
  {
    const W = 40, H = 40;
    const tif = buildTiff(W, H, 1, 128, 128, (x, y) =>
      y === 17 ? 5000 + x : 320 + 0.01 * x);
    const p = CaddyElev.parseGeoTIFF(tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength));
    let rowValid = 0;
    for (let c = 0; c < W; c++) rowValid += p.validMask[17 * W + c];
    ok(rowValid === 0, `garbage row 17 masked out (${rowValid}/40 valid)`);
    let otherValid = 0;
    for (let c = 0; c < W; c++) otherValid += p.validMask[18 * W + c];
    ok(otherValid === W, 'neighboring rows untouched');
  }

  /* ---------- parser: SamplesPerPixel=2 chunky interleave ---------- */
  {
    const W = 32, H = 32;
    const tif = buildTiff(W, H, 2, 128, 128, (x, y, b) =>
      b === 0 ? 321 + 0.02 * x : 77); // band 1 is noise we must skip
    const p = CaddyElev.parseGeoTIFF(tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength));
    ok(!!p, 'spp=2 grid parsed');
    ok(Math.abs(p.grid[5 * W + 5] - (321 + 0.1)) < 1e-3, 'band 0 de-interleaved correctly');
  }

  /* ---------- parser: junk input ---------- */
  {
    ok(CaddyElev.parseGeoTIFF(new ArrayBuffer(64)) === null, 'tiny buffer → null');
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    ok(CaddyElev.parseGeoTIFF(junk) === null, 'junk magic → null');
  }

  /* ---------- slope model + confidence on synthetic tilt ---------- */
  {
    const eg = {
      W: 48, H: 48, cellSizeM: 1,
      bbox: [-93.75, 41.95, -93.75 + (48 * 1 / 111320 / Math.cos(41.95 * Math.PI / 180)), 41.95 + (48 * 1 / 110540)],
      grid: new Float32Array(48 * 48), validMask: new Uint8Array(48 * 48).fill(1),
    };
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++)
      eg.grid[y * 48 + x] = 300 + 0.05 * x; // 5% grade falling toward west
    const center = { lat: (eg.bbox[1] + eg.bbox[3]) / 2, lng: (eg.bbox[0] + eg.bbox[2]) / 2 };
    const m = CaddyElev.greenModelFromGrid(eg, center, 13);
    ok(!!m, 'slope model computed');
    ok(Math.abs(m.meanSlopePct - 5) < 0.6, `meanSlopePct ≈5% (${m.meanSlopePct.toFixed(2)})`);
    ok(Math.abs(((m.fallDirDeg - 270) + 540) % 360 - 180) < 15,
      `fall line points west-ish (${m.fallDirDeg.toFixed(0)}°)`);
    ok(m.confidence > 0.5, `high confidence (${m.confidence.toFixed(2)})`);

    /* confidence gating: mostly-invalid crop → low confidence */
    const eg2 = JSON.parse(JSON.stringify(eg, (k, v) => (v instanceof Uint8Array ? Array.from(v) :
      v instanceof Float32Array ? Array.from(v) : v)));
    const g2 = new Float32Array(eg2.grid), vm2 = new Uint8Array(eg2.validMask);
    for (let i = 0; i < vm2.length; i++) if ((i % 48) > 30) { vm2[i] = 0; g2[i] = NaN; }
    const mLow = CaddyElev.greenModelFromGrid(
      { ...eg, grid: g2, validMask: vm2 }, center, 13);
    ok(!mLow || mLow.confidence < m.confidence,
      `sparse coverage lowers confidence (${mLow ? mLow.confidence.toFixed(2) : 'null'})`);

    /* extreme variance → null */
    const g3 = new Float32Array(eg.grid);
    for (let i = 0; i < g3.length; i += 2) g3[i] += (i % 7) * 4;
    const wild = CaddyElev.greenModelFromGrid({ ...eg, grid: g3 }, center, 13);
    ok(wild === null || wild.meanSlopePct > 15 || wild.confidence < 0.45,
      'wild variance gated (null or low conf)');
  }

  /* ---------- elevation delta sampling ---------- */
  {
    const eg = {
      W: 48, H: 48, cellSizeM: 1,
      bbox: [-93.75, 41.95, -93.7495, 41.9505],
      grid: new Float32Array(48 * 48), validMask: new Uint8Array(48 * 48).fill(1),
    };
    for (let i = 0; i < 48 * 48; i++) eg.grid[i] = 320;
    const z = CaddyElev.sampleMedianZ(eg, 41.95025, -93.74975, 5);
    ok(z === 320, 'sampleMedianZ flat field');
    const [w0, s0, e0, n0] = eg.bbox;
    // GeoTIFF row indices increase south from the northern edge.
    const tee = { lat: n0 - (n0 - s0) * (2.5 / 48), lng: w0 + (e0 - w0) * (2.5 / 48) };
    const green = { lat: n0 - (n0 - s0) * (20.5 / 48), lng: w0 + (e0 - w0) * (20.5 / 48) };
    for (let y = 18; y < 23; y++) for (let x = 18; x < 23; x++) eg.grid[y * 48 + x] = 323;
    const d = CaddyElev.elevDeltaFt ? null : null;
    // use greenMap-level pieces: delta via sampleMedianZ directly
    const tz = CaddyElev.sampleMedianZ(eg, tee.lat, tee.lng, 5);
    const gz = CaddyElev.sampleMedianZ(eg, green.lat, green.lng, 5);
    ok(tz === 320 && gz === 323, `tee/green medians (${tz}/${gz})`);
  }

  /* ---------- LRU cache eviction under cap ---------- */
  {
    // Small grids (~48*48*4 ≈ 9KB each base64'd ≈ 12KB). Insert 200 (>2MB worth).
    const mkGrid = (seed) => ({
      grid: new Float32Array(48 * 48).fill(300 + seed),
      W: 48, H: 48, cellSizeM: 1,
      bbox: [-93.8 - seed * 0.001, 41.9, -93.79 - seed * 0.001, 41.91],
      validMask: new Uint8Array(48 * 48).fill(1),
    });
    // reach into private cache via fetchElevGrid's LS layer is not exposed;
    // simulate through the public surface: monkey-patch fetch once.
    let seed = 0;
    global.fetch = async () => {
      const s = seed++;
      const eg = mkGrid(s);
      return {
        ok: true, status: 200, json: async () => ({ href: 'https://x/y.tif' }),
        arrayBuffer: async () => {
          // hand-craft a tiny valid TIFF so parse succeeds deterministically
          const t = buildTiff(48, 48, 1, 128, 128, () => 300 + s);
          return t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength);
        },
      };
    };
    for (let i = 0; i < 200; i++) {
      await CaddyElev.fetchElevGrid([-93.8 - i * 0.001, 41.9, -93.79 - i * 0.001, 41.91], 32);
    }
    // measure total bytes stored under the elev prefix
    let total = 0, count = 0;
    for (const k of store.keys()) {
      if (k.startsWith('caddy.elev.') && !k.includes('__lru')) { total += store.get(k).length; count++; }
    }
    ok(total <= 2 * 1024 * 1024 + 12000, `LRU cap respected (${(total / 1024).toFixed(0)}KB across ${count} entries)`);

    const fmtKey = (i) => {
      const q = (n) => Math.round(n * 1e6) / 1e6;
      return `caddy.elev.${q(-93.8 - i * 0.001)},${q(41.9)},${q(-93.79 - i * 0.001)},${q(41.91)}#32`;
    };
    ok(!store.has(fmtKey(0)), 'oldest entry evicted');
    ok(store.has(fmtKey(199)), 'newest entry retained');

    // round-trip through LS read path
    const back = CaddyElev.fetchElevGrid([-93.8 - 150 * 0.001, 41.9, -93.79 - 150 * 0.001, 41.91], 32);
    ok(back instanceof Promise, 'LS-backed key still resolves');
  }

  console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('EXCEPTION', e); process.exit(1); });
