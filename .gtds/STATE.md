# GROK GREEN-DETECTION — STATE (work in progress, 2026-08-30/31)

## What exists
- `.gtds/siteA_*` — OSM-mapped green (41-pt verified GT), pin ON green.
- `.gtds/siteB_*` — hand-traced heart-shaped green (15-pt), pin ON green.
- `.gtds/siteC_*` — traced green (12-pt) but pin is 35 m SW of it
  (off-pin; useful for nearest-green logic tests only).
- siteD (tree canopy at pin), siteE (fairway at pin) — skipped, recorded
  in `.gtds/sites_skipped.json`. Pins must sit ON greens for the contract.
- `.gtds/green_detect.js` — Grok 4.6 (high) fn, one-shot, contract-clean.
- `tmp_score_detect.js` — IoU scorer (rasterise GT + detected, overlap).

## Where it stands (after ~10 tuning iterations)
- siteA: conf 0.89, IoU 0.22 (blob covers west half; east flank's
  smooth3 0.13→0.35 falls below grow threshold; GT needs it included).
- siteB: NULL. siteC: untested (off-pin).
- Bar for shipping: A >= 0.75, B >= 0.70. NOT met.

## Root-cause picture (from score-map instrumentation)
The scorer blends smoothness (dominant), texture, slope, sat. On a
tilted dome green the flank smooth3 rises 0.03→0.35 and the blend
drops below loT → under-growth. Water/parking near-greens (pond west of
A) have extreme low texture/tex5 and hook the percentiles — fixed-band
texture helped, but flank admission is still the blocker.

## Candidate next moves (ranked)
1. TWO-TIER GROW: core pass (current blend, high threshold) then a
   FLANK pass seeded from the core's boundary with a slope+mow-texture
   criterion only (slope < 12%, tex5 in 0.8..16, br > 60) — grows the
   dome flank without re-admitting pond/apron.
2. Calibrate bands from more GT: need 3-4 more ON-PIN greens. On this
   course that means picking pin coords by looking at the mosaic FIRST
   (not blind lat/lng offsets): D/E failed because pins were blind.
3. Ship-at-lower-bar fallback: if IoU plateaus ~0.5+, ship as
   'approximate detected outline' with vertex-nudge editing, gated at
   conf >= 0.8, honest badge.

## Cost so far
ONE Grok 4.6 high call (~$0.08). All iteration = cheap model.
App untouched — detection not wired into the source ladder.
