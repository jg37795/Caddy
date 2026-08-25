/* ==========================================================================
   range.js — Range premium layer (additive only)
   --------------------------------------------------------------------------
   Polish-and-extend for the Play/Range hero screen. This file OWNS NO DATA
   that app.js cares about:
     • It READS app state exclusively through the DOM (#rawYards,
       #playsLikeYards, #roundMapHud, …) and localStorage keys that app.js
       already publishes (`caddy:clubs`, `caddy:roundSession`).
     • It WRITES only its own namespaced keys (`caddy.range.*`).
     • Actions (center-on-me, satellite toggle, track shot, drop pin)
       are performed by forwarding clicks to the existing controls or by
       synthesizing a plain Leaflet-compatible tap on the #map container —
       exactly what a finger tap produces. No app.js internals are touched.
   ========================================================================== */

(() => {
  'use strict';

  if (window.__rxRangePremium) return; // idempotent
  window.__rxRangePremium = true;

  /* ---------------- tiny utils ---------------- */

  const $ = (id) => document.getElementById(id);

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  const WIND_KEY = 'caddy.range.wind'; // ONLY key this layer writes
  const CLUBS_KEY = 'caddy:clubs'; // read-only mirror of the bag
  const SESSION_KEY = 'caddy:roundSession'; // read-only mirror of the round

  // Same vocabulary as app.js haptic(): vibrate where available, else the
  // iOS switch-tick trick via an offscreen checkbox.
  let _iosTick = null;
  function haptic(strong) {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(strong ? 12 : 7);
        return;
      }
    } catch {}
    try {
      if (!_iosTick) {
        _iosTick = document.createElement('input');
        _iosTick.type = 'checkbox';
        _iosTick.setAttribute('switch', '');
        _iosTick.style.cssText =
          'position:fixed;opacity:0;pointer-events:none;width:0;height:0;';
        document.body.appendChild(_iosTick);
      }
      _iosTick.checked = !_iosTick.checked;
    } catch {}
  }

  function parseNum(text) {
    if (text == null) return null;
    const m = String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  /* ---------------- element refs (static HTML in index.html) ---------------- */

  const wrap = $('rangeWrap');
  const root = {
    reticle: $('rxReticle'),
    stack: $('rxStack'),
    strip: $('rxStrip'),
    stripHole: $('rxStripHole'),
    stripHoleSep: $('rxStripHoleSep'),
    dots: $('rxDots'),
    wind: $('rxWind'),
    windArrow: $('rxWindArrow'),
    windText: $('rxWindText'),
    windTag: $('rxWindTag'),
    hero: $('rxHero'),
    heroKicker: $('rxHeroKicker'),
    heroNum: $('rxHeroNum'),
    heroPl: $('rxHeroPl'),
    clubChip: $('rxClubChip'),
    clubName: $('rxClubName'),
    clubMeta: $('rxClubMeta'),
    dock: $('rxDock'),
    actTrack: $('rxActTrack'),
    actPin: $('rxActPin'),
    actCenter: $('rxActCenter'),
    actSat: $('rxActSat'),
    scrim: $('rxScrim'),
    clubPop: $('rxClubPop'),
    clubList: $('rxClubList'),
    clubPopSub: $('rxClubPopSub'),
    clubPopClose: $('rxClubPopClose'),
    windPop: $('rxWindPop'),
    windPopClose: $('rxWindPopClose'),
    speedRow: $('rxSpeedRow'),
    dirGrid: $('rxDirGrid'),
    windClear: $('rxWindClear'),
  };
  if (!wrap || !root.reticle || !root.dock) return; // wrong page / partial HTML

  /* ================= 1. HERO DISTANCE MIRROR =================
     Mirrors the sheet's numbers into a glanceable top-center capsule. */

  const srcYards = $('rawYards');
  const srcLabel = $('rawLabel');
  const srcPlays = $('playsLikeYards');

  let lastNumText = null;

  function renderHero() {
    // Hero capsule removed (v1.0.64) — numbers live in the sheet only.
    return;
    if (!srcYards || !root.heroNum) return;
    const t = (srcYards.textContent || '').trim();
    if (t !== lastNumText) {
      lastNumText = t;
      root.heroNum.textContent = t || '—';
      if (!reduceMotion && t && t !== '—') {
        root.heroNum.classList.remove('rx-roll');
        void root.heroNum.offsetWidth; // restart animation
        root.heroNum.classList.add('rx-roll');
      }
    }
    if (root.heroKicker && srcLabel) {
      const lbl = (srcLabel.textContent || '').trim();
      root.heroKicker.textContent = lbl
        ? lbl.toUpperCase()
        : 'DISTANCE TO TARGET';
    }
    // Plays-like badge: value + direction tint mirrored from pl-long/pl-short.
    if (root.heroPl && srcPlays) {
      const pl = (srcPlays.textContent || '').trim();
      const hasTarget = t && t !== '—';
      const plVal = parseNum(pl);
      const rawVal = parseNum(t);
      if (hasTarget && plVal != null && rawVal != null && Math.abs(plVal - rawVal) >= 1) {
        const d = Math.round(plVal - rawVal);
        root.heroPl.hidden = false;
        root.heroPl.textContent = `plays ${Math.round(plVal)}${d ? (d > 0 ? ' +' : ' −') + Math.abs(d) : ''}`;
        root.heroPl.classList.toggle('longer', srcPlays.classList.contains('pl-long'));
        root.heroPl.classList.toggle('shorter', srcPlays.classList.contains('pl-short'));
      } else if (hasTarget && plVal != null) {
        root.heroPl.hidden = false;
        root.heroPl.textContent = `plays like ${Math.round(plVal)}`;
        root.heroPl.classList.remove('longer', 'shorter');
      } else {
        root.heroPl.hidden = true;
      }
    }
    renderClubChip();
  }

  /* ================= 2. SMART CLUB SUGGESTION =================
     Base-carry match: nearest stock carry to the plays-like number.
     Reads `caddy:clubs` (app-owned) — never writes it. */

  // App's DEFAULT_CLUBS (mirrored from app.js): used only when the player
  // has never touched their bag, so first-run users still get suggestions
  // matching what app.js holds in memory.
  const DEFAULT_CLUBS = [
    ['Driver', 275], ['3 Wood', 250], ['2 Hybrid', 230], ['5 Iron', 200],
    ['6 Iron', 190], ['7 Iron', 180], ['8 Iron', 165], ['9 Iron', 150],
    ['PW', 135], ['GW', 120], ['50°', 110], ['54°', 95],
  ];

  function getClubs() {
    const v = loadJSON(CLUBS_KEY, null);
    const src = Array.isArray(v) && v.length ? v : DEFAULT_CLUBS.map(([name, yards]) => ({ name, yards }));
    return src
      .map((c) => ({ name: String(c && c.name || '').trim(), yards: Number(c && c.yards) }))
      .filter((c) => c.name && Number.isFinite(c.yards) && c.yards > 0)
      .sort((a, b) => b.yards - a.yards);
  }

  function bestCarryMatch(yd, clubs) {
    // Nearest stock carry, with the house rule from the Bag screen:
    // "prefer the longer club when between clubs" — a shorter club must be
    // clearly nearer (by more than 2 yd) to win a near-tie.
    let best = null;
    for (const c of clubs) {
      const d = Math.abs(c.yards - yd);
      if (!best || d < best.diff - 2) best = { club: c, diff: d };
    }
    return best;
  }

  // Swing-effort vocabulary shared with the app (easy ≈ 94%, firm ≈ 106%).
  function effortFor(club, yd) {
    if (Math.abs(club.yards - yd) <= 3) return 'stock';
    if (club.yards * 1.06 >= yd && club.yards < yd) return 'firm';
    if (club.yards * 0.94 <= yd && club.yards > yd) return 'easy';
    return null;
  }

  let lastChipKey = '';

  function renderClubChip() {
    if (!root.clubChip || !srcYards) return;
    const yd = parseNum(srcPlays && srcPlays.textContent) ?? parseNum(srcYards.textContent);
    const clubs = getClubs();
    const ok = yd != null && yd > 0 && clubs.length > 0;
    root.clubChip.hidden = !ok;
    if (!ok) {
      lastChipKey = '';
      return;
    }
    const best = bestCarryMatch(yd, clubs);
    const eff = effortFor(best.club, yd);
    const delta = Math.round(best.club.yards - yd);
    const key = `${best.club.name}|${yd}|${clubs.length}`;
    if (key === lastChipKey) return;
    lastChipKey = key;
    root.clubName.textContent = best.club.name;
    root.clubMeta.textContent =
      Math.abs(delta) <= 2
        ? `${best.club.yards} yd · stock`
        : `${best.club.yards} yd · ${delta > 0 ? '+' : '−'}${Math.abs(delta)}${eff ? ' · ' + eff : ''}`;
  }

  function openClubPop() {
    const yd = parseNum(srcPlays && srcPlays.textContent) ?? parseNum(srcYards && srcYards.textContent);
    const clubs = getClubs();
    if (!root.clubPop || yd == null || !clubs.length) return;
    if (root.clubPopSub) {
      root.clubPopSub.textContent = `Nearest stock carries for ${Math.round(yd)} yd plays-like`;
    }
    const maxCy = clubs[0].yards || 1;
    root.clubList.innerHTML = '';
    let bestRow = null;
    for (const c of clubs) {
      const diff = Math.round(c.yards - yd);
      const eff = effortFor(c, yd);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rx-club-row' + (eff === 'stock' || Math.abs(diff) <= 2 ? ' best' : '');
      row.innerHTML =
        '<span class="nm"></span>' +
        '<span class="bar"><i></i></span>' +
        '<span class="cy"></span>' +
        '<span class="df"></span>';
      row.querySelector('.nm').textContent = c.name;
      row.querySelector('.bar i').style.width =
        Math.max(6, Math.min(100, (c.yards / maxCy) * 100)) + '%';
      row.querySelector('.cy').textContent = `${c.yards} yd`;
      const df = row.querySelector('.df');
      df.textContent =
        Math.abs(diff) <= 2 ? (eff || 'stock') : (diff > 0 ? '+' : '−') + Math.abs(diff) + (eff ? ' ' + eff : '');
      df.classList.toggle('hot', Math.abs(diff) <= 2);
      row.addEventListener('click', () => {
        haptic(false);
        closePops();
      });
      root.clubList.appendChild(row);
      if (!bestRow && row.classList.contains('best')) bestRow = row;
    }
    // Bring the suggested club into view without jumping the sheet.
    if (bestRow && bestRow.scrollIntoView) {
      try {
        bestRow.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      } catch {}
    }
    const note = root.clubPop.querySelector('.rx-club-note');
    if (note) {
      note.textContent =
        'Base stock-carry match (conditions ignored). Firm/easy swings move a carry about ±6%.';
    }
    openSheet(root.clubPop);
  }

  /* ================= 3. CONTEXT STRIP — hole · scorecard dots · wind ======== */

  const hudEl = $('roundMapHud');
  const hudHoleEl = $('roundMapHole');

  function sessionData() {
    const rs = loadJSON(SESSION_KEY, null);
    if (!rs || typeof rs !== 'object') return null;
    return rs;
  }

  function renderStrip() {
    // v1.0.65: during a live round the round HUD card (#roundMapHud) owns
    // hole identity + scorecard dots — the strip shows wind only, so the
    // same info never renders twice.
    const hudVisible = !!hudEl && !hudEl.hidden;
    if (root.stripHole) root.stripHole.hidden = true;
    if (root.stripHoleSep) root.stripHoleSep.hidden = true;
    const hasDots = !hudVisible && renderDotsInto();
    if (root.dots) root.dots.hidden = !hasDots;

    // Live-round layout flag: shift the floating stack/dock clear of HUD.
    wrap.classList.toggle('rx-round-live', hudVisible);

    renderWind();
  }

  function renderDotsInto() {
    if (!root.dots) return false;
    const rs = sessionData();
    const card = rs && Array.isArray(rs.scorecard) ? rs.scorecard : null;
    const course = rs && rs.course;
    const holes = course && Array.isArray(course.holes) ? course.holes : [];
    if (!card || !card.length) {
      root.dots.innerHTML = '';
      return false;
    }
    const cur = Math.min(card.length, Math.max(1, Number(rs.hole || rs.currentHole) || 1));
    let html = '';
    card.forEach((h, i) => {
      const n = i + 1;
      const par = Number(holes[i] && holes[i].par) || 4;
      const sc = Number(h.score);
      let cls = 'rx-dot';
      if (n === cur) cls += ' cur';
      if (Number.isFinite(sc) && sc > 0) {
        if (sc < par) cls += ' under';
        else if (sc > par) cls += ' over';
        else cls += ' even';
      }
      html += `<i class="${cls}"></i>`;
    });
    root.dots.innerHTML = html;
    return true;
  }

  /* ================= 4. WIND WIDGET =================
     Manual wind lives under `caddy.range.wind`. With no manual entry and
     no live data the widget shows a clearly-tagged DEMO state. When the
     app's own live wind pill appears and nothing manual is set, this
     widget steps aside. */

  const COMPASS_8 = [
    ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
    ['S', 180], ['SW', 225], ['W', 270], ['NW', 315],
  ];
  const SPEEDS = [0, 5, 8, 12, 18, 25];
  const DEMO_WIND = { mph: 8, fromDeg: 315 }; // NW @ 8 — placeholder only

  function getManualWind() {
    const w = loadJSON(WIND_KEY, null);
    if (!w || typeof w !== 'object') return null;
    const mph = Number(w.mph);
    const fromDeg = Number(w.fromDeg);
    if (!Number.isFinite(mph) || !Number.isFinite(fromDeg)) return null;
    return { mph, fromDeg };
  }

  function compass8(deg) {
    let best = COMPASS_8[0][0];
    let bd = 999;
    for (const [nm, d] of COMPASS_8) {
      const dd = Math.abs(((deg - d + 540) % 360) - 180);
      if (dd < bd) {
        bd = dd;
        best = nm;
      }
    }
    return best;
  }

  function renderWind() {
    if (!root.wind) return;
    const manual = getManualWind();
    const liveShowing = (() => {
      const pill = $('windPill');
      return !!pill && !pill.hidden;
    })();
    const hudVisible = !!hudEl && !hudEl.hidden;
    // Live weather beats everything except an explicit manual entry.
    // During a live round the DEMO placeholder must NEVER show: if the
    // app's real wind pill hasn't been revealed yet (renderWind can run
    // before app.js's first updateWeatherUI, and observers only help
    // after that), show nothing rather than fake data.
    if (!manual && (liveShowing || hudVisible)) {
      root.wind.hidden = true;
      return;
    }
    root.wind.hidden = false;
    const w = manual || DEMO_WIND;
    const toward = (w.fromDeg + 180) % 360;
    if (root.windArrow) root.windArrow.style.transform = `rotate(${toward}deg)`;
    if (root.windText) {
      root.windText.textContent = w.mph === 0 ? 'calm' : `${Math.round(w.mph)} ${compass8(w.fromDeg)}`;
    }
    if (root.windTag) {
      root.windTag.hidden = false;
      root.windTag.textContent = manual ? 'MANUAL' : 'DEMO';
      root.windTag.classList.toggle('manual', !!manual);
    }
    root.wind.classList.toggle('is-demo', !manual);
  }

  function buildWindEditor() {
    if (!root.speedRow || !root.dirGrid) return;
    root.speedRow.innerHTML = '';
    SPEEDS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rx-pill-btn';
      b.dataset.speed = String(s);
      b.textContent = s === 0 ? 'Calm' : String(s);
      b.addEventListener('click', () => {
        const cur = getManualWind() || DEMO_WIND;
        saveWind({ mph: s, fromDeg: cur.fromDeg });
        haptic(s === 0);
      });
      root.speedRow.appendChild(b);
    });
    root.dirGrid.innerHTML = '';
    COMPASS_8.forEach(([nm, deg]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rx-pill-btn';
      b.dataset.deg = String(deg);
      b.textContent = nm;
      b.addEventListener('click', () => {
        const cur = getManualWind() || DEMO_WIND;
        saveWind({ mph: cur.mph || 8, fromDeg: deg });
        haptic(false);
      });
      root.dirGrid.appendChild(b);
    });
  }

  function syncWindEditor() {
    const w = getManualWind();
    if (root.speedRow) {
      root.speedRow.querySelectorAll('.rx-pill-btn').forEach((b) => {
        b.classList.toggle('on', !!w && Number(b.dataset.speed) === w.mph);
      });
    }
    if (root.dirGrid) {
      root.dirGrid.querySelectorAll('.rx-pill-btn').forEach((b) => {
        b.classList.toggle('on', !!w && Number(b.dataset.deg) === w.fromDeg);
      });
    }
    if (root.windClear) root.windClear.style.display = w ? '' : 'none';
  }

  function saveWind(w) {
    try {
      localStorage.setItem(WIND_KEY, JSON.stringify(w));
    } catch {}
    renderWind();
    syncWindEditor();
  }

  function clearWind() {
    try {
      localStorage.removeItem(WIND_KEY);
    } catch {}
    renderWind();
    syncWindEditor();
    haptic(true);
  }

  /* ================= 5. RETICLE POSITIONING =================
     Sits at the center of the VISIBLE map area between the top UI and the
     current sheet edge. Tracks drags/animations with a bounded rAF loop. */

  let rafId = 0;

  function reticlePoint() {
    const wr = wrap.getBoundingClientRect();
    const sheet = $('sheet');
    const topUi = wrap.querySelector('.range-top-ui');
    const sr = sheet ? sheet.getBoundingClientRect() : { top: wr.bottom };
    const tr = topUi ? topUi.getBoundingClientRect().bottom : wr.top + 64;
    const top = Math.max(tr, wr.top);
    const bottom = Math.min(sr.top, wr.bottom);
    const x = wr.left + wr.width / 2;
    const y = top + Math.max(40, bottom - top) * 0.46;
    return { x, y };
  }

  function placeReticle() {
    const p = reticlePoint();
    root.reticle.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  function startReticleLoop() {
    if (rafId || reduceMotion) return;
    const tick = () => {
      placeReticle();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopReticleLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    placeReticle();
  }

  function pingReticle() {
    if (!root.reticle || reduceMotion) return;
    root.reticle.classList.remove('rx-ping');
    void root.reticle.offsetWidth;
    root.reticle.classList.add('rx-ping');
  }

  /* ================= 6. QUICK-ACTION DOCK ================= */

  const mapEl = $('map');
  const recenterBtn = $('recenterBtn');
  const roundFab = $('roundFab');
  const roundFabWrap = $('roundFabWrap');

  // Synthesizes the same DOM 'click' Leaflet receives from a real tap.
  // app.js's own handler does everything else (target, line, math, haptic).
  function tapMapAt(clientX, clientY) {
    if (!mapEl) return false;
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
    });
    mapEl.dispatchEvent(ev);
    return true;
  }

  function dropPin() {
    const p = reticlePoint();
    pingReticle();
    haptic(true);
    tapMapAt(p.x, p.y);
  }

  function trackShot() {
    const usable = !!roundFab && !!roundFabWrap && !roundFabWrap.hidden;
    if (!usable) {
      toast('Start a round on the Round tab to track GPS-measured shots.');
      haptic(false);
      return;
    }
    haptic(true);
    roundFab.click(); // existing behavior: Start shot ↔ Finish shot
  }

  function centerOnMe() {
    if (!recenterBtn) return;
    haptic(false);
    recenterBtn.click();
  }

  function toggleSatellite() {
    const seg = $('layerSeg');
    if (!seg) return;
    const opts = [...seg.querySelectorAll('.seg-opt')];
    if (opts.length < 2) return;
    const activeIdx = opts.findIndex((o) => o.classList.contains('active'));
    const next = opts[(activeIdx + 1) % opts.length] || opts[0];
    haptic(false);
    next.click(); // existing select() handles map swap + persistence
  }

  function syncDock() {
    // Track-shot mirror: idle → dimmed hint · active → armed · pending → amber finish.
    const fabUsable = !!roundFab && !!roundFabWrap && !roundFabWrap.hidden;
    if (root.actTrack) {
      root.actTrack.setAttribute('aria-disabled', String(!fabUsable));
      root.actTrack.classList.toggle('armed', fabUsable && !(roundFab && roundFab.classList.contains('pending')));
      root.actTrack.classList.toggle('pending', !!(fabUsable && roundFab && roundFab.classList.contains('pending')));
      const lb = root.actTrack.querySelector('.rx-act-lb');
      if (lb) {
        lb.textContent =
          fabUsable && roundFab.classList.contains('pending')
            ? 'Finish'
            : fabUsable
              ? 'Track'
              : 'Track';
      }
    }
    // Drop pin is meaningless while a Front/Middle/Back placement is armed.
    const placing = !!document.querySelector('.fcb-seg[data-place]');
    if (root.actPin) {
      root.actPin.setAttribute('aria-disabled', String(placing));
      root.actPin.classList.toggle('armed', !placing);
    }
    // Center mirror: reflect lock state from the real FAB.
    if (root.actCenter && recenterBtn) {
      const locked = recenterBtn.classList.contains('locked');
      root.actCenter.classList.toggle('armed', locked);
      const lb = root.actCenter.querySelector('.rx-act-lb');
      if (lb) lb.textContent = locked ? 'Locked' : 'Center';
    }
    // Satellite mirror: reflect whichever layer segment is active.
    if (root.actSat) {
      const seg = $('layerSeg');
      const active = seg && seg.querySelector('.seg-opt.active');
      const isSat = !!active && active.dataset.layer === 'satellite';
      root.actSat.classList.toggle('armed', !isSat);
      const lb = root.actSat.querySelector('.rx-act-lb');
      if (lb) lb.textContent = isSat ? 'Course' : 'Sat';
    }
  }

  /* ================= 7. POPOVERS / SHEET MECHANICS ================= */

  let openedSheetEl = null;

  function openSheet(el) {
    if (!el) return;
    closePops(true);
    openedSheetEl = el;
    el.hidden = false; // [hidden] is display:none!important app-wide
    if (root.scrim) {
      root.scrim.hidden = false;
      requestAnimationFrame(() => root.scrim.classList.add('open'));
    }
    requestAnimationFrame(() => el.classList.add('open'));
    const closer = el.querySelector('.rx-sheet-close');
    if (closer) closer.focus({ preventScroll: true });
  }

  function closePops(immediate) {
    const el = openedSheetEl;
    openedSheetEl = null;
    if (root.scrim) {
      root.scrim.classList.remove('open');
      if (!immediate) {
        setTimeout(() => {
          if (!openedSheetEl) root.scrim.hidden = true;
        }, 320);
      } else {
        root.scrim.hidden = true;
      }
    }
    if (el) {
      el.classList.remove('open');
      const hide = () => {
        el.hidden = true;
        el.removeEventListener('transitionend', hide);
      };
      if (immediate || reduceMotion) hide();
      else el.addEventListener('transitionend', hide);
      // Safety net if transitionend never fires.
      setTimeout(hide, 600);
    }
  }

  /* ---------------- toast ---------------- */

  let toastTimer = 0;
  let toastEl = null;

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'rx-toast glass';
      wrap.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ================= 8. OBSERVERS (read-only mirrors) ================= */

  function watchText(el, cb) {
    if (!el) return;
    new MutationObserver(cb).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function watchAttrs(el, cb) {
    if (!el) return;
    new MutationObserver(cb).observe(el, { attributes: true });
  }

  function initObservers() {
    watchText(srcYards, renderHero);
    watchText(srcLabel, renderHero);
    watchText(srcPlays, () => {
      renderHero();
      // Class flips (pl-long/pl-short) ride the same node.
      renderHero();
    });
    watchAttrs(srcPlays, renderHero);

    watchText(hudHoleEl, renderStrip);
    watchAttrs(hudEl, renderStrip);
    watchText($('roundMapScore'), renderDotsRefresh);

    // Live wind pill visibility → re-run renderWind so the DEMO strip button
    // hides the moment app.js reveals real wind (no double wind controls).
    const liveWindPill = $('windPill');
    if (liveWindPill) {
      watchAttrs(liveWindPill, renderWind);
      watchText(liveWindPill, renderWind);
    }

    function renderDotsRefresh() {
      renderStrip();
    }

    // Round FAB state → Track action mirror.
    watchAttrs(roundFab, syncDock);
    watchText(roundFab, syncDock);
    watchAttrs(roundFabWrap, syncDock);

    // Recenter lock state → Center action mirror.
    watchAttrs(recenterBtn, syncDock);

    // Layer segment → Satellite action mirror.
    const seg = $('layerSeg');
    if (seg) {
      seg.querySelectorAll('.seg-opt').forEach((o) => watchAttrs(o, syncDock));
    }

    // Green-edge placement mode disables Drop pin.
    const fcbSeg = document.querySelector('.fcb-seg');
    watchAttrs(fcbSeg, syncDock);

    // Sheet movement drives the reticle.
    const sheet = $('sheet');
    if (sheet) {
      sheet.addEventListener('transitionrun', startReticleLoop);
      sheet.addEventListener('transitionstart', startReticleLoop);
      sheet.addEventListener('transitionend', stopReticleLoop);
      sheet.addEventListener('transitioncancel', stopReticleLoop);
    }
    watchAttrs(document.body, () => {
      if (document.body.getAttribute('data-dragging') === '1') startReticleLoop();
      else stopReticleLoop();
    });

    window.addEventListener('resize', placeReticle);
    window.addEventListener('orientationchange', placeReticle);

    // Cross-tab / settings-driven data refreshes.
    window.addEventListener('storage', (e) => {
      if (e.key === CLUBS_KEY) renderClubChip();
      if (e.key === SESSION_KEY) renderStrip();
      if (e.key === WIND_KEY) {
        renderWind();
        syncWindEditor();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        renderHero();
        renderStrip();
        syncDock();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openedSheetEl) closePops();
    });
  }

  /* ================= 9. WIRE UP ================= */

  function initEvents() {
    if (root.clubChip) root.clubChip.addEventListener('click', () => {
      haptic(false);
      openClubPop();
    });
    if (root.actPin) root.actPin.addEventListener('click', () => {
      if (root.actPin.getAttribute('aria-disabled') === 'true') {
        toast('Finish marking the green first.');
        return;
      }
      dropPin();
    });
    if (root.actTrack) root.actTrack.addEventListener('click', trackShot);
    if (root.actCenter) root.actCenter.addEventListener('click', centerOnMe);
    if (root.actSat) root.actSat.addEventListener('click', toggleSatellite);

    if (root.wind) {
      root.wind.addEventListener('click', () => {
        haptic(false);
        syncWindEditor();
        openSheet(root.windPop);
      });
    }
    if (root.windPopClose) root.windPopClose.addEventListener('click', () => closePops());
    if (root.clubPopClose) root.clubPopClose.addEventListener('click', () => closePops());
    if (root.windClear) root.windClear.addEventListener('click', clearWind);
    if (root.scrim) root.scrim.addEventListener('click', () => closePops());
  }

  function init() {
    buildWindEditor();
    initObservers();
    initEvents();
    placeReticle();
    renderHero();
    renderStrip();
    renderWind();
    syncDock();
    // Belt-and-suspenders poll: catches a wind-pill reveal that happened
    // before these observers attached (script-order race on cold start).
    setInterval(renderWind, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
