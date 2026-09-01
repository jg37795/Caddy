# GROK R6 — Hole-view defect round (v1.14.0)

You are fixing six user-visible defects in the Caddy golf PWA. Work
READ-ONLY against the repo at the current directory; write NOTHING
except the single response file named at the end. Node 17 is available
(`node --check file.js` works; `node --experimental-fetch` for live).
Tests you can run: `node tests/greenmap_smoke.js` (expect 2 documented
FAILs: the live USGS fetch pair; anything else failing is yours),
`node tests/greenmap_boot_smoke.js` (expect PASSED),
`node tests/app_boot_smoke.js` (expect PASSED).

## Context

`greenmap.html` + `greenmap.js` render the 3D hole view (a LiDAR mesh,
96–160 grid). `prep.js` renders the Prep hole brief and a row with a
"Tee" shortcut + "3D Green" button. `greenedit.js` is the Check
location editor (satellite map: green sample pin + editable tee).

The user (James, iPhone 16 Pro Max, 3x DPR) reported six defects with
screenshots. Each is diagnosed below — root cause identified, fix
prescribed. Your job: implement precisely, verify with the harness,
no drive-by refactors, NO changes outside the named files.

## The six defects

### D1 — Stylized palette still bland (art direction, not just code)
File: `greenmap.js` (buildHoleScene colorFn, ~line 2006-2090) +
hillshade band in bakeSatelliteTexture (~line 1941-1975).
The v1.13 "composed palette" landed but reads flat and washed-out in
the field screenshot: rough vs fairway distinction too subtle (band
factor 0.07 nearly invisible under 15x exag at glancing angle), mottle
too fine (per-cell hash noise at 0.3-4 m/cell shimmers into grey).
REQUIREMENTS (target: looks like a premium course illustration):
1. Contrast UP: rough base [96,116,92], fairway base [170,188,142] —
   a clearly-visible step between them (currently 106 vs 158 reads as
   noise). Elevation banding ±10%.
2. Mottle: coarser — sample the hash at (ix>>1, iy>>1) so blobs are
   2x2 cells, amplitude 0.10-0.16, and modulate GREEN channel slightly
   more than R/B (vegetative variation, not grey noise).
3. Fairway ribbon WIDER: isFairway threshold at 20 m from the green
   zone (currently 14) + low-slope corridor out to 35 m (currently 26).
4. Contour lines: drawContours3D already runs; increase its contrast
   only in stylized mode — find how drawContours3D picks its stroke
   colour and darken strokes ~35% when ds.texMode === 'stylized'
   (pass the mode in; do not change photo-mode rendering).
5. Keep the green-zone slope ramp untouched (it reads well).
6. Stylized hillshade band stays 0.62–1.30 (already correct).
VERIFY: write a node script .gtds/r6_palette_check.js that stubs a
synthetic grid (64x64, a raised dome centre = zone), calls
GreenMapCore.buildMesh3D with the colorFn path via a jsdom-ish harness
(or extract the colorFn logic — your call, document it), and asserts:
(a) rough cells differ from fairway cells by >30 RGB mean, (b) two
rough cells 2 apart in x can differ (mottle), (c) fairway band wider
than 14-cell radius would give. Include the script in the response.

### D2 — Hole view shows a SQUARE, photo view is cropped (frame mismatch)
Files: `greenmap.js` (fitHoleView ~L3105, corridorBbox ~L749) and the
fetch in loadCorridor (~L1715).
Root cause: corridorBbox now returns the axis-aligned envelope of the
rotated ±50 m rectangle — for a diagonal hole that envelope is nearly
square again (521 m wide for a 388 m hole), and USGS fetches a SQUARE
bbox = max(w,h). fitHoleView then frames the whole square mesh.
The mesh IS the square; the photo is just texture on it — so "photo
is cropped" is the same square, cropped by the screen edges at fit.
REQUIREMENTS:
1. In loadCorridor, after the grid arrives, MASK the mesh to the
   oriented corridor rectangle, not the whole square: build a
   maskRect Uint8Array (same dims as eg.grid) where cell (x,y) is 1
   when its world point (mx,my) lies within halfLen+margin along the
   tee->green axis AND within 50 m perpendicular. Use ds.centerLL,
   ds.eg.cellSizeM, and the tee/green lat/lng (state.lat/lng +
   state.teeLL) to compute the axis. Feed maskRect into buildHoleScene
   (it currently uses ds.mask for the mesh — intersect them: keep
   ds.mask for interaction, add ds.meshMask for geometry, pass
   ds.meshMask to buildMesh3D as the mask arg).
2. Keep the 30 m end margins (the rect length includes them).
3. fitHoleView then frames the actual mesh — already numeric, no
   change needed, but VERIFY it uses the mesh quads (it does: M.pos).
VERIFY: extend your r6 harness: synthetic square grid with a diagonal
corridor mask, assert quad count drops vs unmasked, and the mesh
corner extremes along the perpendicular axis are <= ~55 m from the
axis line.

