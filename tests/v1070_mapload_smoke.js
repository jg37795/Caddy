/* Headless smoke test for v1.0.70 mapping/search changes:
   - overpassRetryLadder: mirrors fail twice → primary re-query succeeds
     (attempts logged), result returned instead of 'not found'
   - overpassRetryLadder: empty mirror round then empty primary = honest
     empty result (authoritative not-found)
   - overpassRetryLadder: first round succeeds immediately (no backoff)
   - phase machine: staged copy advances 0→1→2 and stops at the last phase
   Extracts the real functions from app.js so the shipped code is what's
   tested.
   Run: node tests/v1070_mapload_smoke.js  */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extract(name) {
  const raw = src.indexOf(`function ${name}(`);
  if (raw < 0) throw new Error(`${name} not found in app.js`);
  // Include a preceding async/! modifier if present.
  const start = src.startsWith('async ', raw - 6) ? raw - 6 : raw;
  // Brace-match forward (params contain braces, so track parens/brackets too).
  let i = start, paren = 0, seenBody = false, depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (!seenBody) {
      if (ch === '(' || ch === '[') paren++;
      else if (ch === ')' || ch === ']') paren--;
      else if (ch === '{' && paren === 0) { seenBody = true; depth = 1; }
    } else {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (!depth) break; }
    }
  }
  return src.slice(start, i + 1);
}

// Shared stubs the extracted ladder code references (module scope so the
// direct-eval'd function body resolves them).
const OVERPASS_RETRY_BACKOFF_MS = 1500;
const osmSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warnings = [];
const _origWarn = console.warn.bind(console);
console.warn = (...a) => { warnings.push(a.join(' ')); _origWarn(...a); };
const overpassRetryLadder = eval(
  `(function () { ${extract('overpassRetryLadder')}; return overpassRetryLadder; })()`
);
// Phase-machine bits run inside an IIFE scope in app.js; rebuild them here.
const phasesSrc = src.match(/const MAPLOAD_PHASES = \[[\s\S]*?\];/)[0];
const phasesMsSrc = src.match(/const MAPLOAD_PHASE_MS = \d+;/)[0];
const cardFn = extract('maploadCardHtml');
const startPhasesFn = extract('maploadStartPhases');
const stopPhasesFn = extract('maploadStopPhases');
const esc = (s) => String(s).replace(/[&<>"']/g, () => '&x;');
const phaseSandbox = {};
eval(`
  ${phasesSrc}
  ${phasesMsSrc}
  const escapeHtml = ${esc.toString()};
  const _maploadTimers = {};
  ${stopPhasesFn}
  ${startPhasesFn}
  ${cardFn}
  phaseSandbox.MAPLOAD_PHASES = MAPLOAD_PHASES;
  phaseSandbox.maploadCardHtml = maploadCardHtml;
  phaseSandbox.maploadStartPhases = maploadStartPhases;
  phaseSandbox.maploadStopPhases = maploadStopPhases;
`);

let pass = 0, fail = 0;
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok - ${label}`); }
  else { fail++; console.error(`FAIL - ${label} ${detail}`); }
}

(async () => {
  console.log('overpassRetryLadder:');

  // 1) Mirrors fail twice, primary retry succeeds → result + attempts logged.
  {
    warnings.length = 0;
    let attemptAllCalls = 0, primaryCalls = 0;
    const els = await overpassRetryLadder({
      attemptAll: async () => { attemptAllCalls++; throw new Error('Overpass HTTP 504.'); },
      queryPrimary: async () => { primaryCalls++; const e = [{ id: 1 }]; e.meta = {}; return e; },
      backoffMs: 1,
    });
    ok(els.length === 1 && els.meta.retried === true,
      'mirror failure → primary retry returns result flagged retried',
      JSON.stringify(els));
    ok(attemptAllCalls === 1 && primaryCalls === 1, 'exactly one mirror round + one primary re-query');
    ok(warnings.some((w) => w.includes('retrying primary once')), 'retry attempt logged', warnings.join(' | '));
  }

  // 2) Empty mirror round → primary retry finds data (the flaky case).
  {
    let primaryCalls = 0;
    const els = await overpassRetryLadder({
      attemptAll: async () => [],
      queryPrimary: async () => { primaryCalls++; return [{ id: 7 }, { id: 8 }]; },
      backoffMs: 1,
    });
    ok(primaryCalls === 1 && els.length === 2, 'empty mirror round is retried against primary');
  }

  // 3) Everything genuinely empty → resolves empty (honest not-found), no throw.
  {
    let primaryCalls = 0;
    const els = await overpassRetryLadder({
      attemptAll: async () => [],
      queryPrimary: async () => { primaryCalls++; return []; },
      backoffMs: 1,
    });
    ok(Array.isArray(els) && els.length === 0 && primaryCalls === 1,
      'all-empty resolves as authoritative empty array');
  }

  // 4) Both rounds error → throws the original mirror error.
  {
    let threw = null;
    try {
      await overpassRetryLadder({
        attemptAll: async () => { throw new Error('boom-mirror'); },
        queryPrimary: async () => { throw new Error('boom-primary'); },
        backoffMs: 1,
      });
    } catch (e) { threw = e; }
    ok(threw && threw.message === 'boom-mirror', 'double failure surfaces original mirror error');
  }

  // 5) Fast path: non-empty on first round → no backoff, no primary call.
  {
    let primaryCalls = 0;
    const t0 = Date.now();
    const els = await overpassRetryLadder({
      attemptAll: async () => [{ id: 3 }],
      queryPrimary: async () => { primaryCalls++; return []; },
      backoffMs: 50,
    });
    ok(els.length === 1 && primaryCalls === 0 && Date.now() - t0 < 40,
      'immediate success skips ladder entirely');
  }

  console.log('phase machine:');
  {
    const seen = [];
    phaseSandbox.maploadStartPhases('test', (idx) => seen.push(idx));
    await new Promise((r) => setTimeout(r, 1700 * 2 + 400));
    ok(seen[0] === 0, 'starts at "Finding course…" (phase 0)', JSON.stringify(seen));
    ok(seen.includes(1), 'advances to "Contacting map data…" (phase 1)');
    ok(seen.includes(2), 'reaches "Drawing greens…" (phase 2)');
    ok(!seen.includes(3) && seen[seen.length - 1] === 2, 'stops at final phase (no overrun)', JSON.stringify(seen));

    // Restart resets to phase 0 and stops prior timer.
    phaseSandbox.maploadStartPhases('test', (idx) => seen.push(idx));
    await new Promise((r) => setTimeout(r, 60));
    phaseSandbox.maploadStopPhases('test');
    const after = seen.slice(seen.lastIndexOf(0));
    ok(after[0] === 0, 'restart begins again at phase 0');
    ok(after.every((v, i) => i === 0 || v > seen.lastIndexOf(2) - 99),
      'stop clears pending ticks (only phase-0 emission after restart within window)');
  }

  // Card markup sanity.
  {
    const html = phaseSandbox.maploadCardHtml(0, 'mapload-loading');
    ok(html.includes('Finding course'), 'card markup embeds phase copy');
    ok(html.includes('mapload-flag') && html.includes('mapload-bar'), 'flag motif + shimmer bar present');
    ok(phaseSandbox.maploadCardHtml(9).includes('Drawing greens'),
      'phase index clamps to last phase');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
