# GROK R5 BRIEF — PREP TAB RESTRUCTURE + GREEN-AWARE CADDY ADVICE

## Mission
Restructure the Prep tab (prep.js + its slice of index.html/prep.css)
into the flow James described, and make Caddy's advice green-aware
using the 3D green's slope data. This is a UX restructure + one new
advice feature. NO renderer/physics changes.

## James's target flow (his words, structured)
1. **Search for a course** in the Prep tab.
2. **Load its scorecard** (holes with par/yards).
3. **View each hole on a map view** (tee → green, hazards marked).
4. **Get caddy advice on how to play the hole, with visuals showing each
   shot until the green** (club sequence as visual segments: drive →
   approach → finisher, drawn on a simple hole diagram).
5. **View the 3D green for each hole** (link out to greenmap.html with
   the hole's ?lat&lng&teelat&teelng).
6. **NEW — green-aware caddy advice:** when the 3D green data for the
   bound hole has been loaded at least once, the advice should know
   which way the ball rolls after landing (putt break direction at the
   landing zone, slope class of the landing area).

## What exists (use it, don't rebuild it)
- **Course search + ephemeral course**: app.js `planCourseOptions()`,
  `planCourseSearch` input, `PREP_EPHEMERAL_ID` flow, `holeInfo(number)`
  bridge (returns par/yards/strokeIndex/hazards/green{front,center,back,
  depth}/teeLatLng/greenLatLng/bearing).
- **Club sequence**: `window.CaddyPrep` does NOT expose planClubSequence —
  you must ADD it to the bridge in app.js (Block 18, read-only style:
  pure function of totalYd using sortedClubsDesc/Asc). Signature:
  `clubSequence(totalYd) -> { seq: [names], finisherName } | null`.
- **Strategy card**: prep.js `renderStrategy()` — keep its good parts
  (carries strip, hazards list, tips) but restructure the tab so the
  strategy is ONE coherent per-hole brief, not scattered cards.
- **3D green launch**: greenlink.js pattern — `greenmap.html?lat&lng&
  teelat&teelng` opens the 3D green for a hole. Add a "3D Green"
  button per hole in Prep.
- **Green slope data for advice**: greenmap.js already persists per-hole
  green data? NO — it doesn't. ADD: when greenmap.js computes its
  gradient field (it has `state.field`, `state.mask`, `state.pin`,
  stimp), persist a compact summary to localStorage key
  `caddy:greenBrief:v1` = { lat, lng, savedAt, stimp,
  landing: { atPin: { breakIn, dirDeg, paceClass } }, zones: [ {id:
  'front'|'middle'|'back', breakIn, dirDeg } ] } — computed with the
  EXISTING GreenMapCore.simPuttPath/solvePutt from 3 probe points
  (front/middle/back of green, ~2 m inside from the edges along the
  tee→green axis). prep.js reads this brief (match by proximity of
  greenLatLng within 60 m) and renders "After landing: ball feeds
  LEFT ~8 in, firm pace" per green point.
- 2D hole map: draw with SVG or canvas INSIDE prep.js (simple tee→green
  corridor diagram: tee dot, green ellipse, hazard markers projected on
  the tee→green axis using the hazards' existing along/cross data, shot
  sequence segments drawn as colored lines with club labels). Do NOT
  use Leaflet here (offline, heavy); a static diagram is the point.

## Hard invariants (violating any = rejected)
1. prep.js never mutates app state; everything through window.CaddyPrep
   (read-only bridge) or its own `caddy.prep.*` localStorage.
2. app.js bridge additions must be READ-ONLY pure functions (Block 18
   style). clubSequence addition: no side effects.
3. greenmap.js persists ONLY the compact green brief (above); it must
   not break the headless path (tests import GreenMapCore with no DOM —
   guard localStorage writes with try/catch and typeof localStorage).
4. The existing solve() memo (v1.5.3) and debounce must keep working.
5. Suite baselines: greenmap_boot_smoke prints "BOOT+FLOW SMOKE
   PASSED"; greenmap_smoke has exactly its 2 documented failures.
   node --check must pass on every touched file.

## UX rules (James's standing orders)
- One primary green action per screen; glass pill styling; SF-feeling
  hierarchy; no dead ends — every screen has a next step or a way back.
- Simplify: the tab should read top-to-bottom as the flow above. Hide
  advanced controls (wind dial etc.) behind a single "Conditions"
  collapsible — they exist, they're just not the first thing you see.
- If no course is bound: the search box IS the first screen (with a
  hint). If bound: show the loaded course name + "Change" chip.

## Deliverable
Work directly in prep.js / prep.css / index.html (prep section) /
app.js (bridge addition) / greenmap.js (brief persistence). Verify with
`node --check` on each touched file + both test files at baseline.
Finish with a summary of what changed per file. Do NOT touch
greenmap.js render math, solver physics, or sw.js version (coordinator
bumps the version).
