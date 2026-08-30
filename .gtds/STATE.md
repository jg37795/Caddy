# GROK GREEN-DETECTION — STATE (work in progress, 2026-08-30)

## What exists
- `.gtds/siteA_*` — OSM-mapped green (41-pt verified GT) + full feature
  grid (z, slope, smooth3, tex5, exg, bright) + 1343px mosaic. PASS-TARGET
  IoU >= 0.75.
- `.gtds/siteB_*` — hand-traced heart-shaped green (15-pt GT, overlay
  verified, pin inside) + same features. PASS-TARGET IoU >= 0.70.
- `.gtds/green_detect.js` — Grok 4.6 (high) function, syntactically valid,
  contract-clean. One-shot output, no repo access.
- `tmp_score_detect.js` — my IoU scorer (rasterise both, count overlap).

## Where it stands
- Best so far: siteA conf 0.89 but **IoU 0.22** (detected blob covers the
  WEST half of the green; GT spans ±13m around pin). siteB returns NULL.
- Iterations tried (all mine, post-Grok): water veto (br<70 hard),
  near-zero-texture veto (tex5<0.5), fixed texture band (1..9), soft
  fringe penalty (br<70 → x0.45), pin-anchored grow seed, drift-loosened
  lo. Each moved the needle (0.024 → 0.063 → 0.222) but not to bar.

## The unsolved core (next session, fresh eyes)
Score map around siteA pin (from harness): the green's cells score
0.8–1.0 near pin but drop to 0.3–0.6 at the east flank (smooth3 rises
0.03→0.3 there because the green is a tilted dome). loT ≈ 0.38–0.40
cuts the east flank off, so the blob hugs the west half. The
auto-threshold loop only loosens when area < 150 m² (blob is 654 m², so
it never fires), and the drift-loosen attempt didn't move it (reason not
yet isolated — verify score[origin] and the exact loT used in the failing
grow pass first).

## Candidate next moves
1. Two-tier threshold: core (smoothness-driven) + flank (slope-only)
   growth — greens are smooth-domed; flanks fail smoothness but pass
   slope+mow-texture. Grow in two stages.
2. Percentile-free thresholds: calibrate smooth3/tex5 bands from a dozen
   TRACED greens (need more ground truth — trace 3-4 more sites first).
3. Accept IoU ~0.5 + confidence gating: ship as "approximate detected
   outline" (badge honesty), let user nudge vertices on the trace map.

## Cost so far
ONE Grok 4.6 high call (~4.2K prompt + ~12K output ≈ $0.08). All
iteration so far = me, cheap.
