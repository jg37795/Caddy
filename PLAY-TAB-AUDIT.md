# Play-Tab Overlay Audit — v1.0.65

Systematic audit of every absolutely-positioned overlay on the Play (range)
map, plus root-cause fixes for the four confirmed bugs.

## Overlay position / state matrix (iPhone-width reference)

| Overlay | Selector | Position | z | Shown when |
|---|---|---|---|---|
| Round HUD card | `.round-map-hud` (#roundMapHud) | abs, top `safe-top+60`, left `+12` | 601 | live round, mode ≠ practice |
| Context strip | `.rx-strip` (in `.rx-stack`) | abs, top `safe-top+108`; **+152 round-live**, centered | 600 | always; **hole · dots only** — wind removed v1.0.67 |
| Dock | `.rx-dock` | abs, bottom lane, centered; lifted −(ui-lift+144) round-live | 600 | not full-detent |
| GPS pill / zoom / layer seg | `.range-top-ui` family | top bar / right rail per app.css | ≤601 | per app.js |
| Toasts | `.rx-toast`, `#appToast` | bottom-centered; lifted −(ui-lift+214) round-live | 700/701 | transient |
| Popovers (club) + scrim | `.rx-pop`, `.rx-scrim` | fixed, centered sheets | 650 | user-opened |
| Hole-advance card | `.rx-hole-prompt` | abs, bottom lane, lifted −(ui-lift+14), centered | 660 | current hole just scored, once per hole per round |

Collision checks: HUD (top-left, ends ≈ +150) vs strip (+152 centered) —
clear. No mapping pill exists anymore (removed v1.0.73).
Dock and toast share the bottom lane but are offset by different lifts and
never co-visible at full detent (both fade). No remaining overlap found.

## Fixes

1. **Duplicate hole info** — `range.js renderStrip()` mirrored the HUD's
   hole label + scorecard dots into the strip, so both rendered during a
   round. Now the strip hides hole label/sep/dots whenever `#roundMapHud`
   is visible (`rx-round-live`); it shows wind only.

2. **Garbage distance fallback** — with scorecard mapping failed, no green
   point exists, but app.js restored `caddy:lastTarget` from localStorage
   (a pin from a previous venue, ~4.7 mi away) and computed yardage against
   it → "8281 actual yds". Fix: `calculateRange()` now enforces
   `MAX_SANE_TARGET_YD = 1200`; a target beyond the bound is dropped,
   `caddy:lastTarget` cleared, and distance/plays-like show "—" with a
   "Map a target" hint instead of nonsense numbers.

3. **Error toast overlap** — *(superseded by v1.0.73: the mapping pill
   was removed entirely; see change 9.)* Historically, `.mapping-pill`
   (z 650) rendered on top of the HUD card (z 601, top +60) and was later
   dropped to safe-top + 204px via a `body:has()` rule.

4. **DEMO wind mid-round** — `renderWind()` only stepped aside for the
   live pill if `#windPill` was already un-hidden; on cold start range.js's
   observers attach after app.js's first weather render (or before any
   mutation), so DEMO stayed visible mid-round. Fix: while a round is live
   (`rx-round-live`), DEMO never renders at all — manual wind or nothing;
   live pill still wins over DEMO in all states. Added a 2 s poll as a
   belt-and-suspenders catch for pill-reveal races.

Cache bumped to v1.0.65.

## v1.0.67 changes

5. **Wind controls removed (user decision)** — the DEMO wind strip button
   (`#rxWind`), the manual wind editor sheet (`#rxWindPop`), and all
   range.js wind machinery (`renderWind`/`buildWindEditor`/
   `saveWind`/`clearWind`, `caddy.range.wind`, the 2 s poll) are gone,
   along with their CSS. Wind display is live weather only: the app's own
   wind pill and the sheet's weather metrics. No placeholders, no pickers.
   The strip is now hole identity + scorecard dots only.

