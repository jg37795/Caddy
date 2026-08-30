# tune27.py — cap the tighten loop: never raise lo above 0.42. On siteB
# the loop raised lo 0.335 → 0.50 chasing area > 2500, ending with a thin
# diagonal sliver (bbox 0x25) that failed the bbox filter → !best. The
# flank pass + trims shape the mask from there.
src = open('.gdd43.js', encoding='utf-8').read()
old = "    if (area > 2500) { lo += 0.055; hi += 0.035; keep = grow(lo, hi, 65); cnt = nOn(keep); }"
new = ("    // v-r3f: cap the tighten — chasing area>2500 by raising lo to 0.50\n"
       "    // left a thin sliver (bbox 0x25) that failed the bbox filter. lo is\n"
       "    // capped at 0.42; the flank pass + trims do the shaping.\n"
       "    if (area > 2500 && lo < 0.42) { lo = Math.min(0.42, lo + 0.055); hi += 0.035; keep = grow(lo, hi, 65); cnt = nOn(keep); }")
assert old in src, 'anchor missing'
src = src.replace(old, new, 1)
open('.gdd45.js', 'w', encoding='utf-8').write(src)
print('patched .gdd45.js')
