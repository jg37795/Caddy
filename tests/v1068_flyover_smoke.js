/* Headless smoke test for v1.0.68 prep.js hole flyover profile:
   - 50 yd markers land at correct % positions
   - hazards positioned proportionally, out-of-range dropped
   - green band from front/back carries
   - missing-data cases return null (never a partial chart)
   Run: node tests/v1068_flyover_smoke.js  */
'use strict';
const fs = require('fs');
const path = require('path');

// Extract the pure functions out of the IIFE and evaluate them with the
// two helpers they use (clamp, hazardAlongYd).
const src = fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf8');

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in prep.js`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const factory = new Function(
  'clamp',
  `${grab('hazardAlongYd')}\n${grab('flyoverProfile')}\nreturn flyoverProfile;`
);
const flyoverProfile = factory(clamp);

let failures = 0;
function ok(label, cond) {
  if (!cond) {
    failures++;
    console.error('FAIL: ' + label);
  } else {
    console.log('ok: ' + label);
  }
}

// --- synthetic hole: 412 yd, bunker ~150 yd, water ~300 yd, green 395-420 ---
const hole = {
  yards: 412,
  hazards: [
    { type: 'bunker', label: 'Bunker', sub: 'left, ~150 yd off the tee' },
    { type: 'water', label: 'Water', sub: 'right, ~300 yd off the tee' },
    { type: 'water', label: 'Water', sub: '' }, // no mapped distance → dropped
    { type: 'bunker', label: 'Bunker', sub: 'behind green, ~450 yd off the tee' }, // >= yards → dropped
  ],
  green: { front: 395, center: 408, back: 420, depth: 25 },
};
const p = flyoverProfile(hole);
ok('profile builds for a full hole', !!p);
ok('markers every ~50yd up to yards-20',
  JSON.stringify(p.marks.map((m) => m.yd)) === JSON.stringify([50, 100, 150, 200, 250, 300, 350]));
for (const m of p.marks) {
  ok(`marker ${m.yd}yd at ${(m.yd / 412 * 100).toFixed(1)}%`, Math.abs(m.pct - m.yd / 412) < 1e-9);
}
ok('two in-range hazards kept', p.hazards.length === 2);
ok('bunker pct ≈ 36.4%', Math.abs(p.hazards[0].pct - 150 / 412) < 1e-9 && p.hazards[0].type === 'bunker');
ok('water pct ≈ 72.8%', Math.abs(p.hazards[1].pct - 300 / 412) < 1e-9 && p.hazards[1].type === 'water');
ok('green band front/back pct (back clamped at green)',
  Math.abs(p.green.startPct - 395 / 412) < 1e-9 && p.green.endPct === 1);
ok('no elevation data → flat line', p.elev === null);

// --- elevation supplied → trend points sorted & clamped ---
const pe = flyoverProfile({ ...hole, elevation: [{ yd: 0, ft: 10 }, { yd: 900, ft: 40 }, { yd: 200, ft: 30 }] });
ok('elev present when surveyed', Array.isArray(pe.elev) && pe.elev.length === 3);
ok('elev clamped to [0,1] of hole length', pe.elev.every((e) => e.pct >= 0 && e.pct <= 1));
ok('elev sorted by pct', pe.elev[0].pct <= pe.elev[1].pct && pe.elev[1].pct <= pe.elev[2].pct);

// --- missing-data cases return null ---
ok('null hole → null', flyoverProfile(null) === null);
ok('no yards → null', flyoverProfile({ hazards: [], green: {} }) === null);
ok('tiny yardage → null', flyoverProfile({ yards: 40 }) === null);
ok('yards but nothing mapped → still renders ticks',
  (() => { const q = flyoverProfile({ yards: 120 }); return q && q.marks.length === 2 && !q.hazards.length && !q.green; })());
ok('only unplaceable hazards on a tick-less hole → null (nothing to draw)',
  flyoverProfile({ yards: 65, hazards: [{ type: 'water', sub: '' }] }) === null);

// --- svg builder ---
const grabSvg = new Function(
  'clamp', `${grab('flyoverSvg')}\nreturn flyoverSvg;`
)(clamp);
const svg = grabSvg(p);
ok('svg contains tee, green band, flag, both hazard marks',
  svg.includes('prep-fv-tee') && svg.includes('prep-fv-green') &&
  svg.includes('prep-fv-flag') && svg.includes('prep-fv-hz water') &&
  svg.includes('prep-fv-hz bunker') && svg.includes('prep-fv-ticklabel'));
ok('flat baseline when no elevation', svg.includes('prep-fv-base'));
ok('elevation polyline replaces baseline', grabSvg(pe).includes('prep-fv-elev') && !grabSvg(pe).includes('prep-fv-base'));
ok('null profile → empty svg string', grabSvg(null) === '');

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nALL FLYOVER TESTS PASSED');
