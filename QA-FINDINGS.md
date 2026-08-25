# Caddy PWA — QA Findings (feat/qa-hardening)

Date: 2026-08-25 · Scope: full app at commit `2cef73d` (Partner sheet). Tested in
headless Chrome (CDP, iPhone-16-Pro-Max viewport) + static analysis + the
project self-test harness (40/40 passing before changes).

Severity: **P0** crash / data loss · **P1** wrong behavior · **P2** polish.
Fix policy: P0/P1 fixed surgically, one commit per finding. P2 recorded only.

---

## P0 — crash / data loss

### QA-001 · Map "Score" button silently discards the score you enter
- **Where:** `app.js` — `els.roundMapScoreBtn.addEventListener('click', openRoundScoreSheet)` (~L6118).
- **Repro:** Start any round → Play tab → tap **Score** on the map HUD → sheet opens titled
  **"Score Hole [object PointerEvent]"** → change score → **Save**.
- **Actual:** The click `PointerEvent` is passed as `holeNumber`, so the draft binds to hole
  `NaN`. Saving writes `state.round[NaN]` (a non-index property that never reaches the
  scorecard). Notice says *"Hole [object PointerEvent] saved."* — the score is gone.
- **Expected:** The sheet opens for the current hole and saves into it.
- **Status:** ✅ FIXED (commit `fix(qa-001)`).

## P1 — wrong behavior

### QA-002 · Partners added in the round-options sheet are silently dropped
- **Where:** `app.js` — `optionsStartBtn` handler (~L6210) vs `closeRoundOptionsSheet()` (~L4121).
- **Repro:** Quick start a saved course → *Change tees, start hole, or group…* → **+ Add partner**
  ("Alex") → **Start Round**.
- **Actual:** The start handler calls `closeRoundOptionsSheet()` **before** reading
  `state.optionsGroupPlayers`; close nulls it, so the round always starts **Solo**. The user's
  explicit group choice is lost (verified: `roundSession.groupPlayers = []`).
- **Expected:** The group shown in the options sheet rides into the new round (that is what
  `_pendingGroupPlayers` was built for).
- **Status:** ✅ FIXED (commit `fix(qa-002)`).

### QA-003 · Duplicate partner names accepted (add *and* rename)
- **Where:** `app.js` — `commitPartnerSheet()` (~L4297) and the group-editor rename handler (~L12417).
- **Repro:** Options sheet → + Add partner → "Tom" → + Add partner → "Tom" again (also
  rename an existing partner to a case-variant of another, e.g. "Tommy"→"tommy").
- **Actual:** Both entries are kept; the saved roster accumulates same-name players with
  different ids. `renderPartnerSuggestions()` filters duplicates from *suggestions only* —
  the commit message "no more duplicate names" promised a real guard.
- **Expected:** Case-insensitive duplicate names are rejected with a notice (rename keeps
  its own name).
- **Status:** ✅ FIXED (commit `fix(qa-003)`).

### QA-004 · Corrupted localStorage of the wrong *shape* crashes rendering (6 modes, one root cause)
- **Where:** `app.js` — hydration (`state` init ~L299, `reloadStateFromStorage()` ~L6786) stores
  whatever `JSON.parse` returns; `load()` guards syntax but not shape.
- **Crash modes observed (all uncaught TypeErrors at boot render):**
  | seeded value | crash site |
  |---|---|
  | `caddy:clubs` = `{}` (object) | `state.clubs is not iterable` — `sortedClubsDesc` L1893 |
  | `caddy:clubs` = `[null,…]` | `Cannot read 'yards' of null` — L1894 |
  | `caddy:round` = `{}` / `123` | `scoreRows.slice is not a function` — `renderRound` L2636 |
  | `caddy:courseProfiles:v1` = `{}` | `object is not iterable` — `planCourseOptions` L11943 |
  | `caddy:shotLog:v1` = `["not","dict"]` | `(log[k]||[]).map is not a function` — `missDirectionSummary` L11076 |
  | `caddy:history` = `[null,null]` | `Cannot read 'totalScore' of null` — `renderStats` L11148 |
