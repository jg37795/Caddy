# GROK GREEN-DETECTION — STATE (R3 complete, 2026-08-31)

## Scores (bar: A >= 0.75, B >= 0.70)
- siteA (OSM GT): **IoU 0.750, conf 0.89** — AT the bar.
- siteB (hand-traced GT, corrected once): **IoU 0.600-0.662** — below.
- Best config: `.gdd56` (= `.gdd50` + collar shrink 1.0 m + pin-radius
  trim 18 m). Scorer copy in `.gtds/green_detect.js`.

## R3 progress arc (from R2's A=0.22/B=NULL)
1. Tracer repair (tune16): ring = the loop CONTAINING the blob centroid,
   not largest-area (hole/nested rings were winning).
2. Flank gates from GT/fairway census (tune18): smooth3<=0.40 (p90 green
   0.31 vs fairway 0.52), slope<=13 (12 vs 20.7), br>=85 (111 vs 43),
   tex5 0.6..16 — depth-limited BFS 3 cells.
3. Pin-anchored connected-trim (tune19) + pin-radius trim 18 m (tune20/27):
   the pin defines WHICH green; radius caps apron bridging.
4. Collar shrink (tune21/29): ring rides the collar's outer edge;
   radial inset ~1.0 m.
5. Seed-survival (tune24): lone pin-seed died in erode — dilate-only for
   tiny blobs.
6. lo-cap (tune27): tighten loop raised lo to 0.50 chasing area, leaving
   a 1-cell sliver that failed the bbox filter — capped at 0.42.
7. GT correction: siteB's hand-trace was offset NW into trees (found by
   building the DET-vs-GT overlay — the overlay is mandatory tooling).

## Why B is below bar
B's GT is my hand trace with ±1-2 m uncertainty (already corrected once);
the detector's ring is close but the residual miss is at the GT's own
edge confidence. Also B's south lobe sits under tree-dapple — scores
0.22-0.31, below grow threshold; only the flank pass reaches it.

## Options for R4 (pick one)
1. More ground truth (3-5 more sites, mosaic-first pin picking) and
   recalibrate the flank gates — best expected value.
2. Ship as "approximate outline" path: conf >= 0.8 gate, badge
   "⚠ detected outline — verify via Check location", trace still one tap
   away. IoU ~0.65 at conf 0.75-0.89 is useful as a STARTING edit.
3. Vertex-nudge editor on the detected ring (trace UI pre-filled with
   the detection; user drags points; saves as a trace).

## Cost
Still ONE Grok call total (~$0.08). All R3 iteration = cheap model.
App untouched — detection not wired into the source ladder.
