# tune3.py — fixed texture band (percentiles anchored to pond tex5=0)
src = open('.gdd14.js', encoding='utf-8').read()
old = "    const sTx = rampL(tx[i], pTx8, Math.max(pTx40, pTx8 * 1.8));"
new = ("    // v-tune3 (fixed texture band): percentile thresholds anchored to\n"
       "    // the pond's near-zero tex5 and excluded the green's real mow\n"
       "    // texture (tex5 3-7). Fixed band: green texture ~1.2..9.\n"
       "    const sTx = rampH(tx[i], 1.0, 9.0) * 0.6\n"
       "      + rampL(tx[i], 9.0, 16.0) * 0.4;")
assert old in src, 'anchor missing'
open('.gdd15.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd15.js')
