# AI_AUDIT.md — Caddy repository technical audit

**Repo:** github.com/jg37795/Caddy · local `C:\Users\wendy\Desktop\Caddy\Caddy-main` · branch `main` @ `bfb2eff`
**Date:** 2026-09-05 · **Mode:** audit only — no code, config, or behavior changed.

---

## 1. How this audit was performed

- Full read of `index.html`, `greenmap.html`, `cache-reset.html`, `sw.js`; targeted reads of every module; scripted scans (Python/regex) across all 14 app JS files for storage keys, fetch targets, endpoints, secrets, `eval`, duplicate ids, duplicate function definitions, dead functions, innerHTML/XSS surface, error handling.
- Cross-checked every dynamic `innerHTML` site and every `els.*` binding against static + dynamically generated markup.
- `git log -S` archaeology to date the origin of suspect code.
- Executed: full test suite (`node tests/*.js`, 16 suites), `node --check` on all 48 JS files, local HTTP serve of every production asset (all 200), live GitHub Pages checks.
- Not executable here: in-browser run (no Chrome on this machine; browser automation timed out — consistent with repo history) and on-device iOS checks → listed under "Manual testing".

**Verification results at audit time:** tests **16/16 PASS**; `node --check` clean; no build/lint/typecheck tooling exists (static site, none configured — nothing to run).

---

## 2. Architecture as it actually works

**Stack:** Zero-build, zero-dependency vanilla JS/CSS/HTML PWA. Vendored Leaflet 1.9.4. No bundler, no package.json, no CI. Deployed by pushing `main` to GitHub Pages (repo root = site root). Total payload ~1.7 MB raw (app.js 569 KB, greenmap.js 257 KB, leaflet.js 233 KB), served gzipped by Pages.

**Two entry points:**
- `index.html` (the app: Play/Round/Bag/Prep/Stats tabs) → loads `leaflet.js`, `app.js` (single 15.3k-line IIFE, `bootstrap()` at tail), `caddy-elev.js`, `holeSat.js`, `greenBriefCore.js`, `outlineStore.js`, then deferred `stats/bag/prep/range/greenlink.js` — each an isolated IIFE communicating via `window` bridges (`window.PrepAPI` etc.) and `localStorage`.
- `greenmap.html` ("3D Green" tool, launched per-hole with `?lat&lng&teelat&teelng&pinlat&pinlng&src&view`) → loads `greenmap.js` (+ `green-detect/satview/greenedit/outlineStore/caddy-elev`).

**Backend:** none. All intelligence on-device. External services (all keyless, no auth):
| Service | Use |
|---|---|
| api.open-meteo.com | weather (10-min TTL) + 9-pt elevation profile (30-day TTL) |
| overpass-api.de (+2 mirrors in app.js) | OSM golf course/green geometry |
| elevation.nationalmap.gov | USGS 3DEP 1 m LiDAR grids (green slope models) |
| photon.komoot.io | course-name geocoding |
| server.arcgisonline.com / tile.openstreetmap.org | satellite / map tiles |

**State & persistence:** no database; `localStorage` is the store (~20 keys: `caddy:round`, `caddy:history`, `caddy:courseProfiles:v1`, `caddy:roundSession`, `caddy:shotLog:v1`, `caddy:greenOutlines:v2`, `caddy:api:*` cache, `caddy.greenBrief:v1`, `caddy.prep.*`, prefs, onboarding flag). All reads/writes wrapped in try/catch; hydration validated for shape (QA-004). `sw.js` = offline-first precache (27 assets) + tile LRU (400) + network-first navigation with own-url caching fix (v1.5.2). Auth: none (personal app; nothing user-identifying leaves the device except API queries).

---

## 3. Confirmed bugs / problems