6. **Collapsed sheet = one-liner** — `.sheet-oneliner` (#sheetOneLiner)
   overlays the drag band: "<distance> yd · <club short name>", or
   "Tap map to set target" with no target. Visible only at the collapsed
   detent; fades out via `--fcb-reveal` during drags as the full number
   band (.sheet-peek) fades in. Geometry unchanged — .sheet-peek stays in
   flow (opacity-only), so every detent position matches v1.0.66.

7. **Long-press = target pin** — a ~500 ms hold anywhere on #map drops or
   moves the shot target at that point by replaying the exact tap path
   (synthetic Leaflet click → `handleMapTap`). Cancels on movement > 10 px
   (map pan), pointerup/cancel, or presses that start on control chrome.
   Confirms with haptic + an expanding ring (`.rx-lp-ping`). A native
   click after finger-lift re-sets the identical point (idempotent).

8. **Hole-advance prompt** — when the current hole gets a score (any of
   the three write paths: scorecard cell cycle, mini quick-fix save, full
   score-sheet save), a glass card offers "Hole N done — S · par P. Next
   hole?" with [Next hole] (reuses `nextHole()`) and [Later]. Auto-shows
   once per holed hole per round (`caddy:holeAdvPrompt`, keyed on
   `startedAt`); taken down automatically if the hole changes or a shot
   goes pending (`syncHoleAdvancePrompt` in `renderRoundShotUI`). The last
   hole never prompts — round-end flow owns that moment.

Overlay matrix updated: strip row and new hole-advance card row above.
Cache bumped to v1.0.67.

## v1.0.69 / v1.0.70 changes

9. **Collapsed sheet = informative peek row** — the v1.0.67 one-liner
   was a downgrade (one club name, dead dark slab above it). The drag
   band is now a slim (~72 px incl handle) always-visible summary:
   "<distance> yd · plays <N>" plus F/M/B green distances and the
   target-line direction/aim status ("target NE · 42°"). It sits IN FLOW,
   and `detents()` computes the collapsed offset from a compact band
   (`measureCollapsedBand()`, clamped 56–120 px) instead of the full
   header, so collapsed height matches content exactly — no reserved
   empty slab. Data sources are app.js's own DOM mirrors (#rawYards,
   #playsLikeYards, #fcb*, #bearingChip/#aimChip); updates live via
   range.js MutationObservers. Full number band + FCB cards appear at
   half+ as before.

10. **Reticle removed entirely** — `.rx-reticle` markup (index.html),
    all CSS (ring/dot/ticks/breath/ping) and range.js machinery
    (`reticlePoint`/`placeReticle`/rAF loop/`pingReticle`/`dropPin`)
    deleted. Tap feedback comes from the dropped pin only.

11. **Stray dark blob fixed** — root cause was the collapsed detent
    reserving the old ~150 px header while its content was invisible:
    an empty glass slab floating mid-map. Fix 9 removes it.

12. **Start-round-during-mapping leak closed** — enforcement moved to
    the single choke point `beginRound()`: if
    `state.courseMappingState` is 'mapping'/'failed' it refuses with a
    toast, regardless of entry path (roundActionBtn/startRound, the
    round-setup sheet's own Start button, quick-start confirm, round
    options). UI disabled states (`syncStartRoundGate`) kept.

13. **End-round confirm sheet** — tapping 'End round' no longer fires
    immediately. Every entry point routes through `requestEndRound()` →
    glass action sheet "End round?" with contextual subtext ("Your
    scorecard for this round will be saved." when scores exist; "no
    scores yet" otherwise), destructive 'End round' + 'Cancel'. Pending-
    shot guard runs before the sheet opens. Sheet transitions respect
    `prefers-reduced-motion`.

Self-tests: 48/48 pass (added beginRound-gate refuse/allow and collapsed-
band math blocks). Overlay matrix unchanged except Reticle row removed.
Cache at v1.0.70 (bumped by map-load work).

## v1.0.73 changes

9. **SCOPING RULE: Round-tab setup UI never renders on Play** — all
   course-search and scorecard-mapping UI (nearby results list, loader
   card, mapping status, Retry) lives strictly inside the Round tab's
   round-setup sheet (`#roundSetupSheet`). The on-map mapping pill
   (`.mapping-pill` / `renderCourseMappingPill`), including its error/
   retry variant, is removed entirely from HTML/CSS/JS. The closed setup
   sheet gets `hidden` → `display:none !important` after the slide-down
   transition, so nothing can paint over the map in any viewport state.
   `courseMappingState`, the beginRound/startRound hard gate, and the
   'Still mapping…' toast remain as a safety net; while mapping runs and
   the user is on Play, distance/plays-like show '—' until data arrives
   (MAX_SANE_TARGET_YD fallback). Mapping Retry now renders only inside
   the sheet (appended to the nearby-course status line when failed).