- **Impact:** Bag / Round / Prep / Stats tabs break until the key is manually cleared —
  on-device this means a broken PWA after a partial write or an old-schema leftover.
- **Expected:** Wrong-shape values fall back to defaults at hydration; per-entry junk is filtered.
- **Status:** ✅ FIXED (commit `fix(qa-004)` — `loadArr()` shape guard at both hydration sites +
  entry filtering + shot-log value sanitization).

## P2 — polish (recorded, not fixed)

### QA-005 · Partner score input accepts values > 15
Group-table partner cells have `max="15"` but the change handler clamps only the low end
(`-3` → `0`); `99` is stored and totals. One-line clamp would match the attribute.

### QA-006 · Club-row yards: non-numeric silently becomes 1 yd
Typing `abc` in a bag row's yards field sets the club to 1 yard with no feedback (the
add-club form, by contrast, alerts). Inconsistent validation between the two paths.

### QA-007 · No upper bound on club carry yardage
`999999` yd is accepted (add form + row edit); it becomes "longest club" and produces
nonsense layup advice ("675 yd beyond your Driver"). A sane cap (~400 yd, matching the
sync-club clamp at L2508) would bound the damage.

### QA-008 · "Holes entered" hardcodes /18 on 9-hole courses
`renderStats()` renders `${s.played} / 18` regardless of `getCourseHoleCount()`.

### QA-009 · `caddy:roundSession` persists the literal string "null" after a round ends
`saveRoundSession()` runs after `state.roundSession = null`, storing `"null"`. Harmless
today (`migrateRoundSession` early-returns), but it leaves junk state in localStorage.

### QA-010 · Mixed dialog idioms
Club add uses blocking `alert()`; the partner sheet and round options use inline notices.
On iOS PWA `alert()` is a jarring system dialog — the inline notice pattern is the house style.

---

## Verified-clean areas (no action)

- **XSS:** club names, partner names, course names (incl. OSM API results) pushed through
  `<img onerror>` / `<svg onload>` payloads render escaped in every sink found (bag list,
  club chips, club popover, manual selects, quick-start cards, options sheet title, planner
  select, group editor/table, advice/tips pipeline). `escapeHtml` at sink time is consistent.
- **JSON.parse coverage:** every direct `JSON.parse(localStorage…)` is inside try/catch
  (`load`, `osmCacheGet/Set`, backup import).
- **Stats math:** 0 / 1 / 11 rounds, zero-scored rounds, `firRows=0`, null entries, string /
  negative / 1e9 scores → no NaN/Infinity/crash (Wilson CI, Theil-Sen, recency weights all guard).
- **Shot calc:** blank / garbage / negative / huge inputs → alerts or sane fallbacks, no crash.
- **Geolocation denied:** clear recovery notice; nearby search degrades to "waiting for GPS".
- **sw.js:** versioned caches, `cache:'reload'` revalidation on navigation + shell assets
  (no stale-shell window), tile LRU trim, offline fallback page. No staleness bug found.
- **Scoring loop:** all 18 holes via full sheet + mini quick-fix sheet, edit, cycle caps
  (score ≤ 15, putts ≤ 5), FIR/GIR cycling incl. par-3 NA, Clear gating (disabled → confirm →
  clears), hole prev/next clamped 1–18, summary math (total/to-par/putts/FIR/GIR/best hole),
  Save-to-history and Finish-discard both correct.
- **iOS hygiene:** `viewport-fit=cover` + all four `safe-area-inset-*` in CSS, no <44px tap
  targets found, `visualViewport` keyboard handling present, haptics correctly gated on
  `!navigator.vibrate` → hidden-switch Taptic path (and `reduceMotion`).
