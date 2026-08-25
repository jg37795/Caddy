/* ============================================================
   stats.js — Caddy Stats dashboard (game-improvement layer)

   Additive module for the Stats tab. Reads the app's saved-round
   history (localStorage 'caddy:history', written by app.js) and
   renders: trend charts, strengths & weaknesses, badges,
   club insights (from the shot log), and an expandable round
   history — all hand-rolled SVG/DOM, no libraries.

   Contract:
   - Never renames or re-renders app-managed elements.
   - #saveRoundBtn stays fully owned by app.js; we observe its
     clicks in the CAPTURE phase purely to snapshot per-hole
     scorecards into our own namespace ('caddy.stats.*').
   - All new state lives under localStorage prefix 'caddy.stats.'.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------------------------------------------------- *
   *  Storage keys & constants                                   *
   * ---------------------------------------------------------- */

  const K = {
    HISTORY: 'caddy:history',        // app-owned (read-only here)
    ROUND: 'caddy:round',            // app-owned live scorecard (read-only here)
    SESSION: 'caddy:roundSession',   // app-owned; source of hole pars (read-only here)
    SHOT_LOG: 'caddy:shotLog:v1',    // app-owned tracked shots (read-only here)
    CLUBS: 'caddy:clubs',            // app-owned bag (read-only here)

    SNAPSHOTS: 'caddy.stats.roundSnapshots', // per-hole scorecard captures
    FILTER: 'caddy.stats.filter',            // '5' | '10' | 'all'
  };

  const FILTERS = [
    { id: '5', label: 'Last 5' },
    { id: '10', label: 'Last 10' },
    { id: 'all', label: 'All' },
  ];
  const DEFAULT_FILTER = '10';

  const SNAPSHOT_TTL_MS = 180 * 24 * 3600 * 1000; // keep captures ~6 months
  const SNAPSHOT_CAP = 40;
  const JOIN_WINDOW_MS = 5 * 60 * 1000;           // snapshot ↔ history-entry match window

  /* ---------------------------------------------------------- *
   *  Tiny utilities                                             *
   * ---------------------------------------------------------- */

  const $id = (id) => document.getElementById(id);

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const num = (v, f = NaN) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : f;
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const fmt = (n, d = 0) =>
    Number.isFinite(n) ? n.toFixed(d) : '—';

  const signed = (n, d = 0) =>
    Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d) : '—';

  const lsGet = (k, f) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : f;
    } catch {
      return f;
    }
  };

  const lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* private mode / quota — dashboard degrades gracefully */ }
  };

  let dateFmtShort = null;
  function fmtDate(ms) {
    if (!Number.isFinite(ms)) return '—';
    try {
      if (!dateFmtShort) {
        dateFmtShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      }
      const d = new Date(ms);
      return d.getFullYear() === new Date().getFullYear()
        ? dateFmtShort.format(d)
        : `${dateFmtShort.format(d)}, ${d.getFullYear()}`;
    } catch {
      return '—';
    }
  }

  /* ---------------------------------------------------------- *
   *  Data layer                                                 *
   * ---------------------------------------------------------- */

  /**
   * Normalize app history entries into a consistent shape.
   * History entries carry aggregates only (no per-hole data):
   * {date, played, totalScore, puttRows, totalPutts, firRows, firMade,
   *  girRows, girMade, parSplits, onePutts, threePutts, totalPen, ...}
   */
  function loadRounds() {
    const raw = lsGet(K.HISTORY, []);
    if (!Array.isArray(raw)) return [];
    const rounds = [];
    raw.forEach((e, i) => {
      if (!e || typeof e !== 'object') return;
      const played = Math.max(0, num(e.played, 0));
      const score = num(e.totalScore, NaN);
      if (!played || !Number.isFinite(score)) return;

      const puttRows = Math.max(0, num(e.puttRows, 0));
      const firRows = Math.max(0, num(e.firRows, 0));
      const girRows = Math.max(0, num(e.girRows, 0));

      // Estimated course par from the entry's own par splits:
      // parSplits[par].n counts holes played at that par, so
      // Σ(par × n) reconstructs the total par of scored holes.
      const splits = e.parSplits && typeof e.parSplits === 'object' ? e.parSplits : null;
      let estPar = null;
      let splitN = 0;
      if (splits) {
        estPar = 0;
        [3, 4, 5].forEach((p) => {
          const s = splits[p];
          if (s && Number.isFinite(Number(s.n))) {
            estPar += p * Number(s.n);
            splitN += Number(s.n);
          }
        });
        if (!splitN || !estPar) estPar = null;
      }

      rounds.push({
        i,
        date: Date.parse(e.date),
        played,
        score,
        putts: puttRows ? num(e.totalPutts, NaN) : NaN,
        puttRows,
        firMade: firRows ? num(e.firMade, NaN) : NaN,
        firRows,
        girMade: girRows ? num(e.girMade, NaN) : NaN,
        girRows,
        onePutts: Number.isFinite(num(e.onePutts, NaN)) ? num(e.onePutts, 0) : null,
        threePutts: Number.isFinite(num(e.threePutts, NaN)) ? num(e.threePutts, 0) : null,
        penalties: num(e.totalPen, 0) || 0,
        splits,
        estPar,
        vsPar: estPar != null ? score - estPar : null,
        holes: null, // joined below from caddy.stats snapshots
        pars: null,
        snapId: null,
      });
    });
    rounds.sort((a, b) =>
      (Number.isFinite(a.date) ? a.date : Infinity) -
      (Number.isFinite(b.date) ? b.date : Infinity));
    return rounds;
  }

  /** Capture-phase snapshot of the live scorecard when a round is saved. */
  function stashRoundSnapshot() {
    try {
      const round = lsGet(K.ROUND, []);
      if (!Array.isArray(round)) return;
      // Treat '', null, undefined as "no score" — Number('') is 0, which
      // would otherwise masquerade as a played hole.
      const cleanScore = (v) => {
        const s = v == null ? '' : String(v).trim();
        if (s === '') return NaN;
        const n = Number(s);
        return Number.isFinite(n) && n > 0 ? n : NaN;
      };
      const holes = [];
      let total = 0;
      let any = false;
      round.forEach((h) => {
        if (!h || typeof h !== 'object') return;
        const sc = cleanScore(h.score);
        if (Number.isFinite(sc)) { any = true; total += sc; }
        const rawPutts = h.putts == null ? '' : String(h.putts).trim();
        const putts = rawPutts === '' ? NaN : num(rawPutts, NaN);
        holes.push({
          hole: num(h.hole, holes.length + 1),
          score: Number.isFinite(sc) ? sc : null,
          putts: Number.isFinite(putts) && putts >= 0 ? putts : null,
          fir: h.fir === 'Y' || h.fir === 'N' ? h.fir : null,
          gir: h.gir === 'Y' || h.gir === 'N' ? h.gir : null,
        });
      });
      if (!any) return;

      // Hole pars when a course session is attached to the round.
      let pars = null;
      const sess = lsGet(K.SESSION, null);
      if (sess && sess.course && Array.isArray(sess.course.holes)) {
        pars = sess.course.holes.map((h) => (h ? num(h.par, NaN) : NaN));
        if (!pars.some(Number.isFinite)) pars = null;
      }

      const snaps = lsGet(K.SNAPSHOTS, []);
      snaps.push({ ts: Date.now(), total, pars, holes });
      while (snaps.length > SNAPSHOT_CAP) snaps.shift();
      const cutoff = Date.now() - SNAPSHOT_TTL_MS;
      lsSet(K.SNAPSHOTS, snaps.filter((s) => s.ts >= cutoff));
    } catch { /* never break the save flow */ }
  }

  /** Join captured scorecards onto history entries (same total, close in time). */
  function joinSnapshots(rounds) {
    const snaps = lsGet(K.SNAPSHOTS, []).filter((s) => s && Array.isArray(s.holes));
    if (!snaps.length) return;
    const used = new Set();
    rounds.forEach((r) => {
      if (!Number.isFinite(r.date)) return;
      const hit = snaps.find((s) =>
        !used.has(s.ts) &&
        Math.abs(s.ts - r.date) <= JOIN_WINDOW_MS &&
        Math.abs(num(s.total, NaN) - r.score) < 0.01);
      if (hit) {
        used.add(hit.ts);
        r.holes = hit.holes;
        r.pars = Array.isArray(hit.pars) ? hit.pars : null;
        r.snapId = hit.ts;
      }
    });
  }

  /* ---------------------------------------------------------- *
   *  Derived metrics                                            *
   * ---------------------------------------------------------- */

  function applyWindow(rounds, filterId) {
    if (filterId === 'all') return rounds.slice();
    const n = clamp(parseInt(filterId, 10) || DEFAULT_FILTER, 1, 999);
    return rounds.slice(-n);
  }

  /** Weighted aggregates over a set of rounds. */
  function aggregate(rounds) {
    const agg = {
      n: rounds.length,
      avgScore: null,
      avgPuttsPH: null,
      firPct: null,
      girPct: null,
      avgVsPar18: null,
      threePutts: 0,
      onePutts: 0,
      penalties: 0,
      bestScore: null,
    };
    if (!rounds.length) return agg;

    const scores = rounds.map((r) => r.score);
    agg.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    agg.bestScore = Math.min(...scores);

    const pp = rounds.filter((r) => r.puttRows > 0);
    if (pp.length) {
      const pTot = pp.reduce((a, r) => a + r.putts, 0);
      const pHoles = pp.reduce((a, r) => a + r.puttRows, 0);
      agg.avgPuttsPH = pTot / pHoles;
    }
    const fw = (madeKey, rowsKey) => {
      const m = rounds.reduce((a, r) => a + (num(r[madeKey], 0) || 0), 0);
      const t = rounds.reduce((a, r) => a + (num(r[rowsKey], 0) || 0), 0);
      return t > 0 ? (100 * m) / t : null;
    };
    agg.firPct = fw('firMade', 'firRows');
    agg.girPct = fw('girMade', 'girRows');

    const vp = rounds.filter((r) => r.vsPar != null);
    if (vp.length) {
      agg.avgVsPar18 =
        vp.reduce((a, r) => a + (r.vsPar / r.played) * 18, 0) / vp.length;
    }
    agg.threePutts = rounds.reduce((a, r) => a + (r.threePutts || 0), 0);
    agg.onePutts = rounds.reduce((a, r) => a + (r.onePutts || 0), 0);
    agg.penalties = rounds.reduce((a, r) => a + (r.penalties || 0), 0);
    return agg;
  }

  /* Map a metric onto a 0–100 grade given good/bad anchors. */
  const gradeOf = (v, badV, goodV) =>
    !Number.isFinite(v) ? null : clamp(((v - badV) / (goodV - badV)) * 100, 2, 98);

  /**
   * Facets for strengths & weaknesses. Each gets a 0–100 grade so
   * best/worst are relative to THIS player's own facets, plus an
   * absolute read on the value itself.
   */
  function buildFacets(agg) {
    const f = [];
    const push = (facet) => { if (facet.grade != null) f.push(facet); };

    push({
      key: 'driving', label: 'Driving',
      stat: agg.firPct != null ? `${Math.round(agg.firPct)}% fairways` : '',
      grade: gradeOf(agg.firPct, 25, 65),
    });
    push({
      key: 'approach', label: 'Iron play',
      stat: agg.girPct != null ? `${Math.round(agg.girPct)}% greens` : '',
      grade: gradeOf(agg.girPct, 8, 45),
    });
    push({
      key: 'putting', label: 'Putting',
      stat: agg.avgPuttsPH != null ? `${fmt(agg.avgPuttsPH, 2)} putts/hole` : '',
      grade: gradeOf(agg.avgPuttsPH != null ? -agg.avgPuttsPH : NaN, -2.15, -1.72),
    });
    push({
      key: 'scoring', label: 'Scoring',
      stat: agg.avgVsPar18 != null ? `${signed(agg.avgVsPar18, 1)} vs par / rd` :
        agg.avgScore != null ? `${fmt(agg.avgScore, 1)} avg` : '',
      grade: gradeOf(agg.avgVsPar18 != null ? agg.avgVsPar18 :
        agg.avgScore != null ? agg.avgScore - 85 : NaN, 15, -3),
    });
    return f;
  }

  /** Actionable coaching tips, chosen by facet and direction. */
  function tipFor(facet, isBest, agg) {
    if (isBest) {
      switch (facet.key) {
        case 'driving':
          return 'Tee game is dialed. Keep favoring your go-to fairway club on tight holes — position beats distance.';
        case 'approach':
          return 'You\'re finding greens — stay aggressive at the correct yardage and trust the middle of the green.';
        case 'putting':
          return 'Flat stick is hot. Keep the same pre-putt routine and commit to the line you pick.';
        case 'scoring':
          return 'Scores are trending the right way. Protect it: pick conservative targets and take bogey out of play.';
      }
    }
    switch (facet.key) {
      case 'driving':
        return agg && agg.penalties / Math.max(1, agg.n) >= 1
          ? 'Penalties are costing you. Tee off with the club that finds the fairway — swing smooth, not long.'
          : 'Missed fairways adding up? Tee to the wider side of the dogleg and take one less club off the tee.';
      case 'approach':
        return 'Greens missed is your leak. Take one MORE club than feels right and aim for the center — long is safe.';
      case 'putting':
        return agg && agg.threePutts >= agg.n
          ? `${agg.threePutts} three-putts is the leak. On long putts, aim to finish inside a 3-ft circle — pace over line.`
          : 'Speed control drill: lag putts to a towel until you can stop the ball within a grip-length of it.';
      case 'scoring':
        return 'Doubles and worse are inflating scores. Play for the fat part of the green and take your par — hero shots later.';
    }
    return '';
  }

  /* ---------------------------------------------------------- *
   *  SVG trend charts (hand-rolled)                             *
   * ---------------------------------------------------------- */

  let gradSeq = 0;

  /** Catmull-Rom → cubic Bézier smoothing over pixel points. */
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) {
      return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const t = 0.18; // gentle tension
      const c1x = p1[0] + (p2[0] - p0[0]) * t;
      const c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t;
      const c2y = p2[1] - (p3[1] - p1[1]) * t;
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  /**
   * Build one trend chart as an SVG string.
   * cfg: { values[], labels[], unit, decimals, lowerBetter, w, h, compact, name }
   */
  function trendChart(cfg) {
    const vals = cfg.values;
    const W = cfg.w || 356;
    const H = cfg.h || 150;
    const padL = cfg.compact ? 26 : 30;
    const padR = 8;
    const padT = 16;
    const padB = cfg.compact ? 16 : 18;
    const iw = W - padL - padR;
    const ih = H - padT - padB;

    const idx = vals.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
    if (!idx.length) return '';

    let lo = Math.min(...idx.map(([, v]) => v));
    let hi = Math.max(...idx.map(([, v]) => v));
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo;
    lo -= span * 0.12;
    hi += span * 0.12;

    const xAt = (i) => padL + (vals.length > 1 ? (i / (vals.length - 1)) * iw : iw / 2);
    const yAt = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
    const pts = idx.map(([i, v]) => [xAt(i), yAt(v)]);

    // Split contiguous runs so missing weeks don't bridge gaps.
    const segs = [];
    let cur = [pts[0]];
    for (let k = 1; k < idx.length; k++) {
      if (idx[k][0] - idx[k - 1][0] === 1) cur.push(pts[k]);
      else { segs.push(cur); cur = [pts[k]]; }
    }
    segs.push(cur);

    const gid = `sdG${++gradSeq}`;
    const parts = [];

    // Gradient defs (area fade + stroke).
    parts.push(
      `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#18a45b" stop-opacity=".28"/>` +
      `<stop offset="1" stop-color="#18a45b" stop-opacity="0"/>` +
      `</linearGradient></defs>` +
      `<linearGradient id="${gid}L" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#0f7a43"/><stop offset="1" stop-color="#2fd574"/>` +
      `</linearGradient>`
    );

    // Horizontal hairlines: top / mid / bottom.
    [padT, padT + ih / 2, padT + ih].forEach((y) => {
      parts.push(`<line class="sd-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`);
    });

    // Y labels (top & bottom).
    const dec = cfg.decimals != null ? cfg.decimals : 0;
    parts.push(
      `<text class="sd-axis" x="${padL - 5}" y="${padT + 3}" text-anchor="end">${fmt(hi, dec)}</text>`,
      `<text class="sd-axis" x="${padL - 5}" y="${padT + ih + 3}" text-anchor="end">${fmt(lo + span * 0.0, dec)}</text>`
    );

    // Areas + lines.
    segs.forEach((segPts) => {
      if (segPts.length > 1) {
        const line = smoothPath(segPts);
        parts.push(
          `<path d="${line}L${segPts[segPts.length - 1][0].toFixed(1)} ${(padT + ih).toFixed(1)}L${segPts[0][0].toFixed(1)} ${(padT + ih).toFixed(1)}Z" fill="url(#${gid})" stroke="none"/>`,
          `<path class="sd-line" d="${line}" stroke="url(#${gid}L)" vector-effect="non-scaling-stroke"/>`
        );
      }
    });

    // Average reference line.
    const mean = idx.reduce((a, [, v]) => a + v, 0) / idx.length;
    const my = yAt(mean);
    parts.push(`<line class="sd-avg-line" x1="${padL}" y1="${my.toFixed(1)}" x2="${W - padR}" y2="${my.toFixed(1)}"/>`);
    if (!cfg.compact) {
      parts.push(`<text class="sd-axis" x="${W - padR}" y="${(my - 3).toFixed(1)}" text-anchor="end">avg ${fmt(mean, dec)}</text>`);
    }

    // Dots.
    pts.forEach(([x, y], k) => {
      const last = k === pts.length - 1;
      parts.push(last
        ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#2fd574" opacity=".28" class="sd-chart-pulse"/>` +
          `<circle class="sd-dot-last" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"/>`
        : `<circle class="sd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`);
    });

    // X labels: first / mid / last dates.
    const lbl = cfg.labels || [];
    if (!cfg.compact && lbl.length) {
      const picks = lbl.length >= 6
        ? [[0, 'start'], [Math.floor((lbl.length - 1) / 2), 'middle'], [lbl.length - 1, 'end']]
        : [[0, 'start'], [lbl.length - 1, 'end']];
      picks.forEach(([i, anchor]) => {
        if (lbl[i]) {
          parts.push(`<text class="sd-axis" x="${clamp(xAt(i), padL, W - padR)}" y="${H - 4}" text-anchor="${anchor}">${esc(lbl[i])}</text>`);
        }
      });
    }

    return (
      `<svg class="sd-chart" viewBox="0 0 ${W} ${H}" role="img"` +
      ` aria-label="${esc(cfg.name || 'trend')}">${parts.join('')}</svg>`
    );
  }

  /** Delta chip comparing latest value against the earlier average. */
  function deltaChip(vals, lowerBetter, decimals = 1, unit = '') {
    const fin = vals.filter(Number.isFinite);
    if (fin.length < 3) return '<span class="sd-delta flat">—</span>';
    const last = fin[fin.length - 1];
    const prev = fin.slice(0, -1);
    const base = prev.reduce((a, b) => a + b, 0) / prev.length;
    const d = last - base;
    if (Math.abs(d) < 1e-9) return '<span class="sd-delta flat">level</span>';
    const good = lowerBetter ? d < 0 : d > 0;
    const arrow = d < 0 ? '▾' : '▴';
    const txt = `${arrow}${Math.abs(d).toFixed(decimals)}${unit}`;
    return `<span class="sd-delta ${good ? 'good' : 'bad'}">${txt}</span>`;
  }

  /* ---------------------------------------------------------- *
   *  Badge iconography (inline SVG trophies)                    *
   * ---------------------------------------------------------- */

  function trophySVG(tint, tintDark) {
    return (
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
      `<path d="M7.2 3.4h9.6v4a4.8 4.8 0 0 1-9.6 0v-4Z" fill="${tint}"/>` +
      `<path d="M16.8 4.6h2.3a1 1 0 0 1 1 1c0 2-1.5 3.4-3.5 3.7" stroke="${tint}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M7.2 4.6H4.9a1 1 0 0 0-1 1c0 2 1.5 3.4 3.5 3.7" stroke="${tint}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M11 12.2h2v3.4h-2z" fill="${tintDark}"/>` +
      `<path d="M7.6 19.6c0-2.2 2-3.6 4.4-3.6s4.4 1.4 4.4 3.6v.6H7.6v-.6Z" fill="${tintDark}"/>` +
      `<path d="m12 5.4.62 1.26 1.39.2-1 1 .23 1.38L12 8.57l-1.24.67.23-1.38-1-1 1.39-.2L12 5.4Z" fill="#fff" fill-opacity=".85"/>` +
      `</svg>`
    );
  }

  /* ---------------------------------------------------------- *
   *  Section renderers                                          *
   * ---------------------------------------------------------- */

  function renderChips(state) {
    const active = FILTERS.some((f) => f.id === state.filter) ? state.filter : DEFAULT_FILTER;
    return (
      `<div class="sd-chips" role="tablist" aria-label="Rounds window">` +
      FILTERS.map((f) =>
        `<button class="sd-chip${f.id === active ? ' active' : ''}" data-filter="${f.id}"` +
        ` role="tab" aria-selected="${f.id === active}">${f.label}</button>`).join('') +
      `</div>`
    );
  }

  function renderTrends(view, agg) {
    const labels = view.map((r) => fmtDate(r.date));
    const cards = [];

    // Scoring — prefer estimated score vs par; fall back to gross score.
    const useVsPar = view.filter((r) => r.vsPar != null).length >= Math.max(2, Math.ceil(view.length * 0.6));
    const scoreVals = useVsPar
      ? view.map((r) => (r.vsPar != null ? r.vsPar / r.played * 18 : NaN))
      : view.map((r) => r.score);
    if (scoreVals.some(Number.isFinite)) {
      cards.push(
        `<div class="sd-card"><div class="sd-card-head"><h3>${useVsPar ? 'Score vs par' : 'Scoring'} trend</h3>` +
        `${deltaChip(scoreVals, true, 1, useVsPar ? '' : '')}</div>` +
        trendChart({
          values: scoreVals, labels,
          lowerBetter: true, decimals: 1,
          name: useVsPar ? 'Score versus par per round' : 'Total score per round',
        }) +
        (useVsPar
          ? `<div class="sd-note">${esc('Projected 18-hole score relative to par (course par estimated from hole mix).')}</div>`
          : '') +
        `</div>`
      );
    }

    // Putts per round.
    const puttVals = view.map((r) => r.putts);
    if (puttVals.some(Number.isFinite)) {
      cards.push(
        `<div class="sd-card"><div class="sd-card-head"><h3>Putts per round</h3>${deltaChip(puttVals, true, 1)}</div>` +
        trendChart({ values: puttVals, labels, lowerBetter: true, decimals: 0, name: 'Total putts per round' }) +
        (agg.avgPuttsPH != null
          ? `<div class="sd-note">${esc(`${fmt(agg.avgPuttsPH, 2)} putts per hole across these rounds.`)}</div>`
          : '') +
        `</div>`
      );
    }

    // FIR% / GIR% duo.
    const firVals = view.map((r) => (r.firRows ? (100 * r.firMade) / r.firRows : NaN));
    const girVals = view.map((r) => (r.girRows ? (100 * r.girMade) / r.girRows : NaN));
    if (firVals.some(Number.isFinite) || girVals.some(Number.isFinite)) {
      const mini = (title, vals, cur) =>
        `<div class="sd-mini-card"><div class="sd-mini-head"><span class="l">${title}</span>` +
        `<b>${cur != null ? `${Math.round(cur)}%` : '—'}</b></div>` +
        (vals.some(Number.isFinite)
          ? trendChart({ values: vals, lowerBetter: false, decimals: 0, compact: true, h: 108, w: 168, name: `${title} trend` })
          : `<div class="sd-note">No data yet.</div>`) +
        `</div>`;
      cards.push(
        `<div class="sd-card"><div class="sd-card-head"><h3>Accuracy trends</h3>` +
        `<span class="sd-delta flat">${agg.firPct != null && agg.girPct != null ? 'FIR · GIR' : ''}</span></div>` +
        `<div class="sd-chart-duo">${mini('FIR', firVals, agg.firPct)}${mini('GIR', girVals, agg.girPct)}</div></div>`
      );
    }

    if (!cards.length) {
      cards.push('<div class="sd-card"><div class="sd-note">Not enough measurable rounds yet — save a round with putts, FIR or GIR to unlock trends.</div></div>');
    }
    return cards.join('');
  }

  function renderSW(facets, agg) {
    if (facets.length < 2) {
      return `<div class="sd-card"><div class="sd-card-head"><h3>Strengths &amp; focus</h3></div>` +
        `<div class="sd-note">Save rounds with FIR / GIR / putt entries to see what to work on.</div></div>`;
    }
    const sorted = facets.slice().sort((a, b) => b.grade - a.grade);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    const row = (f, isBest) =>
      `<div class="sd-sw-row ${isBest ? 'best' : 'worst'}">` +
      `<div class="sd-sw-top">` +
      `<span class="sd-facet">${esc(f.label)}</span>` +
      `<span class="sd-sw-tag">${isBest ? 'Strength' : 'Focus'}</span>` +
      `</div>` +
      `<div class="sd-sw-top"><span class="sd-sw-val">${esc(f.stat)}</span></div>` +
      `<p class="sd-sw-tip">${esc(tipFor(f, isBest, agg))}</p>` +
      `<div class="sd-sw-meter"><i style="width:${Math.round(f.grade)}%"></i></div>` +
      `</div>`;

    return `<div class="sd-card"><div class="sd-card-head"><h3>Strengths &amp; focus</h3></div>` +
      `<div class="sd-sw">${row(best, true)}${row(worst, false)}</div></div>`;
  }

  function renderBadges(allRounds, view) {
    const pool = view.length >= 3 ? view : allRounds.slice();
    if (pool.length < 2) return '';

    const best = pool.reduce((a, r) => (!a || r.score < a.score ? r : a), null);
    const puttPool = pool.filter((r) => r.puttRows >= Math.max(9, r.played * 0.5));
    const lowPutts = puttPool.length
      ? puttPool.reduce((a, r) => (!a || r.putts < a.putts ? r : a), null)
      : null;
    const girPool = pool.filter((r) => r.girRows >= 9);
    const mostGir = girPool.length
      ? girPool.reduce((a, r) => (!a || r.girMade > a.girMade ? r : a), null)
      : null;

    const badge = (cls, tint, tintDark, val, label, date) =>
      `<div class="sd-badge ${cls}">${trophySVG(tint, tintDark)}` +
      `<div class="sd-badge-v">${esc(val)}</div>` +
      `<div class="sd-badge-l">${esc(label)}</div>` +
      `<div class="sd-badge-d">${esc(date)}</div></div>`;

    let html = '<div class="sd-section-title"><h2>Honors</h2>' +
      `<span class="sd-sub">${pool.length} rounds</span></div><div class="sd-badges sd-card" style="padding:13px">`;
    html += badge('', '#e2b34a', '#b8873b', String(best.score), 'Best round', fmtDate(best.date));
    if (lowPutts) html += badge('g-green', '#34d27b', '#128a48', String(lowPutts.putts), 'Fewest putts', fmtDate(lowPutts.date));
    if (mostGir) html += badge('g-blue', '#63a4ff', '#2563eb', `${mostGir.girMade} GIR`, 'Most greens', fmtDate(mostGir.date));
    html += '</div>';
    return html;
  }

  function renderClubs() {
    const log = lsGet(K.SHOT_LOG, {});
    const clubs = lsGet(K.CLUBS, []);
    if (!log || typeof log !== 'object') return '';

    const norm = (e) => {
      if (Number.isFinite(e)) return { d: e, l: null };
      if (!e || typeof e !== 'object') return null;
      const d = num(e.d, NaN);
      if (!Number.isFinite(d) || d <= 0) return null;
      return { d, l: Number.isFinite(num(e.l, NaN)) ? num(e.l) : null };
    };

    const nameById = {};
    (Array.isArray(clubs) ? clubs : []).forEach((c) => {
      if (c && c.id) nameById[c.id] = c.name || 'Club';
    });

    const rows = Object.keys(log).map((cid) => {
      const shots = (Array.isArray(log[cid]) ? log[cid] : []).map(norm).filter(Boolean);
      if (shots.length < 3) return null;
      const ds = shots.map((s) => s.d);
      const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
      const sd = Math.sqrt(ds.reduce((a, b) => a + (b - avg) ** 2, 0) / ds.length);
      const lat = shots.map((s) => s.l).filter((l) => l != null);
      return {
        cid,
        name: nameById[cid] || 'Club',
        n: shots.length,
        avg,
        sd,
        rel: avg > 0 ? sd / avg : 1,
        rightPct: lat.length >= 5 ? Math.round((lat.filter((l) => l > 0).length / lat.length) * 100) : null,
        latN: lat.length,
      };
    }).filter(Boolean).sort((a, b) => b.n - a.n);

    if (!rows.length) return ''; // skip gracefully — no shot data

    const bandMax = 14, bandMin = 3.5;
    const barW = (rel) => clamp((bandMax - rel) / (bandMax - bandMin), 0.08, 1) * 100;

    const list = rows.slice(0, 6).map((c) =>
      `<div class="sd-club-row">` +
      `<span class="sd-club-name">${esc(c.name)}</span>` +
      `<span class="sd-club-val"><b>${Math.round(c.avg)}</b> yd ±${Math.round(c.sd)} · ${c.n} shots</span>` +
      `<div class="sd-club-bar"><i style="width:${barW(c.rel).toFixed(0)}%"></i></div>` +
      `</div>`).join('');

    const tightest = rows.slice().sort((a, b) => a.rel - b.rel)[0];
    let foot = `Most consistent: <b>${esc(tightest.name)}</b> (${fmt(tightest.rel * 100, 1)}% dispersion).`;
    const latRows = rows.filter((c) => c.rightPct != null);
    if (latRows.length) {
      const tot = latRows.reduce((a, c) => a + c.latN, 0);
      const right = latRows.reduce((a, c) => a + (c.latN * c.rightPct) / 100, 0);
      const rp = Math.round((right / tot) * 100);
      if (rp >= 60 || rp <= 40) {
        foot += ` Tracked misses finish <b>${rp}% ${rp >= 60 ? 'right — aim a touch left' : 'left — aim a touch right'}</b>.`;
      } else {
        foot += ' Misses are nicely balanced left/right.';
      }
    }

    return `<div class="sd-section-title"><h2>Bag insights</h2><span class="sd-sub">tracked shots</span></div>` +
      `<div class="sd-card"><div class="sd-card-head"><h3>Club performance</h3></div>` +
      `<div class="sd-club-rows">${list}</div>` +
      `<div class="sd-club-foot">${foot}</div></div>`;
  }

  function classifyHoles(r) {
    // Birdie/pars counts need per-hole pars; available only when we
    // captured the scorecard alongside a course session.
    if (!r.holes) return null;
    const holes = r.holes.filter((h) => h && h.score != null);
    if (!holes.length) return null;
    const counts = { eaglePlus: 0, birdie: 0, par: 0, bogey: 0, doublePlus: 0, unclassed: 0 };
    const cells = r.holes.map((h, i) => {
      if (!h || h.score == null) return `<span class="sd-hole" style="visibility:hidden"></span>`;
      const par = r.pars && Number.isFinite(r.pars[i]) ? r.pars[i] : null;
      let cls = '';
      if (par != null) {
        const diff = h.score - par;
        if (diff <= -2) { cls = 'birdie'; counts.eaglePlus++; }
        else if (diff === -1) { cls = 'birdie'; counts.birdie++; }
        else if (diff === 0) counts.par++;
        else if (diff === 1) { cls = 'bogey'; counts.bogey++; }
        else { cls = 'double'; counts.doublePlus++; }
      } else {
        counts.unclassed++;
      }
      const title = par != null ? `Hole ${h.hole}: ${h.score} (par ${par})` : `Hole ${h.hole}: ${h.score}`;
      return `<span class="sd-hole ${cls}" title="${esc(title)}">${h.score}</span>`;
    });
    return { cells: cells.join(''), counts, havePars: !!r.pars };
  }

  function renderHistory(view) {
    if (!view.length) return '';
    const items = view.slice().reverse().map((r) => {
      const vs = r.vsPar != null ? signed(r.vsPar) : null;
      const vsCls = r.vsPar != null ? (r.vsPar <= 0 ? 'sd-vs-under' : 'sd-vs-over') : '';
      const subs = [];
      if (Number.isFinite(r.putts)) subs.push(`${r.putts} putts`);
      if (r.firRows) subs.push(`FIR ${r.firMade}/${r.firRows}`);
      if (r.girRows) subs.push(`GIR ${r.girMade}/${r.girRows}`);
      const detail = renderRoundDetail(r);
      return (
        `<div class="sd-round" data-rid="${r.i}">` +
        `<button class="sd-round-btn" type="button" aria-expanded="false">` +
        `<span class="sd-round-score"><b>${r.score}</b>` +
        (vs != null ? `<span class="${vsCls}">${vs}</span>` : '') +
        `</span>` +
        `<span class="sd-round-meta"><span class="sd-round-date">${esc(fmtDate(r.date))}` +
        `${r.played < 18 ? ` · ${r.played} holes` : ''}</span>` +
        (subs.length ? `<span class="sd-round-sub">${subs.map(esc).join('<span>·</span>')}</span>` : '') +
        `</span>` +
        `<svg class="sd-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5.6 6.6 6.4L9 18.4"/></svg>` +
        `</button>` +
        `<div class="sd-detail"><div class="sd-detail-inner"><div class="sd-detail-pad">${detail}</div></div></div>` +
        `</div>`
      );
    }).join('');

    return `<div class="sd-section-title"><h2>Round history</h2>` +
      `<span class="sd-sub">${view.length} round${view.length === 1 ? '' : 's'}</span></div>` +
      `<div class="sd-rounds">${items}</div>`;
  }

  function renderRoundDetail(r) {
    const facts = [];
    if (r.estPar != null) {
      facts.push(['Course par (est.)', String(r.estPar)]);
      facts.push(['Score vs par', signed(r.vsPar)]);
    }
    if (Number.isFinite(r.putts)) {
      facts.push(['Putts', `${r.putts}${r.puttRows ? ` (${fmt(r.putts / r.puttRows, 2)}/hole)` : ''}`]);
    }
    if (r.firRows) facts.push(['Fairways hit', `${r.firMade} of ${r.firRows} (${Math.round((100 * r.firMade) / r.firRows)}%)`]);
    if (r.girRows) facts.push(['Greens hit', `${r.girMade} of ${r.girRows} (${Math.round((100 * r.girMade) / r.girRows)}%)`]);
    if (r.onePutts != null || r.threePutts != null) {
      facts.push(['1-putts / 3-putts', `${r.onePutts != null ? r.onePutts : '—'} / ${r.threePutts != null ? r.threePutts : '—'}`]);
    }
    if (r.penalties) facts.push(['Penalties', String(r.penalties)]);
    if (r.splits) {
      [3, 4, 5].forEach((p) => {
        const s = r.splits[p];
        if (s && Number(s.n) > 0) {
          facts.push([`Avg on par ${p}`, `${fmt(Number(s.total) / Number(s.n), 2)} over ${s.n} hole${Number(s.n) === 1 ? '' : 's'}`]);
        }
      });
    }

    let html = '';
    const cls = classifyHoles(r);
    if (cls) {
      html += `<div class="sd-holes">${cls.cells}</div>`;
      const pills = [];
      if (cls.havePars) {
        if (cls.counts.eaglePlus) pills.push(`<span class="sd-count-pill hi">${cls.counts.eaglePlus} eagle${cls.counts.eaglePlus === 1 ? '' : 's'}+</span>`);
        if (cls.counts.birdie) pills.push(`<span class="sd-count-pill hi">${cls.counts.birdie} birdie${cls.counts.birdie === 1 ? '' : 's'}</span>`);
        if (cls.counts.par) pills.push(`<span class="sd-count-pill">${cls.counts.par} par${cls.counts.par === 1 ? '' : 's'}</span>`);
        if (cls.counts.bogey) pills.push(`<span class="sd-count-pill">${cls.counts.bogey} bogey${cls.counts.bogey === 1 ? '' : 's'}</span>`);
        if (cls.counts.doublePlus) pills.push(`<span class="sd-count-pill lo">${cls.counts.doublePlus} double+</span>`);
      } else {
        pills.push(`<span class="sd-count-pill">${cls.counts.unclassed || r.holes.filter((h) => h && h.score != null).length} holes played</span>`);
      }
      if (pills.length) html += `<div class="sd-counts">${pills.join('')}</div>`;
      const puttsRecorded = r.holes.reduce((a, h) => a + (h && h.putts != null ? 1 : 0), 0);
      if (puttsRecorded) {
        const pTot = r.holes.reduce((a, h) => a + (h && h.putts != null ? h.putts : 0), 0);
        html += `<div class="sd-note">Hole-by-hole from your saved scorecard · ${puttsRecorded} hole${puttsRecorded === 1 ? '' : 's'} with putts (${pTot} total).</div>`;
      }
    } else {
      html += `<div class="sd-note">Hole-by-hole detail wasn't captured for this round — scorecard snapshots start once Stats has seen a save.</div>`;
    }

    if (facts.length) {
      html += `<div class="sd-facts">${facts.map(([k, v]) =>
        `<div class="sd-fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
    }
    return html;
  }

  function renderEmpty() {
    return (
      `<div class="sd-card sd-empty">` +
      `<div class="sd-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M5.5 21.2 12 14.7l6.5 6.5"/><path d="M12 3.2v11.5"/><path d="M12 3.2 8.4 6.8M12 3.2l3.6 3.6"/>` +
      `<circle cx="12" cy="14.7" r="1.4" fill="#fff" stroke="none"/>` +
      `</svg></div>` +
      `<h3>No rounds yet</h3>` +
      `<p>Play a round, enter scores on the Round tab, then tap “Save round to history”. Your trends, badges and insights will build themselves here.</p>` +
      `<button class="sd-empty-btn" type="button" data-goto-round>Start a round</button>` +
      `</div>`
    );
  }

  /* ---------------------------------------------------------- *
   *  Root render                                                *
   * ---------------------------------------------------------- */

  const expandedRounds = new Set();

  function renderDashboard() {
    const host = $id('statsDashboard');
    if (!host) return;

    const all = loadRounds();
    joinSnapshots(all);

    if (!all.length) {
      host.innerHTML = `<div class="sd sd-anim">${renderEmpty()}</div>`;
      return;
    }

    const filter = lsGet(K.FILTER, DEFAULT_FILTER);
    const view = applyWindow(all, filter);
    const agg = aggregate(view);
    const facets = buildFacets(agg);

    host.innerHTML = `<div class="sd sd-anim">` +
      renderChips({ filter }) +
      `<div class="sd-section-title"><h2>Trends</h2>` +
      `<span class="sd-sub">last ${view.length} round${view.length === 1 ? '' : 's'}</span></div>` +
      renderTrends(view, agg) +
      renderSW(facets, agg) +
      renderBadges(all, view) +
      renderClubs() +
      renderHistory(view) +
      `</div>`;

    // Restore expansion state after re-render.
    host.querySelectorAll('.sd-round').forEach((el) => {
      const rid = el.getAttribute('data-rid');
      if (expandedRounds.has(rid)) {
        el.classList.add('open');
        const btn = el.querySelector('.sd-round-btn');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* ---------------------------------------------------------- *
   *  Event wiring                                               *
   * ---------------------------------------------------------- */

  function onClickDelegated(ev) {
    const chipBtn = ev.target.closest && ev.target.closest('.sd-chip[data-filter]');
    if (chipBtn) {
      lsSet(K.FILTER, chipBtn.getAttribute('data-filter'));
      renderDashboard();
      return;
    }

    const roundBtn = ev.target.closest && ev.target.closest('.sd-round-btn');
    if (roundBtn) {
      const wrap = roundBtn.closest('.sd-round');
      if (wrap) {
        const rid = wrap.getAttribute('data-rid');
        const open = wrap.classList.toggle('open');
        roundBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) expandedRounds.add(rid);
        else expandedRounds.delete(rid);
      }
      return;
    }

    if (ev.target.closest && ev.target.closest('[data-goto-round]')) {
      const tab = document.querySelector('.tab-btn[data-tab="round"]');
      if (tab) tab.click();
    }
  }

  function wireOnce() {
    const host = $id('statsDashboard');
    if (!host || host.dataset.sdWired) return;
    host.dataset.sdWired = '1';
    host.addEventListener('click', onClickDelegated);

    // Snapshot the live scorecard BEFORE app.js's own save handler
    // runs (capture phase fires first), so future rounds carry
    // hole-by-hole detail — without touching any round-entry code.
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('#saveRoundBtn');
      if (btn) stashRoundSnapshot();
    }, true);

    // After the app finishes saving (and maybe resetting the card),
    // refresh the dashboard if the Stats tab is visible.
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('#saveRoundBtn');
      if (btn) setTimeout(() => {
        if (document.body.getAttribute('data-tab') === 'stats') renderDashboard();
      }, 120);
    }, false);

    // Cross-tab / cross-window updates.
    window.addEventListener('storage', (ev) => {
      if (ev.key && (ev.key === K.HISTORY || ev.key.startsWith('caddy.stats'))) {
        if (document.body.getAttribute('data-tab') === 'stats') renderDashboard();
      }
    });

    // Re-render whenever the Stats tab becomes active.
    const obs = new MutationObserver(() => {
      if (document.body.getAttribute('data-tab') === 'stats') renderDashboard();
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-tab'] });

    // Initial paint if Stats is already showing.
    if (document.body.getAttribute('data-tab') === 'stats') renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireOnce);
  } else {
    wireOnce();
  }
})();
