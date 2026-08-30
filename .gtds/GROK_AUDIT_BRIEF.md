# GROK FULL-APP AUDIT BRIEF (v1.5.2 codebase)

## Role
You are auditing a production golf PWA ("Caddy") for bugs, logic errors,
and confusing/incorrect behaviour. The owner has given you free rein to
read the entire committed app. TAKE YOUR TIME and be thorough.

## Hard context (do not violate these invariants — they were paid for)
1. The 3D renderer is a PAINTER'S ALGORITHM canvas renderer. Do NOT add
   backface culling — far-side faces must paint (they are legit terrain
   on a dome). Far-to-near ordering handles occlusion.
2. Canvas fills self-cancel under the nonzero winding rule. Never fill a
   self-overlapping path in one call; use per-segment simple quads +
   same-colour stroke.
3. All fixed/absolute chrome containers must carry their own safe-area
   padding (var(--safe-top/--safe-bottom)) — iOS PWA status bar floats
   over the page (viewport-fit=cover, black-translucent).
4. sw.js CACHE_VERSION must change on every user-visible release. The
   version shown in the UI comes from window.CADDY_VERSION (index.html,
   greenmap.html) and must stay in lockstep.
5. Data sources: OSM (ODbL — attribution required before public launch),
   USGS 3DEP (public domain), Esri World Imagery (tiles; commercial terms
   unresolved — noted, do not change providers).
6. Test suite: tests/greenmap_boot_smoke.js must print "BOOT+FLOW SMOKE
   PASSED"; tests/greenmap_smoke.js has exactly 2 documented failures
   ("fetchElevGrid returned data", "live smoke: no elev data") — the
   suite must stay at that baseline.

## What to look for (priority order)
A. Logic bugs: wrong variable used, off-by-one, inverted conditions,
   stale-state after view switches, race conditions in async loaders,
   event listeners leaking or double-bound.
B. State-machine breaks: the green tool has views (2d/3d/hole), datasets
   (green/hole), sources (traced > OSM > ellipse), a ball/putt model,
   and a flyover. Look for paths where these desync (e.g. ball survives
   when it shouldn't, mode buttons fighting the render, stale dataset
   after "Check location" reload).
C. Confusing UX: labels that lie, buttons that appear disabled but are
   active (or vice versa), states the user can't see.
D. Performance traps: per-frame allocations in render paths, repeated
   solver calls, unbounded caches.
E. HTML/CSS: duplicate ids, styles that fight (multiple position:fixed
   stacking), safe-area violations per rule 3.

## Files (all in repo root)
app.js (~10.5k lines, main app), app.css, index.html, greenmap.js (3D
green tool), greenmap.html, greenmap.css, greenedit.js (location editor),
greenlink.js (Play-tab pill), satview.js (satellite mosaic), caddy-elev.js
(USGS elevation), sw.js (service worker), range.js/bag.js/prep.js
(range/bag/prep tabs), tests/.

## Output contract (STRICT)
Return a single markdown report:
1. ### Findings — numbered. Each: FILE : approx line, SEVERITY
   (high/med/low), WHAT (one sentence), WHY (the mechanism), FIX (exact
   code-level suggestion, minimal diff). NO speculative findings — only
   things you can point to in the code. Max 20 findings; if you find
   more, keep the 20 most impactful.
2. ### Non-issues verified — up to 10 things you checked and confirmed
   correct (so we know coverage).
3. NOTHING else. No praise, no summary of the app, no code dumps.

Do NOT modify any files. Report only. The owner applies fixes.