### C1 · HIGH — Auto green-brief can never run in the app: `GreenMapCore` is never loaded
- **Where:** `index.html` L1464–1467 (script load order) · `greenBriefCore.js` L61 (`build()` guard), L81, L146, L150 · caller `prep.js` L2421–2447 (`runGreenBriefAuto`)
- **What:** `greenBriefCore.js` documents its dependency ("Depends: window.CaddyElev, window.GreenMapCore") and `index.html`'s own comment says it "needs caddy-elev.js + greenmap.js GreenMapCore" — but `index.html` loads `greenBriefCore.js` **without ever loading `greenmap.js`**. `GreenBriefCore.build()` hits `if (... typeof GreenMapCore === 'undefined') return null;` and silently returns null. `prep.js` then catches nothing and proceeds with slope-free wording (its catch comment: "advice falls back to slope-free wording").
- **Why it's a problem:** the v1.18.0 "auto green brief" feature (USGS grid → slope field → putt sim → persisted brief consumed by advice) is dead code in the app shell. Confirmed via `git show 1095119`: the commit added the `greenBriefCore.js` tag + comment but never the `greenmap.js` tag. Tests never caught it because the jsdom suites load `greenmap.js` themselves.
- **Fix:** add `<script src="./greenmap.js"></script>` before `greenBriefCore.js` in `index.html` **and** add `./greenmap.js` to `APP_SHELL` in `sw.js` + bump `CACHE_VERSION` (shell asset set changes). Alternative: split GreenMapCore into its own file to avoid pulling the whole 257 KB tool into the main app — a refactor decision for James.
- **Verify:** open Prep on a mapped hole with no fresh brief → `localStorage['caddy:greenBrief:v1']` becomes populated; advice shows slope-aware wording; add a jsdom assertion that `GreenBriefCore.build()` resolves non-null with both scripts loaded.

### C2 · HIGH (maintenance trap) — Six functions defined twice in the same scope; first copies are dead
- **Where:** `app.js` (single outer IIFE): `integrateTrajectory` L9141/L9662 · `buildEnv` L9397/L9628 · `loadShotLog` L10149/L10383 · `saveShotLog` L10153/L10389 · `clearShotData` L10221/L10395 · `estimateCarryFromTotal` L10173/L10403
- **What:** function declarations in the same scope — the later definition silently shadows the earlier. `integrateTrajectory`/`buildEnv` are a *documented* override ("PATCH B — ZERO-ALLOCATION 3-DOF INTEGRATOR — Overrides: integrateTrajectory, buildEnv", L9620–9626). But the four shot-log functions have **no such marker**: Block 7 (L10110) contains an older, un-memoized copy (no `_shotLogCache`, no cache invalidation) that is fully shadowed by the caching versions at L10383+. ~330 lines of dead physics/logic, differing bodies (e.g. `estimateCarryFromTotal` 14 vs 19 lines).
- **Why it's a problem:** any agent or human editing the *first* copy changes nothing at runtime — a silent no-op edit that can burn hours. This exact pattern (documented PATCH B) shows overrides were deliberate once; the shot-log pair is undocumented drift.
- **Fix (behavior-neutral):** delete the shadowed first copies (keep PATCH B comment + the caching Block 7 versions), or at minimum add the same "OVERRIDDEN BELOW" marker. Then bump `CACHE_VERSION` (app.js is a shell asset).
- **Verify:** `node --check`; 16/16 suites (v1077_elev_unit and the round suites exercise these paths); grep shows single definitions.

### C3 · MEDIUM — Quota-eviction retry in `cachedJSON` is unreachable
- **Where:** `app.js` L2005–2025 (`cachedJSON`)
- **What:** the body is `try { return { data, offline:false, ts }; } catch (quotaErr) { …evict oldest third of caddy:api:* keys…; save again }`. A `return` cannot throw, so the eviction/retry branch never executes. The actual quota failure happens inside `save()` (L2000), whose own try/catch swallows it.
- **Why it's a problem:** the v1.5.2 audit fix ("these keys had no eviction") never actually ships: weather/elevation cache entries accumulate and, on quota exhaustion, writes fail silently instead of evicting. Practical impact is low (entries are small, `load` falls back to refetch), but the intended self-healing is dead code.
- **Fix:** make the write itself the guarded step: `try { save(fullKey, {ts, data}); } catch (quotaErr) { …evict…; save(fullKey, {ts, data}); }` then return.
- **Verify:** jsdom unit test with a `setItem` stub that throws QuotaExceededError once → assert oldest keys removed and second save attempted.

### C4 · MEDIUM — Three version numbers, all stale in different places
- **Where:** `index.html` L13 `CADDY_VERSION='v1.21.6'` · `app.js` L4 `APP_VERSION='1.17.0'` · `sw.js` L2 `CACHE_VERSION='v1.23.0'` (and `greenmap.html` L12 = v1.23.0, correct)
- **What:** the About box renders "Release v1.21.6 (build 1.17.0)" (app.js L8543, L8548–8549) while the actual release is v1.23.0. `index.html` was last touched for v1.21.6's release and nobody updated the constant through v1.21.7→v1.23.0 (each of those commits bumped sw.js + greenmap.html only).
- **Why it's a problem:** the stale-version tell (greenmap's `gm-ver` hint: "if this is old after an update, the service worker is stale") is actively misleading in the main app; bug reports from James will cite a version that doesn't exist.
- **Fix:** one source of truth — e.g. a tiny release step that rewrites the `index.html` constant (same commit discipline as sw.js), or derive `aboutRelease` from `CACHE_VERSION` fetched from sw.js. Also update `APP_VERSION` (feature build number) or drop it.
- **Verify:** `grep CADDY_VERSION index.html` matches `sw.js` `CACHE_VERSION` at every release; About box shows it.

