# AI_AUDIT.md — Caddy repository technical audit (rev 2, re-verified)

**Repo:** github.com/jg37795/Caddy · local `C:\Users\wendy\Desktop\Caddy\Caddy-main` · branch `main` @ `4e3b981`
**First issued:** 2026-09-05 · **Rev 2:** every finding independently re-verified against the working tree; speculative/incorrect items removed or corrected (change log at the bottom). Audit only — no code changed.

---

## 1. Verification commands actually run (exact commands + results)

| # | Command | Result |
|---|---|---|
| V1 | `node --check` on all 32 JS files (16 root app/JS files + `tests/*.js` ×16) | **ALL PASS** — no syntax errors anywhere |
| V2 | `node tests/<suite>.js` × 16 (equivalently the repo's standard loop; there is no test runner script) | **16/16 PASS** (durations 0.07–8.8 s) |
| V3 | Build | **N/A by design** — no build step, no package.json, no bundler; the site is served as-authored from the repo root (GitHub Pages). Nothing to run. |
| V4 | Lint / typecheck | **N/A — none configured** (no eslint/tsc/jsconfig present). `node --check` (V1) is the strongest available syntax gate. |
| V5 | `python -m http.server 8744` at repo root + `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8744/<file>` for each of the 28 shell/production assets + `/` | **ALL 28 assets HTTP 200; `/` → 200** |
| V6 | Live Pages: `curl -s -o /dev/null -w "%{http_code}" https://jg37795.github.io/Caddy/<file>` (app files, CLEANUP_REPORT.md, removed debris) | app files 200; debris 404; report 200 (after CDN refresh) |
| V7 | Scripted scans (Python/regex): storage keys, fetch/endpoint inventory, secrets patterns, `eval`/`new Function`/`document.write`, duplicate DOM ids, duplicate function definitions, dead functions (app.js ∪ tests ∪ other modules), `els.*` bindings vs static/dynamic markup, innerHTML sites vs escaping | results cited inline below |
| V8 | `git log -S` archaeology on suspect code (origin, dates, intent) | cited inline (C1, C2, C4) |
| V9 | In-browser run on this machine | **Not possible** — no Chrome/browser automation available on this host (attempt timed out). Not a repo defect; listed under manual testing. |

---

## 2. Architecture as it actually works

**Stack:** Zero-build, zero-dependency vanilla JS/CSS/HTML PWA. Vendored Leaflet 1.9.4. No bundler, no package.json, no CI, no lint/typecheck. Deployed by pushing `main` to GitHub Pages (repo root = site root). Payload ~1.7 MB raw (app.js 569 KB, greenmap.js 257 KB, leaflet.js 233 KB), gzipped by Pages.

**Two entry points:**
- `index.html` (the app: Play/Round/Bag/Prep/Stats) → loads `leaflet.js`, `app.js` (single 15.3k-line IIFE, `bootstrap()` at tail L15311), `caddy-elev.js`, `holeSat.js`, `greenBriefCore.js`, `outlineStore.js`, then deferred `stats/bag/prep/range/greenlink.js` — each an isolated IIFE communicating via `window` bridges (`window.PrepAPI`, `window.OutlineStore`, `window.GreenBriefCore`, …) and `localStorage`.
- `greenmap.html` ("3D Green" tool, launched with `?lat&lng&teelat&teelng&pinlat&pinlng&src&view`) → loads `greenmap.js` (+ `green-detect/satview/greenedit/outlineStore/caddy-elev`).

**greenmap.js load-time behavior (matters for C1):** the file exports the pure core unconditionally (`window.GreenMapCore = GreenMapCore;` L1227) and then — only if `document` exists — proceeds through data-loading constants and **ends with an unconditional `loadGreen()` call (L5469)**. `loadGreen()` writes `document.getElementById('gm-status').textContent = …` **without a null guard** (L1404–1405). One of only two such unguarded boot writes in the file.

**Backend:** none — all intelligence on-device. External services (all keyless, no auth): api.open-meteo.com (weather 10-min TTL, 9-pt elevation profile 30-day TTL), overpass-api.de + overpass.osm.jp + overpass.private.coffee (OSM geometry; 3-mirror retry ladder in app.js `overpassFetch` L14442), elevation.nationalmap.gov (USGS 3DEP 1 m LiDAR), photon.komoot.io (geocoding), server.arcgisonline.com / tile.openstreetmap.org (tiles).

**State & persistence:** no database. `localStorage` (~20 keys: `caddy:round`, `caddy:history`, `caddy:courseProfiles:v1`, `caddy:roundSession`, `caddy:shotLog:v1`, `caddy:greenOutlines:v2`, `caddy:greenBrief:v1`, `caddy:api:*` caches, `caddy.prep.*`, prefs/onboarding). All access wrapped in try/catch; hydration shape-validated (QA-004). `sw.js`: offline-first precache (27 assets), tile LRU (400), network-first navigation with own-url caching fix (v1.5.2), install-failure keeps old worker. **Auth: none** (personal app; nothing user-identifying leaves the device except API queries).

---

## 3. Confirmed bugs / problems

### C1 · HIGH — Auto green-brief can never run in the app: `GreenMapCore` is never loaded
- **Files:** `index.html` L1464–1467 (script order) · `greenBriefCore.js` L13, L61, L81, L146, L150 · caller `prep.js` L2421–2447 (`runGreenBriefAuto`)
- **Observed:** `greenBriefCore.js` documents its dependency ("Depends: window.CaddyElev, window.GreenMapCore", L13) and `index.html`'s own comment says it "needs caddy-elev.js + greenmap.js GreenMapCore" — but `index.html` never loads `greenmap.js`. `GreenBriefCore.build()` returns `null` at `if (typeof CaddyElev === 'undefined' || typeof GreenMapCore === 'undefined') return null;` (L61). prep.js's only `GreenBriefCore.build` call therefore always yields null → the catch comment applies: "advice falls back to slope-free wording". No `caddy:greenBrief:v1` write ever occurs from the app shell (verified: app.js 0, prep.js calls build but the write lives inside greenBriefCore's build, which early-returns). Confirmed origin: `git show 1095119` (v1.18.0, 2026-09-01) added the `greenBriefCore.js` tag + the dependency comment but not the `greenmap.js` tag.
- **Why it matters:** a shipped feature (USGS grid → slope field → putt sim → persisted green brief consumed by Prep advice) is dark in production. Tests never catch it because the jsdom suites load `greenmap.js` themselves before exercising `greenBriefCore`.
- **Recommended fix (behavior-preserving; both paths need a `CACHE_VERSION` bump since `app.js`/`index.html` are shell assets):**
  1. *Minimal:* add `<script src="./greenmap.js"></script>` before `greenBriefCore.js` in `index.html` — **but this is unsafe as-is**: greenmap.js runs `loadGreen()` at load time and `loadGreen()` does `document.getElementById('gm-status').textContent = …` unguarded (L1404–1405); `gm-status` does not exist in index.html (verified) → **boot crash**. So even the minimal path requires first adding a null guard at greenmap.js L1404–1405 (one line) and ideally a bare-URL early-exit for a foreign host page.
  2. *Cleaner:* extract the pure core (`GreenMapCore`, the headless-tested section up to L1227) into its own `greenmap-core.js`, load that in both pages, and have `greenmap.js` consume it. No 257 KB payload added to the app shell.
  2 is the recommendation; 1 is the smallest diff.
- **Verify:** on-device or jsdom: load order per fix → `typeof GreenMapCore !== 'undefined'` in the app page; open Prep on a mapped hole with no fresh brief → `localStorage['caddy:greenBrief:v1']` becomes populated and advice shows slope-aware wording; add a jsdom assertion that `GreenBriefCore.build()` resolves non-null with the fixed load order; re-run all 16 suites.

### C2 · HIGH (maintenance trap) — Six functions defined twice in the same scope; first copies are dead
- **File:** `app.js` (single outer IIFE — brace-depth-verified, all definitions at depth 1)
  - `integrateTrajectory` L9141 (dead) / L9662 (live) · `buildEnv` L9397 (dead) / L9628 (live)
  - `loadShotLog` L10149 (dead) / L10383 (live) · `saveShotLog` L10153 (dead) / L10389 (live) · `clearShotData` L10221 (dead) / L10395 (live) · `estimateCarryFromTotal` L10173 (dead) / L10403 (live)
- **Observed:** function declarations in one scope — the later shadows the earlier. `integrateTrajectory`/`buildEnv` are documented ("PATCH B — ZERO-ALLOCATION 3-DOF INTEGRATOR / Overrides: integrateTrajectory, buildEnv", L9620–9626). The four shot-log functions are **undocumented** drift: Block 7 (L10110) still contains the older un-memoized copies (no `_shotLogCache`, no cache invalidation) fully shadowed by the caching versions at L10383+. Bodies differ (hash-verified: e.g. `estimateCarryFromTotal` 14 vs 19 lines).
- **Why it matters:** editing a shadowed first copy is a silent no-op at runtime — the highest-probability way for a future agent to burn hours or believe it shipped a fix. ~330 dead lines of physics/logic.
- **Recommended fix (behavior-neutral):** delete the four undocumented shadowed copies (keep PATCH B's marker comment; consider adding "OVERRIDDEN BELOW" markers on the two physics pairs if full deletion of those is deferred), then bump `CACHE_VERSION`.
- **Verify:** `node --check`; 16/16 suites (v1077_elev_unit, v1218/v1219/v1230 exercise these paths); scripted scan shows one definition per name.

### C3 · MEDIUM — Quota-eviction retry in `cachedJSON` is unreachable
- **File:** `app.js` L2005–2025 (`cachedJSON`)
- **Observed:** the body is `try { return { data, offline: false, ts }; } catch (quotaErr) { …evict oldest third of caddy:api:* keys…; save again }`. A `return` cannot throw, so the eviction branch never executes. The real quota failure happens in `save()` (L2000), whose internal try/catch swallows it.
- **Why it matters:** the v1.5.2 audit fix ("these keys had no eviction — every ~1 km-weather / ~110 m-elev grid point saved a fresh localStorage entry forever") never actually ships; on quota exhaustion, API-cache writes fail silently instead of self-healing.
- **Recommended fix:** guard the write itself: `try { save(fullKey, { ts, data }); } catch (quotaErr) { …evict…; save(fullKey, { ts, data }); }` then return.
- **Verify:** jsdom unit test stubbing `setItem` to throw QuotaExceededError once → assert oldest keys removed and second save attempted; confirm normal path unchanged (16/16).

### C4 · MEDIUM — Three version numbers, all stale in different places
- **Files:** `index.html` L13 `window.CADDY_VERSION = 'v1.21.6'` · `app.js` L4 `const APP_VERSION = '1.17.0'` · `sw.js` L2 `CACHE_VERSION = 'v1.23.0'` · (`greenmap.html` L12 = v1.23.0, correct)
- **Observed:** the About box renders "Caddy 1.17.0 … Release v1.21.6 (build 1.17.0)" (app.js L8543, L8548–8549) while the live release is v1.23.0. `git log` shows `index.html` last bumped at v1.21.6 (`fadcd96`); v1.21.7→v1.23.0 bumped `sw.js` + `greenmap.html` only. Two schemes coexist by design (comment L8540: `APP_VERSION` = build/features, `CADDY_VERSION` = release train) but neither is maintained in the main app.
- **Why it matters:** the stale-SW tell (greenmap's `gm-ver` tooltip: "if this is old after an update, the service worker is stale") misleads in the main app; bug reports from James will cite a version that never shipped.
- **Recommended fix:** single source of truth — a release step that rewrites the `index.html` constant in the same commit as the `sw.js` bump, or render `aboutRelease` from `CACHE_VERSION` fetched from the registered worker. Decide whether `APP_VERSION` stays meaningful or is dropped.
- **Verify:** `grep CADDY_VERSION index.html` matches `sw.js CACHE_VERSION` after every release; About box + `gm-ver` show the live release.

### C5 · MEDIUM — `greenmap.js` uses a single hardcoded Overpass mirror, no retry
- **File:** `greenmap.js` — `fetchGreenPolygon` (defined L1351), direct call at L1358: `fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), { signal })`
- **Observed:** app.js has a validated 3-mirror retry ladder (`overpassFetch` L14442: overpass.private.coffee → overpass.osm.jp → overpass-api.de, with timeout + backoff); the 3D tool's OSM-green fetch bypasses it entirely.
- **Why it matters:** overpass-api.de rate-limits/browns out regularly (documented in this repo's own ops notes: "empty results from one mirror are transient — retry remaining mirrors"). A transient 429/502 surfaces as "This green isn't mapped yet" for a green that *is* mapped — the exact false-negative the honest-card design tries to avoid.
- **Recommended fix:** route the query through the same ladder — either expose `overpassFetch` on a shared `window` bridge (it lives in app.js's IIFE) or duplicate the small ladder inside greenmap.js.
- **Verify:** jsdom test stubbing mirror 1 → 502, assert mirror 2 attempted; field test on a flaky day.

### C6 · LOW — Dead functions in app.js (zero references anywhere, re-checked against app.js, all other modules, and `tests/`)
- **File:** `app.js`
  - `getRoundScoreDraft` L6621 — one-line wrapper over `getRoundScoreDraftForHole`; no callers (the hole-level function is used everywhere).
  - `cloneCourse` L545 — no callers.
  - `kinematicViscosity` L9069 — no callers.
  - `renderGroupEditor` L13764 — no callers; the live group UI renders via `groupTableWrap` (L13901). Misleading because it looks like a second rendering path for the same screen. (Its `els.groupEditorList` binding is covered by C7.)
- **Why it matters:** dead code; the group-editor one invites duplicated maintenance.
- **Recommended fix:** delete (behavior-neutral); verify with V1 + V2.

### C7 · LOW — Stale `els` bindings and one dead local, remnants of removed markup
- **File:** `app.js` — `els` map defined L56–L272 (208 entries, bound once at boot)
- **Observed (corrected from rev 1 — see change log):**
  - The `manual*` family (`manualClub` L177, `manualYards` L176, `manualCalcBtn` L185, `prefillBtn` L186, `manualAltitude/Bearing/ElevDiff/Rh/Temp/WindDir/WindSpeed/Rec/RecSub/Breakdown`) bind ids that were deliberately removed from index.html in v1.7.1. Every use is null-guarded (`initManualCalc` L12621+ returns early; render path L2677 guards) → **no runtime bug**, but 11 bindings + guarded code blocks for markup that never exists.
  - `els.groupEditorList` L268 — id exists nowhere (static or dynamic); only consumer is the dead `renderGroupEditor` (C6).
  - `els.roundStatusChip` L195 — documented intentional legacy guard ("Status chip was retired with the top bar; keep a safe guard in case any theme re-adds it", L3959–3961). **Not a defect**; listed only for completeness.
  - `const windArrow = $('windArrow')` L11395 (`updateWeatherUI`) — a **dead local**: `#windArrow` doesn't exist in index.html, and the variable is never subsequently used in the function body. Harmless, but it is a live code line querying a removed element on every weather update.
  - `elevProfileChart` — **not dead and not an els entry** (rev-1 error): created dynamically at L12538 and correctly re-queried at L12512. No issue.
- **Why it matters:** every dangling binding/guard is a candidate for the C2-style silent-no-op trap and slows audits.
- **Recommended fix:** remove the `manual*` bindings + their guarded blocks if the feature is truly gone (product decision — James removed the calculator deliberately), remove `els.groupEditorList` with `renderGroupEditor` (C6), delete the dead `windArrow` local. Leave `roundStatusChip` as-is (documented intent).
- **Verify:** V1 + V2; grep for the removed identifiers returns nothing.

---

## 4. Likely issues (probable, needs device confirmation)

### L1 · MEDIUM (likely) — `apple-touch-icon` uses a `data:` URI; iOS may ignore it
- **File:** `index.html` L18–19
- **Observed:** the 180×180 icon is an inline `data:image/svg+xml,…` URI. iOS Safari has historically not honored `data:` URIs for `apple-touch-icon` (falls back to a page screenshot). James runs Caddy as a homescreen PWA, so this is user-visible if present.
- **Why it matters:** wrong homescreen icon; also SVG is non-standard for this rel.
- **Verify (manual):** re-add to homescreen on the iPhone 16 Pro Max and observe. **Fix if broken:** ship a real 180×180 PNG and reference it (also then add it to `APP_SHELL` + bump `CACHE_VERSION`).

### L2 · LOW (likely) — Runtime `data:` manifest with relative `start_url`/`scope`
- **File:** `app.js` `setManifest()` L1002–1029
- **Observed:** the manifest is injected as `data:application/manifest+json,…` containing `start_url: '.'`, `scope: '.'`. Relative URLs inside a `data:` manifest have no useful base — Chrome may resolve them against the data: origin or reject them. Harmless on iOS (uses `apple-*` meta tags; ignores manifests for homescreen); relevant only for a future Android/Chrome install.
- **Fix if ever needed:** ship a real `manifest.json` (trivial on Pages) instead of the data: URL.

---

## 5. Verified-OK areas (re-checked in rev 2; no action)

- **Secrets/security:** no API keys/tokens/credentials anywhere (all services keyless). No `eval` / `new Function` / `document.write` (scan = 0). No CSP meta (hardening rec R1). No `target="_blank"` anywhere.
- **XSS surface:** `escapeHtml` used 92× in app.js (+7 in prep.js); every dynamic `innerHTML` site re-checked renders numbers, escaped user search text (`planSearchStatus` L13428/L13497), or escaped names (group table L13890–13894). Course names from Overpass/Photon reach the DOM via `textContent` or escaped templates. No injection path found.
- **Storage safety:** every `localStorage` access try/catch-wrapped; hydration shape-validated; offline API fallback returns stale data labeled `offline:true`.
- **Service worker:** correct install-failure safety, own-url navigation caching fix, tile LRU (400), version-prefixed cleanup, SKIP_WAITING. All 27 precache assets exist and serve 200 (V5). `sw.js` correctly registered, not precached. No duplicate ids in either HTML file (scan).
- **Boot robustness:** v1.7.1 regression guards verified in place; `app_boot_smoke` asserts post-boot listener wiring.
- **Golf math:** imperial at the UI, metres internal, converted at defined boundaries; sanity bounds on shot capture (40%–160% of stock) and restored targets (≤1200 yd); plays-like inverse solve memoized; the live 3-DOF RK4 path is the PATCH B version (dead first copy = C2). Weather TTL 10 min; elevation-profile TTL 30 d keyed at 3-decimal coords.
- **Tests:** 16/16 pass on Node 22 (V2), including after the earlier test-only globals fix (`bfb2eff`).

---

## 6. Recommendations (not bugs)

- **R1 · CSP meta** on both HTML files, e.g. `default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://api.open-meteo.com https://overpass-api.de https://overpass.osm.jp https://overpass.private.coffee https://elevation.nationalmap.gov https://photon.komoot.io; style-src 'self' 'unsafe-inline'`. Cheap hardening; verify tiles/USGS still load on device.
- **R2 · Coverage gaps:** no suite touches `bag.js`, `stats.js`, or `sw.js` (`satview.js` only transitively). A boot smoke per bag/stats (pattern of `app_boot_smoke.js`) is cheap. A static test asserting every `APP_SHELL` filename exists on disk protects future shell edits (and would gate C1's fix).
- **R3 · Empty catches:** 35 in app.js (most deliberate no-ops). Where failure means silent data loss rather than a skipped nicety (e.g. `save()`), a `console.warn` would make field bugs diagnosable in Safari's Web Inspector.
- **R4 · Payload:** app.js 569 KB unminified — fine for a personal PWA behind a SW; if first-visit cellular load ever matters, a minify-at-deploy step is the lever. Note C1 fix option 2 (core extraction) avoids adding 257 KB to the app shell; option 1 adds it.
- **R5 · Key naming:** `caddy.prep.*` (dot) vs `caddy:*` (colon) — cosmetic inconsistency in a ~20-key namespace.
- **R6 · `haptic` copy-pasted into app/bag/range (+prep)** (per-file IIFEs; no shared module). Deliberate under the no-build constraint; any change to the iOS switch trick must be made in all copies. (Standing rule: no sound feedback.)

---

## 7. Manual testing requirements (not verifiable from this machine)

1. **Homescreen icon** after re-add (L1).
2. **iOS haptics** — the Safari 17.4 hidden-switch tick on his device (3–4 code copies carry it).
3. **GPS accuracy + follow mode** on course; `watchPosition` high-accuracy behavior standalone.
4. **Offline flow:** airplane-mode launch, tile fallback, offline notice wording.
5. **Overpass/USGS flaky-day behavior** (ties to C5): does a 429 show "isn't mapped yet" for a mapped green?
6. **3D tool on-device performance** (128×128 grid, flyover) and the v1.23.0 outline model end-to-end at his courses.
7. **SW update path** after the next release: About/`gm-ver` reflect reality within one kill+reopen (blocked today by C4).

---

## 8. Priority order if fixing later

1. C1 (shipped feature dark in production; use core-extraction option, or minimal option **with** the L1404 guard — naive tag-add crashes boot) → 2. C4 (user-facing version lies) → 3. C2 (delete dead duplicates; prevents silent no-op edits) → 4. C5 (field-facing flakiness) → 5. C3 → 6. C6/C7 cleanup → 7. L1 after James's icon check.

---

## Rev 2 change log (what was re-verified, corrected, or removed)

- **C7 rewritten.** Rev 1 wrongly listed `windArrow` and `elevProfileChart` as stale `els` bindings: `windArrow` is actually a dead *local* `const` inside `updateWeatherUI` (L11395; the els map never had it), and `elevProfileChart` is legitimately created/re-queried dynamically (L12512/12538) — removed as an issue. `els.roundStatusChip` reclassified as documented intentional legacy guard, not a defect. The `manual*` family's guards were verified line-by-line (no runtime bug; kept as cleanup-grade only). `els.groupEditorList` remains valid (dead binding tied to C6).
- **C1 strengthened.** Re-verification found that rev 1's "minimal fix" (add the script tag) would itself **crash boot**: `greenmap.js` unconditionally calls `loadGreen()` (L5469) which writes `gm-status` unguarded (L1404–1405), and that id doesn't exist in index.html. The fix recommendation now states both options explicitly, including the guard requirement and the core-extraction alternative.
- **C2/C3/C4/C5/C6 re-confirmed** with hash-verified duplicate bodies, exact line numbers re-checked, and origin commits cited. C5 line numbers corrected (`fetchGreenPolygon` L1351, call L1358).
- **Verification section replaced** with the exact commands and results (V1–V9), including the explicit N/A rationale for build/lint/typecheck.
- **Security/storage/architecture claims re-scanned** — all previously reported OK-items held (escapeHtml 92×, 0 eval, 0 target=_blank, no duplicate ids, 28/28 assets 200).
- No findings were removed entirely except the two phantom C7 items noted above; no speculative claims remain.