### D3 — Tee and green markers missing on hole view
File: `greenmap.js` (~L3593 tee marker block, and wherever 'Green'
draws — search 'Green' label).
The screenshots SHOW 'Tee' and 'Green' text labels but NO flag marker
or green disc. Root cause: the tee flag + green disc draw via
dressingOffSurface (depth test) and the depth buffer (zbuf) is built
from the mesh quads — after D2 masking the mesh shrinks; but the bug
predates D2: the tee flag pole is drawn only when
`state.teeLL` exists, and the GREEN disc draws inside
`if (state.active === 'hole' && ...)` — inspect: the labels draw but
the marker shapes are depth-rejected at 1x exag because the pole test
height (~1 m) is BELOW the surface at 1x exaggeration (z at pole base
equals terrain, pole top 3 m * 1x = 3 m — camera at pitch 26° may
occlude). Fix: raise the pole test to 2.5 m and draw the flag REGARDLESS
of depth test result when the depth rejection is within 2 zbuf cells of
the surface depth (tolerance), and same tolerance for the green disc.
ALSO ensure the markers render in BOTH tex modes (they're mode-agnostic
already — verify).
VERIFY: harness: build a small mesh, place a tee marker, assert the
flag projects and passes your tolerance logic at pitch 26, dist ~200.

### D4 — Dock buttons badly spaced (screenshot: Slope/Elev/Both/Shading/
Arrows/Stylized/Photo overflow the row, wrap awkwardly under iOS 3x DPR)
File: `greenmap.css` (.gm-dock-row ~L78 flex-wrap, .gm-dock-group L98,
.gm-btn padding) and `greenmap.html` dock markup.
The new Stylized/Photo group made row 2 overflow on 390 px width.
REQUIREMENTS:
1. Row 2 (data row): Slope/Elev group, Both/Shading/Arrows group,
   Stylized/Photo group. On narrow screens allow horizontal SCROLL
   within the row (overflow-x: auto, -webkit-overflow-scrolling: touch,
   scrollbar hidden) instead of wrapping — keep one row, consistent.
2. Reduce .gm-btn padding to 6px 10px, font 11.5px, gap 5px inside
   groups, row gap 6px. Buttons must stay >= 32 px tall (touch).
3. Stylized/Photo group must be visually attached to the data row
   (same background treatment as the other groups).
VERIFY: eyeball via a local HTML render is not possible headlessly —
instead assert via a JSDOM getComputedStyle-ish check OR simply keep
the CSS minimal and documented. Node --check the css? Not applicable —
state in your response the exact CSS you changed.

### D5 — Move-tee lets you place MULTIPLE tees (marker duplication)
File: `greenedit.js` setTee() (~L120).
Root cause: setTee removes `teeMarker` but then creates a NEW marker
and never updates the `teeMarker` variable (it's const). Each place
adds another marker; only the last is tracked.
REQUIREMENTS: make teeMarker a `let`; on setTee: remove existing
marker if any, create new one, assign to teeMarker. Drag updates
teeLL via dragend (already). Tap-to-remove still works (marker click
handler re-created each time). Verify no path can stack markers.
VERIFY: node --check + a small jsdom test if feasible; otherwise
document the exact diff lines in your response.

### D6 — Prep "Tee" button opens the 3D green, not the tee editor
File: `prep.js` green3dButtonHtml (~L1289-1320).
Root cause: the Tee <a> href IS greenmap.html?...&armtee=1 — correct
target — but greenedit only auto-OPENS the sheet when the user taps
"Check location"; armtee=1 just pre-arms tee mode INSIDE the sheet if
it's already open. Nothing opens the sheet on load. So the user lands
in greenmap with tee mode set but no editor visible = "took me to the
3d green".
REQUIREMENTS: in greenedit.js mount()/init path, after wiring, if
?armtee=1 → openEditor() automatically once (guard: only when
URLSearchParams has armtee=1; after open, strip the param via
history.replaceState so a manual page refresh doesn't re-trigger).
OpenEditor must run after the map container is laid out (rAF or small
timeout — see the existing invalidateSize comment at ~L64).
VERIFY: node --check; document the diff.

## Hard constraints
- Files you may touch: greenmap.js, greenmap.css, greenmap.html,
  greenedit.js, prep.js, tests/greenmap_smoke.js (ONLY if a section-11
  assertion needs updating for D2 — do not weaken other checks).
- Do NOT touch: sw.js (coordinator bumps), app.js, prep.css, index.html,
  any .gtds probe except creating r6_palette_check.js.
- Do NOT change sw CACHE_VERSION. Do NOT commit. Do NOT push.
- node --check every touched JS file. Run the three test suites and
  report their output.
- Every fix gets a `// v1.14.0 (R6-<id>):` comment explaining WHY.

## Response format (single file, append nothing else)
Write your full response to .gtds/r6_response.txt as a unified diff
(git diff format) for each touched file, then a section "VERIFICATION"
listing each test suite output, then a section "NOTES" for anything the
coordinator must double-check. Budget: take your time, be precise.
