# tune_water_veto.py — hard-exclude dark flat regions from the grow map
src = open('.gdd9.js', encoding='utf-8').read()
old = "    if (dist < 70) s += 0.035 * (1 - dist / 70);\n    score[i] = s;"
new = ("    if (dist < 70) s += 0.035 * (1 - dist / 70);\n"
       "    // v-tune: water/shadow hard exclusion (dark+flat = pond, never green)\n"
       "    if (hasSat && fin(br[i]) && br[i] < 70) s = 0;\n"
       "    score[i] = s;")
assert old in src, 'anchor not found'
open('.gdd12.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd12.js')
