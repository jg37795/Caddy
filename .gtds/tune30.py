# tune31.py — R4: gates from the 5-site consensus census.
# GREEN vs OTHER separation (p-values):
#   smooth3: 0.09/0.17/0.29   vs 0.18/0.34/0.52  → cap 0.32 (green p90)
#   slope:   3.3/6.4/11.2     vs 6.9/12.8/20.6   → cap 12 (green p90)
#   tex5:    0.6/2.2/5.7      vs 0.4/2.1/7.7     → NO separation! tex5 is
#            useless as a gate (both span 0.4-7.7) — drop the tex5 gate.
#   bright:  74/82/101 p05/p10/p50 vs 31/49/102    → floor 70 (green p05)
#   exg:     64/80/87 p10/p50/p90 vs 16/41/72      → floor 45 (well below
#            green p10, well above other p50) — this is the STRONGEST gate.
# Apply: flankOk = { smooth3<=0.32, slope<=12, br>=70, exg>=45 } — no tex5.
src = open('.gdd50.js', encoding='utf-8').read()
old = """  const flankOk = (i) => {
    if (!fin(br[i]) || br[i] < 85) return false;
    if (fin(sl[i]) && sl[i] > 13) return false;
    if (!fin(tx[i]) || tx[i] < 0.6 || tx[i] > 16) return false;
    if (!fin(sm[i]) || sm[i] > 0.40) return false;
    return true;
  };"""
new = """  // v-r4 (5-site OSM census — .gtds/census.py): green p90 smooth3 0.29 /
  // slope 11.2, br p05 74; exg separates hardest (green p10 64 vs other
  // p50 41). tex5 does NOT separate (0.6-5.7 vs 0.4-7.7) — gate dropped.
  const flankOk = (i) => {
    if (!fin(br[i]) || br[i] < 70) return false;
    if (fin(sl[i]) && sl[i] > 12) return false;
    if (!fin(sm[i]) || sm[i] > 0.32) return false;
    if (fin(ex[i]) && ex[i] < 45) return false;
    return true;
  };"""
assert old in src, 'flankOk anchor'
src = src.replace(old, new, 1)
open('.gdd57.js', 'w', encoding='utf-8').write(src)
print('patched .gdd57.js (census gates)')