### C5 · MEDIUM — `greenmap.js` uses a single hardcoded Overpass mirror
- **Where:** `greenmap.js` `fetchGreenPolygon` (~L1550s): `fetch('https://overpass-api.de/api/interpreter?data=' + …)`
- **What:** app.js has a 3-mirror retry ladder (`overpassFetch`, L14442: private.coffee → osm.jp → overpass-api.de, validated in v1.5.x audits); the 3D tool's OSM-green fetch bypasses it and hits the primary endpoint directly with no retry.
- **Why it's a problem:** overpass-api.de rate-limits/browns out regularly (repo's own skill notes: "Overpass flakiness: empty results from one mirror are transient — retry remaining mirrors"). A transient 429/502 surfaces to James as "This green isn't mapped yet" for a green that *is* mapped — the exact false-negative the honest-card design tries to avoid.
- **Fix:** route the query through the same ladder (extract `overpassFetch` to a shared scope or duplicate the small ladder in greenmap.js).
- **Verify:** jsdom test stubbing 502 on mirror 1 → assert second mirror attempted; manual field test on a flaky day.

### C6 · LOW — Dead functions in app.js (zero references anywhere)
- **Where:** `getRoundScoreDraft` L6621 (wrapper with no callers — hole-level `getRoundScoreDraftForHole` is used instead) · `cloneCourse` L545 · `kinematicViscosity` L9069 · `renderGroupEditor` L13764 (with its `els.groupEditorList` binding L268 — the live group UI renders via `groupTableWrap`)
- **Why:** dead code; the group-editor one is especially misleading (two "render the group UI" paths, one dead).
- **Fix:** delete (behavior-neutral); verify with 16/16 suites.

### C7 · LOW — Stale `els` bindings for ids that don't exist at boot
- **Where:** `app.js` `els` map (L56+): `windArrow`, `elevProfileChart`, `manual*` family (`manualClub`, `manualYards`, `manualCalcBtn`, `prefillBtn`, …), `roundStatusChip`
- **What:** `els` is captured once at boot. `manual*`/`prefillBtn` markup was deliberately removed in v1.7.1 (guards make those paths no-ops — documented, fine). `elevProfileChart` is created dynamically later and correctly re-queried via `getElementById` at its use site (L12512/12538) — but the boot-time `els` binding stays null forever; `windArrow` is never used at all. `courseSearchRetryBtn`/`planSearchRetryBtn` exist only inside dynamically generated templates (wired at creation — OK).
- **Why:** low-grade confusion; every dangling binding is a candidate for the C2-style trap.
- **Fix:** remove unused bindings (`windArrow`, `els.elevProfileChart`, `manual*` family + their guarded blocks if truly unwanted) — a cleanup pass, not urgent.

---

## 4. Likely issues (probable, needs confirmation)

### L1 · MEDIUM (likely) — `apple-touch-icon` uses a `data:` URI; iOS may ignore it
- **Where:** `index.html` L18–19
- **What:** iOS Safari has historically not honored `data:` URIs for `apple-touch-icon`; the homescreen icon then falls back to a page screenshot. James runs Caddy as a homescreen PWA — if his icon looks right, iOS 17/18 may have relaxed this; if it's a screenshot, this is why.
- **Verify (manual):** re-add to homescreen on the iPhone 16 Pro Max and observe the icon. **Fix if broken:** ship a real 180×180 PNG file and reference it.

### L2 · LOW (likely) — Runtime `data:` manifest with `start_url: '.'`
- **Where:** `app.js` `setManifest()` L1002–1029
- **What:** the manifest is injected as a `data:application/manifest+json,…` URL. Relative URLs (`start_url: '.'`, `scope: '.'`) inside a data: manifest have no meaningful base — Chrome may resolve them against the data: origin or reject them. Harmless on iOS (which uses the `apple-*` meta tags and ignores manifests for homescreen behavior), relevant only for a future Android/Chrome install.
- **Fix if ever needed:** ship a real `manifest.json` (trivial on Pages) instead of the data: URL.

---

## 5. Verified-OK areas (no action needed)

