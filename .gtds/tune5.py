# tune5.py — instrument grow thresholds + blob selection with stderr logs
src = open('.gdd17.js', encoding='utf-8').read()
old = "  if (maxNear < 0.36) return null;"
new = ("  console.error('[dbg] maxNear', maxNear.toFixed(2),\n"
       "    'seed', (((maxNearI % W) - W / 2) * cs).toFixed(0),\n"
       "    ((H / 2 - ((maxNearI / W) | 0)) * cs).toFixed(0));\n"
       "  if (maxNear < 0.36) return null;")
assert old in src
src = src.replace(old, new, 1)
old2 = "  const ring = loops[0];"
new2 = ("  console.error('[dbg] loops', loops.length,\n"
        "    'areas', loops.map(l => areaAbs(l).toFixed(0)).join(','),\n"
        "    'cents', loops.map(l => centroidOf(l).map(v => v.toFixed(0)).join(',')).join(' | '));\n"
        "  const ring = loops[0];")
assert old2 in src
src = src.replace(old2, new2, 1)
open('.gdd20.js', 'w', encoding='utf-8').write(src)
print('patched .gdd20.js')
