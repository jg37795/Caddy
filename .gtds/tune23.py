# tune23.py — instrument siteB component list on .gdd39 (which has the
# score map) — add COMP print before the bbox filter
src = open('.gdd39.js', encoding='utf-8').read()
anchor = "    if (maxx - minx < 8 || maxy - miny < 8) continue;"
probe = """    console.error('[dbg] COMP area', area.toFixed(0), 'cd', cd.toFixed(1),
      'contains', contains, 'bbox', (maxx - minx).toFixed(0) + 'x' + (maxy - miny).toFixed(0));
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd40.js', 'w', encoding='utf-8').write(src)
print('patched .gdd40.js')
