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
    mode: 'number',        // 'number' | 'hole'
    yards: 150,
    greenPoint: 'middle',  // front | middle | back
    bearing: 0,
    lie: 'fairway',
    shape: 'straight',
  });

  let boundHole = null; // holeInfo object when a planner hole is open

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
      host.parentNode.insertBefore(sel, host.nextSibling);
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
      <!-- CONDITIONS -->
      <div class="card" id="prepCondCard">
        <div class="card-title">
          <h2>Conditions</h2>
          <span class="chip" id="prepCondChip">${compass16(cond.windFromDeg)} · ${Math.round(cond.windMph)} mph</span>
        </div>
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

      <!-- THE SHOT -->
      <div class="card" id="prepShotCard">
        <div class="card-title">
          <h2>The shot</h2>
          <span class="chip" id="prepTargetChip">Manual number</span>
        </div>

        <div class="prep-seg" id="prepModeSeg" style="--n:2; margin-bottom: 12px">
          <span class="prep-seg-thumb"></span>
          <button type="button" class="prep-seg-opt" data-mode="hole">Planned hole</button>
          <button type="button" class="prep-seg-opt" data-mode="number">Any number</button>
        </div>

        <div id="prepTargetMeta" class="prep-target-meta"></div>

        <div id="prepHolePane" hidden>
          <div class="prep-mini-label">Playing to</div>
          <div class="prep-green-picker" id="prepGreenPicker">
            <button type="button" class="prep-point-btn" data-point="front"><i>Front</i><b>—</b></button>
            <button type="button" class="prep-point-btn" data-point="middle"><i>Middle</i><b>—</b></button>
            <button type="button" class="prep-point-btn" data-point="back"><i>Back</i><b>—</b></button>
          </div>
          <div class="hint" id="prepGreenHint" style="margin-top: 7px"></div>
        </div>

        <div id="prepNumPane">
          <div class="prep-slider-row" style="grid-template-columns: auto 1fr auto;">
            <label for="prepYardsInput">Yards out</label>
            <input id="prepYardsInput" class="prep-yards-input" type="number" inputmode="decimal" min="1" max="650" value="${Math.round(num(shot.yards, 150))}"/>
            <div class="prep-stepper" id="prepBearingStep">
              <button type="button" class="prep-step-btn" data-step="bearing" data-dir="-1">−</button>
              <span class="prep-step-val" id="prepBearingVal">${fmt(shot.bearing)}°<small>${compass16(shot.bearing)}</small></span>
              <button type="button" class="prep-step-btn" data-step="bearing" data-dir="1">+</button>
            </div>
          </div>
          <div class="hint" style="margin-top: 6px">Bearing is the shot direction — it tells the dial how wind relates to your line.</div>
        </div>

        <div class="section-gap" style="margin-top: 13px">
          <div class="prep-mini-label">Lie</div>
          <div class="prep-lie-row" id="prepLieRow">
            ${LIES.map((l) => `<button type="button" class="prep-lie-chip${shot.lie === l.id ? ' active' : ''}" data-lie="${l.id}"><b>${l.name}</b><span>${l.sub}</span></button>`).join('')}
          </div>
        </div>

        <div class="section-gap" style="margin-top: 13px">
          <div class="prep-mini-label">Intended shape</div>
          <div class="prep-shape-row" id="prepShapeRow">
            ${SHAPES.map((s) => `
              <button type="button" class="prep-shape-btn${shot.shape === s.id ? ' active' : ''}" data-shape="${s.id}">
                <svg viewBox="0 0 60 46">${SHAPE_GLYPHS[s.id]}</svg>
                <b>${s.name}</b><span>${s.sub}</span>
              </button>`).join('')}
          </div>
        </div>

        <button class="ghost-btn prep-live-btn" id="prepLiveBtn" type="button">Use live weather & elevation</button>
      </div>

      <!-- RECOMMENDATION -->
      <div class="card prep-rec" id="prepRecCard">
        <div class="prep-kicker">Pre-shot number</div>
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
      </div>

      <!-- STRATEGY -->
      <div class="card" id="prepStrategyCard" hidden>
        <div class="card-title">
          <h3 id="prepStratTitle">Hole strategy</h3>
          <span class="chip" id="prepStratChip">—</span>
        </div>
        <div id="prepStratBody"></div>
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
    $('prepBearingVal').innerHTML = `${fmt(shot.bearing)}°<small>${compass16(shot.bearing)}</small>`;

    paintSeg('prepSurfaceSeg', 'surface', cond.surface);
    const surf = SURFACES.find((s) => s.id === cond.surface) || SURFACES[1];
    $('prepSurfaceNote').textContent = surf.note;

    paintSeg('prepModeSeg', 'mode', shot.mode);

    [...$('prepLieRow').children].forEach((c) =>
      c.classList.toggle('active', c.dataset.lie === shot.lie)
    );
    [...$('prepShapeRow').children].forEach((c) =>
      c.classList.toggle('active', c.dataset.shape === shot.shape)
    );
  }

  function paintTarget() {
    // Effective mode: 'hole' is only real while a planner hole is bound.
    const effMode = boundHole && shot.mode === 'hole' ? 'hole' : 'number';
    paintSeg('prepModeSeg', 'mode', effMode);
    $('prepModeSeg')
      .querySelector('[data-mode="hole"]')
      .toggleAttribute('disabled', !boundHole);

    const holeBound = effMode === 'hole';
    $('prepHolePane').hidden = !holeBound;
    $('prepNumPane').hidden = holeBound;

    if (holeBound) {
      $('prepTargetChip').textContent = `Hole ${boundHole.number}`;
      const g = boundHole.green || {};
      const pts = { front: g.front, middle: g.center, back: g.back };
      const shown = pts[shot.greenPoint];
      $('prepTargetMeta').innerHTML =
        `${escapeHtml(boundHole.courseName)} · Par ${boundHole.par ?? '—'}` +
        (boundHole.yards ? ` · ${Math.round(boundHole.yards)} yd tee-to-green` : '') +
        (shown != null
          ? ` · playing <b>${shown} yd</b> to the ${shot.greenPoint}`
          : '');
      [...$('prepGreenPicker').children].forEach((b) => {
        const v = pts[b.dataset.point];
        b.querySelector('b').textContent = v != null ? v : '—';
        b.classList.toggle('active', b.dataset.point === shot.greenPoint);
        b.toggleAttribute('disabled', v == null);
      });
      const anyMapped = Object.values(pts).some((v) => v != null);
      $('prepGreenHint').textContent = anyMapped
        ? 'Carries below update live with your conditions.'
        : 'Green edges are not mapped — playing to the center estimate.';
    } else {
      $('prepTargetChip').textContent = 'Manual number';
      const brg = shot.bearing;
      $('prepTargetMeta').innerHTML =
        `Shooting <b>${Math.round(num(shot.yards))} yd</b> on a bearing of ${fmt(brg)}° (${compass16(brg)})` +
        (boundHole
          ? ' — open a hole above to bind this panel to its green.'
          : '');
    }
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
        if (kind === 'bearing') shot.bearing = norm360(shot.bearing + dir * 5);
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

    $('prepModeSeg').addEventListener('click', (e) => {
      const opt = e.target.closest('.prep-seg-opt');
      if (!opt || opt.hasAttribute('disabled')) return;
      shot.mode = opt.dataset.mode;
      haptic(6);
      persist();
      paintControls();
      paintTarget();
      recompute({ pulse: true });
    });

    $('prepGreenPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.prep-point-btn');
      if (!btn || btn.hasAttribute('disabled')) return;
      shot.greenPoint = btn.dataset.point;
      haptic(5);
      persist();
      paintTarget();
      recompute({ pulse: true });
    });

    const yardsInput = $('prepYardsInput');
    let yardsTimer = null;
    yardsInput.addEventListener('input', () => {
      clearTimeout(yardsTimer);
      yardsTimer = setTimeout(() => {
        const v = num(yardsInput.value, NaN);
        if (Number.isFinite(v) && v > 0) {
          shot.yards = clamp(v, 1, 650);
          persist();
          recompute({ pulse: true });
        }
      }, 260);
    });
    yardsInput.addEventListener('blur', () => {
      yardsInput.value = Math.round(num(shot.yards, 150));
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
    if (shot.mode === 'hole' && boundHole) {
      return Math.round(num(boundHole.bearing, 0));
    }
    return Math.round(norm360(shot.bearing));
  }

  function currentTargetYd() {
    if (shot.mode === 'hole' && boundHole) {
      const g = boundHole.green || {};
      const pt = shot.greenPoint === 'front' ? g.front
        : shot.greenPoint === 'back' ? g.back
          : g.center;
      if (pt != null) return pt;
      if (boundHole.yards) return Math.round(boundHole.yards);
      return null;
    }
    const v = num(shot.yards, NaN);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  // One full physics solve under the CURRENT panel conditions.
  function solve(yd) {
    const w = api.weather();
    return api.playsLike({
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
    const card = $('prepRecCard');

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

  function renderStrategy() {
    const card = $('prepStrategyCard');
    if (!(boundHole && shot.mode === 'hole')) {
      card.hidden = true;
      return;
    }
    const h = boundHole;
    card.hidden = false;
    $('prepStratTitle').textContent = `Hole ${h.number} strategy`;
    $('prepStratChip').textContent = h.par ? `Par ${h.par}` : 'Par —';

    const body = [];
    const metaBits = [
      h.par ? `Par ${h.par}` : null,
      h.yards ? `${Math.round(h.yards)} yd` : null,
      h.strokeIndex ? `SI ${h.strokeIndex}` : null,
      currentBearing() ? `${compass16(currentBearing())} off the tee` : null,
    ].filter(Boolean);
    body.push(
      `<div class="prep-strat-meta">${metaBits.map((b) => `<span class="prep-strat-chip">${escapeHtml(b)}</span>`).join('')}</div>`
    );

    // Off-the-tee recommendation under current conditions
    if (h.yards) {
      const teeCalc = solve(Math.round(h.yards));
      const teeRec = api.recommendClub(teeCalc.playsLikeYd);
      const eff = effortInfo(teeRec.main);
      const delta = Math.round(teeCalc.playsLikeYd - Math.round(h.yards));
      const why = Math.abs(delta) >= 2
        ? `${delta >= 0 ? '+' : ''}${delta} yd vs the card length`
        : 'plays true to the card';
      body.push(`
        <div class="prep-tee-box">
          <div class="prep-mini-label">Suggested off the tee</div>
          <div class="prep-tee-main">${escapeHtml(clubShort(teeRec.main))}</div>
          <div class="prep-tee-sub">Plays ${fmt(teeCalc.playsLikeYd)} of ${Math.round(h.yards)} — ${why}. ${eff.note ? escapeHtml(eff.note.charAt(0).toUpperCase() + eff.note.slice(1)) + '.' : ''}</div>
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

    // Conditioned carries to each green point
    const g = h.green || {};
    const pts = [
      ['Front', 'front', g.front],
      ['Middle', 'middle', g.center],
      ['Back', 'back', g.back],
    ];
    const mapped = pts.filter(([, , v]) => v != null);
    if (mapped.length) {
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Conditioned carries</div><div class="prep-carry-strip">');
      for (const [label, key, dist] of pts) {
        if (dist == null) continue;
        const c = solve(dist);
        body.push(
          `<div class="prep-carry-tile${shot.greenPoint === key ? ' chosen' : ''}"><i>${label}</i>${fmt(c.playsLikeYd)} yd</div>`
        );
      }
      body.push('</div></div>');
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
      const teeCalc = solve(Math.round(h.yards));
      const danger = haz.find(
        (hz) =>
          hz.type === 'water' &&
          (() => {
            const along = hazardAlongYd(hz.sub);
            return along != null && Math.abs(along - teeCalc.playsLikeYd) <= 12;
          })()
      );
      if (danger) tips.push(`Water sits right at your carry zone (~${(hazardAlongYd(danger.sub) || 0)} yd) — take enough club or lay back.`);
    }

    body.push(`<div class="prep-strat-advice">${tips.map(escapeHtml).join(' ') || 'Study the carries above and pick your target before you step on the tee.'}</div>`);

    $('prepStratBody').innerHTML = body.join('');
  }

  /* ======================================================================
     MAIN PIPELINE
     ====================================================================== */
  function recompute({ pulse = false } = {}) {
    const yd = currentTargetYd();
    if (!yd) {
      $('prepRecMain').textContent = 'Set a target';
      $('prepReason').textContent = 'Enter a yardage (or bind a planned hole above) to get the play.';
      $('prepAdjChips').innerHTML = '';
      $('cellCarry').textContent = '—';
      $('cellRelease').textContent = '—';
      $('cellTotal').textContent = '—';
      $('prepAimText').textContent = '—';
      renderStrategy();
      return;
    }
    const calc = solve(yd);
    const rec = api.recommendClub(calc.playsLikeYd);
    renderRecommendation(calc, rec, pulse);
    renderStrategy();
  }

  /* ======================================================================
     PLANNER BINDING — follow the Hole planner selection without touching
     any of its code. Click delegation fires AFTER the planner's own button
     handler has updated #planDetailTitle, and a MutationObserver collapses
     our binding when the detail card closes (course change etc.).
     ====================================================================== */
  function bindHole(number) {
    const info = api.holeInfo(number);
    if (!info) return;
    boundHole = info;
    if (shot.mode !== 'hole') {
      shot.mode = 'hole';
      shot.greenPoint = 'middle';
      persist();
    }
    paintControls();
    paintTarget();
    recompute({ pulse: true });
  }

  function unbindHoleIfGone() {
    if (!boundHole) return;
    const detail = document.getElementById('planDetailCard');
    if (!detail || detail.hidden) {
      boundHole = null;
      paintControls();
      paintTarget();
      renderStrategy();
    }
  }

  function wirePlannerBridge() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.plan-hole-row');
      if (!row) return;
      const title = document.getElementById('planDetailTitle');
      const m = title ? /Hole\s+(\d+)/.exec(title.textContent || '') : null;
      bindHole(m ? Number(m[1]) : Number(row.dataset.hole));
    }, true);

    const detail = document.getElementById('planDetailCard');
    if (detail && typeof MutationObserver !== 'undefined') {
      new MutationObserver(unbindHoleIfGone).observe(detail, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    }
  }

  /* ---------- Boot ---------- */
  buildSkeleton();
  wireControls();
  paintControls();
  paintTarget();
  wirePlannerBridge();
  recompute({ pulse: true });
})();
