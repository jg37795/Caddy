# Play-Tab Overlay Audit — v1.0.65

Systematic audit of every absolutely-positioned overlay on the Play (range)
map, plus root-cause fixes for the four confirmed bugs.

## Overlay position / state matrix (iPhone-width reference)

| Overlay | Selector | Position | z | Shown when |
|---|---|---|---|---|
| Round HUD card | `.round-map-hud` (#roundMapHud) | abs, top `safe-top+60`, left `+12` | 601 | live round, mode ≠ practice |
| Mapping pill | `.mapping-pill` | abs, top `safe-top+62`, centered; **+204 when HUD visible** (new) | 650 | course mapping in flight / failed / success flash |
| Context strip | `.rx-strip` (in `.rx-stack`) | abs, top `safe-top+108`; **+152 round-live**, centered | 600 | always; **wind-only during a round** (new) |
| Dock | `.rx-dock` | abs, bottom lane, centered; lifted −(ui-lift+144) round-live | 600 | not full-detent |
| GPS pill / zoom / layer seg | `.range-top-ui` family | top bar / right rail per app.css | ≤601 | per app.js |
| Reticle | `.rx-reticle` | JS-placed center of visible map area | 500 | not full-detent |
| Toasts | `.rx-toast`, `#appToast` | bottom-centered; lifted −(ui-lift+214) round-live | 700/701 | transient |
| Popovers (club/wind) + scrim | `.rx-pop`, `.rx-scrim` | fixed, centered sheets | 650 | user-opened |

Collision checks: HUD (top-left, ends ≈ +150) vs strip (+152 centered) —
clear. Mapping pill now drops to +204 under both when a round is live.
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

3. **Error toast overlap** — `.mapping-pill` (z 650, top +62, centered,
   up to 340px wide) rendered on top of the HUD card (z 601, top +60).
   New rule `body:has(#roundMapHud:not([hidden])) .mapping-pill { top:
   safe-top + 204px }` places it below the HUD and strip stack.

4. **DEMO wind mid-round** — `renderWind()` only stepped aside for the
   live pill if `#windPill` was already un-hidden; on cold start range.js's
   observers attach after app.js's first weather render (or before any
   mutation), so DEMO stayed visible mid-round. Fix: while a round is live
   (`rx-round-live`), DEMO never renders at all — manual wind or nothing;
   live pill still wins over DEMO in all states. Added a 2 s poll as a
   belt-and-suspenders catch for pill-reveal races.

Cache bumped to v1.0.65.
