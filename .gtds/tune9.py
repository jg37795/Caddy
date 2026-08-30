# tune9.py — clip around the PIN (origin), not the high-score core
src = open('.gdd23.js', encoding='utf-8').read()
old = ("  if (cn) {\n"
       "    csx /= cn; csy /= cn;\n"
       "    for (let i = 0; i < N; i++) if (keep[i]) {\n"
       "      const ix = i % W, iy = (i / W) | 0;\n"
       "      if (Math.hypot((ix - W / 2) * cs - csx, (H / 2 - iy) * cs - csy) > 44) keep[i] = 0;\n"
       "    }\n"
       "  }")
new = ("  if (cn) {\n"
       "    // v-tune4 (product contract): clip centred on the PIN (origin),\n"
       "    // not the high-score core. The core centroid gets dragged by\n"
       "    // whichever smooth region dominated; the pin is ground truth for\n"
       "    // where the green is. Radius 65 m = corridor cap anyway.\n"
       "    csx = 0; csy = 0;\n"
       "    for (let i = 0; i < N; i++) if (keep[i]) {\n"
       "      const ix = i % W, iy = (i / W) | 0;\n"
       "      if (Math.hypot((ix - W / 2) * cs - csx, (H / 2 - iy) * cs - csy) > 65) keep[i] = 0;\n"
       "    }\n"
       "  }")
assert old in src, 'anchor missing'
open('.gdd26.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd26.js')
