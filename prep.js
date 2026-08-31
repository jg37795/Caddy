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
      <!-- HOLE BRIEF (map + sequence + strategy + 3D green) -->
      <div class="card" id="prepStrategyCard" hidden>
        <div class="prep-hole-brief-head">
          <div>
            <div class="prep-kicker" style="color: var(--muted); margin-bottom: 2px">Hole brief</div>
            <h3 id="prepStratTitle" style="margin: 0">Hole strategy</h3>
          </div>
          <span class="chip" id="prepStratChip">—</span>
        </div>
        <div id="prepStratBody"></div>
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

      <!-- THE SHOT -->
      <div class="card" id="prepShotCard">
        <div class="card-title">
          <h2>The shot</h2>
          <span class="chip" id="prepTargetChip">Hole —</span>
        </div>

        <div id="prepTargetMeta" class="prep-target-meta"></div>

        <div id="prepHolePane">
          <div class="prep-mini-label">Playing to</div>
          <div class="prep-green-picker" id="prepGreenPicker">
            <button type="button" class="prep-point-btn" data-point="front"><i>Front</i><b>—</b></button>
            <button type="button" class="prep-point-btn" data-point="middle"><i>Middle</i><b>—</b></button>
            <button type="button" class="prep-point-btn" data-point="back"><i>Back</i><b>—</b></button>
          </div>
          <div class="hint" id="prepGreenHint" style="margin-top: 7px"></div>
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

      <!-- CONDITIONS (collapsed — not the first thing you see) -->
      <div class="card" id="prepCondCard">
        <details class="prep-cond-details" id="prepCondDetails">
        <summary>
        <div class="card-title">
          <h2>Conditions</h2>
          <span class="chip" id="prepCondChip">${compass16(cond.windFromDeg)} · ${Math.round(cond.windMph)} mph</span>
        </div>
        </summary>
        <div class="prep-cond-body">
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
    // Prep is always bound to a course hole. No hole → search/scorecard
    // is the screen; studio cards stay hidden.
    const shotCard = $('prepShotCard');
    const recCard = $('prepRecCard');
    const condCard = $('prepCondCard');

    if (!boundHole) {
      if (shotCard) shotCard.hidden = true;
      if (recCard) recCard.hidden = true;
      if (condCard) condCard.hidden = true;
      renderStrategy();
      syncPrepChrome();
      return;
    }
    if (shotCard) shotCard.hidden = false;
    if (recCard) recCard.hidden = false;
    if (condCard) condCard.hidden = false;

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

    $('prepGreenPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.prep-point-btn');
      if (!btn || btn.hasAttribute('disabled')) return;
      shot.greenPoint = btn.dataset.point;
      haptic(5);
      persist();
      paintTarget();
      recompute({ pulse: true });
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

  function holeMapSvg(h, names) {
    const yards = Number(h && h.yards);
    if (!(yards > 40)) return '';
    const W = 320, H = 168;
    const padT = 22, padB = 18, padL = 22, padR = 28;
    const x0 = padL, x1 = W - padR;
    const yMid = (padT + (H - padB)) / 2;
    const spanX = x1 - x0;
    const xAt = (alongYd) => x0 + spanX * clamp(alongYd / yards, 0, 1);

    const fairW = 28;
    const parts = [];
    parts.push(
      `<rect class="prep-hm-fairway" x="${x0}" y="${(yMid - fairW / 2).toFixed(1)}" width="${spanX.toFixed(1)}" height="${fairW}" rx="14"/>`
    );

    const haz = Array.isArray(h.hazards) ? h.hazards : [];
    for (const hz of haz) {
      let along = Number.isFinite(hz.along) ? hz.along : hazardAlongYd(hz.sub);
      if (along == null || along <= 0 || along >= yards) continue;
      const cross = Number.isFinite(hz.cross) ? hz.cross : 0;
      const hx = xAt(along);
      const hy = yMid + clamp(cross / 28, -1, 1) * 22;
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
      const cpy = yMid + bump;
      parts.push(
        `<path class="prep-hm-shot s${i % 4}" d="M ${a.toFixed(1)} ${yMid.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${b.toFixed(1)} ${yMid.toFixed(1)}"/>`
      );
      const lx = (a + b) / 2;
      const ly = yMid + bump - (bump > 0 ? -12 : 12);
      parts.push(
        `<text class="prep-hm-club" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${escapeHtml(clubs[i])}</text>`
      );
    }

    parts.push(`<circle class="prep-hm-tee" cx="${x0}" cy="${yMid}" r="5.5"/>`);
    const g = h.green || {};
    const depthYd = Number.isFinite(g.depth) ? g.depth : 18;
    const gw = clamp((depthYd / yards) * spanX * 4.2, 18, 36);
    parts.push(
      `<ellipse class="prep-hm-green" cx="${x1}" cy="${yMid}" rx="${(gw / 2).toFixed(1)}" ry="11"/>`
    );
    parts.push(
      `<line x1="${x1}" y1="${(yMid - 22).toFixed(1)}" x2="${x1}" y2="${yMid}" stroke="rgba(255,255,255,0.7)" stroke-width="1.4"/>` +
      `<path class="prep-hm-flag" d="M ${x1} ${yMid - 22} l 9 3.5 l -9 3.5 Z"/>`
    );
    parts.push(
      `<text class="prep-hm-club" x="${x0}" y="${H - 4}" text-anchor="start">Tee</text>` +
      `<text class="prep-hm-club" x="${x1}" y="${H - 4}" text-anchor="end">${Math.round(yards)} yd</text>`
    );

    return `<svg class="prep-holemap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hole ${h.number} map, ${Math.round(yards)} yards">${parts.join('')}</svg>`;
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
    const metaBits = [
      h.par ? `Par ${h.par}` : null,
      h.yards ? `${Math.round(h.yards)} yd` : null,
      h.strokeIndex ? `SI ${h.strokeIndex}` : null,
      currentBearing() ? `${compass16(currentBearing())} off the tee` : null,
    ].filter(Boolean);
    body.push(
      `<div class="prep-strat-meta">${metaBits.map((b) => `<span class="prep-strat-chip">${escapeHtml(b)}</span>`).join('')}</div>`
    );

    const names = seqNames(h);
    const map = holeMapSvg(h, names);
    if (map) {
      body.push('<div class="prep-section-gap"><div class="prep-mini-label">Hole map</div>');
      body.push(map);
      body.push('</div>');
    }

    body.push('<div class="prep-section-gap"><div class="prep-mini-label">How to play it</div>');
    body.push(seqChipsHtml(names));
    body.push('</div>');

    // Off-the-tee recommendation under current conditions
    // v-fix(dedupe-tee-solve) v1.5.3 (audit #20): the tee solve ran here AND
    // again in the water-danger check below; one call, reused.
    let teeCalc = null;
    if (h.yards) {
      teeCalc = solve(Math.round(h.yards));
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
    const back = $('prepBackHoles');
    if (back) {
      back.addEventListener('click', () => {
        boundHole = null;
        const detail = document.getElementById('planDetailCard');
        if (detail) detail.hidden = true;
        paintControls();
        paintTarget();
        haptic(5);
      });
    }
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
      $('prepRecMain').textContent = 'Set a target';
      $('prepReason').textContent =
        'Bind a course hole above to get the play for its green.';
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
     our binding when the course card closes (course change etc.).
     ====================================================================== */
  let prepSearching = false;

  function syncPrepChrome() {
    const sel = document.getElementById('planCourseSelect');
    const hasCourse = !!(sel && sel.value);
    const boundHead = document.getElementById('prepBoundHead');
    const searchPane = document.getElementById('prepSearchPane');
    const courseCard = document.getElementById('planCourseCard');
    const nameEl = document.getElementById('prepBoundTitle');
    const courseName = document.getElementById('planCourseName');
    const changeBtn = document.getElementById('prepChangeCourse');

    if (boundHead) boundHead.hidden = !hasCourse;
    if (nameEl && courseName && hasCourse)
      nameEl.textContent = courseName.textContent || 'Course';
    if (searchPane) searchPane.hidden = hasCourse && !prepSearching;
    if (changeBtn) changeBtn.textContent = prepSearching ? 'Done' : 'Change';
    if (courseCard && hasCourse)
      courseCard.hidden = prepSearching || !!boundHole;
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
    loadGreenMap(); // lazy + cancellable; never blocks the flow
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
      loadGreenMap();
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
      new MutationObserver(() => {
        if (courseCard && !courseCard.hidden) prepSearching = false;
        unbindHoleIfGone();
      }).observe(courseCard, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    }
    syncPrepChrome();
  }

  /* ======================================================================
     GREEN MAPS — USGS 3DEP slope arrows + tee→green elevation delta.
     Purely additive: lazy, cancellable, silently absent when coverage or
     the service is unavailable. Never blocks any existing flow.
     ====================================================================== */
  let geAbort = null;

  function ensureGreenMapCard() {
    let card = $('prepGreenMapCard');
    if (card) return card;
    const rec = $('prepRecCard');
    const host = rec && rec.parentNode ? rec.parentNode : studio;
    const div = document.createElement('div');
    div.className = 'card ge-card';
    div.id = 'prepGreenMapCard';
    div.hidden = true;
    div.innerHTML =
      '<div class="ge-head">' +
      '<span class="ge-title">Green Map</span>' +
      '<span class="ge-delta-chip" id="geDeltaChip" hidden></span>' +
      '</div>' +
      '<div id="geBody"></div>';
    host.insertBefore(div, rec);
    return div;
  }

  function geArrowSVG(cx, cy, dirDeg, len) {
    // Arrow pointing downhill (dirDeg compass) from (cx,cy).
    const rad = ((dirDeg - 90) * Math.PI) / 180;
    const x2 = cx + Math.cos(rad) * len;
    const y2 = cy + Math.sin(rad) * len;
    const wing = 4;
    const wA = rad + Math.PI - 0.5;
    const wB = rad + Math.PI + 0.5;
    return (
      `<line class="ge-arrow" x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round"/>` +
      `<path class="ge-arrow" d="M ${x2.toFixed(1)} ${y2.toFixed(1)} L ${(x2 + Math.cos(wA) * wing).toFixed(1)} ${(y2 + Math.sin(wA) * wing).toFixed(1)} L ${(x2 + Math.cos(wB) * wing).toFixed(1)} ${(y2 + Math.sin(wB) * wing).toFixed(1)} Z" fill="var(--green)"/>`
    );
  }

  function renderGreenMap(gm) {
    const card = ensureGreenMapCard();
    const body = $('geBody');
    const chip = $('geDeltaChip');

    const hideAll = () => { card.hidden = true; };
    if (!gm || (!gm.slope && gm.deltaFt == null)) { hideAll(); return; }
    card.hidden = false;

    // Delta chip (+12 ft uphill / −8 ft downhill from tee to green).
    if (gm.deltaFt != null && Math.abs(gm.deltaFt) >= 1) {
      const up = gm.deltaFt > 0;
      chip.hidden = false;
      chip.textContent = `${up ? '+' : '−'}${Math.abs(Math.round(gm.deltaFt))} ft ${up ? 'uphill' : 'downhill'}`;
      chip.classList.toggle('down', !up);
    } else {
      chip.hidden = true;
    }

    if (!gm.slope || gm.slope.confidence < 0.45) {
      // Low confidence / slope unavailable → elevation delta only.
      body.innerHTML =
        `<div class="ge-slope-line">Green elevation data is approximate here.</div>` +
        (gm.deltaFt != null ? '' : '');
      return;
    }

    const s = gm.slope;
    const SZ = 132, C = SZ / 2, R = 52;
    // High side gets a subtle bright wash opposite the fall direction.
    const highRad = (((s.highSideDirDeg - 90) * Math.PI) / 180);
    const hx = C + Math.cos(highRad) * R * 0.55;
    const hy = C + Math.sin(highRad) * R * 0.55;
    let arrows = '';
    const nArrows = 4;
    for (let i = 0; i < nArrows; i++) {
      const off = -18 + i * 12; // stagger across the green along fall line
      const ax = C - Math.cos(((s.fallDirDeg - 90) * Math.PI) / 180) * off;
      const ay = C - Math.sin(((s.fallDirDeg - 90) * Math.PI) / 180) * off;
      arrows += geArrowSVG(ax, ay, s.fallDirDeg, 9);
    }
    body.innerHTML =
      `<svg class="ge-view" viewBox="0 0 ${SZ} ${SZ}" role="img" aria-label="Green slope map">` +
      `<defs><radialGradient id="geShade" cx="${(hx / SZ).toFixed(2)}" cy="${(hy / SZ).toFixed(2)}" r="0.85">` +
      `<stop offset="0%" stop-color="var(--green)" stop-opacity="0.28"/>` +
      `<stop offset="70%" stop-color="var(--green)" stop-opacity="0.06"/>` +
      `</radialGradient></defs>` +
      `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#geShade)" stroke="var(--green-3)" stroke-width="1"/>` +
      `<circle cx="${C}" cy="${C}" r="2.6" fill="var(--glass-text)" opacity="0.85"/>` +
      arrows +
      `</svg>` +
      `<div class="ge-slope-line">Slope: <b>${s.meanSlopePct.toFixed(1)}%</b> toward <b>${compass16(s.fallDirDeg)}</b></div>` +
      (gm.approx ? '<div class="ge-note">approximate</div>' : '');
  }

  function loadGreenMap() {
    if (geAbort) geAbort.abort();
    geAbort = null;
    const card = $('prepGreenMapCard');
    if (!boundHole || !window.CaddyElev ||
        !boundHole.greenLatLng || !Number.isFinite(boundHole.greenLatLng.lat)) {
      if (card) card.hidden = true;
      return;
    }
    geAbort = new AbortController();
    const myAbort = geAbort;
    window.CaddyElev.greenMap({
      teeLL: boundHole.teeLatLng,
      centerLL: boundHole.greenLatLng,
      radiusM: 13,
    }, myAbort.signal).then((gm) => {
      if (myAbort !== geAbort) return; // superseded
      renderGreenMap(gm);
    }).catch(() => { /* silent — feature is best-effort */ });
  }

  /* ---------- Boot ---------- */
  buildSkeleton();
  wireControls();
  paintControls();
  paintTarget();
  wirePlannerBridge();
  recompute({ pulse: true });
})();
