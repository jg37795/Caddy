# tune6.py — print the score map around the origin
src = open('.gdd20.js', encoding='utf-8').read()
anchor = "  if (maxNear < 0.36) return null;"
probe = """  console.error('[dbg] score map rows y=+18..-18 step 6, cols x=-12..+12 step 6:');
  for (let my = 18; my >= -18; my -= 6) {
    let row = '[dbg] y' + String(my).padStart(4) + ':';
    for (let mx = -12; mx <= 12; mx += 6) {
      const i = Math.round(H / 2 - my / cs) * W + Math.round(mx / cs + W / 2);
      row += String(score[i].toFixed(2)).padStart(7);
    }
    console.error(row);
  }
  if (maxNear < 0.36) return null;"""
assert anchor in src
src = src.replace(anchor, probe, 1)
open('.gdd21.js', 'w', encoding='utf-8').write(src)
print('patched .gdd21.js')
