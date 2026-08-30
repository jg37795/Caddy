# tune24.py — siteB fix: the lone pin-seed dies in erode (needs all 8
# neighbours kept). When the grown blob is tiny (<9 cells) keep the seed
# cell alive through morphology: dilate-only (no erode).
src = open('.gdd40.js', encoding='utf-8').read()
old = "  keep = cnt * ca > 1400 ? dilate(erode(keep)) : erode(dilate(keep));"
new = """  // v-r3e (seed survival): a lone pin-seed (sparse-data greens) is killed
  // by erode, which requires all 8 neighbours. Tiny blobs dilate-only.
  keep = cnt * ca > 1400 ? dilate(erode(keep))
    : cnt < 9 ? dilate(keep) : erode(dilate(keep));"""
assert old in src, 'anchor missing'
src = src.replace(old, new, 1)
open('.gdd42.js', 'w', encoding='utf-8').write(src)
print('patched .gdd42.js')
