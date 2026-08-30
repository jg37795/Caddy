# tune4.py — pick the component NEAREST the origin, not the largest
src = open('.gdd15.js', encoding='utf-8').read()
old = ("  loops.sort((a, b) => areaAbs(b) - areaAbs(a));\n"
       "  const ring = loops[0];")
new = ("  // v-tune4 (per brief: pick the component nearest the origin/pin —\n"
       "  // the user dropped the pin ON the green). Largest-area was wrong:\n"
       "  // a bigger smooth neighbour (apron/tee complex) beat the pin's green.\n"
       "  const centroidOf = (p) => {\n"
       "    let x = 0, y = 0;\n"
       "    for (const pt of p) { x += pt[0]; y += pt[1]; }\n"
       "    return [x / p.length, y / p.length];\n"
       "  };\n"
       "  loops.sort((a, b) => {\n"
       "    const ca = centroidOf(a), cb = centroidOf(b);\n"
       "    const da = ca[0] * ca[0] + ca[1] * ca[1];\n"
       "    const db = cb[0] * cb[0] + cb[1] * cb[1];\n"
       "    if (da !== db) return da - db;   // nearest origin first\n"
       "    return areaAbs(b) - areaAbs(a);\n"
       "  });\n"
       "  const ring = loops[0];")
assert old in src
open('.gdd17.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd17.js')
