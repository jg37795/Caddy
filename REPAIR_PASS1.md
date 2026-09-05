# Caddy — functional repair pass 1

Baseline: `8bca348` on `main`; read CLEANUP_REPORT.md and AI_AUDIT.md.
Architecture remains a zero-build static PWA with two HTML entry points,
window bridges, localStorage persistence and keyless external APIs. No rewrite,
dependency changes, styling changes or physics-algorithm changes.

## Three independently confirmed issues fixed

1. **C1 — Prep green briefs always returned null.** index.html omitted the
   existing GreenMapCore dependency. Load greenmap.js before greenBriefCore.js
   and stop its page-specific initialization when gm-canvas is absent.
   Reuses the same math without moving or duplicating it. The script was
   already in the offline precache.
2. **C5 — one failed Overpass server hid mapped greens.** Retry across the
   app's existing three mirrors, then one backed-off primary attempt.
   Timeouts cover response-body reads; cancellation stops further requests.
   Preserve nearest-green selection and existing stored-outline priority.
   Distinguish lookup unavailable from a successful unmapped result.
3. **C3 — cache quota recovery never executed.** Catch the real setItem
   failure, evict only the oldest disposable API entries, and retry once.
   Storage failure never replaces successful fresh data with stale data.
   Round, history, course and shot records are outside eviction scope.
   The audit's suggested save() wrapper would still swallow quota errors.

Service-worker cache bumped to v1.23.1 to deliver the changed shell.

## Execution evidence

- Baseline: all 16 existing test suites passed.
- Added a failing regression before each production fix, then verified green.
- Group 1: 17/17 suites passed; group 2: 7/7 targeted suites passed.
- Final: **19/19 suites passed**, **35/35 JS syntax checks passed**.
- Static production check: **29/29 unique URLs returned HTTP 200** with
  response bytes matching the working tree (shell, root, SW and reset page).
- git diff --check passed. No lint/typecheck/build commands are configured;
  the production artifact is the authored HTML/CSS/JS, not a compiled bundle.
- Existing offline outline assertion now requires the truthful unavailable
  message. Successful-empty behavior remains covered separately.
- Deterministic regression tests use explicitly synthetic elevation/HTTP
  fixtures. No synthetic course data is shipped into the application.
- Live USGS checks passed, including an actual GreenBriefCore build returning
  a persisted-format brief with three zones and finite break values.
- A live Overpass lookup exhausted four bounded attempts: HTTP 429/406 and
  a failed mirror request. The app correctly reported unavailable. Successful
  mirror fallback is verified with fixtures, not claimed as live success.

## Deferred / next pass

Stop after these three fixes. C2/C6/C7 dead-code cleanup, C4's historical
version-display mismatch, speculative install-icon/manifest issues and other
hardening recommendations were deliberately not addressed.

Next: short iPhone homescreen check of Prep → 3D Green → back, saved round
reopen, GPS and airplane-mode behavior. Automated Node/jsdom tests do not
verify physical GPS, iOS haptics, Safari rendering or device SW activation.
Investigate additional functional defects only if that check exposes them.
