# tune5b.py — instrument grow thresholds + blob selection (stderr logs)
src = open('.gdd17.js', encoding='utf-8').read()
# siteA run logs via "EXIT maxNear" on line 70 — insert dbg before it
old = 'console.log("EXIT maxNear", maxNear.toFixed(3)); if (maxNear < 0.36)'
new = ('console.error("[dbg] maxNear", maxNear.toFixed(2));\n'
       '  if (maxNear < 0.36)')
assert old in src, 'anchor1 missing'
src = src.replace(old, new, 1)
old2 = '  const ring = loops[0];'
new2 = ('  console.error("[dbg] loops", loops.length,\n'
        '    "areas", loops.map(l => areaAbs(l).toFixed(0)).join(","),\n'
        '    "cents", loops.map(l => centroidOf(l).map(v => v.toFixed(0)).join(",")).join(" | "));\n'
        '  const ring = loops[0];')
assert old2 in src, 'anchor2 missing'
src = src.replace(old2, new2, 1)
open('.gdd20.js', 'w', encoding='utf-8').write(src)
print('patched .gdd20.js')
