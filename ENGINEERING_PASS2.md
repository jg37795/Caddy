# Caddy engineering pass 2 — v1.24.0

## Scope and baseline

Reviewed AI_AUDIT.md, CLEANUP_REPORT.md and Pass1 commit 815b881 against code.
POST_ASTRA_AUDIT.md was not present in the checkout, remote main, Desktop or
Downloads at the start of this pass; its contents were not assumed.

Retained the static vanilla-JS PWA architecture and existing golf physics.
No runtime dependencies, dependency upgrades, framework changes, or product
redesign. There is no server, login, auth token or runtime environment-variable
configuration: APIs are keyless and user data stays in browser storage.
Handicap-index/net-stroke/Stableford scoring is not implemented; existing
strokeIndex is course metadata, not a player handicap calculation.

Baseline: 19/19 suites, 48/48 in-app self-checks. Those checks missed real
workflow/integration defects; new tests exercise failure states and real DOM
handlers rather than only text assertions.

## Confirmed problems and fixes

### Round, scoring and history

- Nine-hole starts/restores allowed Hole 18 and Clear restored an 18-row card.
  Clamp to the selected layout and retain nine rows across reset/reload.
- The full-sheet partner selection leaked into personal mini-sheet editing,
  copying partner scores and undefined putts into the user's card. Isolate the
  personal draft and keep partner score writes separate.
- Invalid partner numbers and null/invalid persisted rows broke statistics or
  boot. Validate scores and normalize rows without shifting hole positions;
  hydrate before renderers. Recover invalid preferences safely.
- Two save paths produced duplicate aggregate-only history and discarded
  course pars/layout when ending a round. Use stable round identity, upsert,
  embed exact scorecard/course/pars, and preserve completed-card context.
  Stats reads embedded detail; old snapshot data remains a legacy fallback.
- A failed history write could still end the round. Failed persistence now
  leaves the round open for retry/export and reports the failure.
- Discarding a pending shot after losing GPS dereferenced null location.
  Discard remains available without inventing a measured distance.

### Course/green data and calculations

- Play's 3D Green click referenced an out-of-scope `course`. Carry course ID
  in the resolved green payload; preserve course/hole/pin deep-link data.
- Course matching used names alone. Prefer stable/OSM identity, disambiguate
  with location, and refuse ambiguous name-only matches.
- Saved green outlines used coarse coordinate keys plus 100m nearest lookup,
  allowing adjacent greens to share or overwrite records. Use precise owner
  coordinates, tiny coordinate-noise tolerance or containment in the same
  ring; retain/migrate legacy records without associating neighbors.
- First 3D visits ignored saved course rings if OutlineStore had no record;
  source switches used a stale record copy. Adopt the saved ring on empty
  stores and re-read after writes/switches.
- Green briefs decoded only object rings although OutlineStore returns tuples,
  simulated outside the green, included surrounding terrain in mean slope,
  reversed north/south fall, and confused high/low side. Normalize ring shape,
  apply masks, reject unusable data, correct bearings and preserve valid zero.
- Old/neighbor/config-mismatched briefs could supply current-hole advice;
  one global pending job skipped other holes. Validate owner, age, calculation
  revision, ring, tee, radius and stimp; deduplicate per green, coalesce latest
  requests and repaint only the owning visible hole. Restore invalidates old
  work and reloads Prep settings.
- Elevation sampling reflected latitude south-to-north on a north-up TIFF.
  Sample from the northern raster edge. Satellite high-half selection now
  agrees with the physical bearing instead of being rotated 90 degrees.

### API, persistence and offline reliability

- Every live weather request included `sunset` in unsupported `current`
  fields (live HTTP 400). Request daily sunset in Unix time instead; weather
  now returns HTTP 200 and populates actual wind/temperature.
- Coarse elevation-cache keys reused different shot profiles. Key by actual
  requested endpoint precision; invalidate stale context after clearing it.
- Elevation request timeout/cancellation ended at headers. Keep them active
  through JSON/GeoTIFF body reads so bad networks cannot hang loading forever.
- Backup omitted saved outlines, partners, tees, snapshots and settings;
  omitted fields left unrelated old rounds, quota errors claimed success,
  and Bag's stale memory undid restored notes. Extend the allowlist, validate
  before writing, replace absent keys, rollback failed writes, and signal
  in-document rehydration. Disposable API/elevation caches are not backups.
- Offline `greenmap.html?lat=...` returned the main app despite a cached 3D
  document. Canonical route-specific cache keys preserve correct navigation.
  HTTP failures fall back to the correct cached route/asset, while cache quota
  failures no longer discard good network responses.
- Release identifiers drifted across About/HTML/SW. Align them and add a
  production-shell test checking release parity, dependencies and precache.

## Verification performed

- New regression cases failed on the original behavior before fixes.
- Tests, JS syntax and static HTTP-byte checks run after meaningful groups.
- In-app physics/self-checks exercise geodesy, density, launch/ground crossing,
  standard-condition identity, wind direction/asymmetry, altitude, temperature,
  expected strokes, dispersion and tee-set behavior without rewriting math.
- Real Edge mobile viewport: create a 9-hole course, score/edit, reload,
  partner scoring isolation, finish/save history, per-hole Stats, all tabs.
- Real service worker at `/Caddy/`: airplane-mode deep-link into the 3D page
  and return to main without wrong-document fallback or page exceptions.
- Real Play → 3D Green → Back with live USGS elevation and an explicitly
  synthetic course/ring test fixture. No synthetic data shipped to users.
- Live weather HTTP 200 and USGS grid/greenMap smoke passed.
- Ad-hoc ESLint correctness scan used tools installed outside the project;
  four pre-existing unreachable/constant dead-code findings are deferred.
  No TypeScript/typecheck or compiled production build is configured. The
  production artifact remains the checked, served HTML/CSS/JS file set.

## Remaining limits and manual checks

- iPhone homescreen GPS quality, Taptic behavior, screen wake, safe-area and
  keyboard ergonomics need device checks. Edge emulation is not iOS Safari.
- Public Overpass/USGS availability and coverage cannot be guaranteed. Failure
  recovery is tested; cached geometry/data is used where present.
- Old overwritten outlines and missing historical hole detail cannot be
  reconstructed. Legacy aggregate history remains usable but less detailed.
- The app's hand-built data-URI install icon/manifest behavior needs an actual
  iOS install check. No speculative icon/product redesign was performed.
- Full WHS handicap/net scoring would be a separate product/engineering pass,
  not an inferred feature added under bug-fixing authority.
- If another pass is funded, prioritize field-observed golf data/physics
  validation on the user's courses and long-lived state/concurrency testing,
  not cosmetic cleanup or replacement of working modules.
