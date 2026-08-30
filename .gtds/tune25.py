# tune25.py — the dbg COMP print references cd before its declaration
# (siteA now passes through it after the seed-survival fix). Move the
# print AFTER cd is computed (before the bbox continue).
src = open('.gdd42.js', encoding='utf-8').read()
bad = """    console.error('[dbg] COMP area', area.toFixed(0), 'cd', cd.toFixed(1),
      'contains', contains, 'bbox', (maxx - minx).toFixed(0) + 'x' + (maxy - miny).toFixed(0));
    if (maxx - minx < 8 || maxy - miny < 8) continue;"""
good = """    if (maxx - minx < 8 || maxy - miny < 8) continue;
    const cd2 = Math.hypot(sx / cells.length, sy / cells.length);
    console.error('[dbg] COMP area', area.toFixed(0), 'cd', cd2.toFixed(1),
      'contains', contains, 'bbox', (maxx - minx).toFixed(0) + 'x' + (maxy - miny).toFixed(0));"""
assert bad in src, 'anchor missing'
src = src.replace(bad, good, 1)
open('.gdd43.js', 'w', encoding='utf-8').write(src)
print('patched .gdd43.js (COMP print after cd)')
