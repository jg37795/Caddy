/* ==========================================================================
   bag.js — Premium Bag tab for Caddy.
   Grouped club management (Woods / Irons / Wedges / Putter) with per-club
   detail, a distance-gapping chart and iOS-grade interaction polish.

   Architecture (no core-file surgery required):
   • app.js remains the owner of the canonical club list (`state.clubs`,
     persisted under `caddy:clubs`). Its original flat editor stays in the
     DOM inside a hidden host so every existing behaviour keeps working.
   • This file owns the RICH layer: category, total distance, loft, shaft
     and notes — persisted under `caddy.bag.*` keys.
   • Edits made here are mirrored into app.js by driving its own hidden
     controls (set value → dispatch change / click), so recommendations,
     the manual club picker and shot stats stay perfectly in sync without
     a single line changed in app.js.
   • A MutationObserver on the hidden list catches out-of-band app-side
     changes (backup restore, reset defaults, measured-carry sync) and
     reconciles them into the rich store.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------- constants ------------------------------------------ */

  const STORE_KEY = 'caddy.bag.clubs.v1';
  const UI_KEY = 'caddy.bag.ui.v1';
  const WIDE_GAP_YD = 25; // gaps this large get flagged amber

  const CATS = [
    { id: 'woods', label: 'Woods' },
    { id: 'irons', label: 'Irons' },
    { id: 'wedges', label: 'Wedges' },
    { id: 'putter', label: 'Putter' },
  ];
  const CAT_IDS = CATS.map((c) => c.id);

  /* ---------------- tiny helpers --------------------------------------- */

  const $id = (i) => document.getElementById(i);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  const cssEsc = (s) =>
    window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_-]/g, '');
  const num = (v, f) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : f;
  };
  const clamp = (n, mn, mx) => Math.min(mx, Math.max(mn, n));
  const readJSON = (k, f) => {
    try {
      const r = localStorage.getItem(k);
      return r ? JSON.parse(r) : f;
    } catch {
      return f;
    }
  };
  const writeJSON = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode — session-only */
    }
  };
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- haptics (same trick app.js uses) -------------------- */

  const haptic = (() => {
    let lab = null;
    let lastAt = 0;
    function ensure() {
      if (lab) return lab;
      try {
        const id = 'caddy-bag-haptic-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        input.id = id;
        input.style.all = 'initial';
        input.style.appearance = 'auto';
        input.style.display = 'none';
        lab = document.createElement('label');
        lab.setAttribute('for', id);
        lab.style.display = 'none';
        lab.appendChild(input);
        document.body.appendChild(lab);
      } catch {
        lab = null;
      }
      return lab;
    }
    function tick() {
      if (reduceMotion) return;
      const now = performance.now();
      if (now - lastAt < 16) return; // iOS rate-limits anyway
      const l = ensure();
      if (!l) return;
      lastAt = now;
      try {
        l.click();
      } catch {
        /* garnish only */
      }
    }
    return function haptic(strong) {
      try {
        if (navigator.vibrate) {
          navigator.vibrate(strong ? 28 : 8);
          return;
        }
      } catch {
        /* ignore */
      }
      if (strong) {
        tick();
        setTimeout(tick, 110);
      } else tick();
    };
  })();

  /* ---------------- state ------------------------------------------------ */

  let root = null;
  let store = readJSON(STORE_KEY, null); // [{id,name,yards,total,loft,shaft,notes,cat}]
  let ui = readJSON(UI_KEY, null) || { collapsed: {} }; // {collapsed:{woods:true}}
  let openClubId = null; // expanded editor (session-only)
  let measuredMap = {}; // id -> suggested measured carry (from app stats)
  let warnedLegacy = false;

  if (!Array.isArray(store)) store = [];
  if (!ui || typeof ui !== 'object') ui = { collapsed: {} };
  if (!ui.collapsed || typeof ui.collapsed !== 'object') ui.collapsed = {};
  store = store.filter((c) => c && c.id != null).map(normalizeEntry);

  function normalizeEntry(raw) {
    const c = Object.assign({}, raw);
    c.id = String(c.id);
    c.name = String(c.name == null ? '' : c.name);
    c.yards = clamp(Math.round(num(c.yards, 0)), 0, 600);
    c.cat = CAT_IDS.indexOf(c.cat) > -1 ? c.cat : inferCat(c.name);
    c.total = c.total == null || c.total === '' ? null : clamp(Math.round(num(c.total, 0)), 0, 700);
    if (!(c.total > 0)) c.total = null;
    if (c.loft == null || c.loft === '') c.loft = null;
    else {
      const lf = parseFloat(String(c.loft).replace(/[^0-9.\-]/g, ''));
      c.loft = Number.isFinite(lf) ? clamp(lf, 3, 75) : null;
    }
    c.shaft = c.shaft == null || String(c.shaft).trim() === '' ? null : String(c.shaft).trim();
    c.notes =
      c.notes == null || String(c.notes).trim() === ''
        ? null
        : String(c.notes).trim().slice(0, 400);
    return c;
  }

  function inferCat(name) {
    const n = String(name || '').toLowerCase().trim();
    if (!n) return 'irons';
    if (/putt/.test(n)) return 'putter';
    if (/wedge|°/.test(n)) return 'wedges';
    if (/^(pw|gw|sw|lw|aw)$/.test(n)) return 'wedges';
    if (/driver|wood|hybrid|rescue|\bd?\d*h\b/.test(n)) return 'woods';
    return 'irons';
  }

  const catDef = (id) => CATS.find((c) => c.id === id) || CATS[1];
  const catVarStyle = (id) => {
    const map = {
      woods: ['var(--bag-woods-a)', 'var(--bag-woods-b)'],
      irons: ['var(--bag-irons-a)', 'var(--bag-irons-b)'],
      wedges: ['var(--bag-wedges-a)', 'var(--bag-wedges-b)'],
      putter: ['var(--bag-putter-a)', 'var(--bag-putter-b)'],
    };
    const p = map[id] || map.irons;
    return `--bag-cat-a:${p[0]};--bag-cat-b:${p[1]}`;
  };

  function saveStore() {
    writeJSON(STORE_KEY, store);
  }
  function saveUi() {
    writeJSON(UI_KEY, ui);
  }

  /* ------------- bridge to app.js (hidden legacy controls) --------------- */

  function harvestAppClubs() {
    const out = [];
    const host = $id('clubsList');
    if (host) {
      host.querySelectorAll('.club-row[data-id]').forEach((row) => {
        const id = row.getAttribute('data-id');
        const nameEl = row.querySelector('.club-name-input');
        const yardEl = row.querySelector('.club-yard-input');
        if (!id || !nameEl) return;
        const syncBtn = row.querySelector('.sync-club');
        out.push({
          id,
          name: nameEl.value,
          yards: num(yardEl ? yardEl.value : 0, 0),
          measured: syncBtn ? num(syncBtn.getAttribute('data-measured'), NaN) : NaN,
        });
      });
    }
    if (!out.length) {
      // app.js may not have painted yet (or was refactored) — storage fallback.
      const stored = readJSON('caddy:clubs', null);
      if (Array.isArray(stored)) {
        stored.forEach((c) => {
          if (c && c.id != null)
            out.push({ id: String(c.id), name: String(c.name == null ? '' : c.name), yards: num(c.yards, 0), measured: NaN });
        });
      }
    }
    return out;
  }

  function legacyAvailable() {
    const ok = !!($id('clubsList') && $id('addClubBtn') && $id('resetClubsBtn'));
    if (!ok && !warnedLegacy) {
      warnedLegacy = true;
      console.warn('[bag] legacy club controls missing — running standalone');
    }
    return ok;
  }

  /** Mirror a name/yards change into app.js via its own hidden inputs. */
  function legacyPatch(id, patch) {
    if (!legacyAvailable()) return false;
    const row = document.querySelector('#clubsList .club-row[data-id="' + cssEsc(id) + '"]');
    if (!row) return false;
    const apply = (sel, val) => {
      const el = row.querySelector(sel);
      if (!el) return;
      if (el.value !== String(val)) {
        el.value = String(val);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    if (patch.name != null) apply('.club-name-input', patch.name);
    if (patch.yards != null) apply('.club-yard-input', patch.yards);
    return true;
  }

  /** Add through app.js so the id comes from its own cryptoId(). */
  function legacyAdd(name, yards) {
    if (!legacyAvailable()) return null;
    const n = $id('newClubName');
    const y = $id('newClubYards');
    const b = $id('addClubBtn');
    if (!n || !y || !b) return null;
    const known = new Set(store.map((s) => s.id));
    n.value = name;
    y.value = String(yards);
    b.click();
    n.value = '';
    y.value = '';
    const fresh = harvestAppClubs().find((a) => !known.has(a.id));
    return fresh || null;
  }

  function legacyDelete(id) {
    if (!legacyAvailable()) return false;
    const btn = document.querySelector(
      '#clubsList .club-row[data-id="' + cssEsc(id) + '"] .delete-club'
    );
    if (!btn) return false;
    btn.click();
    return true;
  }

  function legacyResetDefaults() {
    if (!legacyAvailable()) return false;
    const b = $id('resetClubsBtn');
    if (!b) return false;
    b.click(); // app.js owns the confirm dialog
    return true;
  }

  /* ------------- reconciliation (app.js state ⇄ rich store) -------------- */

  function reconcile() {
    const apps = harvestAppClubs();

    // Refresh the measured-carry suggestions surfaced from app.js stats.
    const nextMeasured = {};
    apps.forEach((a) => {
      if (Number.isFinite(a.measured) && a.measured > 0) nextMeasured[a.id] = Math.round(a.measured);
    });

    // Snapshot BEFORE any mutation: the merge below must never alias the old
    // entries (mutating them would corrupt this baseline and skip the save).
    const sigBefore = signature(store) + '|' + JSON.stringify(measuredMap);

    if (!apps.length) {
      // Genuinely empty bag (or nothing painted anywhere yet).
      const measuredChanged = JSON.stringify(nextMeasured) !== JSON.stringify(measuredMap);
      measuredMap = nextMeasured;
      if (store.length) {
        store = [];
        saveStore();
        return true;
      }
      return measuredChanged;
    }

    if (!Array.isArray(store)) store = [];

    const byId = new Map(store.map((c) => [c.id, c]));
    const orphans = store.filter((s) => !apps.some((a) => a.id === s.id));
    const next = [];

    apps.forEach((a) => {
      let s = byId.get(a.id) || null;
      if (!s) {
        // Reset defaults mints fresh ids — reattach enrichment by name.
        const oi = orphans.findIndex((o) => o.name === a.name);
        if (oi > -1) {
          s = Object.assign({}, orphans.splice(oi, 1)[0]);
        } else {
          s = normalizeEntry({ id: a.id, name: a.name, yards: a.yards, cat: inferCat(a.name) });
        }
      } else {
        s = Object.assign({}, s);
      }
      s.id = a.id;
      next.push(s);
    });

    // app.js is authoritative for name + carry.
    const amap = new Map(apps.map((a) => [a.id, a]));
    next.forEach((s) => {
      const a = amap.get(s.id);
      if (!a) return;
      if (s.name !== a.name) s.name = a.name;
      const y = clamp(Math.round(num(a.yards, 0)), 1, 600);
      if (num(s.yards, -1) !== y) s.yards = y;
    });

    store = next;
    measuredMap = nextMeasured;
    const sigAfter = signature(store) + '|' + JSON.stringify(measuredMap);
    if (sigBefore !== sigAfter) saveStore();
    return sigBefore !== sigAfter;
  }

  function signature(list) {
    return list
      .map(
        (c) =>
          `${c.id}:${c.name}:${c.yards}:${c.cat}:${c.total || ''}:${c.loft || ''}:${
            c.shaft || ''
          }:${c.notes || ''}`
      )
      .join('~');
  }

  /* ---------------- derived models --------------------------------------- */

  function visibleClubs() {
    return store.filter((c) => c.name && c.yards > 0);
  }

  function groupedClubs() {
    const vis = visibleClubs();
    return CATS.map((cat) => ({
      cat,
      clubs: vis
        .filter((c) => c.cat === cat.id)
        .sort((a, b) => b.yards - a.yards),
    })).filter((g) => g.clubs.length > 0);
  }

  /* ------------- club confidence (from tracked-shot history) -------------- */

  const SHOTLOG_KEY_BAG = 'caddy:shotLog:v1'; // same store app.js owns — read-only here
  const CONF_UNTESTED_N = 3;   // fewer recorded shots than this → 'untested'
  const CONF_TRUSTED_N = 8;    // shots before a club can earn 'trusted'
  const CONF_TRUSTED_REL_SD = 0.12; // …and carry SD within 12% of average

  let _confCacheRaw = null, _confCache = null;
  function readShotConfidence() {
    // Returns null when the player has no shot history at all (show nothing),
    // else { map: id -> 'untested'|'trusted', trusted: n, untested: n }.
    let raw = null;
    try { raw = localStorage.getItem(SHOTLOG_KEY_BAG); } catch (_) { return null; }
    if (_confCache && raw === _confCacheRaw) return _confCache;
    _confCacheRaw = raw;
    _confCache = computeShotConfidence(raw);
    return _confCache;
  }

  function computeShotConfidence(raw) {
    let log = null;
    try { log = JSON.parse(raw || 'null'); } catch (_) { return null; }
    const norm = (e) => {
      if (Number.isFinite(e)) return e > 0 ? e : null;
      if (!e || typeof e !== 'object') return null;
      const d = Number(e.d);
      return Number.isFinite(d) && d > 0 ? d : null;
    };
    const map = {};
    let any = false;
    if (log && typeof log === 'object') Object.keys(log).forEach((cid) => {
      const arr = Array.isArray(log[cid]) ? log[cid].map(norm).filter(Boolean) : [];
      if (!arr.length) return;
      any = true;
      if (arr.length < CONF_UNTESTED_N) { map[cid] = 'untested'; return; }
      if (arr.length < CONF_TRUSTED_N) return; // enough to be interesting, not yet proven
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - avg) * (b - avg), 0) / arr.length);
      if (avg > 0 && sd / avg <= CONF_TRUSTED_REL_SD) map[cid] = 'trusted';
    });
    if (!any) return null;
    let trusted = 0, untested = 0;
    Object.keys(map).forEach((k) => (map[k] === 'trusted' ? trusted++ : untested++));
    return { map: map, trusted: trusted, untested: untested };
  }

  function confMarkHTML(cid, conf) {
    if (!conf || !conf.map[cid]) return '';
    const kind = conf.map[cid];
    return kind === 'trusted'
      ? '<span class="bag-conf bag-conf-trusted" title="Trusted — ' +
          'consistent carry over many tracked shots" aria-label="Trusted club">✓</span>'
      : '<span class="bag-conf bag-conf-untested" title="Untested — few tracked shots yet" ' +
          'aria-label="Untested club">·</span>';
  }

  function chartModel() {
    const list = visibleClubs().slice().sort((a, b) => a.yards - b.yards);
    const model = { list, rows: [], lo: 0, hi: 1, widest: 0, widestFlagged: false, axisMax: 0 };
    if (!list.length) return model;
    const ys = list.map((c) => c.yards);
    const min = Math.min.apply(null, ys);
    const max = Math.max.apply(null, ys);
    // Scale must reach the longest TOTAL so carry→total ghosts stay visible.
    const maxTotal = Math.max.apply(null, list.map((c) => (c.total && c.total > c.yards ? c.total : c.yards)));
    const span = Math.max(1, max - min);
    model.lo = min - span * 0.05;
    model.hi = maxTotal + span * 0.02;
    model.axisMax = maxTotal;
    const pct = (v) => clamp(((v - model.lo) / (model.hi - model.lo)) * 100, 0, 100);
    list.forEach((c, i) => {
      const prev = i > 0 ? list[i - 1] : null;
      const gap = prev ? c.yards - prev.yards : 0;
      if (gap > model.widest) model.widest = gap;
      const ghostL = c.total && c.total > c.yards ? pct(c.yards) : null;
      const ghostW = ghostL == null ? 0 : Math.max(0, pct(Math.min(c.total, model.hi)) - ghostL);
      model.rows.push({
        c,
        w: pct(c.yards),
        prevPct: prev ? pct(prev.yards) : null,
        // Anchor the pill midway through the gap (between previous bar tip
        // and this bar's start) so it doesn't sit on top of bars.
        pillPct: prev ? pct(prev.yards) + (pct(c.yards) - pct(prev.yards)) / 2 : null,
        gap,
        ghostL,
        ghostW,
        wide: prev ? gap >= WIDE_GAP_YD : false,
      });
    });
    model.widestFlagged = model.widest >= WIDE_GAP_YD;
    return model;
  }

  /* ---------------- svg bits --------------------------------------------- */

  const CHEV_SVG =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8.5 4.5 7 7.5-7 7.5"/></svg>';

  /* ---------------- render ------------------------------------------------ */

  function metaParts(c) {
    const parts = [];
    if (c.loft != null) parts.push(c.loft + '°');
    if (c.shaft) parts.push(c.shaft);
    if (c.total) parts.push(c.total + ' total');
    if (c.notes) {
      const t = c.notes.replace(/\s+/g, ' ').trim();
      parts.push(t.length > 26 ? t.slice(0, 25) + '…' : t);
    }
    return parts;
  }

  function clubRowHTML(c, animate) {
    const open = openClubId === c.id;
    const parts = metaParts(c);
    const meta = parts.length
      ? parts
          .map((p, i) =>
            i === 0 ? esc(p) : '<span class="dot-sep"></span>' + esc(p)
          )
          .join('')
      : 'Loft · shaft · notes';
    const measured = measuredMap[c.id];
    const syncChip = measured
      ? '<button type="button" class="bag-sync-chip" data-act="sync" data-id="' +
        esc(c.id) +
        '" data-measured="' + measured +
        '" title="Adopt measured average from your shots">→ ' + measured + ' yd</button>'
      : '';
    return (
      '<div class="bag-club' + (open ? ' open' : '') + '" data-id="' + esc(c.id) + '">' +
      '<div class="bag-club-top">' +
      '<button type="button" class="bag-club-main" data-act="toggle" data-id="' + esc(c.id) + '"' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="bag-club-dot" style="' + catVarStyle(c.cat) + '"></span>' +
      '<span class="bag-club-id">' +
      '<span class="bag-club-name">' + esc(c.name) + confMarkHTML(c.id, readShotConfidence()) + '</span>' +
      '<span class="bag-club-meta">' + meta + '</span>' +
      '</span>' +
      '<span class="bag-club-yards">' + c.yards + '<small>yd</small></span>' +
      CHEV_SVG.replace('class="ic"', 'class="ic bag-club-chev"') +
      '</button>' + syncChip +
      '</div>' +
      '<div class="bag-club-detail"><div class="bag-club-detail-in">' +
      editorHTML(c, measured) +
      '</div></div>' +
      '</div>'
    );
  }

  function editorHTML(c, measured) {
    const seg = CATS.map(
      (cat) =>
        '<button type="button" class="bag-cat-opt' + (c.cat === cat.id ? ' active' : '') +
        '" data-act="set-cat" data-id="' + esc(c.id) + '" data-val="' + cat.id + '">' +
        cat.label + '</button>'
    ).join('');
    const footInfo = measured
      ? 'Your shots average ' + measured + ' yd carry'
      : c.notes
      ? ''
      : 'Distances power club advice across Caddy';
    return (
      '<div class="bag-editor">' +
      '<div class="bag-field-grid">' +
      '<label class="bag-field full">Name' +
      '<input class="bag-input" inputmode="text" data-f="name" data-id="' + esc(c.id) +
      '" value="' + esc(c.name) + '" placeholder="e.g. 7 Iron" maxlength="24"></label>' +
      fieldHTML('Carry yd', 'yards', c.yards, 'numeric', '', c.id) +
      fieldHTML('Total yd', 'total', c.total == null ? '' : c.total, 'numeric', 'Optional', c.id) +
      fieldHTML('Loft °', 'loft', c.loft == null ? '' : c.loft, 'decimal', 'e.g. 34', c.id) +
      fieldHTML('Shaft', 'shaft', c.shaft == null ? '' : c.shaft, 'text', 'e.g. Stiff 65g', c.id) +
      '<label class="bag-field full">Notes' +
      '<textarea class="bag-input" rows="2" data-f="notes" data-id="' + esc(c.id) +
      '" placeholder="Lie tweak, grip size, how it feels…">' + esc(c.notes == null ? '' : c.notes) + '</textarea></label>' +
      '<div class="bag-field full"><span>Category</span><div class="bag-cat-seg">' + seg + '</div></div>' +
      '</div>' +
      '<div class="bag-editor-foot">' +
      '<span class="bag-loft-badge">' + esc(footInfo) + '</span>' +
      '<button type="button" class="bag-delete-btn" data-act="del" data-id="' + esc(c.id) + '">Delete club</button>' +
      '</div></div>'
    );
  }

  function fieldHTML(label, f, val, inputmode, placeholder, id) {
    return (
      '<label class="bag-field">' + label +
      '<input class="bag-input" inputmode="' + inputmode + '" data-f="' + f + '" data-id="' + esc(id) +
      '" value="' + esc(val == null ? '' : val) +
      '" placeholder="' + esc(placeholder) + '"></label>'
    );
  }

  function addRowHTML(catId, open) {
    if (open) {
      return (
        '<form class="bag-add-form" data-cat="' + catId + '" autocomplete="off">' +
        '<input class="bag-input" data-af="name" placeholder="Club name (e.g. 60°)" maxlength="24" aria-label="Club name">' +
        '<input class="bag-input" data-af="yards" inputmode="numeric" placeholder="Carry yd" aria-label="Carry yards">' +
        '<button type="submit" class="bag-add-go">Add</button>' +
        '<button type="button" class="bag-add-cancel" data-act="add-cancel" aria-label="Cancel">✕</button>' +
        '</form>'
      );
    }
    const label = catId === 'putter' ? 'Add putter' : 'Add to ' + catDef(catId).label;
    return (
      '<button type="button" class="bag-add-row" data-act="add-open" data-cat="' + catId + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
      label + '</button>'
    );
  }

  function groupHTML(g, animate) {
    const collapsed = !!ui.collapsed[g.cat.id];
    const lo = g.clubs[g.clubs.length - 1].yards;
    const hi = g.clubs[0].yards;
    const rows = g.clubs.map((c) => clubRowHTML(c, animate)).join('');
    return (
      '<section class="card bag-group' + (collapsed ? ' collapsed' : '') + (animate ? ' bag-rise' : '') +
      '" data-cat-card="' + g.cat.id + '" style="' + catVarStyle(g.cat.id) + '">' +
      '<button type="button" class="bag-group-head" data-act="group-toggle" data-cat="' + g.cat.id + '"' +
      ' aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
      '<span class="bag-group-dot" aria-hidden="true"></span>' +
      '<span class="bag-group-name">' + g.cat.label + '</span>' +
      '<span class="bag-group-count">' + g.clubs.length + '</span>' +
      '<span class="bag-group-range">' + lo + '–' + hi + ' yd</span>' +
      CHEV_SVG.replace('class="ic"', 'class="ic bag-chevron"') +
      '</button>' +
      '<div class="bag-group-body"><div class="bag-group-inner">' +
      rows +
      addRowHTML(g.cat.id, openAddCat === g.cat.id) +
      '</div></div></section>'
    );
  }

  function chartCardHTML(animate) {
    const m = chartModel();
    if (!m.list.length) return '';
    const n = m.list.length;
    const longest = m.list[m.list.length - 1];

    if (n < 2) {
      const r = m.rows[0];
      return (
        '<section class="card bag-chart-card' + (animate ? ' bag-rise' : '') + '">' +
        '<div class="card-title"><h2>Distance gapping</h2></div>' +
        '<div class="bag-chart-note">Add more clubs to see the distance ladder between them.</div>' +
        '<div class="bag-chart">' + chartRowHTML(r, animate, false) + '</div>' +
        legendHTML(m) + '</section>'
      );
    }

    const widestTxt = '+' + m.widest + ' yd';
    const subline =
      '<b>' + n + '</b> clubs · longest <b>' + esc(longest.name) + ' ' + longest.yards + '</b> · widest gap ' +
      (m.widestFlagged ? '<b class="bag-gap-flag">' : '<b>') + widestTxt + '</b>';
    const conf = readShotConfidence();
    const confTxt =
      conf && conf.trusted
        ? ' · <span class="bag-conf-count"><span class="bag-conf bag-conf-trusted">✓</span> ' +
          conf.trusted + ' trusted' +
          (conf.untested ? ' · <span class="bag-conf bag-conf-untested">·</span> ' + conf.untested + ' untested' : '') +
          '</span>'
        : '';

    const rows = m.rows
      .map((r) => chartRowHTML(r, animate, true, conf))
      .join('');

    return (
      '<section class="card bag-chart-card' + (animate ? ' bag-rise' : '') + '">' +
      '<div class="card-title"><h2>Distance gapping</h2></div>' +
      '<div class="bag-subline">' + subline + confTxt + '</div>' +
      '<div class="bag-chart">' + rows + '</div>' +
      '<div class="bag-chart-axis"><span>' + m.list[0].yards + '</span><span>carry (yd)</span><span>' + m.axisMax + '</span></div>' +
      legendHTML(m) +
      '</section>'
    );
  }

  function chartRowHTML(r, animate, withPill, conf) {
    const style =
      ' style="' + catVarStyle(r.c.cat) + '"';
    const fill =
      '<i class="bag-bar-fill"' + (animate ? '' : ' style="width:' + r.w.toFixed(2) + '%"') +
      ' data-w="' + r.w.toFixed(2) + '"></i>';
    const ghost =
      r.ghostL == null
        ? ''
        : '<i class="bag-bar-ghost" style="left:' + r.ghostL.toFixed(2) + '%;width:' +
          r.ghostW.toFixed(2) + '%"></i>';
    const pill =
      withPill && r.pillPct != null
        ? '<span class="bag-gap-pill' + (r.wide ? ' wide' : '') + '" data-pos="' +
          r.pillPct.toFixed(2) + '"' + (animate ? '' : ' data-noin') + '>+' + r.gap + '</span>'
        : '';
    return (
      '<div class="bag-chart-row" role="button" tabindex="0" data-act="chart-goto" data-id="' + esc(r.c.id) + '"' + style + '>' +
      '<span class="bag-chart-name">' + esc(r.c.name) + confMarkHTML(r.c.id, conf) + '</span>' +
      '<span class="bag-chart-track">' + fill + ghost + pill + '</span>' +
      '<span class="bag-chart-yd">' + r.c.yards + '</span>' +
      '</div>'
    );
  }

  // Clamp each gap pill horizontally so it stays fully inside its track:
  // center must be within [halfWidth + pad, trackWidth - halfWidth - pad].
  function fixGapPills(scope) {
    (scope || document).querySelectorAll('.bag-gap-pill[data-pos]').forEach(function (pill) {
      const track = pill.closest('.bag-chart-track');
      if (!track) return;
      const tw = track.clientWidth;
      const half = pill.offsetWidth / 2;
      const pad = 4;
      const minPx = Math.min(half + pad, tw / 2);
      const maxPx = Math.max(tw - half - pad, tw / 2);
      let x = (parseFloat(pill.dataset.pos) / 100) * tw;
      x = clamp(x, minPx, maxPx);
      pill.style.left = ((x / tw) * 100).toFixed(2) + '%';
    });
  }

  function legendHTML(m) {
    const present = CATS.filter((cat) => m.list.some((c) => c.cat === cat.id));
    const anyTotal = m.list.some((c) => c.total);
    const items = present
      .map(
        (cat) =>
          '<span style="' + catVarStyle(cat.id) + '"><i></i>' + cat.label + '</span>'
      )
      .join('');
    const ghost = anyTotal
      ? '<span class="leg-ghost"><i></i>carry → total</span>'
      : '';
    return '<div class="bag-chart-legend">' + items + ghost + '</div>';
  }

  function toolbarHTML() {
    const n = visibleClubs().length;
    return (
      '<div class="bag-toolbar">' +
      '<span class="bag-toolbar-cap">' + n + (n === 1 ? ' club' : ' clubs') + ' in the bag</span>' +
      '<button type="button" class="bag-reset-btn" data-act="reset">Reset defaults</button>' +
      '</div>'
    );
  }

  function emptyHTML() {
    return (
      '<div class="card bag-empty-card bag-empty bag-rise">' +
      '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M22 14v10M27 15v9M17 15v9"/>' +
      '<path d="M14 23h20l-2 25a5 5 0 0 1-5 4.6h-6a5 5 0 0 1-5-4.6L14 23Z"/>' +
      '<path d="M16.5 33h15"/>' +
      '<circle cx="46" cy="44" r="6"/><path d="M40 30l4.5 9"/>' +
      '</svg>' +
      '<h2>Your bag is empty</h2>' +
      '<p>Add your first club below — carry distances power every recommendation Caddy makes.</p>' +
      '<button type="button" class="bag-add-go" data-act="seed">Load starter bag</button>' +
      '</div>'
    );
  }

  function footHintHTML() {
    return store.length
      ? '<p class="bag-foot-hint">Carry distances drive club advice · total distance and specs stay on this device.</p>'
      : '';
  }

  let openAddCat = null; // which group's add-form is open

  function render(animate) {
    if (!root) return;
    const focusCap = captureFocus();
    const groups = groupedClubs();

    let html = chartCardHTML(animate);
    if (!groups.length) {
      html += emptyHTML();
    } else {
      html += toolbarHTML();
      html += groups.map((g) => groupHTML(g, animate)).join('');
    }
    html += footHintHTML();

    root.innerHTML = html;
    root.classList.toggle('bag-anim', !!animate);
    fixGapPills(root);

    if (animate && !reduceMotion) {
      // Two frames so the zero-width bars are committed before growing.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          root.querySelectorAll('.bag-bar-fill').forEach((el) => {
            el.style.width = (el.getAttribute('data-w') || 0) + '%';
          });
        });
      });
    } else {
      root.querySelectorAll('.bag-bar-fill').forEach((el) => {
        el.style.width = (el.getAttribute('data-w') || 0) + '%';
      });
    }
    restoreFocus(focusCap);
  }

  /* ---------------- focus preservation across re-renders ------------------ */

  function captureFocus() {
    const ae = document.activeElement;
    if (!ae || !root.contains(ae)) return null;
    if (!(ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement)) return null;
    let s = null;
    let e = null;
    try {
      s = ae.selectionStart;
      e = ae.selectionEnd;
    } catch {
      /* type=email etc. */
    }
    return { f: ae.getAttribute('data-f') || '', id: ae.getAttribute('data-id') || '', s, e };
  }

  function restoreFocus(cap) {
    if (!cap || !cap.f || !cap.id) return;
    const el = root.querySelector(
      '[data-f="' + cap.f + '"][data-id="' + cssEsc(cap.id) + '"]'
    );
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      if (cap.s != null && cap.e != null && el.setSelectionRange) el.setSelectionRange(cap.s, cap.e);
    } catch {
      /* ignore */
    }
  }

  /* ---------------- actions ---------------------------------------------- */

  function toggleGroup(catId) {
    ui.collapsed[catId] = !ui.collapsed[catId];
    saveUi();
    const card = root.querySelector('[data-cat-card="' + catId + '"]');
    if (card) {
      card.classList.toggle('collapsed', !!ui.collapsed[catId]);
      const head = card.querySelector('.bag-group-head');
      if (head) head.setAttribute('aria-expanded', ui.collapsed[catId] ? 'false' : 'true');
    }
    haptic(false);
  }

  function toggleClub(id) {
    openClubId = openClubId === id ? null : id;
    openAddCat = null;
    render(false);
    haptic(false);
  }

  function scrollToClub(id) {
    openClubId = id;
    openAddCat = null;
    render(false);
    requestAnimationFrame(() => {
      const el = root.querySelector('.bag-club[data-id="' + cssEsc(id) + '"] .bag-club-main');
      if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
    haptic(false);
  }

  function commitField(input) {
    const id = input.getAttribute('data-id');
    const f = input.getAttribute('data-f');
    const c = store.find((x) => x.id === id);
    if (!c || !f) return;
    const v = input.value;

    if (f === 'name') {
      const nm = String(v).trim() || 'Club';
      c.name = nm;
      legacyPatch(id, { name: nm });
    } else if (f === 'yards') {
      const y = clamp(Math.round(num(v, 0)), 1, 600);
      c.yards = y;
      input.value = String(y);
      legacyPatch(id, { yards: y });
    } else if (f === 'total') {
      const t = String(v).trim() === '' ? null : clamp(Math.round(num(v, 0)), 1, 700);
      c.total = t;
      if (t != null) input.value = String(t);
    } else if (f === 'loft') {
      const t = String(v).trim();
      if (t === '') c.loft = null;
      else {
        const lf = parseFloat(t.replace(/[^0-9.\-]/g, ''));
        c.loft = Number.isFinite(lf) ? clamp(lf, 3, 75) : null;
      }
      if (c.loft != null) input.value = String(c.loft);
    } else if (f === 'shaft') {
      const t = String(v).trim();
      c.shaft = t === '' ? null : t.slice(0, 60);
    } else if (f === 'notes') {
      const t = String(v).trim();
      c.notes = t === '' ? null : t.slice(0, 400);
    } else return;

    saveStore();
    // Re-render (focus-preserving) so row meta, chart bars and pills update.
    render(false);
  }

  function setCat(id, val) {
    const c = store.find((x) => x.id === id);
    if (!c || CAT_IDS.indexOf(val) === -1) return;
    c.cat = val;
    saveStore();
    haptic(false);
    render(false);
  }

  function adoptMeasured(id) {
    const c = store.find((x) => x.id === id);
    const m = Math.round(num(measuredMap[id], NaN));
    if (!c || !Number.isFinite(m) || m <= 0) return;
    c.yards = clamp(m, 1, 600);
    saveStore();
    legacyPatch(id, { yards: c.yards });
    haptic(true);
    render(false);
  }

  function deleteClub(id) {
    const c = store.find((x) => x.id === id);
    if (!c) return;
    if (!window.confirm('Remove ' + (c.name || 'this club') + ' from your bag?')) return;
    if (!legacyDelete(id)) {
      // Legacy path unavailable — delete locally so UI stays truthful.
      store = store.filter((x) => x.id !== id);
      saveStore();
    }
    if (openClubId === id) openClubId = null;
    saveStore();
    haptic(true);
    reconcile();
    render(true);
  }

  function submitAdd(catId) {
    const form = root.querySelector('.bag-add-form[data-cat="' + catId + '"]');
    if (!form) return;
    const nameEl = form.querySelector('[data-af="name"]');
    const ydEl = form.querySelector('[data-af="yards"]');
    const name = String(nameEl ? nameEl.value : '').trim();
    const yards = Math.round(num(ydEl ? ydEl.value : 0, 0));
    if (!name || yards <= 0) {
      haptic(true);
      window.alert('Enter a club name and a positive carry yardage.');
      if (!name && nameEl) nameEl.focus();
      else if (ydEl) ydEl.focus();
      return;
    }
    const fresh = legacyAdd(name, yards);
    const entry = normalizeEntry({
      id: fresh ? fresh.id : 'local-' + Date.now(),
      name,
      yards: clamp(yards, 1, 600),
      cat: catId,
    });
    store.push(entry);
    saveStore();
    openAddCat = null;
    haptic(true);
    render(true);
    requestAnimationFrame(() => {
      const el = root.querySelector('.bag-club[data-id="' + cssEsc(entry.id) + '"] .bag-club-main');
      if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
  }

  /* ---------------- events ------------------------------------------------ */

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const act = t.getAttribute('data-act');
    const id = t.getAttribute('data-id');

    switch (act) {
      case 'group-toggle':
        toggleGroup(t.getAttribute('data-cat'));
        break;
      case 'toggle':
        if (t.classList.contains('bag-club-main')) toggleClub(id);
        break;
      case 'sync':
        e.stopPropagation();
        adoptMeasured(id);
        break;
      case 'del':
        deleteClub(id);
        break;
      case 'reset':
        haptic(true);
        legacyResetDefaults(); // app.js owns the confirm dialog
        break;
      case 'seed':
        haptic(true);
        if (legacyResetDefaults()) {
          /* observer will repaint */
        } else {
          // Standalone fallback: seed sensible defaults ourselves.
          seedLocalDefaults();
          render(true);
        }
        break;
      case 'add-open':
        openAddCat = t.getAttribute('data-cat');
        render(false);
        requestAnimationFrame(() => {
          const el = root.querySelector('.bag-add-form[data-cat="' + openAddCat + '"] [data-af="name"]');
          if (el) el.focus({ preventScroll: false });
        });
        break;
      case 'add-cancel':
        openAddCat = null;
        render(false);
        break;
      case 'set-cat':
        setCat(id, t.getAttribute('data-val'));
        break;
      case 'chart-goto':
        scrollToClub(id);
        break;
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t && t.classList && t.classList.contains('bag-input') && root.contains(t)) {
      if (t.getAttribute('data-id')) commitField(t);
    }
  }

  function onSubmit(e) {
    const form = e.target && e.target.closest
      ? e.target.closest('.bag-add-form')
      : null;
    if (!form || !root.contains(form)) return;
    e.preventDefault(); // never navigate — commit through app.js's own add path
    submitAdd(form.getAttribute('data-cat'));
  }

  function onKeyDown(e) {
    const t = e.target;
    if (!t || !root.contains(t)) return;
    if (e.key === 'Enter' && t.matches && t.matches('.bag-add-form .bag-input')) {
      e.preventDefault();
      const form = t.closest('.bag-add-form');
      if (form) submitAdd(form.getAttribute('data-cat'));
    } else if (e.key === 'Enter' && t.matches && t.matches('input.bag-input')) {
      t.blur(); // commits via change — closes the keyboard like iOS users expect
    }
  }

  function seedLocalDefaults() {
    const defs = [
      ['Driver', 275, 'woods'], ['3 Wood', 250, 'woods'], ['2 Hybrid', 230, 'woods'],
      ['5 Iron', 200, 'irons'], ['6 Iron', 190, 'irons'], ['7 Iron', 180, 'irons'],
      ['8 Iron', 165, 'irons'], ['9 Iron', 150, 'irons'],
      ['PW', 135, 'wedges'], ['GW', 120, 'wedges'], ['54°', 95, 'wedges'], ['Putter', 32, 'putter'],
    ];
    store = defs.map(([nm, y, ct], i) => normalizeEntry({ id: 'local-' + i + '-' + Date.now(), name: nm, yards: y, cat: ct }));
    saveStore();
  }

  /* ---------------- boot --------------------------------------------------- */

  let moQueued = false;
  function scheduleReconcile() {
    if (moQueued) return;
    moQueued = true;
    requestAnimationFrame(() => {
      moQueued = false;
      if (reconcile()) render(false);
    });
  }

  function init() {
    root = $id('bagRoot');
    if (!root) return;

    reconcile(); // seed from app.js's freshly rendered hidden list

    render(true);

    if ($id('clubsList')) {
      const mo = new MutationObserver(scheduleReconcile);
      mo.observe($id('clubsList'), { childList: true, subtree: true });
    }

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', onKeyDown);

    // Safety net: re-check when returning to the app/tab.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleReconcile();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
