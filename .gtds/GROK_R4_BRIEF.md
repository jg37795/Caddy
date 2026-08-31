# GROK R4 BRIEF — improve detectGreen with the full calibration dataset

## Context
You previously wrote `detectGreen(data)` for a golf app: find the
putting-green polygon near the origin of a 96x96 LiDAR+satellite grid.
Your function is in production testing. It now scores:

| site | IoU | conf | notes |
|---|---|---|---|
| A (OSM GT) | 0.743-0.759 | 0.89 | bean-shaped, clean |
| B (hand GT) | 0.66 | 0.75 | heart-shaped, S lobe in tree-dapple |
| C (OSM) | 0.559 | 0.89 | small, W of pin by 35m (pin off-green) |
| D (OSM) | NULL | — | pin cell scores 0.54 but blob dies in morphology |
| E (OSM) | 0.358 | 0.79 | steep terraced green (slope p90 16.6) |
| F (OSM) | 0.000 | 0.61 | SHADED green under trees (bright p10 = 50) |
| G (OSM) | 0.222 | 0.89 | pond-adjacent, detector grabs apron |

## Your updated task
Rewrite/improve `detectGreen` to raise MEAN IoU across A-G, with these
constraints:

1. **Per-site adaptation beats global thresholds.** We proved: absolute
   gates fail shaded greens (F) and steep greens (E); relative gates
   (similarity to the near-pin core's own medians) fix E but over-admit
   on A. Combine: seeded region growing whose admissibility is
   statistically similar to the seed neighbourhood, PLUS loose absolute
   sanity floors (slope <= 14, smooth3 sanity, not-water via brightness
   relative to core).
2. **F (shaded green) may be un-detectable** — bright p10 = 50, same as
   dark fairway. Returning null with conf < 0.5 for F is ACCEPTABLE and
   better than a wrong polygon.
3. **D (NULL)**: the pin cell scores 0.54 (above loT 0.335) and seeds
   fine, but the blob dies in morphology (erode needs 8 neighbours; a
   sparse seed has none). Keep seed survival in mind.
4. **G (pond-adjacent)**: the grow leaks west through the collar bridge.
   Consider: after growing, evaluate each boundary arc's similarity and
   CUT arcs that diverge (local similarity, not global radius).

## Inputs (same contract as before)
`data.grid` = { W, H, cellSizeM, z, slope, smooth3, tex5, exg, bright }
(Float64Array W*H, NaN = no data, origin = pin at (0,0) local metres)
`data.satSample(lon, lat)` = {r,g,b} | null
Output: `{ poly: [[mx,my]...8..64], confidence: 0..1 }` or null.

## Quality bar
Mean IoU >= 0.70 across A-G (F may be null), with NO site below 0.55
except F. Runtime < 300 ms per grid. Pure function, ES2020, <= ~350
lines, deterministic.

## Deliverable
ONLY the function source in one fenced code block.
