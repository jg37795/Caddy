# tune12.py — pin-centred grow: loosen lo when the blob centroid drifts
# >12 m from the pin (the pin is ON the green; lopsided blob = under-growth)
src = open('.gdd27.js', encoding='utf-8').read()
old = "    else if (area < 150 && lo > 0.26) { lo -= 0.05; keep = grow(lo, hi, 75); cnt = nOn(keep); }"
new = ("    else if (area < 150 && lo > 0.26) { lo -= 0.05; keep = grow(lo, hi, 75); cnt = nOn(keep); }\n"
       "    // v-tune6 (pin-centred contract): if the blob centroid drifted\n"
       "    // >12 m from the pin, growth is lopsided - loosen lo once to pull\n"
       "    // the far flank in (pin is ON the green; centred blob expected).\n"
       "    else {\n"
       "      let cx2 = 0, cy2 = 0;\n"
       "      for (let i = 0; i < N; i++) if (keep[i]) {\n"
       "        cx2 += (i % W - W / 2) * cs; cy2 += (H / 2 - ((i / W) | 0)) * cs;\n"
       "      }\n"
       "      cx2 /= cnt || 1; cy2 /= cnt || 1;\n"
       "      if (Math.hypot(cx2, cy2) > 12 && lo > 0.30) {\n"
       "        lo -= 0.06; keep = grow(lo, hi, 75); cnt = nOn(keep);\n"
       "      }\n"
       "    }")
assert old in src, 'anchor missing'
open('.gdd29.js', 'w', encoding='utf-8').write(src.replace(old, new))
print('patched .gdd29.js')
