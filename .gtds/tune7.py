# tune7.py — soften the water veto: hard only for true water (br<55 AND flat);
# shaded fringe gets a soft penalty (hard zero severed the green at its
# shaded south fringe — cell (0,-6) scored 0.00 and split the component)
src = open('.gdd14.js', encoding='utf-8').read()
old = "    if ((hasSat && fin(br[i]) && br[i] < 70) || sFlat === 0) s = 0;"
new = ("    // v-tune2b: hard veto only for true water (flat AND br<55);\n"
       "    // shaded fringe (br 55-70) gets a soft penalty - a hard zero at\n"
       "    // the green's shaded south fringe severed the component.\n"
       "    if (sFlat === 0) s = 0;\n"
       "    else if (hasSat && fin(br[i]) && br[i] < 55) s = 0;\n"
       "    else if (hasSat && fin(br[i]) && br[i] < 70) s *= 0.45;")
assert old in src, 'anchor missing'
open('.gdd22.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd22.js')
