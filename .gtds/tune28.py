# tune28.py — flank smooth3 cap 0.40 → 0.45, BFS depth 3 → 5
src = open('.gdd45.js', encoding='utf-8').read()
old = "if (!fin(sm[i]) || sm[i] > 0.40) return false;"
new = "if (!fin(sm[i]) || sm[i] > 0.45) return false;"
assert old in src, 'anchor1'
src = src.replace(old, new, 1)
old2 = "      if (depth[i] >= 3) continue;"
new2 = "      if (depth[i] >= 5) continue;"
assert old2 in src, 'anchor2'
src = src.replace(old2, new2, 1)
open('.gdd46.js', 'w', encoding='utf-8').write(src)
print('patched .gdd46.js')
