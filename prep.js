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
           header → map → TARGET TILES (the picker) → THE NUMBER →
           tweaks (lie/shape) → caddy notes → conditions (collapsed).
           The old Pre-shot / The-shot / Conditions boxes are merged in. -->
      <div class="card" id="prepStrategyCard" hidden>
        <div class="prep-hole-brief-head">
          <div>
            <div class="prep-kicker" style="color: var(--muted); margin-bottom: 2px">Hole brief</div>
            <h3 id="prepStratTitle" style="margin: 0">Hole strategy</h3>
          </div>
          <span class="chip" id="prepStratChip">—</span>
        </div>
        <div id="prepStratBody"></div>

        <!-- THE NUMBER — lives inside the hole card, under the target
             tiles: tap a tile, the number re-solves in place. -->
        <div class="prep-num-block" id="prepNumBlock">
          <div class="prep-kicker">The number</div>
          <div class="prep-rec-main" id="prepRecMain">—</div>
          <div id="prepEffortWrap"><span class="prep-effort-tag" id="prepEffortTag"></span></div>
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

          <!-- TWEAKS — the only two inputs that change the number -->
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
        </div>

        <!-- CONDITIONS — collapsed inside the same card; same controls,
             no separate box. Live-weather sync lives at its top. -->
        <details class="prep-cond-details" id="prepCondDetails">
        <summary>
        <div class="card-title">
          <h2>Conditions</h2>
          <span class="chip" id="prepCondChip">${compass16(cond.windFromDeg)} · ${Math.round(cond.windMph)} mph</span>
        </div>
        </summary>
        <div class="prep-cond-body">
        <button class="ghost-btn prep-live-btn" id="prepLiveBtn" type="button" style="margin-bottom: 12px">Use live weather & elevation</button>
        <div class="prep-cond-grid">
          <div class="prep-dial-wrap">${dialSvg()}</div>
          <div class="prep-cond-side">
            <div class="prep-wind-rel">
              <div class="prep-rel-tile" id="relHeadTile"><i>Head / tail</i><b id="relHeadVal">—</b></div>
              <div class="prep-rel-tile" id="relCrossTile"><i>Crosswind</i><b id="relCrossVal">—</b></div>
            </div>
            <div>
              <div class="prep-slider-row">
                <label for="prepWindRange">Wind speed</label>
                <input type="range" class="prep-range" id="prepWindRange" min="0" max="30" step="1" value="${clamp(Math.round(cond.windMph), 0, 30)}"/>
                <span class="prep-slider-val" id="prepWindVal">${Math.round(cond.windMph)} mph</span>
              </div>
              <div class="prep-preset-row" id="prepWindPresets">
                ${WIND_PRESETS.map((p) => `<button type="button" class="prep-preset${Math.abs(cond.windMph - p.mph) <= 1 ? ' active' : ''}" data-mph="${p.mph}">${p.name}</button>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top: 10px">
          <div class="prep-slider-row">
            <label for="prepTempRange">Temperature</label>
            <input type="range" class="prep-range" id="prepTempRange" min="30" max="110" step="1" value="${clamp(Math.round(cond.tempF), 30, 110)}"/>
            <span class="prep-slider-val" id="prepTempVal">${Math.round(cond.tempF)}°F</span>
          </div>
        </div>

        <div class="prep-cond-line section-gap" style="margin-top: 12px">
          <label>Course altitude</label>
          <div class="prep-stepper">
            <button type="button" class="prep-step-btn" data-step="alt" data-dir="-1">−</button>
            <span class="prep-step-val" id="prepAltVal">${fmt(cond.altFt)}<small>feet</small></span>
            <button type="button" class="prep-step-btn" data-step="alt" data-dir="1">+</button>
          </div>
        </div>

        <div class="prep-cond-line" style="margin-top: 10px">
          <label>Green vs ball</label>
          <div class="prep-stepper">
            <button type="button" class="prep-step-btn" data-step="elev" data-dir="-1">−</button>
            <span class="prep-step-val" id="prepElevVal">${sgn(cond.elevFt, 0)}<small>feet</small></span>
            <button type="button" class="prep-step-btn" data-step="elev" data-dir="1">+</button>
          </div>
        </div>

        <div class="section-gap" style="margin-top: 13px">
          <div class="prep-mini-label">Ground</div>
          <div class="prep-seg" id="prepSurfaceSeg" style="--n:${SURFACES.length}">
            <span class="prep-seg-thumb"></span>
            ${SURFACES.map((s) => `<button type="button" class="prep-seg-opt" data-surface="${s.id}">${s.name}</button>`).join('')}
          </div>
          <div class="prep-surface-note" id="prepSurfaceNote"></div>
        </div>
        </div>
        </details>
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
    paintDial();
    $('prepCondChip').textContent = `${compass16(cond.windFromDeg)} · ${Math.round(cond.windMph)} mph`;

    const wr = $('prepWindRange');
    wr.value = clamp(Math.round(cond.windMph), 0, 30);
    setSliderFill(wr);
    $('prepWindVal').textContent = `${Math.round(cond.windMph)} mph`;
    [...$('prepWindPresets').children].forEach((b) =>
      b.classList.toggle('active', Math.abs(cond.windMph - Number(b.dataset.mph)) <= 1)
    );

    const tr = $('prepTempRange');
    tr.value = clamp(Math.round(cond.tempF), 30, 110);
    setSliderFill(tr);
    $('prepTempVal').textContent = `${Math.round(cond.tempF)}°F`;

    $('prepAltVal').innerHTML = `${fmt(cond.altFt, 0)}<small>feet</small>`;
    $('prepElevVal').innerHTML = `${sgn(cond.elevFt, 0)}<small>feet</small>`;

    paintSeg('prepSurfaceSeg', 'surface', cond.surface);
    const surf = SURFACES.find((s) => s.id === cond.surface) || SURFACES[1];
    $('prepSurfaceNote').textContent = surf.note;

    [...$('prepLieRow').children].forEach((c) =>
      c.classList.toggle('active', c.dataset.lie === shot.lie)
    );
    [...$('prepShapeRow').children].forEach((c) =>
      c.classList.toggle('active', c.dataset.shape === shot.shape)
    );
  }

  function paintTarget() {
    // v1.9.0: ONE hole card. The carry tiles in the brief ARE the target
    // picker; the number block lives in the same card. No separate boxes.
    const condCard = $('prepCondDetails');
    if (!boundHole) {
      const card = $('prepStrategyCard');
      if (card) card.hidden = true;
      if (condCard) condCard.closest('.card').hidden = true;
      syncPrepChrome();
      return;
    }
    if (condCard) condCard.closest('.card').hidden = false;
    syncPrepChrome();
  }

  function wireControls() {
    wireDial();

    const onSlider = (el, fn) => {
      el.addEventListener('input', () => {
        setSliderFill(el);
        fn(Number(el.value));
      });
      el.addEventListener('change', () => haptic(5));
    };
    onSlider($('prepWindRange'), (v) => {
      cond.windMph = v;
      persist();
      paintDial();
      syncPresetChips();
      recompute({ pulse: false });
    });
    onSlider($('prepTempRange'), (v) => {
      cond.tempF = v;
      persist();
      recompute({ pulse: false });
    });

    $('prepWindPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('.prep-preset');
      if (!btn) return;
      cond.windMph = Number(btn.dataset.mph);
      haptic(5);
      persist();
      paintControls();
      recompute({ pulse: true });
    });

    studio.querySelectorAll('.prep-step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.dir);
        const kind = btn.dataset.step;
        if (kind === 'alt') cond.altFt = clamp(cond.altFt + dir * 250, 0, 12000);
        if (kind === 'elev') cond.elevFt = clamp(cond.elevFt + dir * 5, -200, 200);
        haptic(4);
        persist();
        paintControls();
        paintTarget();
        recompute({ pulse: true });
      });
    });

    $('prepSurfaceSeg').addEventListener('click', (e) => {
      const opt = e.target.closest('.prep-seg-opt');
      if (!opt) return;
      cond.surface = opt.dataset.surface;
      haptic(6);
      persist();
      paintControls();
      recompute({ pulse: true });
    });

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

    // v1.10.0 (tee fairness): tee-set chips switch the stored tee set
    // (Round agrees — same applyTeeSet path); the ± nudge shifts the
    // effective tee along the hole, persisted per course.
    $('prepStratBody').addEventListener('click', (e) => {
      const chip = e.target.closest('.prep-tee-chip');
      if (chip && chip.dataset.tee) {
        const updated = api.setTeeSet(chip.dataset.tee);
        if (updated) {
          haptic(6);
          rebindAfterTeeChange();
        }
        return;
      }
      const step = e.target.closest('.prep-tee-nudge .prep-step-btn');
      if (step && boundHole && boundHole.courseId) {
        const cur = teeNudgeLoad(boundHole.courseId);
        const next = clamp(cur + Number(step.dataset.nd || 0), -60, 60);
        teeNudgeSave(boundHole.courseId, next);
        haptic(4);
        renderStrategy();
        recompute({ pulse: true });
      }
    });

    $('prepLieRow').addEventListener('click', (e) => {
      const chip = e.target.closest('.prep-lie-chip');
      if (!chip) return;
      shot.lie = chip.dataset.lie;
      haptic(6);
      persist();
      [...$('prepLieRow').children].forEach((c) =>
        c.classList.toggle('active', c === chip)
      );
      recompute({ pulse: true });
    });

    $('prepShapeRow').addEventListener('click', (e) => {
      const chip = e.target.closest('.prep-shape-btn');
      if (!chip) return;
      shot.shape = chip.dataset.shape;
      haptic(6);
      persist();
      [...$('prepShapeRow').children].forEach((c) =>
        c.classList.toggle('active', c === chip)
      );
      recompute({ pulse: true });
    });

    $('prepLiveBtn').addEventListener('click', () => {
      const w = api.weather();
      const e = api.elevation();
      if (w && Number.isFinite(w.tempF)) cond.tempF = Math.round(clamp(w.tempF, 30, 110));
      if (w && Number.isFinite(w.windMph)) cond.windMph = Math.round(clamp(w.windMph, 0, 30));
      if (w && Number.isFinite(w.windFromDeg)) cond.windFromDeg = Math.round(norm360(w.windFromDeg));
      if (e) {
        const mid = (num(e.userFt) + num(e.targetFt)) / 2;
        if (mid > 0) cond.altFt = Math.round(clamp(mid, 0, 12000));
        cond.elevFt = Math.round(clamp(num(e.targetFt) - num(e.userFt), -200, 200));
      }
      haptic(9);
      persist();
      paintControls();
      paintTarget();
      recompute({ pulse: true });
      const btn = $('prepLiveBtn');
      btn.textContent = '✓ Live conditions loaded';
      setTimeout(() => {
        btn.textContent = 'Use live weather & elevation';
      }, 1600);
    });
  }

  function syncPresetChips() {
    [...$('prepWindPresets').children].forEach((b) =>
      b.classList.toggle('active', Math.abs(cond.windMph - Number(b.dataset.mph)) <= 1)
    );
  }

  /* ======================================================================
     5. COMPUTE PIPELINE
     ====================================================================== */
  function currentBearing() {
    return boundHole ? Math.round(num(boundHole.bearing, 0)) : 0;
  }

  function currentTargetYd() {
    if (!boundHole) return null;
    const g = boundHole.green || {};
    const pt = shot.greenPoint === 'front' ? g.front
      : shot.greenPoint === 'back' ? g.back
        : g.center;
    // v1.10.0: the tee nudge shifts every carry uniformly (tee moves
    // along the hole), so the effective target shifts with it.
    const base = pt != null ? pt
      : (boundHole.yards ? Math.round(boundHole.yards) : null);
    if (base == null || !boundHole.courseId) return base;
    return Math.max(40, base + teeNudgeLoad(boundHole.courseId));
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
    const w = api.weather();
    const key = [
      Math.round(yd * 2), currentBearing(),
      Math.round(num(cond.elevFt, 0)), Math.round(num(cond.altFt, 0) / 25),
      Math.round(num(cond.tempF, 70)), Math.round(num(cond.windMph, 0) * 2),
      Math.round(norm360(num(cond.windFromDeg, 0)) / 3),
      cond.surface,
      Math.round(num(liePenalty(), 0) * 10),
      Math.round(num(w.rh, 50) / 5), Math.round(num(w.pressureHpa, 0)),
      Math.round(num(w.shearAlpha, 0.143) * 100),
      Math.round(num(w.gustMph, 0) * 2), Math.round(num(api.locLat(), 40))
    ].join('|');
    const hit = _solveMemo.get(key);
    if (hit) return hit;
    const out = api.playsLike({
      horizontalYd: yd,
      bearingDeg: currentBearing(),
      elevDiffFt: cond.elevFt,
      courseAltitudeFt: cond.altFt,
      tempF: cond.tempF,
      rh: w.rh,
      windMph: cond.windMph,
      windFromDeg: cond.windFromDeg,
      pressureHpa: w.pressureHpa,
      shearAlpha: w.shearAlpha,
      gustMph: w.gustMph,
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

  function renderRecommendation(calc, rec) {
    // v1.9.0: the number block lives INSIDE the hole card now — the sweep
    // animation targets it, not a separate card.
    const card = $('prepNumBlock');

    // Wind-relative tiles (head/tail + cross, relative to the shot line)
    const headTile = $('relHeadTile');
    $('relHeadVal').textContent =
      Math.abs(calc.headwindMph) < 0.05
        ? 'calm'
        : `${fmt(Math.abs(calc.headwindMph), 1)} mph ${calc.headwindMph >= 0 ? 'head' : 'tail'}`;
    headTile.classList.toggle('warn', Math.abs(calc.headwindMph) >= 10);
    $('relCrossVal').textContent =
      Math.abs(calc.crosswindMph) < 1
        ? 'calm'
        : `${fmt(Math.abs(calc.crosswindMph), 1)} mph from the ${calc.crosswindMph > 0 ? 'right' : 'left'}`;

    // Headline
    const eff = effortInfo(rec.main);
    $('prepRecMain').textContent = `${fmt(calc.playsLikeYd)} yd → ${clubShort(rec.main)}`;
    $('prepEffortTag').textContent = eff.tag;
    $('prepEffortWrap').hidden = !eff.tag;

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
    const effYd = Math.round(nudgedYards(h));
    const parts = [];

    // ---- Projection helpers (shared by both modes) ----
    let P = null;   // {toXY(latlngOrAlongCross)} when real geometry exists
    if (Array.isArray(h.pathPts) && h.pathPts.length >= 3 &&
        h.teeLatLng && h.greenLatLng) {
      // Local EN plane anchored at the ACTIVE tee point (it moves with
      // tee sets), yards, rotated so tee→green is +X.
      const mLat = 111320, mLng = 111320 * Math.cos(h.teeLatLng.lat * Math.PI / 180);
      const en = (ll) => ({
        x: ((ll.lng - h.teeLatLng.lng) * mLng) / 0.9144,
        y: ((ll.lat - h.teeLatLng.lat) * mLat) / 0.9144,
      });
      const tgt = en(h.greenLatLng);
      const L = Math.hypot(tgt.x, tgt.y) || 1e-9;
      const ux = tgt.x / L, uy = tgt.y / L;        // unit toward green
      const px = -uy, py = ux;                      // perpendicular (right)
      const toXY = (ll) => {
        const p = en(ll);
        const along = p.x * ux + p.y * uy;
        const cross = p.x * px + p.y * py;
        return { along, cross };
      };
      // Fit: along 0..(dist tee→green scaled to nudged length), cross
      // clipped to a band. Scale = spanX / nudgeLen so the map stretches
      // with the tee nudge (tee is anchor at origin).
      const fitLen = Math.max(120, effYd);
      const X = (along) => x0 + spanX * clamp(along / fitLen, -0.06, 1.04);
      const Y = (cross) => yMid - clamp(cross / (fitLen * 0.22), -1.15, 1.15) * (H * 0.30);
      P = { toXY, X, Y };
    }

    if (P) {
      // ---- REAL SHAPE MODE ----
      // Fairway = the actual path.
      const d = h.pathPts.map((ll, i) => {
        const { along, cross } = P.toXY(ll);
        return (i ? 'L' : 'M') + ` ${P.X(along).toFixed(1)} ${P.Y(cross).toFixed(1)}`;
      }).join(' ');
      parts.push(`<path class="prep-hm-fairway" d="${d}" fill="none" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`);

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
      const haz = Array.isArray(h.hazards) ? h.hazards : [];
      for (const hz of haz) {
        let ax = null, ay = null;
        if (Number.isFinite(hz.lat) && Number.isFinite(hz.lng) && h.teeLatLng) {
          const pr = P.toXY(hz);
          ax = P.X(pr.along); ay = P.Y(pr.cross);
        } else {
          const along = Number.isFinite(hz.along) ? hz.along : hazardAlongYd(hz.sub);
          if (along == null || along <= 0 || along >= effYd) continue;
          const cross = Number.isFinite(hz.cross) ? hz.cross : 0;
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
      for (let i = 0; i < n; i++) {
        const d0 = (ydPerPath * i) / n * (effYd / ydPerPath);
        const d1 = (ydPerPath * (i + 1)) / n * Math.min(1, effYd / ydPerPath);
        const s0 = ptAlong(d0), s1 = ptAlong(Math.min(d1, ydPerPath * effShare));
        const p0 = { x: P.X(s0.along), y: P.Y(s0.cross) };
        const p1 = { x: P.X(s1.along), y: P.Y(s1.cross) };
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        parts.push(
          `<path class="prep-hm-shot s${i % 4}" d="M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}"/>`
        );
        parts.push(
          `<text class="prep-hm-club" x="${mx.toFixed(1)}" y="${(my + (i % 2 === 0 ? -8 : 14)).toFixed(1)}" text-anchor="middle">${escapeHtml(clubs[i])}</text>`
        );
      }

      // Tee + flag at the path's real ends.
      const teeP = P.toXY(h.teeLatLng);
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
      return `<svg class="prep-holemap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hole ${h.number} map, ${effYd} yards">${parts.join('')}</svg>`;
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
      if (along == null || along <= 0 || along >= effYd) continue;
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

  function seqChipsHtml(names) {
    if (!names.length) {
      return '<div class="prep-empty">Add carry distances in the Bag tab to get a shot sequence.</div>';
    }
    return `<div class="prep-seq-row">${names.map((n, i) =>
      `<span class="prep-seq-chip s${i % 4}"><i></i>${escapeHtml(n)}</span>`
    ).join('')}</div>`;
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
    return `<a class="primary-btn prep-3d-btn" id="prep3dGreenBtn" href="${href}">` +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">' +
      '<path d="M3 17c3-2.6 6-2.6 9 0s6 2.6 9 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 14V5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M12 4.2l4.2 2.3L12 8.8z" fill="currentColor"/></svg>' +
      '3D Green</a>';
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
    $('prepStratTitle').textContent = `Hole ${h.number}`;
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
      body.push('<button type="button" class="ghost-btn prep-back-holes" id="prepBackHoles">All holes</button>');
      $('prepStratBody').innerHTML = body.join('');
      wireBackButton();
      return;
    }

    const metaBits = [
      h.par ? `Par ${h.par}` : null,
      h.yards ? `${Math.round(nudgedYards(h))} yd` : null,
      h.strokeIndex ? `SI ${h.strokeIndex}` : null,
      currentBearing() ? `${compass16(currentBearing())} off the tee` : null,
    ].filter(Boolean);
    body.push(
      `<div class="prep-strat-meta">${metaBits.map((b) => `<span class="prep-strat-chip">${escapeHtml(b)}</span>`).join('')}</div>`
    );

    // v1.10.0 (tee fairness): tee-set chips + nudge stepper, right under
    // the meta chips. Tapping a chip or ± re-solves the whole brief.
    const teeRow = teePickerHtml(h);
    if (teeRow) body.push(teeRow);

    const names = seqNames(h);
    const map = holeMapSvg(h, names);
    if (map) {
      // v1.8.0: ELEV chip rides the map's top-right corner — one glance
      // shows tee→green rise/fall next to the yardage.
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Hole map</div>');
      body.push('<div class="prep-hm-wrap">' + map +
        (geDeltaHole === h.number ? `<div class="prep-hm-elev">${deltaChipHtml()}</div>` : '') +
        '</div>');
      body.push('</div>');
    } else if (geDeltaHole === h.number && deltaChipHtml()) {
      // No map (unmapped yardage) but a delta exists — show the chip alone.
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Elevation</div>' +
        deltaChipHtml() + '</div>');
    }

    body.push('<div class="prep-section-gap"><div class="prep-mini-label">How to play it</div>');
    body.push(seqChipsHtml(names));
    body.push('</div>');

    // Off-the-tee recommendation under current conditions
    // v-fix(dedupe-tee-solve) v1.5.3 (audit #20): the tee solve ran here AND
    // again in the water-danger check below; one call, reused.
    // v1.10.0: solves the NUDGED yardage (tee set + nudge), not card length.
    let teeCalc = null;
    const effYd = Math.round(nudgedYards(h));
    if (effYd) {
      teeCalc = solve(effYd);
      const teeRec = api.recommendClub(teeCalc.playsLikeYd);
      const eff = effortInfo(teeRec.main);
      const delta = Math.round(teeCalc.playsLikeYd - effYd);
      const why = Math.abs(delta) >= 2
        ? `${delta >= 0 ? '+' : ''}${delta} yd vs the ${effYd} yd you're playing`
        : 'plays true to the number';
      body.push(`
        <div class="prep-tee-box">
          <div class="prep-mini-label">Suggested off the tee</div>
          <div class="prep-tee-main">${escapeHtml(clubShort(teeRec.main))}</div>
          <div class="prep-tee-sub">Plays ${fmt(teeCalc.playsLikeYd)} of ${effYd} — ${why}. ${eff.note ? escapeHtml(eff.note.charAt(0).toUpperCase() + eff.note.slice(1)) + '.' : ''}</div>
        </div>`);
    }

    // Hazards
    const haz = Array.isArray(h.hazards) ? h.hazards : [];
    body.push('<div class="prep-section-gap"><div class="prep-mini-label">Hazards in play</div>');
    if (haz.length) {
      body.push(
        `<div class="prep-hz-list">${haz
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

    // Conditioned carries to each green point — v1.9.0: these tiles ARE
    // the target picker (data-point + tap-to-choose + disabled when the
    // point isn't mapped). One control instead of two.
    // v1.10.0: carries shift by the tee nudge (tee moves along the hole).
    const g = h.green || {};
    const nd = h.courseId ? teeNudgeLoad(h.courseId) : 0;
    const shift = (v) => (v == null ? null : Math.max(40, v + nd));
    const pts = [
      ['Front', 'front', shift(g.front)],
      ['Middle', 'middle', shift(g.center)],
      ['Back', 'back', shift(g.back)],
    ];
    const mapped = pts.filter(([, , v]) => v != null);
    if (mapped.length) {
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Target — tap to play it</div><div class="prep-carry-strip">');
      for (const [label, key, dist] of pts) {
        if (dist == null) {
          body.push(`<div class="prep-carry-tile" data-point="${key}" disabled><i>${label}</i>—</div>`);
          continue;
        }
        const c = solve(dist);
        body.push(
          `<button type="button" class="prep-carry-tile${shot.greenPoint === key ? ' chosen' : ''}" data-point="${key}"><i>${label}</i>${fmt(c.playsLikeYd)} yd</button>`
        );
      }
      body.push('</div></div>');
    }

    const brief = readGreenBrief(h);
    const feed = greenFeedLine(brief, shot.greenPoint);
    if (feed) {
      body.push(
        `<div class="prep-green-feed"><div class="prep-mini-label">Green</div>${escapeHtml(feed)}</div>`
      );
    } else {
      body.push(
        '<div class="prep-green-feed missing">Open 3D Green once to load slope — then advice knows which way the ball feeds.</div>'
      );
    }

    // Advisory paragraph — conditions-aware course management.
    const tips = [];
    const depth = g.depth;
    if (depth != null) {
      if (depth >= 26) tips.push(`Deep green (~${Math.round(depth)} yd) — space to be aggressive.`);
      else if (depth <= 14) tips.push(`Shallow green (~${Math.round(depth)} yd) — distance control decides it; favour the middle.`);
    }
    if (cond.surface === 'soft') {
      tips.push('Soft turf gives nothing back — trust carry, never bounce.');
    } else if (cond.surface === 'firm') {
      if (shot.greenPoint === 'front') tips.push('Firm release will run through front pins — consider targeting the middle.');
      else tips.push('Firm ground rewards landing short of your spot and letting it release.');
    }
    if (h.par === 5) tips.push('Decide the layup number NOW, not off the second shot.');
    else if (h.par === 3) tips.push('One clean strike — commit fully to the conditioned number.');

    // Carry danger callout: water near the required carry line.
    if (h.yards && cond.windMph >= 1) {
      const danger = haz.find(
        (hz) =>
          hz.type === 'water' &&
          (() => {
            const along = Number.isFinite(hz.along) ? hz.along : hazardAlongYd(hz.sub);
            return along != null && teeCalc && Math.abs(along - teeCalc.playsLikeYd) <= 12;
          })()
      );
      if (danger) {
        const along = Number.isFinite(danger.along) ? danger.along : hazardAlongYd(danger.sub);
        tips.push(`Water sits right at your carry zone (~${Math.round(along || 0)} yd) — take enough club or lay back.`);
      }
    }

    body.push(`<div class="prep-strat-advice">${tips.map(escapeHtml).join(' ') || 'Study the carries above and pick your target before you step on the tee.'}</div>`);
    body.push(green3dButtonHtml(h));
    body.push('<button type="button" class="ghost-btn prep-back-holes" id="prepBackHoles">All holes</button>');

    $('prepStratBody').innerHTML = body.join('');
    wireBackButton();
  }

  function wireBackButton() {
    const back = $('prepBackHoles');
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

  // v1.10.0: after a tee-set switch the course data changed under us —
  // re-fetch holeInfo for the same hole and re-render everything that
  // depends on it (number, carries, map, tee chips).
  function rebindAfterTeeChange() {
    if (!boundHole) return;
    const number = boundHole.number;
    const info = api.holeInfo(number);
    if (info) boundHole = info;
    paintControls();
    paintTarget();
    renderStrategy();
    fetchGreenDelta();
    recompute({ pulse: true });
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
    const yd = currentTargetYd();
    if (!yd) {
      // v1.9.0: honest no-target state inside the single hole card. The
      // number block stays visible (same card) with a clear why + fix.
      const num = $('prepNumBlock');
      if (num) num.hidden = true;
      renderStrategy();
      return;
    }
    const num = $('prepNumBlock');
    if (num) num.hidden = false;
    const calc = solve(yd);
    const rec = api.recommendClub(calc.playsLikeYd);
    renderRecommendation(calc, rec, pulse);
    renderStrategy();
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
  const TEE_NUDGE_KEY = 'caddy.prep.teeNudge';   // { courseId: yd }
  const teeNudgeLoad = (courseId) => {
    try {
      const m = JSON.parse(localStorage.getItem(TEE_NUDGE_KEY) || '{}');
      return Number.isFinite(m[courseId]) ? m[courseId] : 0;
    } catch { return 0; }
  };
  const teeNudgeSave = (courseId, yd) => {
    try {
      const m = JSON.parse(localStorage.getItem(TEE_NUDGE_KEY) || '{}');
      if (yd) m[courseId] = yd; else delete m[courseId];
      localStorage.setItem(TEE_NUDGE_KEY, JSON.stringify(m));
    } catch { /* best-effort */ }
  };

  // Effective yardage for this hole under the current nudge. The nudge
  // shifts the tee ALONG the hole (all carries/distances uniformly).
  function nudgedYards(h) {
    const base = Number(h && h.yards);
    if (!(base > 0) || !h.courseId) return base || 0;
    return Math.max(40, base + teeNudgeLoad(h.courseId));
  }

  function teePickerHtml(h) {
    const sets = Array.isArray(h.teeSets) ? h.teeSets : [];
    const nudge = h.courseId ? teeNudgeLoad(h.courseId) : 0;
    const chips = sets.filter((s) => s.name).map((s) => {
      const active = h.activeTeeSet ? s.name === h.activeTeeSet : false;
      const yd = s.yardsForHole != null ? `${Math.round(s.yardsForHole)} yd` : '';
      return `<button type="button" class="prep-tee-chip${active ? ' active' : ''}" data-tee="${escapeHtml(s.name)}">${escapeHtml(s.name)}${yd ? `<i>${yd}</i>` : ''}</button>`;
    }).join('');
    const nudgeBit = `
      <div class="prep-tee-nudge">
        <button type="button" class="prep-step-btn" data-nd="-5" aria-label="Play shorter">−</button>
        <span class="prep-step-val">${nudge ? (nudge > 0 ? '+' : '') + nudge : '±0'}<small>yd</small></span>
        <button type="button" class="prep-step-btn" data-nd="5" aria-label="Play longer">+</button>
      </div>`;
    if (!sets.length && !nudge) return '';
    return `
      <div class="prep-tee-row" id="prepTeeRow">
        <div class="prep-mini-label">Tees${h.activeTeeSet ? ` · from the ${escapeHtml(h.activeTeeSet)}` : ''}</div>
        <div class="prep-tee-chips">${chips || '<span class="prep-empty">one set mapped</span>'}</div>
        ${nudgeBit}
      </div>`;
  }

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
