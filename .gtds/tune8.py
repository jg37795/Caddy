# tune8.py — pin-anchored grow: always seed the origin cell (the pin IS on
# the green per the product contract); not only as last resort.
src = open('.gdd22.js', encoding='utf-8').read()
old = "    if (!q.length && score[maxNearI] >= loT) { keep[maxNearI] = 1; q.push(maxNearI); }"
new = ("    // v-tune3 (product contract): the pin IS on the green - always seed\n"
       "    // the grow at the origin cell too, not only as a last resort.\n"
       "    const oi2 = ((H / 2) | 0) * W + ((W / 2) | 0);\n"
       "    if (score[oi2] >= loT && !keep[oi2]) { keep[oi2] = 1; q.push(oi2); }\n"
       "    if (!q.length && score[maxNearI] >= loT) { keep[maxNearI] = 1; q.push(maxNearI); }")
assert old in src, 'anchor missing'
open('.gdd23.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd23.js')
