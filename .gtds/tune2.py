# tune2.py — near-zero-texture veto (water/parking are unnaturally flat)
src = open('.gdd12.js', encoding='utf-8').read()
old = "    const sTx = rampL(tx[i], pTx8, Math.max(pTx40, pTx8 * 1.8));"
new = ("    const sTx = rampL(tx[i], pTx8, Math.max(pTx40, pTx8 * 1.8));\n"
       "    // v-tune2: near-ZERO texture = water/pad (unnaturally flat); real\n"
       "    // greens carry mow/slope texture (tex5 ~1-4 here)\n"
       "    const sFlat = (tx[i] === tx[i] && tx[i] < 0.5) ? 0 : 1;")
assert old in src
src = src.replace(old, new)
old2 = "    if (hasSat && fin(br[i]) && br[i] < 70) s = 0;"
new2 = "    if ((hasSat && fin(br[i]) && br[i] < 70) || sFlat === 0) s = 0;"
assert old2 in src
src = src.replace(old2, new2)
open('.gdd14.js', 'w', encoding='utf-8').write(src)
print('patched .gdd14.js')
