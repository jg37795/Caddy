# tune10.py — double-open severs the thin collar bridge to aprons
src = open('.gdd26.js', encoding='utf-8').read()
old = "  keep = cnt * ca > 1400 ? dilate(erode(keep)) : erode(dilate(keep));"
new = ("  // v-tune5: double-open severs the thin mowed-collar bridge between\n"
       "  // the green and neighbouring smooth aprons; interior survives.\n"
       "  keep = cnt * ca > 1400 ? dilate(erode(dilate(erode(keep))))\n"
       "                          : erode(dilate(erode(dilate(keep))));")
assert old in src, 'anchor missing'
open('.gdd27.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd27.js')