- **Secrets/security:** no API keys, tokens, or credentials anywhere (all services are keyless public endpoints). No `eval`/`new Function`/`document.write`. No CSP meta (hardening recommendation only, R1). All external links safe; no `target="_blank"` without need.
- **XSS surface:** `escapeHtml` defined and used 92× in app.js; every dynamic `innerHTML` site checked renders numbers, escaped terms (`planSearchStatus` escapes user search text), or escaped names (group table L13890–13894). Course names arriving from Overpass/Photon reach the DOM via `textContent` or escaped templates. No injection path found.
- **Storage safety:** every `localStorage` access wrapped; hydration shape-validated; offline-fallback handling for API caches returns stale data labeled `offline:true`.
- **Service worker:** correct precache-failure safety (install throws → old worker stays), own-url navigation caching fix, tile LRU (400), version-prefixed cache cleanup, SKIP_WAITING message. All 27 shell assets exist and serve 200 (locally + live). `sw.js` itself is correctly registered rather than precached.
- **Boot robustness:** v1.7.1 regression guards in place; the app-boot smoke suite asserts listener wiring after boot.
- **Golf math:** units are imperial end-to-end (yd at the UI, metres internally, converted at defined boundaries); sanity bounds on shot capture (40%–160% stock) and restored targets (max 1200 yd); plays-like inverse solve memoized; 3-DOF RK4 integrator is the live path (see C2 for the dead first copy). Weather TTL 10 min, elevation profile TTL 30 d, keyed at 3-decimal coords.
- **Markup:** no duplicate DOM ids in either HTML file.
- **Tests:** 16/16 passing on Node 22 (after the separate getter-only-globals fix, commit `bfb2eff`).

---

## 6. Recommendations (not bugs)

- **R1 · Add a CSP `<meta http-equiv="Content-Security-Policy">`** to both HTML files (e.g. `default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://api.open-meteo.com https://overpass-api.de https://overpass.osm.jp https://overpass.private.coffee https://elevation.nationalmap.gov https://photon.komoot.io; style-src 'self' 'unsafe-inline'`). Cheap hardening; test with the tile hosts listed.
- **R2 · Test-coverage gaps:** no suite touches `bag.js`, `stats.js`, or `sw.js` (and `satview.js` only transitively). Bag/stats are pure-logic-friendly; a boot smoke like `app_boot_smoke.js` each would be cheap. sw.js needs a service-worker environment (minimally: assert APP_SHELL filenames match files on disk — a static test would have caught nothing here but protects future shell edits; C1's fix makes such a test genuinely useful).
- **R3 · Empty catches:** 35 in app.js (mostly deliberate "garnish/no-op" paths). Where a failure means *silent data loss* rather than a skipped nicety (e.g. `save()`), consider a `console.warn` so future field bugs are diagnosable in the Safari Web Inspector.
- **R4 · Payload:** app.js is 569 KB unminified. For a personal PWA behind a service worker this is fine; if first-visit load on cellular ever matters, a minify-at-deploy step (no source changes) is the lever. Also note C1's fix would add greenmap.js (257 KB) to the app shell — the split-core option avoids that.
- **R5 · Key naming:** `caddy.prep.*` (dot) vs `caddy:*` (colon) — cosmetic inconsistency in a ~20-key namespace.
- **R6 · `haptic` is copy-pasted into app/bag/range** (per-file IIFEs, no shared module). Deliberate given the no-build constraint; fine, but any change to the iOS switch trick must be made in 3–4 places (memory: don't re-add sound).

---

## 7. Things requiring manual testing (cannot be verified from this machine)

1. **Homescreen icon** after re-add (L1 above).
2. **iOS haptics** — Safari 17.4 hidden-switch trick still ticks on his device (Regression risk whenever `haptic` copies are touched).
3. **GPS accuracy + follow mode** on course; `watchPosition` high-accuracy behavior in the PWA standalone.
4. **Offline flow:** airplane-mode launch, tile fallback from cache, offline notice wording.
5. **Overpass/USGS live behavior** on a flaky day (ties to C5): does a 429 show the honest "isn't mapped yet" card for a mapped green?
6. **3D tool on-device performance** (canvas + flyover at 128×128 grid) and the new outline model end-to-end at his actual courses (Sugar Creek / Westwood-class data).
7. **SW update path:** after the next release, confirm the `gm-ver`/About version reflects reality within one kill+reopen (depends on C4 fix).

---

## 8. Priority order if fixing later

1. C1 (feature is dark in production) → 2. C4 (user-facing version lies) → 3. C2 (delete dead duplicates; prevents future silent no-op edits) → 4. C5 (field-facing flakiness) → 5. C3 → 6. C6/C7 cleanup → 7. L1 after James's icon check.
