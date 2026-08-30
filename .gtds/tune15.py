# tune15.py — flank pass: add smoothness cap (fairway mottling filter)
src = open('.gdd30.js', encoding='utf-8').read()
old = ("        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 60) continue;\n"
       "        if (!flankOk(j)) continue;\n"
       "        chosen[j] = 1; fq.push(j); grown++;")
new = ("        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 60) continue;\n"
       "        if (!flankOk(j)) continue;\n"
       "        // v-tune15: smoothness cap - fairway mottling is >0.45;\n"
       "        // green dome flanks stay 0.1-0.35\n"
       "        if (!fin(sm[j]) || sm[j] > 0.42) continue;\n"
       "        chosen[j] = 1; fq.push(j); grown++;")
assert old in src, 'anchor missing'
open('.gdd32.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd32.js')
