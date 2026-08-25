/* v1.0.77 green-maps integration smoke: REAL USGS 3DEP tile through our
   own fetchElevGrid code path (Ankeny-area bbox). Run: node tests/v1077_elev_smoke.js --live */
const path = require('path');
const CaddyElev = require(path.join(__dirname, '..', 'caddy-elev.js'));

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + msg); if (!c) fails++; };

(async () => {
  const bbox = [-93.75, 41.95, -93.749, 41.951];
  const eg = await CaddyElev.fetchElevGrid(bbox, 32);
  ok(!!eg, 'grid fetched');
  if (!eg) process.exit(1);
  let valid = 0;
  for (let i = 0; i < eg.W * eg.H; i++) if (eg.validMask[i]) valid++;
  ok(valid / (eg.W * eg.H) > 0.5, `>50% valid cells (${valid}/${eg.W * eg.H})`);
  // median elevation within 320–324 m
  const zs = [];
  for (let i = 0; i < eg.W * eg.H; i++) if (eg.validMask[i]) zs.push(eg.grid[i]);
  zs.sort((a, b) => a - b);
  const med = zs[Math.floor(zs.length / 2)];
  ok(med > 320 && med < 324, `median elevation ${med.toFixed(2)}m within 320-324`);
  ok(eg.cellSizeM > 0.1 && eg.cellSizeM < 8, `cellSizeM sane (${eg.cellSizeM.toFixed(2)}m)`);

  // slope model on a fake green at grid center
  const [w, s, e, n] = bbox;
  const center = { lat: (s + n) / 2, lng: (w + e) / 2 };
  const slope = CaddyElev.greenModelFromGrid(eg, center, 13);
  ok(!!slope, 'slope model computed');
  if (slope) {
    ok(slope.meanSlopePct >= 0 && slope.meanSlopePct <= 15,
      `meanSlopePct ${slope.meanSlopePct.toFixed(2)}% in 0-15`);
    ok(slope.fallDirDeg >= 0 && slope.fallDirDeg < 360, 'fallDirDeg range');
    ok(slope.confidence > 0, `confidence ${slope.confidence.toFixed(2)}`);
  }
  const delta = await CaddyElev.greenMap({
    teeLL: { lat: s + (n - s) * 0.25, lng: w + (e - w) * 0.25 },
    centerLL: center, radiusM: 13,
  });
  console.log('greenMap:', delta ? JSON.stringify({
    slope: delta.slope ? +delta.slope.meanSlopePct.toFixed(2) : null,
    fall: delta.slope ? Math.round(delta.slope.fallDirDeg) : null,
    conf: delta.slope ? +delta.slope.confidence.toFixed(2) : null,
    deltaFt: delta.deltaFt != null ? +delta.deltaFt.toFixed(1) : null,
  }) : 'null');

  // second call should hit cache
  const t0 = Date.now();
  const eg2 = await CaddyElev.fetchElevGrid(bbox, 32);
  ok(!!eg2 && Date.now() - t0 < 50, 'memory cache hit fast');
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error('EXCEPTION', err); process.exit(1); });
