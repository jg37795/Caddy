# ELEV-NOTES.md — Green Maps elevation pipeline (v1.0.77)

Client-side USGS 3DEP pipeline in `caddy-elev.js`: two-step fetch → minimal
GeoTIFF parser → per-green slope model → Prep-tab green card with fall-line
arrows + tee→green delta chip.

## API quirks handled (all observed against the live endpoint)

1. **Two-step fetch.** `exportImage?f=json` returns JSON with an `href`
   pointing at the actual GeoTIFF. Both steps get a 15 s AbortController
   timeout and one retry; aborts propagate to both steps.
2. **Tiled, not stripped.** The service answers small requests (e.g.
   32×32) with a 128×128 *tiled* TIFF (tags 322/323/324/325), so ~94% of
   the buffer is padding. The parser crops tiles back to W×H.
3. **Stripped layout also supported** (tags 273/278/279, multi-strip) in
   case the service switches layout per request shape.
4. **SamplesPerPixel 1 or 2.** Chunky (pixel-interleaved) bands are
   de-interleaved and only band 0 is kept.
5. **Nodata padding.** Zero-float padding cells are masked out via a
   plausibility band (-100…9000 m); `0.0` is treated as nodata for spp=1
   since real elevations at cell scale never round to exactly 0 m in CONUS.
6. **Garbage rows.** Rows whose median deviates >15 m from the global
   median are masked entirely (misaligned-row artifact).
7. **Cell size computed from bbox**, not assumed (~3 m/cell at size=32
   over 0.001°; ~1.5–2 m/cell at the size=48 requests greens use).
8. **Coverage gaps.** Where 1m data is missing the same service resamples
   to coarser data; if that fails too, `greenMap()` resolves `null` and
   the Prep card simply never appears — never a broken state.

## Data-format / model decisions

- **Cache:** memory Map + localStorage LRU under `caddy.elev.*`, keyed by
  bbox rounded to 1e-6° + size. Courses are static ⇒ cache forever within
  a hard 2 MB byte cap (index window 512 rows; oldest payloads evicted
  first). Quota errors degrade silently to memory-only.
- **Slope model:** crop grid to green radius (13 m default), Horn
  gradients on interior cells, then component-wise **median** gradient
  (robust to artifact cells/rows; ±8 m outlier gate per cell). Fall line
  = downhill compass bearing (`compass = 90 − atan2(north, east)` — this
  conversion was wrong once; tests now pin it). High side = fall + 180°.
- **Confidence** ∈ [0,1] = 0.45·validFraction + 0.35·direction agreement
  (MAD-based) + 0.20·inverse relative slope spread. <0.45 ⇒ UI shows
  delta-only with an "approximate" note; slope >60% rejected outright.
- **Delta:** median of 5×5 valid cells at tee vs green center, ×3.28084
  → ft. Tee outside the main grid triggers one extra tiny request.
- **Node-testable:** module exports via `module.exports` when `window`
  is absent; all browser globals (localStorage/btoa/atob) are guarded.

## Tests

- `tests/v1077_elev_unit.js` — headless: synthetic TIFFs (clean tilt,
  zero-padded tiles, garbage row, spp=2 interleave, junk inputs), slope
  model accuracy (5% synthetic grade → 5.00%), confidence gating, LRU
  eviction under cap, eviction order.
- `tests/v1077_elev_smoke.js --live` — real Ankeny-area tile
  (`-93.75,41.95,-93.749,41.951`): >50% valid, median 321.30 m,
  slope 1.78%, fall line 176°, conf 0.70, delta −2.4 ft, cache hit <50 ms.

## Files

- NEW `caddy-elev.js`, `elev.css`
- `prep.js` — Green Map card in Prep (lazy, cancellable, silent failure)
- `app.js` — additive `teeLatLng`/`greenLatLng` on `CaddyPrep.holeInfo()`
- `index.html` — link elev.css + load caddy-elev.js
- `sw.js` — v1.0.77 + new shell entries (no fetch-handler changes)
