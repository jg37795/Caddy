/* ==========================================================================
   prep.js — Caddy Prep Studio (premium pre-shot decision engine)
   --------------------------------------------------------------------------
   Pure add-on: builds its UI into #prepStudio inside the existing Prep
   (#shotScreen) tab and reads physics/planner data through the read-only
   window.CaddyPrep bridge exposed by app.js. It NEVER mutates app state,
   never touches round/scorecard code, and persists everything it owns
   under the localStorage prefix `caddy.prep.`.

   Sections:
     0.  Bridge + tiny utils
     1.  Persisted state
     2.  Wind dial SVG (16-point compass picker)
     3.  Skeleton build
     4.  Control wiring + micro-interactions
     5.  Compute pipeline (plays-like, club, aim/shape)
     6.  Recommendation card render
     7.  Hole strategy card render (+ planner binding)
     ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     0. BRIDGE + UTILS
     ====================================================================== */
  const api = window.CaddyPrep;
  const studio = document.getElementById('prepStudio');
  if (!api || !studio) return; // graceful no-op if app.js bridge is absent

  const $ = (id) => document.getElementById(id);
  const clamp = (n, mn, mx) => Math.min(mx, Math.max(mn, n));
  const num = (v, f = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : f;
  };
  const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  const sgn = (v, d = 1) => `${v >= 0 ? '+' : ''}${fmt(v, d)}`;
  const norm360 = (d) => ((Number(d) % 360) + 360) % 360;
  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        }[c])
    );
  const compass16 = (deg) => {
    const pts = [
      'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
    ];
    return pts[Math.round(norm360(deg) / 22.5) % 16];
  };
  const haptic = (ms) => api.haptic(ms);

  /* ======================================================================
     1. PERSISTED STATE — everything under caddy.prep.*
     ====================================================================== */
  const LS_PREFIX = 'caddy.prep.';
  const lsLoad = (key, fallback) => {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  };
  const lsSave = (key, val) => {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
    } catch { }
  };

  // Standard penalties for imperfect lies (yards ADDED to plays-like):
  // rough grabs and kills flight, sand is worse, fringe is nearly clean.
  const LIES = [
    { id: 'fairway', name: 'Fairway', pen: 0, sub: '±0' },
    { id: 'rough', name: 'Rough', pen: 4, sub: '+4 yd' },
    { id: 'sand', name: 'Sand', pen: 7, sub: '+7 yd' },
    { id: 'fringe', name: 'Fringe', pen: -1, sub: '−1 yd' },
  ];

  const SURFACES = [
    {
      id: 'soft', name: 'Soft',
      note: 'Wet & soft: almost zero rollout — fly the full number, spin stops fast.',
    },
    {
      id: 'medium', name: 'Normal',
      note: 'Standard turf: normal release after landing.',
    },
    {
      id: 'firm', name: 'Firm',
      note: 'Firm & fast: ball releases well past landing — land it front edge.',
    },
  ];

  const SHAPES = [
    { id: 'straight', name: 'Straight', sub: 'Dead at target' },
    { id: 'draw', name: 'Draw', sub: 'Right → left' },
    { id: 'fade', name: 'Fade', sub: 'Left → right' },
  ];

  const WIND_PRESETS = [
    { id: 'calm', name: 'Calm', mph: 2 },
    { id: 'light', name: 'Light', mph: 8 },
    { id: 'fresh', name: 'Fresh', mph: 14 },
    { id: 'strong', name: 'Strong', mph: 20 },
  ];

  const cond = lsLoad('cond', {
    windMph: 8,
    windFromDeg: 270,
    tempF: 70,
    altFt: 0,
    elevFt: 0,
    surface: 'medium',
  });
  const shot = lsLoad('shot', {
    greenPoint: 'middle',  // front | middle | back
    lie: 'fairway',
    shape: 'straight',
  });

  let boundHole = null; // holeInfo object when a planner hole is open
                       // Prep ALWAYS works from a bound course hole — there
                       // is no manual-yardage fallback anymore.
  // v1.15.1: which shot in the "How to play it" plan THE NUMBER reflects.
  // -1 = the tee/full-hole number (previous behaviour). _planShotYds is
  // rebuilt on every renderStrategy pass (plan geometry depends on the
  // hole + bag).
  let planShotIdx = -1;
  let _planShotYds = [];

  const persist = () => {
    lsSave('cond', cond);
    lsSave('shot', shot);
  };

  const liePenalty = () =>
    (LIES.find((l) => l.id === shot.lie) || LIES[0]).pen;

  /* ======================================================================
     2. WIND DIAL — 16-sector SVG compass (wind FROM picker)
     ====================================================================== */
  const DIAL_C = 116;
  const R_OUT = 110;
  const R_RING_OUT = 106;
  const R_RING_IN = 80;

  const pol = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [DIAL_C + r * Math.cos(a), DIAL_C + r * Math.sin(a)];
  };

  const wedgePath = (i) => {
    const a0 = i * 22.5 - 11.25;
    const a1 = i * 22.5 + 11.25;
    const [x0o, y0o] = pol(R_RING_OUT, a0);
    const [x1o, y1o] = pol(R_RING_OUT, a1);
    const [x1i, y1i] = pol(R_RING_IN, a1);
    const [x0i, y0i] = pol(R_RING_IN, a0);
    return (
      `M ${x0o.toFixed(1)} ${y0o.toFixed(1)}` +
      ` A ${R_RING_OUT} ${R_RING_OUT} 0 0 1 ${x1o.toFixed(1)} ${y1o.toFixed(1)}` +
      ` L ${x1i.toFixed(1)} ${y1i.toFixed(1)}` +
      ` A ${R_RING_IN} ${R_RING_IN} 0 0 0 ${x0i.toFixed(1)} ${y0i.toFixed(1)} Z`
    );
  };

  function dialSvg() {
    let sectors = '';
    for (let i = 0; i < 16; i++) {
      sectors += `<path class="prep-dial-sector" data-i="${i}" d="${wedgePath(i)}" aria-label="Wind from ${compass16(i * 22.5)}"><title>Wind from ${compass16(i * 22.5)}</title></path>`;
    }

    let ticks = '';
    for (let i = 0; i < 16; i++) {
      const cardinal = i % 4 === 0;
      const len = cardinal ? 13 : 7;
      const w = cardinal ? 3 : 1.6;
      const [x0, y0] = pol(R_RING_OUT - 1.5, i * 22.5);
      const [x1, y1] = pol(R_RING_OUT - 1.5 - len, i * 22.5);
      ticks += `<line class="prep-dial-tick${cardinal ? ' cardinal' : ''}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke-width="${w}" stroke-linecap="round"/>`;
    }

    let labels = '';
    ['N', 'E', 'S', 'W'].forEach((lbl) => {
      const deg = { N: 0, E: 90, S: 180, W: 270 }[lbl];
      const [x, y] = pol(R_RING_IN - 14, deg);
      labels += `<text class="prep-dial-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${lbl}</text>`;
    });

    return `
      <svg class="prep-dial" id="prepDial" viewBox="0 0 232 232" role="group" aria-label="Wind direction dial">
        <circle cx="${DIAL_C}" cy="${DIAL_C}" r="${R_OUT}" fill="rgba(127,127,127,0.08)"/>
        <g id="dialSectors">${sectors}</g>
        ${ticks}
        ${labels}
        <g class="prep-dial-needle" id="dialNeedle">
          <polygon points="${DIAL_C - 8},22 ${DIAL_C + 8},22 ${DIAL_C},66" fill="var(--green-2)" opacity="0.95"/>
          <line x1="${DIAL_C}" y1="58" x2="${DIAL_C}" y2="74" stroke="var(--green-2)" stroke-width="3" stroke-linecap="round"/>
        </g>
        <circle class="prep-dial-center" cx="${DIAL_C}" cy="${DIAL_C}" r="47"/>
        <text class="prep-dial-mph" id="dialMph" x="${DIAL_C}" y="${DIAL_C + 8}" text-anchor="middle">8</text>
        <text class="prep-dial-unit" x="${DIAL_C}" y="${DIAL_C + 21}" text-anchor="middle">MPH</text>
        <text class="prep-dial-dir" id="dialDir" x="${DIAL_C}" y="${DIAL_C + 35}" text-anchor="middle">FROM W</text>
      </svg>`;
  }

  function paintDial() {
    const idx = Math.round(norm360(cond.windFromDeg) / 22.5) % 16;
    $('dialMph').textContent = String(Math.round(cond.windMph));
    $('dialDir').textContent = `FROM ${compass16(cond.windFromDeg)}`;
    $('dialNeedle').style.transform = `rotate(${norm360(cond.windFromDeg)}deg)`;
    const chip = $('prepCondChip');
    if (chip) {
      chip.textContent = `${compass16(cond.windFromDeg)} · ${Math.round(cond.windMph)} mph`;
    }

    const old = document.getElementById('dialSel');
    if (old) old.remove();
    if (cond.windMph >= 1) {
      const sel = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sel.setAttribute('d', wedgePath(idx));
      sel.setAttribute('id', 'dialSel');
      sel.setAttribute('class', 'prep-dial-sel');
      const host = $('dialSectors');
      if (host && host.parentNode) host.parentNode.insertBefore(sel, host.nextSibling);
      else if (host) host.appendChild(sel);
    }
  }

  function dialPointerToDeg(evt) {
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * 232;
    const y = ((evt.clientY - rect.top) / rect.height) * 232;
    return norm360((Math.atan2(x - DIAL_C, DIAL_C - y) * 180) / Math.PI);
  }

  function wireDial() {
    const svg = $('prepDial');
    let pressed = false;
    const apply = (evt) => {
      const deg = dialPointerToDeg(evt);
      const idx = Math.round(deg / 22.5) % 16;
      const snapped = idx * 22.5;
      if (snapped !== norm360(cond.windFromDeg)) {
        cond.windFromDeg = snapped;
        haptic(4);
        persist();
        paintDial();
        recompute({ pulse: false });
      }
    };
    svg.addEventListener('pointerdown', (e) => {
      pressed = true;
      try { svg.setPointerCapture(e.pointerId); } catch { }
      apply(e);
    });
    svg.addEventListener('pointermove', (e) => {
      if (pressed) apply(e);
    });
    const release = () => { pressed = false; };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
  }

  /* ======================================================================
     3. SKELETON
     ====================================================================== */
  const SHAPE_GLYPHS = {
    straight:
      '<path class="shape-path" d="M22 23 H52"/><polygon class="shape-head" points="56,23 47,18 47,28"/>',
    draw:
      '<path class="shape-path" d="M14 26 Q34 24 46 12"/><polygon class="shape-head" points="50,8 39,10 44,19"/>',
    fade:
      '<path class="shape-path" d="M14 20 Q34 22 46 34"/><polygon class="shape-head" points="50,38 44,27 39,36"/>',
  };

  function buildSkeleton() {
    studio.innerHTML = `
      <!-- ============ THE HOLE CARD (v1.9.0) ============
           One card when a hole is selected. Top-to-bottom:
           header (hole number = back nav, v1.15.0) → map →
           shot plan → THE NUMBER → tweaks (lie/shape) → caddy notes →
           conditions (collapsed). The old Pre-shot / The-shot /
           Conditions boxes are merged in. -->
      <div class="card" id="prepStrategyCard" hidden>
        <div class="prep-hole-brief-head">
          <button type="button" class="prep-hole-back" id="prepStratTitle"
            title="Back to all holes" aria-label="Back to all holes">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span id="prepStratTitleText">Hole strategy</span>
          </button>
          <span class="chip" id="prepStratChip">—</span>
        </div>
        <div id="prepStratBody"></div>

        <!-- v1.15.2: THE NUMBER block is REMOVED from the static skeleton.
             The shot plan rows now carry their own expansion: tapping a
             shot renders the full number (plays-like, wind chip,
             carry/release/total, aim) INSIDE the plan row. The number's
             live elements (prepRecMain/prepReason/prepAdjChips/
             prepRecGrid/prepAimRow) are created by renderStrategy inside
             the expanded row via ensureNumberElements(). The lie/shape
             tweak rows move with it.

        <!-- v1.17.0 (James, discussed): the CONDITIONS box is REMOVED —
             Prep is course prep (yardage + elevation + slope, which
             don't change overnight); solves run at neutral conditions.
             Live weather belongs to Play on the day. -->
      </div>
    `;
  }

  /* ======================================================================
     4. CONTROL WIRING
     ====================================================================== */
  function setSliderFill(input) {
    const pct =
      ((num(input.value) - Number(input.min)) /
        (Number(input.max) - Number(input.min))) *
      100;
    input.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
  }

  function paintSeg(segId, attr, value) {
    const seg = $(segId);
    if (!seg) return;
    const opts = [...seg.querySelectorAll('.prep-seg-opt')];
    const i = Math.max(0, opts.findIndex((o) => o.dataset[attr] === value));
    seg.style.setProperty('--i', String(i));
    opts.forEach((o, k) => o.classList.toggle('active', k === i));
  }

  function paintControls() {
    // v1.17.0: the Conditions box is gone — only the lie/shape rows
    // (inside the expanded shot) still paint here. Guards included.
    const lieRow = $('prepLieRow');
    if (lieRow) [...lieRow.children].forEach((c) =>
      c.classList.toggle('active', c.dataset.lie === shot.lie)
    );
    const shapeRow = $('prepShapeRow');
    if (shapeRow) [...shapeRow.children].forEach((c) =>
      c.classList.toggle('active', c.dataset.shape === shot.shape)
    );
  }

  function paintTarget() {
    // v1.17.0: the Conditions card is gone; the hole card visibility is
    // the whole story.
    const card = $('prepStrategyCard');
    if (!boundHole) {
      if (card) card.hidden = true;
      syncPrepChrome();
      return;
    }
    if (card) card.hidden = false;
    syncPrepChrome();
  }

  function wireControls() {
    // v1.17.0: the Conditions box is gone — no dial, sliders, presets,
    // surface seg, or live-weather sync to wire. Only the delegated
    // lie/shape/plan-row handlers (below) remain.

    // v1.9.0: the carry tiles in the hole brief ARE the target picker —
    // tap Front/Middle/Back on a tile, the number re-solves in place.
    $('prepStratBody').addEventListener('click', (e) => {
      const tile = e.target.closest('.prep-carry-tile');
      if (!tile || tile.hasAttribute('disabled')) return;
      const point = tile.dataset.point;
      if (!point || point === shot.greenPoint) return;
      shot.greenPoint = point;
      haptic(5);
      persist();
      renderStrategy();       // re-paint tiles (chosen state) + feed line
      recompute({ pulse: true });
      return;
    });
    void wireControls;

    // v1.12.0: the tee chips/nudge handlers are gone — tee editing lives
    // in Check location (Move tee), persisted per hole; Prep picks it up
    // through holeInfo on the next bind.

    // v1.15.2: lie/shape rows are created inside the expanded shot row
    // (see ensureNumberElements), so their handlers are DELEGATED here —
    // they survive the number UI moving between rows.
    document.addEventListener('click', (e) => {
      const lie = e.target.closest('.prep-lie-chip');
      if (lie && lie.closest('#prepStratBody')) {
        shot.lie = lie.dataset.lie;
        haptic(6);
        persist();
        [...lie.parentNode.children].forEach((c) =>
          c.classList.toggle('active', c === lie)
        );
        recompute({ pulse: true });
        return;
      }
      const shape = e.target.closest('.prep-shape-btn');
      if (shape && shape.closest('#prepStratBody')) {
        shot.shape = shape.dataset.shape;
        haptic(6);
        persist();
        [...shape.parentNode.children].forEach((c) =>
          c.classList.toggle('active', c === shape)
        );
        recompute({ pulse: true });
      }
    });

    // v1.15.1 (tap-a-shot → number): tapping a "How to play it" row loads
    // that shot into THE NUMBER (yardage, club context, aim). Tapping the
    // already-selected shot deselects it — back to the tee/full number.
    // v1.15.2: the number UI itself is INJECTED into the selected row
    // (ensureNumberElements) so it appears right where you tapped.
    $('prepStratBody').addEventListener('click', (e) => {
      const row = e.target.closest('.prep-plan-shot');
      if (!row || row.dataset.shot == null) return;
      if (e.target.closest('.prep-num-inline')) return;   // tweaks/number taps
      const idx = parseInt(row.dataset.shot, 10);
      planShotIdx = planShotIdx === idx ? -1 : idx;
      haptic(6);
      document.querySelectorAll('#prepStratBody .prep-plan-shot')
        .forEach((el) => el.classList.toggle('chosen',
          Number(el.dataset.shot) === planShotIdx));
      ensureNumberElements();
      recompute({ pulse: true });
    });
  }

  /* ======================================================================
     5. COMPUTE PIPELINE
     ====================================================================== */
  function currentBearing() {
    return boundHole ? Math.round(num(boundHole.bearing, 0)) : 0;
  }

  function currentTargetYd() {
    if (!boundHole) return null;
    // v1.15.1 (tap-a-shot → number): when a plan shot is selected, THE
    // NUMBER solves for that shot's yardage (from the plan table), not
    // the green target.
    if (planShotIdx >= 0 && Array.isArray(_planShotYds) &&
        _planShotYds[planShotIdx] != null) {
      return _planShotYds[planShotIdx];
    }
    const g = boundHole.green || {};
    const pt = shot.greenPoint === 'front' ? g.front
      : shot.greenPoint === 'back' ? g.back
        : g.center;
    // v1.12.0: the tee is whatever the player placed via Check location
    // (manual teePoint — already reflected in holeInfo's yards/carries by
    // the importer's tee resolution), so no arithmetic nudge here.
    if (pt != null) return pt;
    if (boundHole.yards) return Math.round(boundHole.yards);
    return null;
  }

  // One full physics solve under the CURRENT panel conditions.
  // v-fix(solve-memo) v1.5.3 (audit #20): renderStrategy calls solve() up to
  // 4x per recompute — the tee-yardage solve runs TWICE — and each solve is
  // a full playsLike (6-12 RK4 integrations + attributions). Memoized on the
  // complete input signature; entries can never go stale because every
  // input that affects the result is in the key (a changed value just
  // misses and recomputes). LRU 64.
  const _solveMemo = new Map();   // key -> result (LRU, oldest evicted)
  function solve(yd) {
    // v1.17.0 (James, discussed: "get rid of the conditions box fully…
    // I'll be using it to get ready for a course I'm playing the next
    // day"): Prep solves at NEUTRAL conditions — no wind, standard temp,
    // sea-level. Prep numbers are COURSE intelligence (yardage + elevation
    // + slope), which doesn't change overnight; live conditions belong to
    // Play on the day. The tee→green elevation delta is still real (USGS
    // via the ELEV chip), and the green brief still feeds slope advice —
    // only the weather/temp/altitude inputs are neutralized.
    const neutral = {
      tempF: 70, windMph: 0, windFromDeg: 0,
      rh: 50, pressureHpa: NaN, gustMph: NaN, shearAlpha: 0.143,
    };
    const elevFt = num(cond.elevFt, 0);   // real USGS delta when loaded
    const key = [
      Math.round(yd * 2), currentBearing(),
      Math.round(elevFt),
      cond.surface,
      Math.round(num(liePenalty(), 0) * 10),
    ].join('|');
    const hit = _solveMemo.get(key);
    if (hit) return hit;
    const out = api.playsLike({
      horizontalYd: yd,
      bearingDeg: currentBearing(),
      elevDiffFt: elevFt,
      courseAltitudeFt: 0,
      tempF: neutral.tempF,
      rh: neutral.rh,
      windMph: neutral.windMph,
      windFromDeg: neutral.windFromDeg,
      pressureHpa: neutral.pressureHpa,
      shearAlpha: neutral.shearAlpha,
      gustMph: neutral.gustMph,
      latDeg: api.locLat(),
      lieYd: liePenalty(),
      firmness: cond.surface,
    });
    _solveMemo.set(key, out);
    if (_solveMemo.size > 64) {
      _solveMemo.delete(_solveMemo.keys().next().value);
    }
    return out;
  }

  // Designed curvature of an intentional shape at landing, in yards
  // relative to a straight start line (negative = finishes left).
  function shapeDispYd(horizontalYd) {
    if (shot.shape === 'straight') return 0;
    const mag = clamp(Math.round(horizontalYd * 0.055), 5, 15);
    return shot.shape === 'draw' ? -mag : mag;
  }

  /* ======================================================================
     6. RECOMMENDATION CARD
     ====================================================================== */
  let lastShownYd = null;

  function effortInfo(recMain) {
    const m = String(recMain).toLowerCase();
    if (m.includes('smooth') || m.includes('easy'))
      return { tag: 'Choke down', note: 'choke down — smooth effort covers it' };
    if (m.includes(' firm'))
      return { tag: 'Swing firm', note: 'swing firm — it needs every yard' };
    if (m.includes('stock')) return { tag: 'Stock swing', note: 'full stock swing' };
    if (m.includes('%')) return { tag: 'Partial swing', note: 'control with swing length' };
    if (m.startsWith('lay up')) return { tag: 'Lay up', note: '' };
    return { tag: '', note: '' };
  }

  function clubShort(recMain) {
    let s = String(recMain);
    s = s.replace(/\s+(stock|smooth|easy|firm)\s*$/i, '');
    return s;
  }

  // v1.15.2 (James: "what if we get rid of the numbers box"): THE NUMBER
  // is no longer a fixed block — renderStrategy injects it INSIDE the
  // selected shot-plan row (expanded in place). This builds/moves the
  // number's live elements into the expanded row so every existing
  // $('prepRecMain')-style reference keeps working unchanged.
  // v1.15.2: the number UI template — built as a FUNCTION so lie/shape
  // active states reflect the CURRENT shot every injection (a const
  // template literal froze them at load-time values).
  function numberTemplateHtml() {
    return `
    <div class="prep-num-inline">
      <div class="prep-rec-main" id="prepRecMain">—</div>
      <div class="prep-reason" id="prepReason">Set a target to see the play.</div>
      <div class="prep-adj-chips" id="prepAdjChips"></div>
      <div class="prep-rec-grid" id="prepRecGrid">
        <div class="prep-rec-cell"><i>Carry to</i><b id="cellCarry">—</b></div>
        <div class="prep-rec-cell"><i>Release</i><b id="cellRelease">—</b></div>
        <div class="prep-rec-cell"><i>Total</i><b id="cellTotal">—</b></div>
      </div>
      <div class="prep-aim-row" id="prepAimRow">
        <span class="prep-aim-arrow" id="prepAimArrow">
          <svg viewBox="0 0 24 24" id="prepAimSvg">
            <path d="M12 3 L17 13 H14 V21 H10 V13 H7 Z" fill="#fff"/>
          </svg>
        </span>
        <span id="prepAimText">—</span>
      </div>
      <div class="prep-tweaks">
        <div class="prep-mini-label">Lie</div>
        <div class="prep-lie-row" id="prepLieRow">
          ${LIES.map((l) => `<button type="button" class="prep-lie-chip${shot.lie === l.id ? ' active' : ''}" data-lie="${l.id}"><b>${l.name}</b><span>${l.sub}</span></button>`).join('')}
        </div>
        <div class="prep-mini-label" style="margin-top: 11px">Intended shape</div>
        <div class="prep-shape-row" id="prepShapeRow">
          ${SHAPES.map((s) => `
            <button type="button" class="prep-shape-btn${shot.shape === s.id ? ' active' : ''}" data-shape="${s.id}">
              <svg viewBox="0 0 60 46">${SHAPE_GLYPHS[s.id]}</svg>
              <b>${s.name}</b><span>${s.sub}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  }
  function ensureNumberElements() {
    // v1.15.2 (final): NO number UI unless a shot is selected — James
    // wanted the numbers box GONE, and the plan rows already show every
    // number at rest. Tapping a shot expands it right there.
    if (planShotIdx < 0) {
      document.querySelectorAll('#prepStratBody .prep-num-inline')
        .forEach((el) => el.remove());
      const fb = document.getElementById('prepNumberFallback');
      if (fb) fb.remove();
      return;
    }
    const rows = document.querySelectorAll('#prepStratBody .prep-plan-shot');
    const host = rows[planShotIdx] || null;
    if (!host) return;
    let inline = host.querySelector(':scope > .prep-num-inline');
    // remove any stray number UI from other rows (move, not duplicate)
    document.querySelectorAll('#prepStratBody .prep-num-inline')
      .forEach((el) => { if (el !== inline) el.remove(); });
    const fb = document.getElementById('prepNumberFallback');
    if (fb) fb.remove();
    if (!inline) {
      host.insertAdjacentHTML('beforeend', numberTemplateHtml());
      // lie/shape handlers are DELEGATED on document (wireChrome) — no
      // per-mount wiring needed; the rows just work when they appear.
    }
  }

  function renderRecommendation(calc, rec) {
    // v1.9.0: the number block lives INSIDE the hole card now — the sweep
    // animation targets it, not a separate card.
    // v1.15.2: it lives inside the SELECTED SHOT ROW (tap-a-shot).
    const card = document.querySelector(
      '#prepStratBody .prep-plan-shot.chosen .prep-num-inline') ||
      document.getElementById('prepNumberFallback');
    if (!card) return;

    // v1.17.0: wind-relative tiles lived in the removed Conditions box —
    // with neutral solves they're always calm; nothing to render.

    // Headline
    const eff = effortInfo(rec.main);
    $('prepRecMain').textContent = `${fmt(calc.playsLikeYd)} yd → ${clubShort(rec.main)}`;
    // v1.15.2: prepEffortTag/prepEffortWrap were dropped in the inline
    // template — the effort tag now lives in the reason line instead.
    if (eff.tag) {
      const r2 = $('prepReason');
      if (r2 && eff.tag && !r2.textContent.startsWith(eff.tag))
        r2.textContent = `${eff.tag} — ${r2.textContent}`;
    }

    // Reasoning sentence — every adjustment named, in golf language.
    const bits = [];
    const hw = calc.headwindMph;
    if (Math.abs(calc.windAdjYd) >= 1) {
      const kind = hw >= 0 ? 'headwind' : 'tailwind';
      const dirTxt = hw >= 0 ? 'into' : 'riding';
      bits.push(`${fmt(Math.abs(hw))} mph ${dirTxt} ${kind} ${sgn(calc.windAdjYd)}`);
    }
    if (calc.tempF < 55 && Math.abs(calc.tempAdjYd) >= 1)
      bits.push(`cold air ${sgn(calc.tempAdjYd)}`);
    else if (calc.tempF > 85 && Math.abs(calc.tempAdjYd) >= 1)
      bits.push(`hot air ${sgn(calc.tempAdjYd)}`);
    if (Math.abs(calc.elevAdjYd) >= 1)
      bits.push(`${calc.elevDiffFt > 0 ? 'uphill' : 'downhill'} ${sgn(calc.elevAdjYd)}`);
    if (Math.abs(calc.altitudeAdjYd) >= 1)
      bits.push(`${cond.altFt >= 3000 ? 'thin air' : 'altitude'} ${sgn(calc.altitudeAdjYd)}`);
    const lieObj = LIES.find((l) => l.id === shot.lie) || LIES[0];
    if (lieObj.pen !== 0)
      bits.push(`${lieObj.name.toLowerCase()} lie ${lieObj.pen >= 0 ? '+' : ''}${lieObj.pen}`);

    let sentence;
    if (!bits.length) {
      sentence = `Neutral conditions — your stock ${clubShort(rec.main)} number holds as-is.`;
    } else {
      sentence = `${bits.join('; ')} → swing to ${fmt(calc.playsLikeYd)}.`;
    }
    if (eff.note) sentence += ` ${eff.note.charAt(0).toUpperCase()}${eff.note.slice(1)}.`;

    // Shape interplay note
    const disp = shapeDispYd(calc.horizontalYd);
    if (disp !== 0 && Math.abs(calc.lateralDriftYd) >= 2) {
      const against = Math.sign(disp) === -Math.sign(calc.lateralDriftYd);
      sentence += against
        ? ` The ${shot.shape} holds against the breeze — keep it committed.`
        : ` Careful — the ${shot.shape} rides the same way the wind pushes.`;
    }
    $('prepReason').textContent = sentence;

    // Adjustment chips (only the ones that matter)
    const chips = [];
    const addChip = (label, val, d = 1) => {
      if (Math.abs(val) < 0.5) return;
      chips.push(
        `<span class="prep-adj-chip ${val >= 0 ? 'longer' : 'shorter'}"><i>${label}</i>${sgn(val, d)} yd</span>`
      );
    };
    addChip('Wind', calc.windAdjYd);
    addChip('Hill', calc.elevAdjYd);
    addChip('Temp', calc.tempAdjYd);
    addChip('Altitude', calc.altitudeAdjYd);
    if (lieObj.pen !== 0) addChip('Lie', lieObj.pen, 0);
    $('prepAdjChips').innerHTML = chips.length
      ? chips.join('')
      : '<span class="prep-adj-chip shorter"><i>Straight math</i>no adjustments</span>';

    // Cells
    $('cellCarry').textContent = `${fmt(calc.playsLikeYd)} yd`;
    const rel = num(calc.rolloutYd, 0);
    $('cellRelease').textContent = rel >= 0.5 ? `+${fmt(rel)} yd` : '~0 yd';
    $('cellTotal').textContent = `${fmt(calc.playsLikeYd + Math.max(0, rel))} yd`;

    // Aim line (crosswind + intended shape combined)
    const totalDisp = num(calc.lateralDriftYd, 0) + disp;
    const aimYd = Math.round(-totalDisp); // + = start right of target
    const aimDeg = (Math.atan2(aimYd, Math.max(20, calc.horizontalYd)) * 180) / Math.PI;
    const aimTextEl = $('prepAimText');
    if (Math.abs(aimYd) < 2) {
      aimTextEl.textContent =
        disp === 0
          ? 'Aim dead at the target — wind is negligible.'
          : `Play the ${shot.shape} straight over the pin.`;
    } else {
      const side = aimYd > 0 ? 'right' : 'left';
      aimTextEl.textContent =
        `Start ${Math.abs(aimYd)} yd ${side}` +
        (disp !== 0 ? ` — the ${shot.shape} brings it back to target` : ' of target') +
        ` · ${fmt(Math.abs(aimDeg), 1)}°.`;
    }
    $('prepAimSvg').style.transform = `rotate(${clamp(aimDeg * 2.4, -32, 32)}deg)`;

    // Micro-interactions
    if (lastShownYd != null && lastShownYd !== calc.playsLikeYd) {
      const main = $('prepRecMain');
      main.classList.remove('prep-pulse');
      void main.offsetWidth;
      main.classList.add('prep-pulse');
    }
    lastShownYd = calc.playsLikeYd;
    if (arguments[2]) {
      card.classList.remove('sweep');
      void card.offsetWidth;
      card.classList.add('sweep');
    }
  }

  /* ======================================================================
     7. HOLE STRATEGY CARD
     ====================================================================== */
  function hazardAlongYd(sub) {
    const m = /~(\d+)\s*yd/.exec(String(sub || ''));
    return m ? Number(m[1]) : null;
  }

  /* ======================================================================
     HOLE FLYOVER — glanceable side-profile strip (tee left, green right)
     ====================================================================== */
  function flyoverProfile(h) {
    if (!h || !Number.isFinite(h.yards) || h.yards < 60) return null;
    const yards = Math.round(h.yards);

    // Yardage ticks every ~50 yd between tee and green.
    const marks = [];
    for (let d = 50; d <= yards - 20; d += 50) {
      marks.push({ yd: d, pct: d / yards });
    }

    // Hazards with a mapped along-the-line distance.
    const hazards = [];
    const hzList = Array.isArray(h.hazards) ? h.hazards : [];
    for (const hz of hzList) {
      const along = hazardAlongYd(hz && hz.sub);
      if (along == null || along <= 0 || along >= yards) continue;
      hazards.push({
        type: hz.type === 'water' ? 'water' : 'bunker',
        along,
        pct: along / yards,
      });
    }

    // Green band from front/back carry distances.
    const g = h.green || {};
    let green = null;
    if (
      Number.isFinite(g.front) &&
      Number.isFinite(g.back) &&
      g.back > g.front
    ) {
      green = {
        startPct: clamp(g.front / yards, 0, 1),
        endPct: clamp(g.back / yards, 0, 1),
      };
    }

    // Elevation trend (yd → ft). Flat line when the course isn't surveyed.
    let elev = null;
    const ev = h.elevation;
    if (
      Array.isArray(ev) &&
      ev.length >= 2 &&
      ev.every((p) => p && Number.isFinite(p.yd) && Number.isFinite(p.ft))
    ) {
      elev = ev
        .map((p) => ({ pct: clamp(p.yd / yards, 0, 1), ft: p.ft }))
        .sort((a, b) => a.pct - b.pct);
    }

    if (!marks.length && !hazards.length && !green) return null;
    return { yards, marks, hazards, green, elev };
  }

  function flyoverSvg(p) {
    if (!p) return '';
    const W = 320;
    const H = 96;
    const L = 14;
    const R = W - 16;
    const BASE = 62;
    const span = R - L;
    const x = (pct) => L + span * clamp(pct, 0, 1);

    const parts = [];

    // Elevation trend: surveyed points, or a calm flat baseline.
    if (p.elev) {
      const fts = p.elev.map((e) => e.ft);
      const lo = Math.min(...fts);
      const hi = Math.max(...fts);
      const spread = Math.max(hi - lo, 1);
      const pts = p.elev.map(
        (e) => `${x(e.pct).toFixed(1)},${(BASE - 8 - ((e.ft - lo) / spread) * 22).toFixed(1)}`
      );
      parts.push(
        `<polyline class="prep-fv-elev" points="${pts.join(' ')}" />`
      );
    } else {
      parts.push(`<line class="prep-fv-base" x1="${L}" y1="${BASE}" x2="${R}" y2="${BASE}" />`);
    }

    // Distance markers every 50 yd.
    for (const m of p.marks) {
      const mx = x(m.pct);
      parts.push(
        `<line class="prep-fv-tick" x1="${mx.toFixed(1)}" y1="${BASE + (p.elev ? -30 : 3)}" x2="${mx.toFixed(1)}" y2="${BASE + (p.elev ? -26 : 7)}" />` +
          `<text class="prep-fv-ticklabel" x="${mx.toFixed(1)}" y="${H - 6}">${m.yd}</text>`
      );
    }

    // Green band + flag on the right end.
    if (p.green) {
      const gx = x(p.green.startPct);
      const gw = Math.max(x(p.green.endPct) - gx, 5);
      parts.push(
        `<rect class="prep-fv-green" x="${gx.toFixed(1)}" y="${BASE - 4}" width="${gw.toFixed(1)}" height="8" rx="4" />`
      );
    }
    parts.push(
      `<line class="prep-fv-flagpole" x1="${R}" y1="${BASE - 24}" x2="${R}" y2="${BASE}" />` +
        `<path class="prep-fv-flag" d="M ${R} ${BASE - 24} l 10 4 l -10 4 Z" />`
    );

    // Tee pad on the left.
    parts.push(
      `<rect class="prep-fv-tee" x="${L - 6}" y="${BASE - 3}" width="7" height="6" rx="1.5" />`
    );

    // Hazard markers, proportionally placed above the line.
    for (const hz of p.hazards) {
      const hx = x(hz.pct);
      if (hz.type === 'water') {
        parts.push(
          `<path class="prep-fv-hz water" d="M ${hx - 5} ${BASE - 12} q 2.5 -4 5 0 q 2.5 4 5 0 l 0 3 q -2.5 3 -5 0.5 q -2.5 2.5 -5 -0.5 Z" transform="translate(-0,0)" />`
        );
      } else {
        parts.push(
          `<ellipse class="prep-fv-hz bunker" cx="${hx.toFixed(1)}" cy="${BASE - 10}" rx="5.5" ry="3" />`
        );
      }
    }

    return `<svg class="prep-fv-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Side profile of the hole: ${p.yards} yards">${parts.join('')}</svg>`;
  }

  function renderFlyover() {
    const card = $('prepFlyoverCard');
    const body = $('prepFlyoverBody');
    if (!card || !body) return;
    const prof = boundHole ? flyoverProfile(boundHole) : null;
    const svg = flyoverSvg(prof);
    if (!svg) {
      card.hidden = true;
      body.innerHTML = '';
      return;
    }
    body.innerHTML = svg;
    card.hidden = false;
  }

  const GREEN_BRIEF_KEY = 'caddy:greenBrief:v1';
  const GREEN_BRIEF_MATCH_M = 60;

  function metersApart(a, b) {
    if (!a || !b) return Infinity;
    const lat1 = Number(a.lat), lng1 = Number(a.lng);
    const lat2 = Number(b.lat), lng2 = Number(b.lng);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const s = Math.sin(dp / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function readGreenBrief(hole) {
    if (!hole || !hole.greenLatLng) return null;
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(GREEN_BRIEF_KEY);
      if (!raw) return null;
      const brief = JSON.parse(raw);
      if (!brief || !Number.isFinite(brief.lat) || !Number.isFinite(brief.lng))
        return null;
      if (metersApart(hole.greenLatLng, brief) > GREEN_BRIEF_MATCH_M) return null;
      return brief;
    } catch {
      return null;
    }
  }

  function breakSideLabel(breakIn) {
    const n = Number(breakIn);
    if (!Number.isFinite(n) || Math.abs(n) < 1.5) return null;
    return n > 0 ? 'RIGHT' : 'LEFT';
  }

  function paceWords(cls) {
    if (cls === 'firm') return 'firm pace';
    if (cls === 'soft') return 'soft pace';
    return 'true pace';
  }

  function greenFeedLine(brief, pointId) {
    if (!brief) return null;
    const zones = Array.isArray(brief.zones) ? brief.zones : [];
    const zone = zones.find((z) => z && z.id === pointId) ||
      zones.find((z) => z && z.id === 'middle') ||
      null;
    const atPin = brief.landing && brief.landing.atPin;
    const br = zone && Number.isFinite(zone.breakIn)
      ? zone.breakIn
      : (atPin && Number.isFinite(atPin.breakIn) ? atPin.breakIn : 0);
    const side = breakSideLabel(br);
    const pace = paceWords(atPin && atPin.paceClass);
    const inches = Math.round(Math.abs(br));
    if (!side) return `After landing: putt holds, ${pace}.`;
    return `After landing: ball feeds ${side} ~${inches} in, ${pace}.`;
  }

  function seqNames(h) {
    if (!h || !h.yards || typeof api.clubSequence !== 'function') return [];
    const seq = api.clubSequence(Math.round(h.yards));
    if (!seq) return [];
    const names = Array.isArray(seq.seq) ? seq.seq.slice() : [];
    if (seq.finisherName) names.push(seq.finisherName);
    return names;
  }

  // v1.15.0 (shot plan): the hole's shot sequence as concrete shots.
  // Returns full club names (with "% swing" partials intact) so each
  // plan line can show a real target number.
  function planSequenceFor(totalYd, names) {
    if (!names || !names.length) return [];
    return names;
  }

  // Stock carry for a club name (matches "7 Iron" and "7 Iron · 85% swing"
  // — partial swings use their percentage of the stock number). Reads the
  // bag through the bridge (api.clubSequence-style access).
  function clubYardsFor(name) {
    const bag = typeof api.clubs === 'function' ? api.clubs() : [];
    if (!Array.isArray(bag)) return null;
    const base = String(name || '').replace(/\s*·.*$/, '').trim()
      .toLowerCase();
    const club = bag.find((c) =>
      String(c.name || '').trim().toLowerCase() === base);
    if (!club || !Number.isFinite(club.yards)) return null;
    const pctM = /(\d+)%\s*swing/.exec(String(name || ''));
    const pct = pctM ? Number(pctM[1]) / 100 : 1;
    return Math.round(club.yards * pct);
  }

  // v1.10.0 (real-shape maps): the map draws the hole's TRUE geometry
  // when the course was imported after this shipped — pathPts (the OSM
  // hole way, simplified) + greenRingPts (the OSM green outline).
  // Everything is projected into a local EN plane, rotated so the tee→
  // green axis runs left→right, then fitted to the viewBox. Hazards are
  // placed by their real lat/lng projected the same way when available,
  // else along/cross off the line (old behaviour). Shot segments follow
  // the path: each club's segment starts where the previous ended by
  // CUMULATIVE PATH DISTANCE, so a dogleg shows the bend. Courses saved
  // before v1.10 (and manual holes) keep the honest generic corridor.
  function holeMapSvg(h, names) {
    const yards = Number(h && h.yards);
    if (!(yards > 40)) return '';
    const W = 320, H = 168;
    const padT = 22, padB = 18, padL = 22, padR = 28;
    const x0 = padL, x1 = W - padR;
    const yMid = (padT + (H - padB)) / 2;
    const spanX = x1 - x0;
    const xAt = (alongYd) => x0 + spanX * clamp(alongYd / yards, 0, 1);
    const effYd = Math.round(Number(h && h.yards) || 0);
    const parts = [];

    // ---- Projection helpers (shared by both modes) ----
    let P = null;   // {toXY(latlngOrAlongCross)} when real geometry exists
    // v1.20.8: the hole's FOOTPRINT — loops in along/cross (turf + green
    // + surround) and the bunkers that touch it. Filled by the fit block
    // below, consumed by the draw block.
    const foot = { loops: [], bunkers: [] };
    if (Array.isArray(h.pathPts) && h.pathPts.length >= 2 &&
        h.teeLatLng && h.greenLatLng) {
      // v1.15.0: anchor the EN plane at the PATH's first point — the hole
      // way start, which is on the hole line (the stored teePoint may be
      // a tee-set node tens of yards off the line; the tee dot is then
      // drawn at the path start and never floats).
      const anchor = h.pathPts[0];
      const mLat = 111320, mLng = 111320 * Math.cos(anchor.lat * Math.PI / 180);
      const en = (ll) => ({
        x: ((ll.lng - anchor.lng) * mLng) / 0.9144,
        y: ((ll.lat - anchor.lat) * mLat) / 0.9144,
      });
      const tgt = en(h.greenLatLng);
      const L = Math.hypot(tgt.x, tgt.y) || 1e-9;
      const ux = tgt.x / L, uy = tgt.y / L;        // unit toward green
      // v1.14.1 (bunker mirror — James: "the bunker on this hole is on the
      // left side?"): the old basis px=-uy, py=ux made cross POSITIVE to
      // the golfer's LEFT, while the hazard text (planHazardsFor →
      // crossTrackYd) is right-positive — the map drew every hazard
      // mirrored across the fairway line. Now +cross = golfer's RIGHT in
      // both, and P.Y maps right = DOWN the screen (viewer sees the hole
      // as if standing on the tee).
      const px = uy, py = -ux;                      // perpendicular (right)
      const toXY = (ll) => {
        const p = en(ll);
        const along = p.x * ux + p.y * uy;
        const cross = p.x * px + p.y * py;
        return { along, cross };
      };
      // Fit: TRUE-SCALE, this hole fills the card.
      // v1.20.8 (James: the cartoon is TEE→GREEN, this hole only):
      // FOOTPRINT = this hole's mapped turf (fairway/rough/tees) +
      // green ring + green grown by 25 yd. Water/bunkers render only
      // where they touch the footprint — a wrapping pond paints just
      // the sliver the hole clips; another hole's bunker (inside the
      // old 90 yd corridor) renders nothing. Camera surveys path +
      // green + footprint + the bunkers that earned their place —
      // never water, never foreign shapes. No yardage floor or cap.
      // The 90 yd corridor lives on only in ASSIGNMENT (hazards-in-
      // play text), not as a drawing rule.
      const innerH = H - padT - padB;
      const S0 = h.shapes || {};
      // v1.20.9 (James: the surround pulled in neighbour bunkers — the
      // clip is the HOLE LINE, not the turf): one corridor = the
      // tee→green path offset ±20 yd each side, extended 20 yd past
      // the tee and past the green. Water clips to it (only the part
      // the hole line clips paints). Bunkers whole-or-drop against it.
      // Fallback dots must sit inside it. Turf still paints as the
      // background but is NOT the clip. No green surround.
      const STRIP_YD = 20;
      const acPts = h.pathPts.map((ll) => toXY(ll));
      {
        // extend the centerline one strip-width past each end
        const first = acPts[0], second = acPts[1];
        const d0 = Math.hypot(second.along - first.along,
          second.cross - first.cross) || 1e-9;
        acPts.unshift({
          along: first.along - ((second.along - first.along) / d0) * STRIP_YD,
          cross: first.cross - ((second.cross - first.cross) / d0) * STRIP_YD,
        });
        const last = acPts[acPts.length - 1];
        const prev = acPts[acPts.length - 2];
        const dN = Math.hypot(last.along - prev.along,
          last.cross - prev.cross) || 1e-9;
        acPts.push({
          along: last.along + ((last.along - prev.along) / dN) * STRIP_YD,
          cross: last.cross + ((last.cross - prev.cross) / dN) * STRIP_YD,
        });
      }
      const offsetRing = (() => {
        const left = [], right = [];
        for (let i = 0; i < acPts.length; i++) {
          let dx, dy;
          if (i === 0) {
            dx = acPts[1].along - acPts[0].along;
            dy = acPts[1].cross - acPts[0].cross;
          } else if (i === acPts.length - 1) {
            dx = acPts[i].along - acPts[i - 1].along;
            dy = acPts[i].cross - acPts[i - 1].cross;
          } else {
            dx = acPts[i + 1].along - acPts[i - 1].along;
            dy = acPts[i + 1].cross - acPts[i - 1].cross;
          }
          const len = Math.hypot(dx, dy) || 1e-9;
          const nx = -dy / len, ny = dx / len;
          left.push({
            along: acPts[i].along + nx * STRIP_YD,
            cross: acPts[i].cross + ny * STRIP_YD,
          });
          right.push({
            along: acPts[i].along - nx * STRIP_YD,
            cross: acPts[i].cross - ny * STRIP_YD,
          });
        }
        return left.concat(right.reverse());
      })();
      const corridor = {
        pts: offsetRing,
        aMin: Infinity, aMax: -Infinity, cMin: Infinity, cMax: -Infinity,
      };
      offsetRing.forEach((p) => {
        corridor.aMin = Math.min(corridor.aMin, p.along);
        corridor.aMax = Math.max(corridor.aMax, p.along);
        corridor.cMin = Math.min(corridor.cMin, p.cross);
        corridor.cMax = Math.max(corridor.cMax, p.cross);
      });
      const ptInRing = (p, pts) => {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], b = pts[j];
          if ((a.cross > p.cross) !== (b.cross > p.cross) &&
              p.along < ((b.along - a.along) * (p.cross - a.cross)) /
                ((b.cross - a.cross) || 1e-12) + a.along) {
            inside = !inside;
          }
        }
        return inside;
      };
      // Bunker touches the strip? (whole-or-drop — James)
      const bunkerTouches = (ring) => {
        const bl = { pts: [], aMin: Infinity, aMax: -Infinity,
          cMin: Infinity, cMax: -Infinity };
        (ring || []).forEach((ll) => {
          if (!ll) return;
          const p = toXY(ll);
          bl.pts.push(p);
          bl.aMin = Math.min(bl.aMin, p.along);
          bl.aMax = Math.max(bl.aMax, p.along);
          bl.cMin = Math.min(bl.cMin, p.cross);
          bl.cMax = Math.max(bl.cMax, p.cross);
        });
        if (bl.pts.length < 3) return false;
        // any bunker vertex inside the strip, or the strip swallowed
        // by a huge bunker (bunker bbox contains a strip vertex)
        if (bl.pts.some((p) => ptInRing(p, corridor.pts))) return true;
        if (corridor.pts.some((p) =>
          p.along >= bl.aMin && p.along <= bl.aMax &&
          p.cross >= bl.cMin && p.cross <= bl.cMax)) return true;
        return false;
      };
      foot.bunkers = (Array.isArray(S0.bunkers) ? S0.bunkers : [])
        .filter((r) => bunkerTouches(r));
      foot.loops = [corridor];
      // v1.21.0 (James: chord-crossed water paints too): a second tube
      // along the STRAIGHT tee→green chord — the flight line. Water
      // clips to the union of both; bunkers/dots stay on the path strip.
      const chordRing = (() => {
        const a = acPts[1];   // first original point (after the extension)
        const b = acPts[acPts.length - 2];
        const dx = b.along - a.along, dy = b.cross - a.cross;
        const len = Math.hypot(dx, dy) || 1e-9;
        const nx = -dy / len, ny = dx / len;
        const aE = {
          along: a.along - (dx / len) * STRIP_YD,
          cross: a.cross - (dy / len) * STRIP_YD,
        };
        const bE = {
          along: b.along + (dx / len) * STRIP_YD,
          cross: b.cross + (dy / len) * STRIP_YD,
        };
        return [
          { along: aE.along + nx * STRIP_YD, cross: aE.cross + ny * STRIP_YD },
          { along: bE.along + nx * STRIP_YD, cross: bE.cross + ny * STRIP_YD },
          { along: bE.along - nx * STRIP_YD, cross: bE.cross - ny * STRIP_YD },
          { along: aE.along - nx * STRIP_YD, cross: aE.cross - ny * STRIP_YD },
        ];
      })();
      foot.chord = chordRing;
      // Camera: hole + strip + kept bunkers. WATER EXCLUDED.
      let aMin = Infinity, aMax = -Infinity;
      let cMin = Infinity, cMax = -Infinity;
      const surveyAC = (along, cross) => {
        if (along < aMin) aMin = along;
        if (along > aMax) aMax = along;
        if (cross < cMin) cMin = cross;
        if (cross > cMax) cMax = cross;
      };
      const survey = (ll) => {
        if (!ll) return;
        const p = toXY(ll);
        surveyAC(p.along, p.cross);
      };
      h.pathPts.forEach(survey);
      if (Array.isArray(h.greenRingPts)) h.greenRingPts.forEach(survey);
      if (h.teeLatLng) survey(h.teeLatLng);
      if (h.greenLatLng) survey(h.greenLatLng);
      // Strip contributes CROSS only (width) — the 20 yd end
      // extensions must not lengthen the hole's along span (v1.20.9
      // test: tee→green still fills the card).
      cMin = Math.min(cMin, corridor.cMin);
      cMax = Math.max(cMax, corridor.cMax);
      foot.bunkers.forEach((r) => (r || []).forEach(survey));
      if (!Number.isFinite(aMin)) { aMin = 0; aMax = Math.max(80, effYd); }
      if (!Number.isFinite(cMin)) { cMin = -20; cMax = 20; }
      const PAD_YD = 12;
      const alongSpan = Math.max(40, aMax - aMin) + PAD_YD * 2;
      const crossSpan = Math.max(28, cMax - cMin) + PAD_YD * 2;
      const alongMid = (aMin + aMax) / 2;
      const crossMid = (cMin + cMax) / 2;
      const ydPerPx = Math.max(alongSpan / spanX, crossSpan / innerH);
      const xMid = (x0 + x1) / 2;
      const X = (along) => xMid + (along - alongMid) / ydPerPx;
      const Y = (cross) => yMid + (cross - crossMid) / ydPerPx;
      P = { toXY, X, Y, ydPerPx };
    }

    if (P) {
      // ---- REAL SHAPE MODE ----
      // v1.15.4 (draw-time defense): courses saved before the import-side
      // path trim can still carry looped ways (green→tee→…→green). Trim
      // the drawn path to the journey: stop at the point closest to the
      // green. Prevents the faint straight return leg across the band.
      {
        let bi = 0, bd = Infinity;
        h.pathPts.forEach((p, i) => {
          // distance to the green in metres (local approximation)
          const dM = Math.hypot(
            (p.lng - h.greenLatLng.lng) * 111320 *
              Math.cos(p.lat * Math.PI / 180),
            (p.lat - h.greenLatLng.lat) * 110540);
          if (dM < bd) { bd = dM; bi = i; }
        });
        if (bi < h.pathPts.length - 1) h.pathPts = h.pathPts.slice(0, bi + 1);
      }
      // Fairway = the actual path.
      const d = h.pathPts.map((ll, i) => {
        const { along, cross } = P.toXY(ll);
        return (i ? 'L' : 'M') + ` ${P.X(along).toFixed(1)} ${P.Y(cross).toFixed(1)}`;
      }).join(' ');
      // v1.19.0 (James: "why not actually import their cartoons?"): draw
      // OSM's REAL polygons — rough underlay, fairway shapes, water,
      // bunkers, tee boxes — instead of only the stroked band. Polygons
      // are pre-assigned per hole at import (h.shapes). The band stays
      // beneath as a graceful fallback when a course has no fairway
      // polygons mapped.
      const shapePath = (rings, close = true) => rings.map((ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return '';
        return ring.map((ll, i) => {
          const { along, cross } = P.toXY(ll);
          return (i ? 'L' : 'M') +
            ` ${P.X(along).toFixed(1)} ${P.Y(cross).toFixed(1)}`;
        }).join(' ') + (close ? ' Z' : '');
      }).join(' ');
      const S = h.shapes || {};
      // v1.20.8: water + point-dots clip to the hole's FOOTPRINT
      // (turf + green + 25 yd surround; ±25 yd band fallback). The
      // 90 yd corridor is gone as a drawing rule — a wrapping pond
      // paints only the sliver this hole clips.
      const footClipId = 'prepHmFoot';
      const footLoopD = (l) => {
        if (!l.pts || l.pts.length < 3) {
          // envelope-only loop (bbox rect) — build the rect path
          return 'M ' + P.X(l.aMin).toFixed(1) + ' ' + P.Y(l.cMin).toFixed(1) +
            ' L ' + P.X(l.aMax).toFixed(1) + ' ' + P.Y(l.cMin).toFixed(1) +
            ' L ' + P.X(l.aMax).toFixed(1) + ' ' + P.Y(l.cMax).toFixed(1) +
            ' L ' + P.X(l.aMin).toFixed(1) + ' ' + P.Y(l.cMax).toFixed(1) + ' Z';
        }
        return l.pts.map((p, i) =>
          (i ? 'L' : 'M') +
          ` ${P.X(p.along).toFixed(1)} ${P.Y(p.cross).toFixed(1)}`
        ).join(' ') + ' Z';
      };
      const footClipD = foot.loops.map(footLoopD).join(' ') +
        (foot.chord && foot.chord.length >= 3
          ? ' ' + foot.chord.map((p, i) =>
            (i ? 'L' : 'M') +
            ` ${P.X(p.along).toFixed(1)} ${P.Y(p.cross).toFixed(1)}`
          ).join(' ') + ' Z' : '');
      if (footClipD && ((Array.isArray(S.water) && S.water.length))) {
        let hasTurfClip = false;
        parts.push(
          `<defs><clipPath id="${footClipId}"><path d="${footClipD}"/></clipPath></defs>`);
        // v1.21.2 (evolution of v1.21.1): the turf clipPath now gates a
        // SECOND water path (the turf-overlap slice), added to the
        // strip/chord-clipped one. Water = (strip ∪ chord) ∪ (water ∩
        // turf) — the crossing sliver James red-marked fills, and the
        // far past-turf mass still never paints (it's outside the
        // strip/chord AND the turf-overlap slice stops at the grass).
        const turfD = shapePath([
          ...(Array.isArray(S.fairways) ? S.fairways : []),
          ...(Array.isArray(S.rough) ? S.rough : []),
        ]) + (Array.isArray(h.greenRingPts) && h.greenRingPts.length >= 3
          ? ' ' + shapePath([h.greenRingPts])
          : (() => {
            if (!h.greenLatLng) return '';
            const e = P.toXY(h.greenLatLng);
            const rx = 16 * P.ydPerPx, ry = 11 * P.ydPerPx;
            return ` M ${(P.X(e.along) - rx).toFixed(1)} ${P.Y(e.cross).toFixed(1)}` +
              ` a ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(2 * rx).toFixed(1)} 0` +
              ` a ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(-2 * rx).toFixed(1)} 0 Z`;
          })());
        if (turfD) {
          hasTurfClip = true;
          parts.push(
            `<defs><clipPath id="prepHmTurf"><path d="${turfD}"/></clipPath></defs>`);
        }
        foot.hasTurfClip = hasTurfClip;
      }
      // v1.20.1 (James: "some holes still keep the old style even though
      // they're mapped"): the stroked band was engaging whenever the
      // course had no golf=FAIRWAY polygons — but courses like the exec
      // tag their light green as golf=ROUGH. When rough polygons exist,
      // they ARE the corridor: draw them and skip the band. Band only
      // when there's neither.
      if (Array.isArray(S.rough) && S.rough.length) {
        parts.push(
          `<path class="prep-hm-shape rough" d="${shapePath(S.rough)}"/>`);
      }
      if (Array.isArray(S.fairways) && S.fairways.length) {
        parts.push(
          `<path class="prep-hm-shape fairway" d="${shapePath(S.fairways)}"/>`);
      }
      if (Array.isArray(S.water) && S.water.length && footClipD) {
        // v1.21.2 (James: "the water should be FILLED where I marked
        // red"): the v1.21.1 AND-of-clips cut the crossing sliver —
        // the pond near the line sits on NEITHER the 20 yd strip NOR
        // the turf (the line hooks across a gap between rough blobs).
        // Water paints where the hole genuinely meets it:
        //   (strip ∪ chord)   — the line/crossing gate (kept), PLUS
        //   turf-overlap slice — where the water touches this hole's
        //   grass (the red-marked area), via a SECOND water path
        //   clipped to turf only. Minus rule (unchanged): anything
        //   outside both gates never paints (far arms, neighbour
        //   water). No green surround anywhere.
        const waterD = `<path class="prep-hm-shape water" fill-rule="nonzero" clip-path="url(#${footClipId})" d="${shapePath(S.water)}"/>`;
        parts.push(waterD);
        if (foot.hasTurfClip) {
          parts.push(
            `<g class="prep-hm-waterclip" clip-path="url(#prepHmTurf)">${waterD}</g>`);
        }
      }
      if (foot.bunkers.length) {
        parts.push(
          `<path class="prep-hm-shape bunker" d="${shapePath(foot.bunkers)}"/>`);
      }
      if (Array.isArray(S.tees) && S.tees.length) {
        parts.push(
          `<path class="prep-hm-shape teebox" d="${shapePath(S.tees)}"/>`);
      }
      if ((!Array.isArray(S.fairways) || !S.fairways.length) &&
          (!Array.isArray(S.rough) || !S.rough.length)) {
        parts.push(`<path class="prep-hm-fairway" d="${d}" fill="none" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`);
      }

      // Green: the real outline when stored, else an ellipse at the end.
      if (Array.isArray(h.greenRingPts) && h.greenRingPts.length >= 3) {
        const gd = h.greenRingPts.map((ll, i) => {
          const { along, cross } = P.toXY(ll);
          return (i ? 'L' : 'M') + ` ${P.X(along).toFixed(1)} ${P.Y(cross).toFixed(1)}`;
        }).join(' ') + ' Z';
        parts.push(`<path class="prep-hm-green" d="${gd}" fill="none" stroke-width="2"/>`);
        // tint the interior
        parts.push(`<path class="prep-hm-greenfill" d="${gd}"/>`);
      } else {
        const end = P.toXY(h.greenLatLng);
        parts.push(
          `<ellipse class="prep-hm-green" cx="${P.X(end.along).toFixed(1)}" cy="${P.Y(end.cross).toFixed(1)}" rx="16" ry="11"/>`
        );
      }

      // Hazards: project real positions when lat/lng present.
      // v1.15.0 (path-relative — James: the cartoon was still wrong on
      // doglegs): hazards now measure against the FAIRWAY PATH, not the
      // tee→green chord. For each hazard: nearest path point (walked
      // cumulative distance = along) and the signed perpendicular from
      // the LOCAL path direction there (= cross, +right of play). On a
      // dogleg this is what the eye expects; the chord put bunkers
      // bunching near the green, detached from the line.
      const pathAlong = (() => {
        // cumulative path distance (yd) per pathPts index
        const acc = [0];
        for (let i = 1; i < h.pathPts.length; i++) {
          const a = P.toXY(h.pathPts[i - 1]);
          const b = P.toXY(h.pathPts[i]);
          acc.push(acc[i - 1] + Math.hypot(b.along - a.along, b.cross - a.cross));
        }
        return acc;
      })();
      const pathProject = (ll) => {
        let best = null;
        for (let i = 1; i < h.pathPts.length; i++) {
          const a = P.toXY(h.pathPts[i - 1]);
          const b = P.toXY(h.pathPts[i]);
          const dx = b.along - a.along, dy = b.cross - a.cross;
          const len2 = dx * dx + dy * dy || 1e-9;
          const p = P.toXY(ll);
          let tt = ((p.along - a.along) * dx + (p.cross - a.cross) * dy) / len2;
          tt = Math.max(0, Math.min(1, tt));
          const projAlong = a.along + tt * dx;
          const projCross = a.cross + tt * dy;
          const d2 = (p.along - projAlong) * (p.along - projAlong) +
            (p.cross - projCross) * (p.cross - projCross);
          if (!best || d2 < best.d2) {
            // v1.15.0: return the projection point in GLOBAL chord coords
            // (draw position is honest on doglegs — the dot sits on the
            // drawn path) plus the PATH-RELATIVE side for the label:
            // signed perpendicular from the LOCAL segment direction,
            // + = golfer's right of play (viewer-behind-tee convention).
            const segLen = Math.sqrt(len2) || 1e-9;
            const ux = dx / segLen, uy = dy / segLen;
            const relA = (p.along - projAlong) * ux +
              (p.cross - projCross) * uy;          // (unused, kept for debug)
            const side = (p.along - projAlong) * uy -
              (p.cross - projCross) * ux;          // + = right of local play
            best = {
              d2,
              along: pathAlong[i - 1] + tt * segLen,  // walked path yd
              gx: projAlong, gy: projCross,           // global draw coords
              side,
            };
          }
        }
        return best;
      };
      const haz = Array.isArray(h.hazards) ? h.hazards : [];
      // v1.19.0: bunkers/water with REAL outlines (h.shapes) draw as
      // their true shapes; the ellipse dots stay only for point-only
      // hazards (no polygon mapped).
      // v1.20.8: a fallback dot also has to sit ON this hole —
      // inside the footprint loops (turf/green/band). The 45 yd
      // assignment corridor used to paint neighbours' point hazards.
      const dotOnHole = (along, cross) => foot.loops.some((l) =>
        along >= l.aMin && along <= l.aMax &&
        cross >= l.cMin && cross <= l.cMax);
      const shapes = h.shapes || {};
      const bunkersDrawn = Array.isArray(shapes.bunkers) &&
        shapes.bunkers.length;
      const waterDrawn = Array.isArray(shapes.water) &&
        shapes.water.length;
      for (const hz of haz) {
        if (hz.type === 'bunker' && bunkersDrawn) continue;
        if (hz.type === 'water' && waterDrawn) continue;
        let ax = null, ay = null;
        if (Number.isFinite(hz.lat) && Number.isFinite(hz.lng) && h.teeLatLng) {
          const pr = pathProject(hz);
          if (!pr) continue;
          if (!dotOnHole(pr.along, pr.side)) continue;
          ax = P.X(pr.gx); ay = P.Y(pr.gy);
        } else {
          const along = Number.isFinite(hz.along) ? hz.along : hazardAlongYd(hz.sub);
          if (along == null || along <= 0 || along > effYd + 30) continue;
          const cross = Number.isFinite(hz.cross) ? hz.cross : 0;
          if (!dotOnHole(along, cross)) continue;
          ax = P.X(along); ay = P.Y(cross);
        }
        if (hz.type === 'water') {
          parts.push(`<ellipse class="prep-hm-hz water" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" rx="9" ry="6"/>`);
        } else {
          parts.push(`<ellipse class="prep-hm-hz bunker" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" rx="8" ry="5"/>`);
        }
      }

      // Shot segments ALONG the path by cumulative distance.
      const clubs = names.length ? names : ['Shot'];
      const n = clubs.length;
      const ydPerPath = (() => {
        // total path length in yards for even division of the sequence
        let tot = 0;
        for (let i = 1; i < h.pathPts.length; i++) {
          const a = P.toXY(h.pathPts[i - 1]);
          const b = P.toXY(h.pathPts[i]);
          tot += Math.hypot(b.along - a.along, b.cross - a.cross);
        }
        return tot || effYd;
      })();
      const ptAlong = (yd) => {
        // walk the path until cumulative distance covers yd
        let acc = 0;
        for (let i = 1; i < h.pathPts.length; i++) {
          const a = P.toXY(h.pathPts[i - 1]);
          const b = P.toXY(h.pathPts[i]);
          const seg = Math.hypot(b.along - a.along, b.cross - a.cross);
          if (acc + seg >= yd) {
            const t = seg > 0 ? (yd - acc) / seg : 0;
            return { along: a.along + (b.along - a.along) * t,
                     cross: a.cross + (b.cross - a.cross) * t };
          }
          acc += seg;
        }
        const e = P.toXY(h.pathPts[h.pathPts.length - 1]);
        return e;
      };
      const effShare = Math.min(1, effYd / ydPerPath);   // nudge shortens shots
      // v1.15.2 (James, with screenshots): the map's hero is the FAIRWAY
      // SHAPE — the long colored shot chords read as a straight tee→green
      // line and buried the band. Redesign:
      //   • fairway band = the hero (brighter, wider);
      //   • NO long shot lines — one colored LANDING DOT per club at its
      //     spot along the path, hue = the club's Bag-tab category color
      //     (woods gold / irons blue / wedges purple / putter green);
      //   • the tee→green reference is a SMALL dashed line under the
      //     band (subtle, with the yardage label bottom-right).
      const bagCats = (typeof api.clubs === 'function' ? api.clubs() : []);
      const catOf = (name) => {
        const n2 = String(name || '').toLowerCase().trim();
        const base = n2.replace(/\s*·.*$/, '').trim();
        const entry = bagCats.find((c) =>
          String(c.name || '').toLowerCase().trim() === base);
        if (entry && entry.cat) return entry.cat;
        if (/putt/.test(n2)) return 'putter';
        if (/wedge|°/.test(n2)) return 'wedges';
        if (/^(pw|gw|sw|lw|aw)$/.test(base)) return 'wedges';
        if (/driver|wood|hybrid|rescue|\bd?\d*h\b/.test(n2)) return 'woods';
        return 'irons';
      };
      const CAT_HEX = {
        woods: '#e8a63c', irons: '#5ea8ff',
        wedges: '#b48bff', putter: '#3ec98a',
      };
      // v1.15.3 (James): the dashed chord is gone. The tee→green
      // reference lives in the yardage label alone — the fairway shape
      // speaks for itself.
      // (pathDbetween removed in v1.19.1 — shot segments are STRAIGHT
      // lines now, ball flight not ground-following.)
      // v1.15.3 (James: "I liked the segments you had before of each
      // club"): the segments are BACK — but now colored by the club's
      // Bag-tab category instead of a 4-color rotation, so Driver is
      // gold (wood), irons blue, wedges purple. Landing dots stay, in
      // the same hue, as the segment's endpoint.
      for (let i = 0; i < n; i++) {
        const d0 = (ydPerPath * i) / n * (effYd / ydPerPath);
        const d1 = (ydPerPath * (i + 1)) / n * Math.min(1, effYd / ydPerPath);
        const s0 = ptAlong(d0), s1 = ptAlong(Math.min(d1, ydPerPath * effShare));
        const p0 = { x: P.X(s0.along), y: P.Y(s0.cross) };
        const p1 = { x: P.X(s1.along), y: P.Y(s1.cross) };
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        const hex = CAT_HEX[catOf(clubs[i])] || '#5ea8ff';
        // v1.19.1 (James: "why does the eight iron follow the hole line?
        // I'd be hitting it over the water"): a golf shot FLIES — draw
        // the segment STRAIGHT from start to landing, not along the OSM
        // hole way (that's the ground's centerline, not the flight).
        // Landing POSITIONS still come from the path splits; the line
        // between them is honest ball flight.
        parts.push(
          `<path class="prep-hm-shot" d="M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}" stroke="${hex}"/>`
        );
        parts.push(
          `<circle class="prep-hm-land" cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="3.6" fill="${hex}" stroke="rgba(10,14,12,0.9)" stroke-width="1.4"/>`
        );
        parts.push(
          `<text class="prep-hm-club" x="${mx.toFixed(1)}" y="${(my + (i % 2 === 0 ? -8 : 14)).toFixed(1)}" text-anchor="middle" fill="${hex}">${escapeHtml(clubs[i])}</text>`
        );
      }

      // v1.15.0: tee dot AT the path's first point (never floating off the
      // line on a tee-set offset); flag at the path's real end.
      const teeP = P.toXY(h.pathPts[0]);
      const teeXY = { x: P.X(teeP.along), y: P.Y(teeP.cross) };
      parts.push(`<circle class="prep-hm-tee" cx="${teeXY.x.toFixed(1)}" cy="${teeXY.y.toFixed(1)}" r="5.5"/>`);
      const gEnd = P.toXY(h.greenLatLng);
      const gXY = { x: P.X(gEnd.along), y: P.Y(gEnd.cross) };
      parts.push(
        `<line x1="${gXY.x.toFixed(1)}" y1="${(gXY.y - 22).toFixed(1)}" x2="${gXY.x.toFixed(1)}" y2="${gXY.y.toFixed(1)}" stroke="rgba(255,255,255,0.7)" stroke-width="1.4"/>` +
        `<path class="prep-hm-flag" d="M ${gXY.x.toFixed(1)} ${gXY.y - 22} l 9 3.5 l -9 3.5 Z"/>`
      );
      parts.push(
        `<text class="prep-hm-club" x="${teeXY.x.toFixed(1)}" y="${H - 4}" text-anchor="start">Tee</text>` +
        `<text class="prep-hm-club" x="${(W - padR).toFixed(1)}" y="${H - 4}" text-anchor="end">${effYd} yd</text>`
      );
      return `<svg class="prep-holemap" viewBox="0 0 ${W} ${H}" overflow="hidden" role="img" aria-label="Hole ${h.number} map, ${effYd} yards">${parts.join('')}</svg>`;
    }

    // ---- GENERIC CORRIDOR (pre-v1.10 courses / manual holes) ----
    const yMid2 = yMid;
    const fairW = 28;
    parts.push(
      `<rect class="prep-hm-fairway" x="${x0}" y="${(yMid2 - fairW / 2).toFixed(1)}" width="${spanX.toFixed(1)}" height="${fairW}" rx="14"/>`
    );

    const haz = Array.isArray(h.hazards) ? h.hazards : [];
    for (const hz of haz) {
      let along = Number.isFinite(hz.along) ? hz.along : hazardAlongYd(hz.sub);
      if (along == null || along <= 0 || along > effYd + 30) continue;
      const cross = Number.isFinite(hz.cross) ? hz.cross : 0;
      const hx = xAt(along);
      const hy = yMid2 + clamp(cross / 28, -1, 1) * 22;
      if (hz.type === 'water') {
        parts.push(
          `<ellipse class="prep-hm-hz water" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" rx="9" ry="6"/>`
        );
      } else {
        parts.push(
          `<ellipse class="prep-hm-hz bunker" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" rx="8" ry="5"/>`
        );
      }
    }

    const clubs = names.length ? names : ['Shot'];
    const n = clubs.length;
    const xs = [x0];
    for (let i = 1; i < n; i++) xs.push(x0 + (spanX * i) / n);
    xs.push(x1);
    for (let i = 0; i < n; i++) {
      const a = xs[i], b = xs[i + 1];
      const bump = (i % 2 === 0 ? -1 : 1) * 7;
      const cpx = (a + b) / 2;
      const cpy = yMid2 + bump;
      parts.push(
        `<path class="prep-hm-shot s${i % 4}" d="M ${a.toFixed(1)} ${yMid2.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${b.toFixed(1)} ${yMid2.toFixed(1)}"/>`
      );
      const lx = (a + b) / 2;
      const ly = yMid2 + bump - (bump > 0 ? -12 : 12);
      parts.push(
        `<text class="prep-hm-club" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${escapeHtml(clubs[i])}</text>`
      );
    }

    parts.push(`<circle class="prep-hm-tee" cx="${x0}" cy="${yMid2}" r="5.5"/>`);
    const g = h.green || {};
    const depthYd = Number.isFinite(g.depth) ? g.depth : 18;
    const gw = clamp((depthYd / effYd) * spanX * 4.2, 18, 36);
    parts.push(
      `<ellipse class="prep-hm-green" cx="${x1}" cy="${yMid2}" rx="${(gw / 2).toFixed(1)}" ry="11"/>`
    );
    parts.push(
      `<line x1="${x1}" y1="${(yMid2 - 22).toFixed(1)}" x2="${x1}" y2="${yMid2}" stroke="rgba(255,255,255,0.7)" stroke-width="1.4"/>` +
      `<path class="prep-hm-flag" d="M ${x1} ${yMid2 - 22} l 9 3.5 l -9 3.5 Z"/>`
    );
    parts.push(
      `<text class="prep-hm-club" x="${x0}" y="${H - 4}" text-anchor="start">Tee</text>` +
      `<text class="prep-hm-club" x="${x1}" y="${H - 4}" text-anchor="end">${effYd} yd</text>`
    );

    return `<svg class="prep-holemap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hole ${h.number} map, ${effYd} yards">${parts.join('')}</svg>`;
  }

  // v1.15.3: bag-category helpers shared by the map AND the plan pills —
  // one classification, one palette, everywhere.
  function clubCatOf(name) {
    const n2 = String(name || '').toLowerCase().trim();
    const base = n2.replace(/\s*·.*$/, '').trim();
    if (/putt/.test(n2)) return 'putter';
    if (/wedge|°/.test(n2)) return 'wedges';
    if (/^(pw|gw|sw|lw|aw)$/.test(base)) return 'wedges';
    if (/driver|wood|hybrid|rescue|\bd?\d*h\b/.test(n2)) return 'woods';
    return 'irons';
  }
  const CLUB_CAT_HEX = {
    woods: '#e8a63c', irons: '#5ea8ff',
    wedges: '#b48bff', putter: '#3ec98a',
  };
  // v1.16.0: holeSat.js reads this to color landing dots the same as the
  // cartoon's segments.
  window.PrepHoleCatHex = CLUB_CAT_HEX;

  function seqChipsHtml(names) {
    if (!names.length) {
      return '<div class="prep-empty">Add carry distances in the Bag tab to get a shot sequence.</div>';
    }
    // v1.15.3 (James): the pills color-coordinate with the map segments —
    // same bag-category hue per club.
    return `<div class="prep-seq-row">${names.map((n) => {
      const hex = CLUB_CAT_HEX[clubCatOf(n)] || '#5ea8ff';
      return `<span class="prep-seq-chip" style="color:${hex}"><i style="background:${hex}"></i>${escapeHtml(n)}</span>`;
    }).join('')}</div>`;
  }

  function green3dButtonHtml(h) {
    const g = h.greenLatLng;
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) {
      return '<div class="hint" style="margin-top:12px">No green mapped for this hole — 3D Green needs a pin.</div>';
    }
    let href = `greenmap.html?lat=${g.lat.toFixed(6)}&lng=${g.lng.toFixed(6)}`;
    const t = h.teeLatLng;
    if (t && Number.isFinite(t.lat) && Number.isFinite(t.lng)) {
      href += `&teelat=${t.lat.toFixed(6)}&teelng=${t.lng.toFixed(6)}`;
    }
    // v1.11.0/v1.12.0: course id (tee chips removed — tee editing now
    // lives in Check location) + hole number so the editor can persist a
    // manual tee to the right hole.
    if (h.courseId) href += `&course=${encodeURIComponent(h.courseId)}`;
    href += `&hole=${h.number}`;
    // v1.13.0 (James: "what if we have it next to the 3d green button"):
    // a compact Tee button beside 3D Green — deep-links into Check
    // location with TEE MODE PRE-ARMED (via &armtee=1), so fixing the
    // tee box is: tap Tee → tap the map → tap Load. The editor itself
    // lives there (it has the map); this is the shortcut.
    let href2 = null;
    if (g && Number.isFinite(g.lat)) {
      href2 = `greenmap.html?lat=${g.lat.toFixed(6)}&lng=${g.lng.toFixed(6)}`;
      if (t && Number.isFinite(t.lat) && Number.isFinite(t.lng)) {
        href2 += `&teelat=${t.lat.toFixed(6)}&teelng=${t.lng.toFixed(6)}`;
      }
      if (h.courseId) href2 += `&course=${encodeURIComponent(h.courseId)}`;
      href2 += `&hole=${h.number}&armtee=1`;
    }
    const teeBtn = href2
      ? `<a class="ghost-btn prep-tee-btn" id="prepTeeBtn" href="${href2}" title="Place your tee box on a map"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Move tee</a>`
      : '';
    return `${teeBtn}<a class="primary-btn prep-3d-btn" id="prep3dGreenBtn" href="${href}">` +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">' +
      '<path d="M3 17c3-2.6 6-2.6 9 0s6 2.6 9 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 14V5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 4.2l4.2 2.3L12 8.8z" fill="currentColor"/></svg>' +
      '3D Green</a>';
  }

  // v1.21.0: shared geometry math for the "is this ON the hole" tests.
  // Strip = the hole's path offset ±20 yd each side (matches the map
  // clip). Point-in-ring in the along/cross plane. The cartoon builds
  // the same corridor internally, so the list and the map can never
  // disagree.
  const STRIP_YD = 20;
  function hazPointOnStrip(hz, h) {
    if (!h || !Array.isArray(h.pathPts) || h.pathPts.length < 2) return true;
    if (!hz || !Number.isFinite(hz.lat) || !Number.isFinite(hz.lng)) return true;
    const anchor = h.pathPts[0];
    const mLat = 111320;
    const mLng = 111320 * Math.cos(anchor.lat * Math.PI / 180);
    const en = (ll) => ({
      x: ((ll.lng - anchor.lng) * mLng) / 0.9144,
      y: ((ll.lat - anchor.lat) * mLat) / 0.9144,
    });
    const tgt = en(h.greenLatLng || h.pathPts[h.pathPts.length - 1]);
    const L = Math.hypot(tgt.x, tgt.y) || 1e-9;
    const ux = tgt.x / L, uy = tgt.y / L;
    const px = uy, py = -ux;
    const toAC = (ll) => {
      const p = en(ll);
      return { along: p.x * ux + p.y * uy, cross: p.x * px + p.y * py };
    };
    const acPts = h.pathPts.map(toAC);
    {
      const first = acPts[0], second = acPts[1];
      const d0 = Math.hypot(second.along - first.along,
        second.cross - first.cross) || 1e-9;
      acPts.unshift({
        along: first.along - ((second.along - first.along) / d0) * STRIP_YD,
        cross: first.cross - ((second.cross - first.cross) / d0) * STRIP_YD,
      });
      const last = acPts[acPts.length - 1];
      const prev = acPts[acPts.length - 2];
      const dN = Math.hypot(last.along - prev.along,
        last.cross - prev.cross) || 1e-9;
      acPts.push({
        along: last.along + ((last.along - prev.along) / dN) * STRIP_YD,
        cross: last.cross + ((last.cross - prev.cross) / dN) * STRIP_YD,
      });
    }
    const ring = (() => {
      const left = [], right = [];
      for (let i = 0; i < acPts.length; i++) {
        let dx, dy;
        if (i === 0) {
          dx = acPts[1].along - acPts[0].along;
          dy = acPts[1].cross - acPts[0].cross;
        } else if (i === acPts.length - 1) {
          dx = acPts[i].along - acPts[i - 1].along;
          dy = acPts[i].cross - acPts[i - 1].cross;
        } else {
          dx = acPts[i + 1].along - acPts[i - 1].along;
          dy = acPts[i + 1].cross - acPts[i - 1].cross;
        }
        const len = Math.hypot(dx, dy) || 1e-9;
        const nx = -dy / len, ny = dx / len;
        left.push({
          along: acPts[i].along + nx * STRIP_YD,
          cross: acPts[i].cross + ny * STRIP_YD,
        });
        right.push({
          along: acPts[i].along - nx * STRIP_YD,
          cross: acPts[i].cross - ny * STRIP_YD,
        });
      }
      return left.concat(right.reverse());
    })();
    const p = toAC(hz);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.cross > p.cross) !== (b.cross > p.cross) &&
          p.along < ((b.along - a.along) * (p.cross - a.cross)) /
            ((b.cross - a.cross) || 1e-12) + a.along) {
        inside = !inside;
      }
    }
    return inside;
  }

  function renderStrategy() {
    const card = $('prepStrategyCard');
    if (!card) return;
    if (!(boundHole)) {
      card.hidden = true;
      return;
    }
    const h = boundHole;
    card.hidden = false;
    $('prepStratTitleText').textContent = `Hole ${h.number}`;
    $('prepStratChip').textContent = h.par ? `Par ${h.par}` : 'Par —';

    const body = [];
    // v1.9.0 (honest unmapped state): a hole with no yards and no green
    // data gets a straight answer + what still works, not dead boxes.
    const g0 = h.green || {};
    const unmapped = !h.yards && g0.front == null && g0.center == null &&
      g0.back == null;
    if (unmapped) {
      body.push(
        `<div class="prep-strat-advice">Hole ${h.number} isn't mapped — no yardage, green, or hazards on record.</div>`
      );
      body.push(green3dButtonHtml(h));
      $('prepStratBody').innerHTML = body.join('');
      wireBackButton();
      return;
    }

    const metaBits = [
      h.par ? `Par ${h.par}` : null,
      h.yards ? `${Math.round(h.yards)} yd` : null,
      h.strokeIndex ? `SI ${h.strokeIndex}` : null,
      currentBearing() ? `${compass16(currentBearing())} off the tee` : null,
    ].filter(Boolean);
    body.push(
      `<div class="prep-strat-meta">${metaBits.map((b) => `<span class="prep-strat-chip">${escapeHtml(b)}</span>`).join('')}</div>`
    );
    // v1.12.0: tee chips/nudge row removed — tee editing lives in Check
    // location ("Move tee" → tap the map → Load). holeInfo's yards and
    // carries already reflect the manual tee the player saved.

    const names = seqNames(h);
    const map = holeMapSvg(h, names);
    if (map) {
      // v1.8.0: ELEV chip rides the map's top-right corner — one glance
      // shows tee→green rise/fall next to the yardage.
      // v1.16.0 (James: "allow the user to tap the hole map which would
      // bring up a satellite view of the hole, kind of like check
      // location, but it would look similar to the play tab"): the map
      // is TAPPABLE — tap opens the satellite sheet (prepHoleSatSheet).
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Hole map</div>');
      body.push('<div class="prep-hm-wrap" id="prepHoleMapTap" role="button" tabindex="0" aria-label="Open satellite view of this hole">' + map +
        (geDeltaHole === h.number ? `<div class="prep-hm-elev">${deltaChipHtml()}</div>` : '') +
        '</div>');
      body.push('</div>');
    } else if (geDeltaHole === h.number && deltaChipHtml()) {
      // No map (unmapped yardage) but a delta exists — show the chip alone.
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Elevation</div>' +
        deltaChipHtml() + '</div>');
    }

    // v1.16.0: Hazards moved DIRECTLY under the hole map (James) —
    // they're location info, not decision info; the plan below stays lean.
    // (haz is declared later, just before the plan, in the mapped branch —
    // hoist a local read here for unmapped holes.)
    // v1.21.0 (James: the list matches the map): a hazard chip shows
    // only if the hazard sits inside the same 20 yd strip the cartoon
    // clips to. Not drawn → not listed.
    const hzHere = (Array.isArray(h.hazards) ? h.hazards : [])
      .filter((hz) => hazPointOnStrip(hz, h));
    body.push('<div class="prep-section-gap"><div class="prep-mini-label">Hazards in play</div>');
    if (hzHere.length) {
      body.push(
        `<div class="prep-hz-list">${hzHere
          .map(
            (hz) =>
              `<div class="prep-hz${hz.type === 'water' ? ' water' : ''}">` +
              `<span class="prep-hz-dot"></span><span>${escapeHtml(hz.label)}</span>` +
              (hz.sub ? `<span class="prep-hz-sub">${escapeHtml(hz.sub)}</span>` : '') +
              '</div>'
          )
          .join('')}</div>`
      );
    } else {
      body.push('<div class="prep-empty">None marked for this hole — swing free.</div>');
    }
    body.push('</div>');

    body.push('<div class="prep-section-gap"><div class="prep-mini-label">How to play it</div>');
    body.push(seqChipsHtml(names));
    body.push('</div>');

    // v1.15.0 (shot plan — James: the advice "is so basic it just says
    // lay up"): the plan walks the ACTUAL shot sequence and gives each
    // shot a job — target number, plays-like, and the WHY (hazards near
    // the landing zone, dogleg shape, green depth, conditions). The tee
    // box and approach each get their own reasoning.
    let teeCalc = null;
    const effYd = h.yards ? Math.round(h.yards) : 0;
    const haz = Array.isArray(h.hazards) ? h.hazards : [];
    const hzAlong = (hz) => Number.isFinite(hz.along)
      ? hz.along : hazardAlongYd(hz.sub);
    if (effYd) {
      teeCalc = solve(effYd);
      const seq = planSequenceFor(effYd, names);
      const landingNotes = (fromYd, toYd) => {
        // hazards whose along sits within the landing window
        const near = haz.filter((hz) => {
          const a = hzAlong(hz);
          return a != null && a >= fromYd - 12 && a <= toYd + 12;
        });
        if (!near.length) return '';
        const w = near.find((x) => x.type === 'water');
        const b = near.find((x) => x.type !== 'water');
        const hz = w || b;
        const a = hzAlong(hz);
        const side = /right/.test(hz.sub || '') ? 'right'
          : /left/.test(hz.sub || '') ? 'left' : 'on the line';
        return `${w ? 'Water' : 'Bunker'} ${side} at ~${Math.round(a)} yd — ${
          w ? 'take enough club to clear it or lay back short'
            : 'keep your line away from it'}`;
      };
      const lines = [];
      let prev = 0;
      _planShotYds = [];
      // v1.15.3 (James: "on my approach shot it doesn't tell me which
      // side of the green to favor because of the slope"): the APPROACH
      // row (last shot) gets a favor line from the green brief — the
      // green's LiDAR feed (breakIn + means right) implies the HIGH side
      // to favor. "Green feeds right → favor the left."
      const briefApproach = readGreenBrief(h);
      const approachFavor = (() => {
        if (!briefApproach) return '';
        const zones = Array.isArray(briefApproach.zones)
          ? briefApproach.zones : [];
        const z = zones.find((zz) => zz && zz.id === 'middle') ||
          zones[0] || null;
        const br = z && Number.isFinite(z.breakIn) ? z.breakIn : null;
        if (br == null || Math.abs(br) < 1.5) return '';
        const favor = br > 0 ? 'left' : 'right';
        const inches = Math.round(Math.abs(br));
        return `Favor the ${favor} side — the green feeds ${br > 0 ? 'right' : 'left'} ~${inches} in`;
      })();
      seq.forEach((shotName, idx) => {
        const isLast = idx === seq.length - 1;
        const segYd = isLast ? effYd - prev : Math.min(
          clubYardsFor(shotName) || effYd - prev, effYd - prev);
        _planShotYds.push(Math.round(segYd));
        const toYd = prev + segYd;
        const calc = solve(segYd);
        const delta = Math.round(calc.playsLikeYd - segYd);
        const windTxt = Math.abs(delta) >= 2
          ? `plays ${fmt(calc.playsLikeYd)} (${delta > 0 ? '+' : ''}${delta})`
          : 'plays true';
        // v1.15.4 (James: "expand more on the advice given"): richer
        // per-shot reasoning, layered:
        //   1. approach → green-favor from LiDAR + depth
        //   2. hazards in this shot's landing window
        //   3. dogleg shape context for the tee shot
        //   4. wind already shown via plays-like delta
        let note = '';
        if (isLast) {
          if (approachFavor) note = approachFavor;
          if (g0.depth != null && g0.depth >= 26) {
            note = note ? note + '; deep green — attack the pin' :
              'Deep green (~' + Math.round(g0.depth) + ' yd) — attack the pin';
          }
        }
        if (!note) note = landingNotes(prev, toYd);
        if (!note && idx === 0 && h.pathPts && h.pathPts.length >= 3) {
          // dogleg direction from the path: lateral offset of the
          // midpoint relative to the tee→green chord (+ = right)
          const mid = h.pathPts[Math.floor(h.pathPts.length / 2)];
          const mLat = 110540;
          const mLng = 111320 * Math.cos(h.pathPts[0].lat * Math.PI / 180);
          const ax = (h.greenLatLng.lng - h.pathPts[0].lng) * mLng;
          const ay = (h.greenLatLng.lat - h.pathPts[0].lat) * mLat;
          const L = Math.hypot(ax, ay) || 1e-9;
          const ux = ax / L, uy = ay / L;
          const mxp = (mid.lng - h.pathPts[0].lng) * mLng;
          const myp = (mid.lat - h.pathPts[0].lat) * mLat;
          const side = mxp * uy - myp * ux;   // + = left of chord (rot -90)
          const leftish = side > 0;
          note = `dogleg ${leftish ? 'left' : 'right'} — play the ${
            leftish ? 'left' : 'right'} edge for the short turn-in`;
        }
        // v1.15.1 (James: "the number box is useless — let users tap the
        // shots caddy recommends and that's what the number reflects"):
        // each plan row is a BUTTON. Tapping it loads that shot into the
        // inline number (expanded in place).
        lines.push(
          `<button type="button" class="prep-plan-shot${planShotIdx === idx ? ' chosen' : ''}" data-shot="${idx}">` +
          `<span class="prep-plan-club">${escapeHtml(clubShort(shotName))}</span>` +
          `<span class="prep-plan-num">${fmt(segYd)} yd</span>` +
          `<span class="prep-plan-sub">${windTxt}${note ? ' · ' + escapeHtml(note) : ''}</span>` +
          `</button>`
        );
        prev = toYd;
      });
      // v1.16.1 (James: "I'm seeing duplicates of the clubs"): the tee-box
      // fold-in pushed the plan TWICE — once at the original push (line
      // above) and again after mutating lines[0]. Push once.
      if (teeCalc && lines.length) {
        const teeRec = api.recommendClub(teeCalc.playsLikeYd);
        const delta = Math.round(teeCalc.playsLikeYd - effYd);
        const why = Math.abs(delta) >= 2
          ? `${delta >= 0 ? '+' : ''}${delta} yd — ${clubShort(teeRec.main)}`
          : `${clubShort(teeRec.main)} — plays true`;
        const first = lines[0];
        lines[0] = first.replace(
          /(<span class="prep-plan-sub">)[^<]*(<\/span>)/,
          `$1${escapeHtml(why)}$2`);
      }
      body.push(`<div class="prep-plan">${lines.join('')}</div>`);
    }

    // v1.17.0 (James: "that green advice box… it's so generic"): a real
    // caddie read — flowing sentences built from the data we already
    // hold: the tee→green delta (USGS), the dogleg shape (path), the
    // green's slope feed (LiDAR brief), green depth, and the surface.
    // Deduped against the plan rows (no repeating their notes).
    {
      const g2 = h.green || {};
      const s = [];
      // 1. The hole shape: length + dogleg turn (path midpoint vs chord).
      let turnTxt = '';
      if (Array.isArray(h.pathPts) && h.pathPts.length >= 3 &&
          h.greenLatLng && h.pathPts[0]) {
        const mid = h.pathPts[Math.floor(h.pathPts.length / 2)];
        const mLat = 110540;
        const mLng = 111320 * Math.cos(h.pathPts[0].lat * Math.PI / 180);
        const ax = (h.greenLatLng.lng - h.pathPts[0].lng) * mLng;
        const ay = (h.greenLatLng.lat - h.pathPts[0].lat) * mLat;
        const L = Math.hypot(ax, ay) || 1e-9;
        const mxp = (mid.lng - h.pathPts[0].lng) * mLng;
        const myp = (mid.lat - h.pathPts[0].lat) * mLat;
        // + = left of the chord (perp rotated -90° of the tee→green axis)
        const side = (mxp * (ay / L) - myp * (ax / L)) * -1;
        if (Math.abs(side) > 18) {
          const d = Math.round(Math.abs(side) / 0.9144);
          turnTxt = `turns ${side > 0 ? 'left' : 'right'} (~${d} yd of bend at the apex)`;
        }
      }
      // 2. The elevation story (USGS delta chip).
      const elevFt = Number(cond.elevFt) || 0;
      // 2b. v1.19.2 (James: "does it know that I'm going to be hitting
      // over it?"): WATER CARRY CHECK — walk the straight tee→pin line
      // and test the water polygons. If the line crosses, the read says
      // where the carry starts and what must be cleared. Real course
      // intelligence from the shapes we now store.
      const carryTxt = (() => {
        if (!h.teeLatLng || !h.greenLatLng || !h.shapes ||
            !Array.isArray(h.shapes.water) || !h.shapes.water.length) {
          return '';
        }
        const t = h.teeLatLng, g = h.greenLatLng;
        const mLat = 110540;
        const mLng = 111320 * Math.cos(t.lat * Math.PI / 180);
        const pointInRing = (lat, lng, ring) => {
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const yi = ring[i].lat, xi = ring[i].lng;
            const yj = ring[j].lat, xj = ring[j].lng;
            if (((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) {
              inside = !inside;
            }
          }
          return inside;
        };
        let firstYd = null, lastYd = null;
        for (let yy = 3; yy <= effYd; yy += 3) {
          const fr = yy / effYd;
          const lat = t.lat + (g.lat - t.lat) * fr;
          const lng = t.lng + (g.lng - t.lng) * fr;
          const over = h.shapes.water.some((ring) =>
            Array.isArray(ring) && ring.length >= 3 &&
            pointInRing(lat, lng, ring));
          if (over) {
            if (firstYd == null) firstYd = yy;
            lastYd = yy;
          }
        }
        if (firstYd == null) return '';
        const runLen = lastYd - firstYd;
        if (runLen < 8) {
          // grazing the edge — not a forced carry worth calling out
          return '';
        }
        const clearYd = lastYd + 8;
        // v1.20.1 (James: "the pond is still incorrect?" — the drawn
        // pond only grazed the line but the text implied a full carry):
        // distinguish a graze (<25 yd of water on the line) from a true
        // forced carry.
        if (runLen < 25) {
          return `Your line clips the water's corner from ~${Math.round(firstYd)} yd out — clear ~${Math.round(clearYd)} yd and it's never in play`;
        }
        return `Your line carries water from ~${Math.round(firstYd)} yd out — take the club that clears ~${Math.round(clearYd)} yd with room to spare`;
      })();
      // 3. The green's slope feed (LiDAR brief).
      const br = (() => {
        const b = readGreenBrief(h);
        const zones = b && Array.isArray(b.zones) ? b.zones : [];
        const z = zones.find((zz) => zz && zz.id === 'middle') || null;
        return z && Number.isFinite(z.breakIn) ? z.breakIn : null;
      })();
      if (effYd) {
        const open = `You're playing ${Math.round(effYd)} yd${
          turnTxt ? `, a hole that ${turnTxt}` : ''}.`;
        s.push(open);
      }
      if (elevFt !== 0) {
        s.push(`Tee to green you're ${Math.abs(Math.round(elevFt))} ft ${
          elevFt > 0 ? 'uphill — take one more club than the card says' :
          'downhill — the ball will run, club down'}.`);
      }
      // v1.19.2: the water-carry sentence leads if present — it changes
      // club selection more than anything else on the card.
      if (carryTxt) s.push(`${carryTxt}.`);
      if (br != null && Math.abs(br) >= 1.5) {
        s.push(`The green feeds ${br > 0 ? 'right' : 'left'} ~${Math.round(Math.abs(br))} in from the middle — miss on the ${
          br > 0 ? 'left' : 'right'} and the slope brings you back.`);
      }
      if (g2.depth != null) {
        if (g2.depth >= 26) s.push(`It's a deep target (~${Math.round(g2.depth)} yd) — you can fire at the pin.`);
        else if (g2.depth <= 14) s.push(`It's shallow (~${Math.round(g2.depth)} yd) — the number matters more than the line.`);
      }
      if (cond.surface === 'soft') s.push('Soft turf: trust the carry, expect no run-out.');
      else if (cond.surface === 'firm') s.push('Firm turf: land it short of your spot and let it release.');
      body.push(`<div class="prep-strat-advice">${
        s.length ? s.map(escapeHtml).join(' ') :
        'Nothing fancy on this one — pick a line and swing.'}</div>`);
    }

    // v1.16.1 (James: 3D Green + Move tee live inside the satellite
    // sheet now) — buttons removed from the mapped card too.
    $('prepStratBody').innerHTML = body.join('');
    wireBackButton();
    wireHoleMapTap();
  }

  // v1.16.0 (James: tap the hole map → satellite view of the hole):
  // exposes the plan's landing points (lat/lng + bag color) so the
  // satellite sheet can draw them, and wires the cartoon as the tap
  // target. Requires holeSat.js (window.PrepHoleSat).
  function wireHoleMapTap() {
    const tap = document.getElementById('prepHoleMapTap');
    if (!tap) return;
    const open = () => {
      if (!boundHole || typeof window.PrepHoleSat === 'undefined') return;
      // landing dots: walk the plan splits against the real path
      const landing = [];
      try {
        if (Array.isArray(boundHole.pathPts) && boundHole.pathPts.length >= 2) {
          const mLat = 110540;
          const mLng = 111320 *
            Math.cos(boundHole.pathPts[0].lat * Math.PI / 180);
          const acc = [0];
          for (let i = 1; i < boundHole.pathPts.length; i++) {
            const a = boundHole.pathPts[i - 1], b = boundHole.pathPts[i];
            acc.push(acc[i - 1] + Math.hypot(
              (b.lng - a.lng) * mLng, (b.lat - a.lat) * mLat) / 0.9144);
          }
          const names = seqNames(boundHole);
          const total = acc[acc.length - 1] || 1;
          const effYd = Number(boundHole.yards) || total;
          const share = Math.min(1, effYd / total);
          names.forEach((nm, i) => {
            const d0 = (total * i) / names.length * share;
            const d1 = (total * (i + 1)) / names.length * share;
            // landing = path point at d1
            let best = boundHole.pathPts[boundHole.pathPts.length - 1];
            let bd = Infinity;
            for (let k = 0; k < boundHole.pathPts.length; k++) {
              const dd = Math.abs(acc[k] - d1);
              if (dd < bd) { bd = dd; best = boundHole.pathPts[k]; }
            }
            const hex = (window.PrepHoleCatHex &&
              window.PrepHoleCatHex[clubCatOf(nm)]) || '#5ea8ff';
            // v1.17.1 (James: "driver says 194yd and gw 387?"): the tag
            // must show the SHOT'S CARRY (the plan row number), not the
            // from-tee distance. _planShotYds[i] is exactly that.
            const carryYd = Array.isArray(_planShotYds) &&
              Number.isFinite(_planShotYds[i]) ? _planShotYds[i] : null;
            // dispersion: per-axis 1σ from the bag bridge (shot-log
            // posterior when the club has samples, prior otherwise).
            const sig = clubSigmas(nm);
            landing.push({
              lat: best.lat, lng: best.lng, hex,
              label: clubShort(nm),
              yd: carryYd,
              sigAlongYd: sig ? sig.along : null,
              sigCrossYd: sig ? sig.cross : null,
              bearingDeg: (i === 0)
                ? (boundHole.bearing || null)
                : segBearing(best, i),
            });
          });
        }
      } catch (e) { /* dots are garnish */ }
      // v1.17.0: the sheet reads this — the earlier build computed the
      // dots but never handed them over (they never drew).
      window.__prepPlanLanding = landing;
      // v1.17.1: DIRECT hole payload — no localStorage round-trip (that
      // was the first-tap-empty/second-tap-loaded bug).
      window.PrepHoleSat.open({
        greenLatLng: boundHole.greenLatLng,
        courseId: boundHole.courseId,
        hole: boundHole.number,
        holeData: {
          par: boundHole.par || null,
          yards: boundHole.yards || null,
          pathPts: boundHole.pathPts || null,
          greenRingPts: boundHole.greenRingPts || null,
          // v1.19.0: REAL OSM polygons (fairway/bunker/water/tee/rough).
          shapes: boundHole.shapes || null,
          teePoint: boundHole.teeLatLng
            ? { lat: boundHole.teeLatLng.lat,
                lng: boundHole.teeLatLng.lng } : null,
          greenCenter: boundHole.greenLatLng
            ? { lat: boundHole.greenLatLng.lat,
                lng: boundHole.greenLatLng.lng } : null,
          hazards: (Array.isArray(boundHole.hazards)
            ? boundHole.hazards : []).filter((hz) =>
              hz && Number.isFinite(hz.lat) && Number.isFinite(hz.lng)),
        },
        teeLL: boundHole.teeLatLng,
      });
      haptic(6);
      // v1.18.0 (James: "why rely on me opening the 3d green?"): run the
      // FULL green-brief pipeline invisibly — USGS patch → gradient
      // field → putt sim → persist in the 3D-tool's exact schema. One
      // fetch per green, cached; later opens instant.
      runGreenBriefAuto(boundHole);
    };
    tap.addEventListener('click', open);
    tap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  // v1.18.0: per-axis 1σ for a club — along/cross, from the shot-log
  // posterior when the club has samples, else the same prior Play uses.
  // Read through the bag bridge so prep never touches app state.
  function clubSigmas(name) {
    if (typeof api.clubSigmas !== 'function') return null;
    try { return api.clubSigmas(name); } catch (e) { return null; }
  }

  // Initial bearing (deg) from point a to point b — for ellipse rotation
  // of approach-shot landing zones.
  function segBearing(toLL, idx) {
    void idx;
    if (!toLL || !boundHole || !boundHole.greenLatLng) return null;
    const mLat = 110540;
    const mLng = 111320 * Math.cos(toLL.lat * Math.PI / 180);
    const de = (boundHole.greenLatLng.lng - toLL.lng) * mLng;
    const dn = (boundHole.greenLatLng.lat - toLL.lat) * mLat;
    if (Math.hypot(de, dn) < 1e-6) return null;
    return (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
  }

  // v1.18.0: invisible green-brief pipeline. Runs the whole 3D-Green
  // data path (USGS patch → gradient field → putt sim → persist in the
  // tool's exact schema) WITHOUT opening the tool. Skips if a fresh
  // brief already exists (< 30 days) or a build is in flight.
  let _briefInFlight = null;
  function runGreenBriefAuto(h) {
    if (!h || !h.greenLatLng || typeof window.GreenBriefCore ===
      'undefined') return;
    const existing = window.GreenBriefCore.briefFor(h.greenLatLng);
    const FRESH_MS = 30 * 24 * 3600 * 1000;
    if (existing && Date.now() - (existing.savedAt || 0) < FRESH_MS) return;
    if (_briefInFlight) return;
    _briefInFlight = (async () => {
      try {
        await window.GreenBriefCore.build({
          teeLL: h.teeLatLng,
          centerLL: h.greenLatLng,
          radiusM: 18,
          polyLL: Array.isArray(h.greenRingPts) ? h.greenRingPts : null,
        });
      } catch (e) { /* silent: advice falls back to slope-free wording */ }
      _briefInFlight = null;
    })();
  }

  function wireBackButton() {
    // v1.15.0: the "All holes" button is gone — the hole number in the
    // card header IS the back navigation (bigger tap target, one less
    // button). The id is kept so the wiring stays in one place.
    const back = $('prepStratTitle') || $('prepBackHoles');
    if (!back) return;
    back.addEventListener('click', () => {
      boundHole = null;
      const detail = document.getElementById('planDetailCard');
      if (detail) detail.hidden = true;
      paintControls();
      paintTarget();
      haptic(5);
    });
  }

  /* ======================================================================
     MAIN PIPELINE
     ====================================================================== */
  // v-fix(recompute-debounce) v1.5.3 (audit #20): wind/temp sliders fire
  // recompute per pixel-step; each recompute runs up to 4 full playsLike
  // solves. During a drag we throttle to one pipeline run per 120 ms and
  // always settle exactly once after the last tick.
  let _rcThrottle = null, _rcSettle = null;
  function recompute({ pulse = false } = {}) {
    clearTimeout(_rcSettle);
    if (_rcThrottle) {
      _rcSettle = setTimeout(() => { _rcThrottle = null; recompute({ pulse: false }); }, 140);
      return;
    }
    _rcThrottle = setTimeout(() => { _rcThrottle = null; }, 120);
    recomputeNow({ pulse });
  }
  function recomputeNow({ pulse = false } = {}) {
    // v1.15.2: the number UI lives inside the selected shot row. With no
    // shot selected there IS no number UI (the plan rows show every
    // number at rest) — writes are skipped.
    ensureNumberElements();
    const yd = currentTargetYd();
    const hasUI = planShotIdx >= 0 &&
      document.getElementById('prepRecMain') != null;
    if (!yd || !hasUI) {
      renderStrategy();
      ensureNumberElements();
      return;
    }
    const calc = solve(yd);
    const rec = api.recommendClub(calc.playsLikeYd);
    // v1.15.2: renderStrategy rebuilds prepStratBody (plan rows) — run it
    // FIRST, then ensure the number UI exists in the chosen row, then
    // write the values (renderRecommendation targets whatever ids exist).
    renderStrategy();
    ensureNumberElements();
    renderRecommendation(calc, rec, pulse);
  }

  /* ======================================================================
     PLANNER BINDING — follow the Hole planner selection without touching
     any of its code. Click delegation fires AFTER the planner's own button
     handler has updated #planDetailTitle, and a MutationObserver collapses
     our binding when the course card closes (course change etc.).
     ====================================================================== */
  let prepSearching = false;

  // v1.10.0 (tee box fairness): the importer's default tee set is usually
  // the women's. Two fixes, both data-driven:
  //   1. Tee-set switcher chips (Red/White/Blue…) from the stored teeSets.
  //   2. A ± yards nudge for single-set courses (or fine-tuning within a
  //      set) — "playing +15 yd from card". Persisted per course.
  /* ======================================================================
     v1.12.0: tee chips + nudge stepper REMOVED per James — "allow the
     user to edit the tee just like when a round is active". Tee editing
     now lives in Check location (Move tee → tap map → Load), persisted
     to the course hole as a manual tee; Prep reads it via holeInfo.
     ====================================================================== */

  function syncPrepChrome() {
    const sel = document.getElementById('planCourseSelect');
    const hasCourse = !!(sel && sel.value);
    const boundHead = document.getElementById('prepBoundHead');
    const searchPane = document.getElementById('prepSearchPane');
    const courseCard = document.getElementById('planCourseCard');
    const nameEl = document.getElementById('prepBoundTitle');
    const courseName = document.getElementById('planCourseName');
    const changeBtn = document.getElementById('prepChangeCourse');

    // v-fix(mo-loop) v1.7.4 (James: hole tap freezes the app): every write
    // below is now CHANGE-GUARDED. The observer on planCourseCard fires
    // unbindHoleIfGone → syncPrepChrome; a same-value hidden/textContent
    // write must never re-queue a mutation record, or the callback feeds
    // itself forever (microtask storm = the freeze).
    if (boundHead) {
      if (boundHead.hidden !== !hasCourse) boundHead.hidden = !hasCourse;
    }
    if (nameEl && courseName && hasCourse &&
        nameEl.textContent !== (courseName.textContent || 'Course'))
      nameEl.textContent = courseName.textContent || 'Course';
    if (searchPane) {
      const want = hasCourse && !prepSearching;
      if (searchPane.hidden !== want) searchPane.hidden = want;
    }
    if (changeBtn) {
      const label = prepSearching ? 'Done' : 'Change';
      if (changeBtn.textContent !== label) changeBtn.textContent = label;
    }
    if (courseCard && hasCourse) {
      const want = prepSearching || !!boundHole;
      if (courseCard.hidden !== want) courseCard.hidden = want;
    }
  }

  function bindHole(number) {
    const info = api.holeInfo(number);
    if (!info) return;
    boundHole = info;
    prepSearching = false;
    shot.greenPoint = 'middle';
    persist();
    // v-fix(tap-freeze) v1.7.3 (James: "when I tap one of the holes the app
    // freezes"): the solve pipeline (4 full playsLike + 4 recommendClub
    // searches, each ~4k expected-strokes evaluations) ran SYNCHRONOUSLY
    // in the tap handler — on iPhone that's a multi-second main-thread
    // stall: the tap looks frozen. Paint the hole UI FIRST, then run the
    // math on the next task so the header/card appear instantly.
    paintControls();
    paintTarget();
    fetchGreenDelta(); // lazy + cancellable; chip lands when it lands
    setTimeout(() => {
      recompute({ pulse: true });
    }, 0);
  }

  function unbindHoleIfGone() {
    const sel = document.getElementById('planCourseSelect');
    // Course gone (picker cleared) — drop the hole. While a hole brief is
    // open we hide the scorecard ourselves, so don't treat that as unbound.
    if (!boundHole) {
      syncPrepChrome();
      return;
    }
    if (!(sel && sel.value)) {
      boundHole = null;
      paintControls();
      paintTarget();
      renderStrategy();
      fetchGreenDelta();
    } else {
      syncPrepChrome();
    }
  }

  function wirePlannerBridge() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.plan-hole-row');
      if (!row) return;
      bindHole(Number(row.dataset.hole));
    }, true);

    const changeBtn = document.getElementById('prepChangeCourse');
    if (changeBtn) {
      changeBtn.addEventListener('click', () => {
        prepSearching = !prepSearching;
        if (prepSearching) {
          boundHole = null;
          const detail = document.getElementById('planDetailCard');
          if (detail) detail.hidden = true;
          const search = document.getElementById('planCourseSearch');
          if (search) {
            try { search.focus(); } catch { }
          }
        }
        haptic(5);
        paintControls();
        paintTarget();
      });
    }

    const sel = document.getElementById('planCourseSelect');
    if (sel) {
      sel.addEventListener('change', () => {
        prepSearching = false;
        boundHole = null;
        queueMicrotask(() => {
          paintTarget();
        });
      });
    }

    const courseCard = document.getElementById('planCourseCard');
    if (courseCard && typeof MutationObserver !== 'undefined') {
      // v-fix(mo-loop) v1.7.4: disconnect while reacting. The callback's
      // own hidden/textContent writes must never be observed by itself —
      // a self-feeding observer is a microtask storm (app freeze).
      const mo = new MutationObserver(() => {
        mo.disconnect();
        try {
          if (courseCard && !courseCard.hidden) prepSearching = false;
          unbindHoleIfGone();
        } finally {
          mo.observe(courseCard, {
            attributes: true,
            attributeFilter: ['hidden'],
          });
        }
      });
      mo.observe(courseCard, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    }
    syncPrepChrome();
  }

  /* ======================================================================
     TEE→GREEN ELEVATION DELTA (v1.8.0 — replaces the old Green Map card)
     One number, fetched lazily per hole, surfaced in the Hole brief next
     to the yardage. The full slope picture lives in the 3D Green view.
     ====================================================================== */
  let geAbort = null;
  let geDeltaFt = null;       // null = unknown; number once fetched
  let geDeltaHole = null;     // hole number the delta belongs to

  function deltaChipHtml() {
    if (!Number.isFinite(geDeltaFt) || Math.abs(geDeltaFt) < 1) return '';
    const up = geDeltaFt > 0;
    return `<span class="prep-elev-chip${up ? '' : ' down'}">` +
      `${up ? '↑' : '↓'} ${Math.abs(Math.round(geDeltaFt))} ft ${up ? 'uphill' : 'downhill'}</span>`;
  }

  function fetchGreenDelta() {
    if (geAbort) geAbort.abort();
    geAbort = null;
    geDeltaFt = null;
    if (!boundHole || !window.CaddyElev ||
        !boundHole.greenLatLng || !Number.isFinite(boundHole.greenLatLng.lat)) {
      paintTarget();   // clear any stale chip
      return;
    }
    const holeNum = boundHole.number;
    geDeltaHole = holeNum;
    geAbort = new AbortController();
    const myAbort = geAbort;
    window.CaddyElev.greenMap({
      teeLL: boundHole.teeLatLng,
      centerLL: boundHole.greenLatLng,
      radiusM: 13,
    }, myAbort.signal).then((gm) => {
      if (myAbort !== geAbort || geDeltaHole !== holeNum) return; // superseded
      geDeltaFt = gm && gm.deltaFt != null ? gm.deltaFt : null;
      paintTarget();   // chip appears next to the yardage
    }).catch(() => { /* silent — best-effort */ });
  }

  /* ---------- Boot ---------- */
  buildSkeleton();
  wireControls();
  paintControls();
  paintTarget();
  wirePlannerBridge();
  recompute({ pulse: true });
})();
