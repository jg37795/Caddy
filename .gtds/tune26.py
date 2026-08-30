# tune26.py — print cnt at morphology time on .gdd43
src = open('.gdd43.js', encoding='utf-8').read()
anchor = "  keep = cnt * ca > 1400 ? dilate(erode(keep))"
probe = """  console.error('[dbg] morphology cnt', cnt, 'area m2', (cnt * ca).toFixed(0),
    'lo', lo.toFixed(2), 'hi', hi.toFixed(2));
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd44.js', 'w', encoding='utf-8').write(src)
print('patched .gdd44.js')
